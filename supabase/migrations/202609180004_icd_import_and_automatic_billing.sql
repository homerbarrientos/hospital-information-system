begin;

alter table public.products add column if not exists billing_service_id uuid references public.service_catalog;
alter table public.wards add column if not exists billing_service_id uuid references public.service_catalog;
alter table public.encounter_care_team
 add column if not exists fee_status text not null default 'not_required' check(fee_status in('not_required','pending','approved','posted','rejected')),
 add column if not exists fee_approved_by uuid references public.profiles,
 add column if not exists fee_approved_at timestamptz,
 add column if not exists billing_ledger_entry_id uuid references public.ledger_entries;

create index if not exists products_billing_service_idx on public.products(billing_service_id) where billing_service_id is not null;
create index if not exists wards_billing_service_idx on public.wards(billing_service_id) where billing_service_id is not null;
create index if not exists care_team_fee_status_idx on public.encounter_care_team(status,fee_status) where professional_fee is not null;

create or replace function public.import_diagnosis_master_batch(target_facility uuid,rows_json jsonb,source_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;row_item jsonb;imported integer:=0;updated integer:=0;skipped integer:=0;code_value text;title_value text;existing uuid;
begin
 if not public.has_privilege('clinical_registry.write',target_facility) then raise exception 'Not authorized to import diagnosis master data';end if;
 if jsonb_typeof(rows_json)<>'array' or jsonb_array_length(rows_json)<1 or jsonb_array_length(rows_json)>500 then raise exception 'Import between 1 and 500 rows per batch';end if;
 select organization_id into org from public.facilities where id=target_facility;
 for row_item in select value from jsonb_array_elements(rows_json) loop
  code_value:=upper(trim(coalesce(row_item->>'code','')));title_value:=trim(coalesce(row_item->>'title',''));
  if length(code_value)<2 or length(title_value)<3 then skipped:=skipped+1;continue;end if;
  select id into existing from public.diagnosis_catalog where organization_id=org and code_system=coalesce(nullif(trim(row_item->>'code_system'),''),'ICD-10') and code=code_value;
  if existing is null then
   insert into public.diagnosis_catalog(organization_id,code_system,code,title,chapter,category,disease_class,clinical_course,reportable,philhealth_case_rate_code,source_version,created_by)
   values(org,coalesce(nullif(trim(row_item->>'code_system'),''),'ICD-10'),code_value,title_value,nullif(trim(row_item->>'chapter'),''),nullif(trim(row_item->>'category'),''),coalesce(nullif(trim(row_item->>'disease_class'),''),'unclassified'),coalesce(nullif(trim(row_item->>'clinical_course'),''),'unspecified'),lower(coalesce(row_item->>'reportable','false')) in('true','1','yes','y'),nullif(trim(row_item->>'philhealth_case_rate_code'),''),coalesce(nullif(trim(row_item->>'source_version'),''),nullif(trim(source_name),'')),auth.uid());imported:=imported+1;
  else
   update public.diagnosis_catalog d set title=title_value,chapter=nullif(trim(row_item->>'chapter'),''),category=nullif(trim(row_item->>'category'),''),disease_class=coalesce(nullif(trim(row_item->>'disease_class'),''),d.disease_class),clinical_course=coalesce(nullif(trim(row_item->>'clinical_course'),''),d.clinical_course),reportable=lower(coalesce(row_item->>'reportable','false')) in('true','1','yes','y'),philhealth_case_rate_code=nullif(trim(row_item->>'philhealth_case_rate_code'),''),source_version=coalesce(nullif(trim(row_item->>'source_version'),''),nullif(trim(source_name),'')),version=d.version+1,updated_by=auth.uid(),updated_at=now() where d.id=existing;updated:=updated+1;
  end if;
 end loop;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,reason,details) values(org,target_facility,auth.uid(),'diagnosis_master.imported','diagnosis_catalog',nullif(trim(source_name),''),jsonb_build_object('imported',imported,'updated',updated,'skipped',skipped));
 return jsonb_build_object('imported',imported,'updated',updated,'skipped',skipped);
end$$;

