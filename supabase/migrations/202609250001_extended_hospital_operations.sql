begin;

insert into public.privileges(code,description,risk_level) values
 ('theatre.read','View operating and delivery cases','privileged'),
 ('theatre.write','Schedule and record operating and delivery cases','high_risk'),
 ('dietary.read','View encounter diet orders','privileged'),
 ('dietary.write','Create and fulfill encounter diet orders','high_risk'),
 ('materials.read','View non-medicine material stock','privileged'),
 ('materials.write','Receive and issue non-medicine materials','high_risk'),
 ('purchasing.read','View purchase orders','privileged'),
 ('purchasing.write','Create purchase orders','high_risk'),
 ('purchasing.approve','Approve and receive purchase orders','high_risk'),
 ('claims.read','View PhilHealth claim worklist','privileged'),
 ('claims.write','Prepare PhilHealth claims and record external outcomes','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id
cross join public.privileges p where o.code='INF' and r.name='Hospital Administrator'
and p.code in('theatre.read','theatre.write','dietary.read','dietary.write','materials.read','materials.write','purchasing.read','purchasing.write','purchasing.approve','claims.read','claims.write')
on conflict do nothing;

create table public.care_cases(
 id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities,
 encounter_id uuid not null references public.encounters,case_type text not null check(case_type in('OR','DR')),
 procedure_name text not null check(length(trim(procedure_name))>=3),room_name text not null,
 scheduled_at timestamptz not null,lead_doctor_id uuid references public.doctors,
 billing_service_id uuid references public.service_catalog,
 status text not null default 'scheduled' check(status in('scheduled','in_progress','completed','cancelled')),
 clinical_note text,created_by uuid not null references public.profiles,created_at timestamptz not null default now(),
 updated_by uuid references public.profiles,updated_at timestamptz
);
create index care_cases_facility_time on public.care_cases(facility_id,scheduled_at desc);
create unique index care_case_room_time on public.care_cases(facility_id,case_type,room_name,scheduled_at) where status in('scheduled','in_progress');

create table public.diet_orders(
 id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities,
 encounter_id uuid not null references public.encounters,diet_type text not null,
 texture text,allergy_precautions text,instructions text,meal_date date not null,
 meal text not null check(meal in('breakfast','lunch','dinner','snack')),
 status text not null default 'ordered' check(status in('ordered','prepared','served','cancelled')),
 created_by uuid not null references public.profiles,created_at timestamptz not null default now(),
 updated_by uuid references public.profiles,updated_at timestamptz
);
create index diet_orders_facility_date on public.diet_orders(facility_id,meal_date desc);

create table public.material_items(
 id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities,
 code text not null,name text not null,category text not null,unit text not null,
 billing_service_id uuid references public.service_catalog,
 reorder_level numeric(14,3) not null default 0 check(reorder_level>=0),
 quantity_on_hand numeric(14,3) not null default 0 check(quantity_on_hand>=0),
 status text not null default 'active' check(status in('active','inactive')),
 created_by uuid not null references public.profiles,created_at timestamptz not null default now(),
 unique(facility_id,code)
);
create table public.material_movements(
 id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities,
 item_id uuid not null references public.material_items,kind text not null check(kind in('receipt','issue')),
 quantity numeric(14,3) not null check(quantity>0),balance_after numeric(14,3) not null,
 encounter_id uuid references public.encounters,purchase_order_id uuid,
 reference_no text,notes text,created_by uuid not null references public.profiles,created_at timestamptz not null default now()
);
create index material_movements_item_time on public.material_movements(item_id,created_at desc);

create table public.purchase_orders(
 id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities,
 supplier_id uuid not null references public.suppliers,item_id uuid not null references public.material_items,
 quantity numeric(14,3) not null check(quantity>0),unit_cost numeric(14,2) not null check(unit_cost>=0),
 status text not null default 'requested' check(status in('requested','approved','rejected','partially_received','received','cancelled')),
 quantity_received numeric(14,3) not null default 0 check(quantity_received>=0 and quantity_received<=quantity),
 reason text not null,decision_reason text,created_by uuid not null references public.profiles,
 decided_by uuid references public.profiles,created_at timestamptz not null default now(),decided_at timestamptz
);
alter table public.material_movements add constraint material_purchase_order_fk foreign key(purchase_order_id) references public.purchase_orders(id);
create unique index material_receipt_purchase_once on public.material_movements(purchase_order_id,reference_no) where purchase_order_id is not null;

create table public.phic_claims(
 id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities,
 encounter_id uuid not null references public.encounters,patient_id uuid not null references public.patients,
 membership_no text not null,diagnosis_code text not null,case_rate_code text,
 status text not null default 'draft' check(status in('draft','ready','submitted_external','returned','approved','denied','paid')),
 external_claim_no text,external_status_note text,submitted_at timestamptz,
 created_by uuid not null references public.profiles,created_at timestamptz not null default now(),
 updated_by uuid references public.profiles,updated_at timestamptz,unique(encounter_id)
);

alter table public.care_cases enable row level security;
alter table public.diet_orders enable row level security;
alter table public.material_items enable row level security;
alter table public.material_movements enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.phic_claims enable row level security;
create policy care_case_read on public.care_cases for select to authenticated using(public.has_privilege('theatre.read',facility_id));
create policy diet_order_read on public.diet_orders for select to authenticated using(public.has_privilege('dietary.read',facility_id));
create policy material_item_read on public.material_items for select to authenticated using(public.has_privilege('materials.read',facility_id) or public.has_privilege('purchasing.read',facility_id));
create policy material_movement_read on public.material_movements for select to authenticated using(public.has_privilege('materials.read',facility_id));
create policy purchase_order_read on public.purchase_orders for select to authenticated using(public.has_privilege('purchasing.read',facility_id));
create policy phic_claim_read on public.phic_claims for select to authenticated using(public.has_privilege('claims.read',facility_id));
create policy purchasing_supplier_read on public.suppliers for select to authenticated using(
 exists(select 1 from public.facilities f where f.organization_id=suppliers.organization_id and public.has_privilege('purchasing.read',f.id))
);
grant select on public.care_cases,public.diet_orders,public.material_items,public.material_movements,public.purchase_orders,public.phic_claims to authenticated;

create or replace function public.create_care_case(target_facility uuid,target_encounter uuid,kind text,procedure_name text,room_name text,scheduled_at timestamptz,lead_doctor uuid,notes text,target_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;new_id uuid;begin
 select organization_id into org from public.facilities where id=target_facility;
 if not public.has_privilege('theatre.write',target_facility) or org is null then raise exception 'Not authorized';end if;
 if not exists(select 1 from public.encounters where id=target_encounter and facility_id=target_facility and status not in('completed','cancelled')) then raise exception 'Choose an active encounter at this facility';end if;
 if lead_doctor is not null and not exists(select 1 from public.doctor_facility_assignments where facility_id=target_facility and doctor_id=lead_doctor and active) then raise exception 'Choose an assigned doctor';end if;
 if target_service is not null and not exists(select 1 from public.service_catalog where id=target_service and organization_id=org and status='active' and billable) then raise exception 'Choose a billable service in this organization';end if;
 insert into public.care_cases(facility_id,encounter_id,case_type,procedure_name,room_name,scheduled_at,lead_doctor_id,clinical_note,billing_service_id,created_by)
 values(target_facility,target_encounter,kind,trim(procedure_name),trim(room_name),scheduled_at,lead_doctor,nullif(trim(notes),''),target_service,auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'care_case.created','care_case',new_id);
 return new_id;
end$$;

create or replace function public.advance_care_case(target_id uuid,next_status text,notes text)
returns void language plpgsql security definer set search_path='' as $$declare row_data public.care_cases%rowtype;org uuid;begin
 select * into row_data from public.care_cases where id=target_id for update;
 if row_data.id is null or not public.has_privilege('theatre.write',row_data.facility_id) then raise exception 'Not authorized';end if;
 if not ((row_data.status='scheduled' and next_status in('in_progress','cancelled')) or (row_data.status='in_progress' and next_status='completed')) then raise exception 'Invalid case transition';end if;
 if next_status in('completed','cancelled') and length(trim(coalesce(notes,'')))<5 then raise exception 'Record a clinical summary or cancellation reason';end if;
 if next_status='completed' and row_data.billing_service_id is not null and not exists(select 1 from public.service_prices where facility_id=row_data.facility_id and service_id=row_data.billing_service_id and effective_from<=current_date and (effective_to is null or effective_to>=current_date)) then raise exception 'Configure an active procedure price before completion';end if;
 update public.care_cases set status=next_status,clinical_note=coalesce(nullif(trim(notes),''),clinical_note),updated_by=auth.uid(),updated_at=now() where id=target_id;
 if next_status='completed' and row_data.billing_service_id is not null then perform public.post_automatic_encounter_charge(row_data.encounter_id,row_data.billing_service_id,'care_case',target_id,1,row_data.procedure_name,auth.uid());end if;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,row_data.facility_id,auth.uid(),'care_case.'||next_status,'care_case',target_id,nullif(trim(notes),''),jsonb_build_object('previous_status',row_data.status));
end$$;

create or replace function public.create_diet_order(target_facility uuid,target_encounter uuid,diet_name text,diet_texture text,allergy_notes text,other_instructions text,service_date date,service_meal text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;new_id uuid;patient uuid;active_allergies text;begin
 select organization_id into org from public.facilities where id=target_facility;
 if not public.has_privilege('dietary.write',target_facility) or not exists(select 1 from public.encounters where id=target_encounter and facility_id=target_facility and status not in('completed','cancelled')) then raise exception 'Choose an active encounter at this facility';end if;
 if length(trim(coalesce(diet_name,'')))<2 then raise exception 'Diet type is required';end if;
 select patient_id into patient from public.encounters where id=target_encounter and facility_id=target_facility;
 select string_agg(substance,', ') into active_allergies from public.allergies where patient_id=patient and status='active';
 insert into public.diet_orders(facility_id,encounter_id,diet_type,texture,allergy_precautions,instructions,meal_date,meal,created_by)
 values(target_facility,target_encounter,trim(diet_name),nullif(trim(diet_texture),''),nullif(concat_ws('; ',case when active_allergies is not null then 'Patient allergies: '||active_allergies end,nullif(trim(allergy_notes),'')),''),nullif(trim(other_instructions),''),service_date,service_meal,auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'diet_order.created','diet_order',new_id);
 return new_id;
end$$;

create or replace function public.advance_diet_order(target_id uuid,next_status text,reason text)
returns void language plpgsql security definer set search_path='' as $$declare row_data public.diet_orders%rowtype;org uuid;begin
 select * into row_data from public.diet_orders where id=target_id for update;
 if row_data.id is null or not public.has_privilege('dietary.write',row_data.facility_id) then raise exception 'Not authorized';end if;
 if not ((row_data.status='ordered' and next_status in('prepared','cancelled')) or (row_data.status='prepared' and next_status in('served','cancelled'))) then raise exception 'Invalid meal transition';end if;
 if next_status='cancelled' and length(trim(coalesce(reason,'')))<5 then raise exception 'Cancellation reason is required';end if;
 update public.diet_orders set status=next_status,updated_by=auth.uid(),updated_at=now() where id=target_id;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason) values(org,row_data.facility_id,auth.uid(),'diet_order.'||next_status,'diet_order',target_id,nullif(trim(reason),''));
end$$;

create or replace function public.create_material_item(target_facility uuid,item_code text,item_name text,item_category text,item_unit text,reorder_quantity numeric,target_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;new_id uuid;begin
 select organization_id into org from public.facilities where id=target_facility;
 if not public.has_privilege('materials.write',target_facility) or length(trim(coalesce(item_code,'')))<2 or length(trim(coalesce(item_name,'')))<2 or length(trim(coalesce(item_category,'')))<2 or length(trim(coalesce(item_unit,'')))<1 then raise exception 'Enter valid material details';end if;
 if target_service is not null and not exists(select 1 from public.service_catalog where id=target_service and organization_id=org and status='active' and billable) then raise exception 'Choose a billable service in this organization';end if;
 insert into public.material_items(facility_id,code,name,category,unit,reorder_level,billing_service_id,created_by) values(target_facility,upper(trim(item_code)),trim(item_name),trim(item_category),trim(item_unit),reorder_quantity,target_service,auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'material.created','material_item',new_id);
 return new_id;
end$$;

create or replace function public.move_material(target_facility uuid,target_item uuid,movement_kind text,movement_quantity numeric,target_encounter uuid,reference_text text,movement_notes text)
returns uuid language plpgsql security definer set search_path='' as $$declare item public.material_items%rowtype;org uuid;new_id uuid;balance numeric;begin
 if not public.has_privilege('materials.write',target_facility) then raise exception 'Not authorized';end if;
 select * into item from public.material_items where id=target_item and facility_id=target_facility and status='active' for update;
 if item.id is null or movement_kind not in('receipt','issue') or coalesce(movement_quantity,0)<=0 then raise exception 'Valid item, movement, and quantity are required';end if;
 if movement_kind='issue' and (target_encounter is null or not exists(select 1 from public.encounters where id=target_encounter and facility_id=target_facility)) then raise exception 'Issue materials against a valid patient encounter';end if;
 if movement_kind='issue' and item.billing_service_id is not null and not exists(select 1 from public.service_prices where facility_id=target_facility and service_id=item.billing_service_id and effective_from<=current_date and (effective_to is null or effective_to>=current_date)) then raise exception 'Configure an active price for this material before issuing it to a patient';end if;
 balance:=item.quantity_on_hand+case when movement_kind='receipt' then movement_quantity else -movement_quantity end;
 if balance<0 then raise exception 'Insufficient material stock';end if;
 update public.material_items set quantity_on_hand=balance where id=target_item;
 insert into public.material_movements(facility_id,item_id,kind,quantity,balance_after,encounter_id,reference_no,notes,created_by)
 values(target_facility,target_item,movement_kind,movement_quantity,balance,target_encounter,nullif(trim(reference_text),''),nullif(trim(movement_notes),''),auth.uid()) returning id into new_id;
 if movement_kind='issue' and item.billing_service_id is not null then
  perform public.post_automatic_encounter_charge(target_encounter,item.billing_service_id,'material_issue',new_id,movement_quantity,item.name,auth.uid());
 end if;
 select organization_id into org from public.facilities where id=target_facility;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,target_facility,auth.uid(),'material.'||movement_kind,'material_movement',new_id,jsonb_build_object('quantity',movement_quantity,'encounter_id',target_encounter));
 return new_id;
end$$;

create or replace function public.create_purchase_order(target_facility uuid,target_supplier uuid,target_item uuid,order_quantity numeric,price_per_unit numeric,order_reason text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;new_id uuid;begin
 select organization_id into org from public.facilities where id=target_facility;
 if not public.has_privilege('purchasing.write',target_facility) then raise exception 'Not authorized';end if;
 if not exists(select 1 from public.suppliers where id=target_supplier and organization_id=org and status='active') or not exists(select 1 from public.material_items where id=target_item and facility_id=target_facility and status='active') then raise exception 'Choose an active supplier and material';end if;
 if coalesce(order_quantity,0)<=0 or coalesce(price_per_unit,-1)<0 or length(trim(coalesce(order_reason,'')))<5 then raise exception 'Quantity, price, and purchase reason are required';end if;
 insert into public.purchase_orders(facility_id,supplier_id,item_id,quantity,unit_cost,reason,created_by) values(target_facility,target_supplier,target_item,order_quantity,price_per_unit,trim(order_reason),auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'purchase.requested','purchase_order',new_id);
 return new_id;
end$$;

create or replace function public.decide_purchase_order(target_id uuid,decision text,decision_notes text)
returns void language plpgsql security definer set search_path='' as $$declare row_data public.purchase_orders%rowtype;org uuid;begin
 select * into row_data from public.purchase_orders where id=target_id for update;
 if row_data.id is null or not public.has_privilege('purchasing.approve',row_data.facility_id) or row_data.status<>'requested' or decision not in('approved','rejected') or length(trim(coalesce(decision_notes,'')))<5 then raise exception 'Pending order, authorized decision, and reason are required';end if;
 if row_data.created_by=auth.uid() then raise exception 'Requester cannot approve their own order';end if;
 update public.purchase_orders set status=decision,decision_reason=trim(decision_notes),decided_by=auth.uid(),decided_at=now() where id=target_id;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason) values(org,row_data.facility_id,auth.uid(),'purchase.'||decision,'purchase_order',target_id,trim(decision_notes));
end$$;

create or replace function public.receive_purchase_order(target_id uuid,received_quantity numeric,delivery_reference text)
returns uuid language plpgsql security definer set search_path='' as $$declare row_data public.purchase_orders%rowtype;item public.material_items%rowtype;org uuid;new_id uuid;balance numeric;begin
 select * into row_data from public.purchase_orders where id=target_id for update;
 if row_data.id is null or not public.has_privilege('purchasing.approve',row_data.facility_id) or row_data.status not in('approved','partially_received') then raise exception 'Approved order and receiving permission are required';end if;
 if coalesce(received_quantity,0)<=0 or row_data.quantity_received+received_quantity>row_data.quantity or length(trim(coalesce(delivery_reference,'')))<2 then raise exception 'Enter a valid quantity and delivery reference';end if;
 if exists(select 1 from public.material_movements where purchase_order_id=target_id and reference_no=trim(delivery_reference)) then raise exception 'Delivery reference was already received for this order';end if;
 select * into item from public.material_items where id=row_data.item_id and facility_id=row_data.facility_id and status='active' for update;
 if item.id is null then raise exception 'Material item is inactive';end if;
 balance:=item.quantity_on_hand+received_quantity;
 update public.material_items set quantity_on_hand=balance where id=item.id;
 update public.purchase_orders set quantity_received=quantity_received+received_quantity,status=case when quantity_received+received_quantity=quantity then 'received' else 'partially_received' end where id=target_id;
 insert into public.material_movements(facility_id,item_id,kind,quantity,balance_after,purchase_order_id,reference_no,created_by) values(row_data.facility_id,item.id,'receipt',received_quantity,balance,target_id,trim(delivery_reference),auth.uid()) returning id into new_id;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,row_data.facility_id,auth.uid(),'purchase.received','material_movement',new_id,jsonb_build_object('order_id',target_id,'quantity',received_quantity));
 return new_id;