create or replace function public.post_automatic_encounter_charge(target_encounter uuid,target_service uuid,source_kind text,source_record uuid,quantity numeric,charge_description text,posting_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid;patient uuid;account uuid;price numeric;entry uuid;key text;
begin
 select facility_id,patient_id into fac,patient from public.encounters where id=target_encounter;
 if fac is null or target_service is null or coalesce(quantity,0)<=0 then return null;end if;
 select amount into price from public.service_prices where facility_id=fac and service_id=target_service and effective_from<=current_date and (effective_to is null or effective_to>=current_date) order by effective_from desc limit 1;
 if price is null then return null;end if;
 select id into account from public.patient_accounts where patient_id=patient and facility_id=fac and status='open' order by created_at desc limit 1;
 if account is null then insert into public.patient_accounts(patient_id,facility_id,status) values(patient,fac,'open') returning id into account;end if;
 key:='auto-'||source_kind||'-'||source_record::text;
 insert into public.ledger_entries(account_id,encounter_id,kind,source_type,source_id,idempotency_key,description,amount,posted_by)
 values(account,target_encounter,'charge',source_kind,source_record,key,trim(charge_description),round(price*quantity,2),posting_user)
 on conflict(idempotency_key) do nothing returning id into entry;
 return coalesce(entry,(select id from public.ledger_entries where idempotency_key=key));
end$$;

create or replace function public.bill_order_item_on_status() returns trigger language plpgsql security definer set search_path='' as $$
declare enc uuid;triggered boolean;begin
 if (tg_op='UPDATE' and new.status is not distinct from old.status) or new.service_id is null or new.status='cancelled' then return new;end if;
 triggered:=(new.charge_on='request' and new.status='requested') or (new.charge_on='collection' and new.status='collected') or (new.charge_on='completion' and new.status='completed') or (new.charge_on='release' and new.status='released');
 if triggered then select encounter_id into enc from public.clinical_orders where id=new.order_id;perform public.post_automatic_encounter_charge(enc,new.service_id,'order_item',new.id,1,new.description,auth.uid());end if;return new;
end$$;
drop trigger if exists bill_order_item_status on public.order_items;
create trigger bill_order_item_status after insert or update of status on public.order_items for each row execute function public.bill_order_item_on_status();

create or replace function public.bill_dispense_on_post() returns trigger language plpgsql security definer set search_path='' as $$declare enc uuid;service uuid;begin
 if new.status<>'posted' then return new;end if;
 select rx.encounter_id,p.billing_service_id into enc,service from public.prescription_items pi join public.prescriptions rx on rx.id=pi.prescription_id join public.products p on p.id=pi.product_id where pi.id=new.prescription_item_id;
 if service is not null then perform public.post_automatic_encounter_charge(enc,service,'medication_dispense',new.id,new.quantity,'Dispensed medication',new.dispensed_by);end if;return new;
end$$;
drop trigger if exists bill_dispense_post on public.dispenses;
create trigger bill_dispense_post after insert on public.dispenses for each row execute function public.bill_dispense_on_post();

create or replace function public.bill_patient_supply_issue() returns trigger language plpgsql security definer set search_path='' as $$declare service uuid;enc uuid;begin
 if new.movement_type<>'issue' or new.source_type<>'patient_encounter' or new.source_id is null then return new;end if;
 enc:=new.source_id;select billing_service_id into service from public.products where id=new.product_id;
 if service is not null then perform public.post_automatic_encounter_charge(enc,service,'supply_issue',new.id,abs(new.quantity),'Patient supply issue',new.posted_by);end if;return new;
end$$;
drop trigger if exists bill_supply_issue_post on public.stock_movements;
create trigger bill_supply_issue_post after insert on public.stock_movements for each row execute function public.bill_patient_supply_issue();

create or replace function public.bill_completed_bed_stay() returns trigger language plpgsql security definer set search_path='' as $$declare enc uuid;service uuid;days numeric;begin
 if old.ended_at is not null or new.ended_at is null then return new;end if;
 select a.encounter_id,w.billing_service_id into enc,service from public.admissions a join public.beds b on b.id=new.bed_id join public.wards w on w.id=b.ward_id where a.id=new.admission_id;
 days:=greatest(1,ceil(extract(epoch from(new.ended_at-new.started_at))/86400));
 if service is not null then perform public.post_automatic_encounter_charge(enc,service,'bed_stay',new.id,days,'Room and bed charge ('||days||' day/s)',new.recorded_by);end if;return new;
end$$;
drop trigger if exists bill_bed_stay_completion on public.bed_stays;
create trigger bill_bed_stay_completion after update of ended_at on public.bed_stays for each row execute function public.bill_completed_bed_stay();

create or replace function public.approve_professional_fee(target_assignment uuid,approval_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare row_data public.encounter_care_team%rowtype;fac uuid;org uuid;account uuid;patient uuid;entry uuid;key text;
begin
 select * into row_data from public.encounter_care_team where id=target_assignment and status='active' and professional_fee is not null and professional_fee>0 and fee_status in('pending','not_required') for update;
 select e.facility_id,p.organization_id,e.patient_id into fac,org,patient from public.encounters e join public.patients p on p.id=e.patient_id where e.id=row_data.encounter_id;
 if fac is null or not public.has_privilege('billing.adjust.approve',fac) or length(trim(coalesce(approval_reason,'')))<5 then raise exception 'Fee approval authorization and reason are required';end if;
 select id into account from public.patient_accounts where patient_id=patient and facility_id=fac and status='open' order by created_at desc limit 1;
 if account is null then insert into public.patient_accounts(patient_id,facility_id,status) values(patient,fac,'open') returning id into account;end if;
 key:='professional-fee-'||target_assignment::text;
 insert into public.ledger_entries(account_id,encounter_id,kind,source_type,source_id,idempotency_key,description,amount,posted_by,reason) values(account,row_data.encounter_id,'charge','professional_fee',target_assignment,key,'Professional fee — '||row_data.role,row_data.professional_fee,auth.uid(),trim(approval_reason)) on conflict(idempotency_key) do nothing returning id into entry;
 if entry is null then select id into entry from public.ledger_entries where idempotency_key=key;end if;
 update public.encounter_care_team set fee_status='posted',fee_approved_by=auth.uid(),fee_approved_at=now(),billing_ledger_entry_id=entry,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_assignment;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'professional_fee.approved_and_posted','encounter_care_team',target_assignment,trim(approval_reason),jsonb_build_object('ledger_entry_id',entry,'amount',row_data.professional_fee));return entry;
end$$;

grant execute on function public.import_diagnosis_master_batch(uuid,jsonb,text) to authenticated;
grant execute on function public.approve_professional_fee(uuid,text) to authenticated;
revoke execute on function public.post_automatic_encounter_charge(uuid,uuid,text,uuid,numeric,text,uuid) from public,authenticated;

commit;