end$$;

create or replace function public.prepare_phic_claim(target_facility uuid,target_encounter uuid,diagnosis_text text,rate_text text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;patient uuid;pin text;new_id uuid;begin
 if not public.has_privilege('claims.write',target_facility) then raise exception 'Not authorized';end if;
 select f.organization_id,e.patient_id,p.philhealth_no into org,patient,pin from public.encounters e join public.facilities f on f.id=e.facility_id join public.patients p on p.id=e.patient_id where e.id=target_encounter and e.facility_id=target_facility;
 if patient is null or length(coalesce(pin,''))<>12 or length(trim(coalesce(diagnosis_text,'')))<3 then raise exception 'Patient PhilHealth number (12 digits) and diagnosis code are required';end if;
 insert into public.phic_claims(facility_id,encounter_id,patient_id,membership_no,diagnosis_code,case_rate_code,created_by) values(target_facility,target_encounter,patient,pin,trim(diagnosis_text),nullif(trim(rate_text),''),auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'claim.draft_created','phic_claim',new_id);
 return new_id;
end$$;

create or replace function public.update_phic_claim(target_id uuid,next_status text,external_reference text,status_notes text)
returns void language plpgsql security definer set search_path='' as $$declare row_data public.phic_claims%rowtype;org uuid;begin
 select * into row_data from public.phic_claims where id=target_id for update;
 if row_data.id is null or not public.has_privilege('claims.write',row_data.facility_id) then raise exception 'Not authorized';end if;
 if not ((row_data.status='draft' and next_status='ready') or (row_data.status in('ready','returned') and next_status='submitted_external') or (row_data.status='submitted_external' and next_status in('returned','approved','denied')) or (row_data.status='approved' and next_status='paid')) then raise exception 'Invalid claim transition';end if;
 if next_status='ready' and not exists(select 1 from public.diagnoses where encounter_id=row_data.encounter_id and code=row_data.diagnosis_code and verification_status in('confirmed','final')) then raise exception 'Confirm the encounter diagnosis in Clinical Registry before marking this claim ready';end if;
 if next_status in('submitted_external','approved','paid') and length(trim(coalesce(external_reference,'')))<3 then raise exception 'External PHIC reference is required';end if;
 if next_status in('returned','denied') and length(trim(coalesce(status_notes,'')))<5 then raise exception 'Record the reason returned by PHIC';end if;
 update public.phic_claims set status=next_status,external_claim_no=coalesce(nullif(trim(external_reference),''),external_claim_no),external_status_note=nullif(trim(status_notes),''),submitted_at=case when next_status='submitted_external' then now() else submitted_at end,updated_by=auth.uid(),updated_at=now() where id=target_id;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,row_data.facility_id,auth.uid(),'claim.'||next_status,'phic_claim',target_id,nullif(trim(status_notes),''),jsonb_build_object('external_ref',nullif(trim(external_reference),''),'previous_status',row_data.status));
end$$;

revoke all on function public.create_care_case(uuid,uuid,text,text,text,timestamptz,uuid,text,uuid),public.advance_care_case(uuid,text,text),public.create_diet_order(uuid,uuid,text,text,text,text,date,text),public.advance_diet_order(uuid,text,text),public.create_material_item(uuid,text,text,text,text,numeric,uuid),public.move_material(uuid,uuid,text,numeric,uuid,text,text),public.create_purchase_order(uuid,uuid,uuid,numeric,numeric,text),public.decide_purchase_order(uuid,text,text),public.receive_purchase_order(uuid,numeric,text),public.prepare_phic_claim(uuid,uuid,text,text),public.update_phic_claim(uuid,text,text,text) from public;
grant execute on function public.create_care_case(uuid,uuid,text,text,text,timestamptz,uuid,text,uuid),public.advance_care_case(uuid,text,text),public.create_diet_order(uuid,uuid,text,text,text,text,date,text),public.advance_diet_order(uuid,text,text),public.create_material_item(uuid,text,text,text,text,numeric,uuid),public.move_material(uuid,uuid,text,numeric,uuid,text,text),public.create_purchase_order(uuid,uuid,uuid,numeric,numeric,text),public.decide_purchase_order(uuid,text,text),public.receive_purchase_order(uuid,numeric,text),public.prepare_phic_claim(uuid,uuid,text,text),public.update_phic_claim(uuid,text,text,text) to authenticated;

commit;
