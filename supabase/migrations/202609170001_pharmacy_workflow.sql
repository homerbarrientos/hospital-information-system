begin;

insert into public.privileges(code,description,risk_level) values
 ('pharmacy.read','View prescriptions and dispensing records','privileged'),
 ('pharmacy.write','Create, validate, dispense, amend, and cancel prescriptions','high_risk'),
 ('medicines.read','View the medicine master list','privileged'),
 ('medicines.write','Maintain the medicine master list','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('pharmacy.read','pharmacy.write','medicines.read','medicines.write')
on conflict do nothing;

create sequence if not exists public.prescription_no_seq start 1;
alter table public.products add column if not exists version integer not null default 1,
 add column if not exists updated_by uuid references public.profiles,
 add column if not exists updated_at timestamptz;
alter table public.prescriptions add column if not exists prescribing_doctor_id uuid references public.doctors,
 add column if not exists notes text,
 add column if not exists cancellation_reason text,
 add column if not exists version integer not null default 1,
 add column if not exists updated_by uuid references public.profiles,
 add column if not exists updated_at timestamptz;

create table if not exists public.prescription_documents(
 id uuid primary key default gen_random_uuid(),
 prescription_id uuid not null references public.prescriptions,
 storage_path text not null unique,
 original_name text not null,
 display_name text not null,
 description text,
 mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 3145728),
 status public.record_status not null default 'active',
 uploaded_by uuid not null references public.profiles,
 uploaded_at timestamptz not null default now(),
 updated_by uuid references public.profiles,
 updated_at timestamptz,
 removed_by uuid references public.profiles,
 removed_at timestamptz,
 removal_reason text
);
alter table public.prescription_documents enable row level security;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pharmacy-documents','pharmacy-documents',false,3145728,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

insert into public.reference_groups(organization_id,code,name,description)
select id,v.code,v.name,v.description from public.organizations cross join(values
 ('medication_route','Medication route','Routes available for prescriptions'),
 ('medication_frequency','Medication frequency','Common administration frequencies')
)v(code,name,description)
on conflict(organization_id,code) do update set name=excluded.name,description=excluded.description;

insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g cross join(values
 ('oral','Oral',10),('sublingual','Sublingual',20),('topical','Topical',30),('inhalation','Inhalation',40),('intramuscular','Intramuscular',50),('intravenous','Intravenous',60),('subcutaneous','Subcutaneous',70),('rectal','Rectal',80),('other','Other',90)
)v(code,label,sort_order) where g.code='medication_route'
on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;
insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g cross join(values
 ('once_daily','Once daily',10),('twice_daily','Twice daily',20),('three_times_daily','Three times daily',30),('four_times_daily','Four times daily',40),('every_4_hours','Every 4 hours',50),('every_6_hours','Every 6 hours',60),('every_8_hours','Every 8 hours',70),('every_12_hours','Every 12 hours',80),('as_needed','As needed',90),('stat','Immediately (STAT)',100),('other','Other',110)
)v(code,label,sort_order) where g.code='medication_frequency'
on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;

drop policy if exists "medicine master read" on public.products;
create policy "medicine master read" on public.products for select using(
 exists(select 1 from public.facilities f where f.organization_id=products.organization_id and public.has_privilege('medicines.read',f.id))
);
drop policy if exists "pharmacy stock lot read" on public.stock_lots;
create policy "pharmacy stock lot read" on public.stock_lots for select using(
 exists(select 1 from public.stores s where s.id=stock_lots.store_id and public.has_privilege('pharmacy.read',s.facility_id))
);
drop policy if exists "pharmacy prescription read" on public.prescriptions;
create policy "pharmacy prescription read" on public.prescriptions for select using(
 exists(select 1 from public.encounters e where e.id=prescriptions.encounter_id and public.has_privilege('pharmacy.read',e.facility_id))
);
drop policy if exists "pharmacy prescription item read" on public.prescription_items;
create policy "pharmacy prescription item read" on public.prescription_items for select using(
 exists(select 1 from public.prescriptions p join public.encounters e on e.id=p.encounter_id where p.id=prescription_items.prescription_id and public.has_privilege('pharmacy.read',e.facility_id))
);
drop policy if exists "pharmacy dispense read" on public.dispenses;
create policy "pharmacy dispense read" on public.dispenses for select using(
 exists(select 1 from public.prescription_items pi join public.prescriptions p on p.id=pi.prescription_id join public.encounters e on e.id=p.encounter_id where pi.id=dispenses.prescription_item_id and public.has_privilege('pharmacy.read',e.facility_id))
);
drop policy if exists "pharmacy document read" on public.prescription_documents;
create policy "pharmacy document read" on public.prescription_documents for select using(
 exists(select 1 from public.prescriptions p join public.encounters e on e.id=p.encounter_id where p.id=prescription_documents.prescription_id and public.has_privilege('pharmacy.read',e.facility_id))
);
drop policy if exists "pharmacy object insert" on storage.objects;
create policy "pharmacy object insert" on storage.objects for insert to authenticated with check(
 bucket_id='pharmacy-documents' and public.has_privilege('pharmacy.write',((storage.foldername(name))[1])::uuid)
);
drop policy if exists "pharmacy object read" on storage.objects;
create policy "pharmacy object read" on storage.objects for select to authenticated using(
 bucket_id='pharmacy-documents' and public.has_privilege('pharmacy.read',((storage.foldername(name))[1])::uuid)
);
drop policy if exists "pharmacy object delete" on storage.objects;
create policy "pharmacy object delete" on storage.objects for delete to authenticated using(
 bucket_id='pharmacy-documents' and public.has_privilege('pharmacy.write',((storage.foldername(name))[1])::uuid)
);

create or replace function public.create_medicine(target_facility uuid,medicine_code text,medicine_name text,medicine_unit text,reorder_quantity numeric)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;pid uuid;begin
 if not public.has_privilege('medicines.write',target_facility) then raise exception 'Not authorized to maintain medicines';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if length(trim(medicine_code))<2 or length(trim(medicine_name))<2 or length(trim(medicine_unit))<1 then raise exception 'Code, name, and unit are required';end if;
 insert into public.products(organization_id,code,name,product_type,unit,reorder_level,status) values(org,upper(trim(medicine_code)),trim(medicine_name),'medicine',trim(medicine_unit),greatest(coalesce(reorder_quantity,0),0),'active') returning id into pid;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,target_facility,auth.uid(),'medicine.created','product',pid,jsonb_build_object('code',upper(trim(medicine_code))));return pid;
end$$;

create or replace function public.update_medicine(target_facility uuid,target_product uuid,medicine_name text,medicine_unit text,reorder_quantity numeric,expected_version integer,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;old_record jsonb;begin
 if not public.has_privilege('medicines.write',target_facility) or length(trim(coalesce(modification_reason,'')))<5 then raise exception 'Authorization and modification reason are required';end if;
 select p.organization_id,to_jsonb(p) into org,old_record from public.products p join public.facilities f on f.organization_id=p.organization_id where p.id=target_product and p.product_type='medicine' and f.id=target_facility for update of p;
 if org is null then raise exception 'Medicine not found';end if;
 update public.products set name=trim(medicine_name),unit=trim(medicine_unit),reorder_level=greatest(coalesce(reorder_quantity,0),0),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_product and version=expected_version;
 if not found then raise exception 'Medicine changed. Refresh and try again';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'medicine.updated','product',target_product,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

create or replace function public.set_medicine_status(target_facility uuid,target_product uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;begin
 if not public.has_privilege('medicines.write',target_facility) or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization and status reason are required';end if;
 select p.organization_id into org from public.products p join public.facilities f on f.organization_id=p.organization_id where p.id=target_product and p.product_type='medicine' and f.id=target_facility;
 if org is null then raise exception 'Medicine not found';end if;
 update public.products set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_product;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'medicine.status_changed','product',target_product,trim(change_reason),jsonb_build_object('status',next_status));
end$$;

create or replace function public.create_prescription_with_doctor(target_encounter uuid,target_doctor uuid,prescription_notes text,prescription_items_json jsonb)
returns uuid language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;pid uuid;pno text;item jsonb;product uuid;product_name text;begin
 select e.facility_id,pa.organization_id into fac,org from public.encounters e join public.patients pa on pa.id=e.patient_id where e.id=target_encounter and e.status<>'cancelled';
 if fac is null or not public.has_privilege('pharmacy.write',fac) then raise exception 'Not authorized to create prescriptions';end if;
 if not public.active_facility_doctor(target_doctor,fac) then raise exception 'Select an active doctor assigned to this facility';end if;
 if jsonb_typeof(prescription_items_json)<>'array' or jsonb_array_length(prescription_items_json)<1 or jsonb_array_length(prescription_items_json)>20 then raise exception 'Add between 1 and 20 medicines';end if;
 pno:='RX-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.prescription_no_seq')::text,6,'0');
 insert into public.prescriptions(encounter_id,prescription_no,status,prescribed_by,prescribing_doctor_id,notes) values(target_encounter,pno,'ordered',auth.uid(),target_doctor,nullif(trim(prescription_notes),'')) returning id into pid;
 for item in select value from jsonb_array_elements(prescription_items_json) loop
  begin product:=(item->>'product_id')::uuid;exception when others then raise exception 'Select a valid medicine';end;
  select name into product_name from public.products where id=product and organization_id=org and product_type='medicine' and status='active';
  if product_name is null then raise exception 'Selected medicine is inactive or invalid';end if;
  if length(trim(coalesce(item->>'dose','')))<1 or coalesce((item->>'quantity')::numeric,0)<=0 then raise exception 'Dose and a positive quantity are required';end if;
  if not public.valid_reference_option(org,'medication_route',item->>'route') or not public.valid_reference_option(org,'medication_frequency',item->>'frequency') then raise exception 'Select valid route and frequency values';end if;
  insert into public.prescription_items(prescription_id,product_id,dose,route,frequency,duration,quantity,instructions) values(pid,product,trim(item->>'dose'),item->>'route',item->>'frequency',nullif(trim(item->>'duration'),''),(item->>'quantity')::numeric,nullif(trim(item->>'instructions'),''));
 end loop;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'prescription.created','prescription',pid,jsonb_build_object('prescription_no',pno,'item_count',jsonb_array_length(prescription_items_json)));return pid;
end$$;

create or replace function public.amend_prescription(target_prescription uuid,target_doctor uuid,prescription_notes text,prescription_items_json jsonb,expected_version integer,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;old_record jsonb;item jsonb;product uuid;begin
 select e.facility_id,pa.organization_id,to_jsonb(p) into fac,org,old_record from public.prescriptions p join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where p.id=target_prescription and p.status='ordered' for update of p;
 if fac is null or not public.has_privilege('pharmacy.write',fac) or length(trim(coalesce(modification_reason,'')))<5 then raise exception 'Only ordered prescriptions can be modified with a reason';end if;
 if not public.active_facility_doctor(target_doctor,fac) then raise exception 'Select an active doctor';end if;
 if jsonb_typeof(prescription_items_json)<>'array' or jsonb_array_length(prescription_items_json)<1 then raise exception 'Add at least one medicine';end if;
 delete from public.prescription_items where prescription_id=target_prescription;
 for item in select value from jsonb_array_elements(prescription_items_json) loop product:=(item->>'product_id')::uuid;if not exists(select 1 from public.products where id=product and organization_id=org and product_type='medicine' and status='active') then raise exception 'Invalid medicine';end if;insert into public.prescription_items(prescription_id,product_id,dose,route,frequency,duration,quantity,instructions) values(target_prescription,product,trim(item->>'dose'),item->>'route',item->>'frequency',nullif(trim(item->>'duration'),''),(item->>'quantity')::numeric,nullif(trim(item->>'instructions'),''));end loop;
 update public.prescriptions set prescribing_doctor_id=target_doctor,notes=nullif(trim(prescription_notes),''),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_prescription and version=expected_version;
 if not found then raise exception 'Prescription changed. Refresh and try again';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'prescription.amended','prescription',target_prescription,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

create or replace function public.validate_prescription(target_prescription uuid)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;begin
 select e.facility_id,pa.organization_id into fac,org from public.prescriptions p join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where p.id=target_prescription and p.status='ordered' for update of p;
 if fac is null or not public.has_privilege('pharmacy.write',fac) then raise exception 'Prescription cannot be validated';end if;
 update public.prescriptions set status='validated',version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_prescription;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'prescription.validated','prescription',target_prescription,'{}');
end$$;

create or replace function public.cancel_prescription(target_prescription uuid,cancel_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;begin
 select e.facility_id,pa.organization_id into fac,org from public.prescriptions p join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where p.id=target_prescription and p.status in('ordered','validated') for update of p;
 if fac is null or not public.has_privilege('pharmacy.write',fac) or length(trim(coalesce(cancel_reason,'')))<5 then raise exception 'Prescription cannot be cancelled without a reason';end if;
 if exists(select 1 from public.prescription_items pi join public.dispenses d on d.prescription_item_id=pi.id where pi.prescription_id=target_prescription and d.status='posted') then raise exception 'A prescription with posted dispensing cannot be cancelled';end if;
 update public.prescriptions set status='cancelled',cancellation_reason=trim(cancel_reason),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_prescription;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason) values(org,fac,auth.uid(),'prescription.cancelled','prescription',target_prescription,trim(cancel_reason));
end$$;

create or replace function public.dispense_medication(target_item uuid,target_lot uuid,dispense_quantity numeric,request_key text)
returns uuid language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;pres uuid;product uuid;required numeric;already numeric;available numeric;did uuid;store uuid;begin
 select e.facility_id,pa.organization_id,p.id,pi.product_id,pi.quantity into fac,org,pres,product,required from public.prescription_items pi join public.prescriptions p on p.id=pi.prescription_id join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where pi.id=target_item and p.status in('validated','partially_dispensed') for update of p;
 if fac is null or not public.has_privilege('pharmacy.write',fac) or coalesce(dispense_quantity,0)<=0 then raise exception 'Medication cannot be dispensed';end if;
 select sl.quantity_on_hand,sl.store_id into available,store from public.stock_lots sl join public.stores s on s.id=sl.store_id where sl.id=target_lot and sl.product_id=product and s.facility_id=fac and (sl.expiry_date is null or sl.expiry_date>=current_date) for update of sl;
 if available is null or available<dispense_quantity then raise exception 'Selected lot has insufficient available stock';end if;
 select coalesce(sum(quantity),0) into already from public.dispenses where prescription_item_id=target_item and status='posted';
 if already+dispense_quantity>required then raise exception 'Dispensed quantity exceeds the prescribed quantity';end if;
 insert into public.dispenses(prescription_item_id,stock_lot_id,quantity,status,dispensed_by,idempotency_key) values(target_item,target_lot,dispense_quantity,'posted',auth.uid(),nullif(trim(request_key),'')) returning id into did;
 update public.stock_lots set quantity_on_hand=quantity_on_hand-dispense_quantity where id=target_lot;
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,source_id,posted_by,idempotency_key) values(store,product,target_lot,'dispense',-dispense_quantity,'prescription',pres,auth.uid(),'movement-'||did::text);
 if not exists(select 1 from public.prescription_items pi where pi.prescription_id=pres and pi.quantity>(select coalesce(sum(d.quantity),0) from public.dispenses d where d.prescription_item_id=pi.id and d.status='posted')) then update public.prescriptions set status='dispensed',version=version+1,updated_by=auth.uid(),updated_at=now() where id=pres;else update public.prescriptions set status='partially_dispensed',version=version+1,updated_by=auth.uid(),updated_at=now() where id=pres;end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'medication.dispensed','dispense',did,jsonb_build_object('prescription_id',pres,'quantity',dispense_quantity,'lot_id',target_lot));return did;
end$$;

create or replace function public.add_prescription_document(target_prescription uuid,file_path text,original_file_name text,document_title text,document_description text,file_type text,file_size bigint)
returns uuid language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;doc uuid;begin
 select e.facility_id,pa.organization_id into fac,org from public.prescriptions p join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where p.id=target_prescription;
 if fac is null or not public.has_privilege('pharmacy.write',fac) or length(trim(document_title))<2 or file_type not in('application/pdf','image/jpeg','image/png') or file_size not between 1 and 3145728 then raise exception 'Invalid or unauthorized pharmacy document';end if;
 insert into public.prescription_documents(prescription_id,storage_path,original_name,display_name,description,mime_type,size_bytes,uploaded_by) values(target_prescription,file_path,original_file_name,trim(document_title),nullif(trim(document_description),''),file_type,file_size,auth.uid()) returning id into doc;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'prescription_document.added','prescription_document',doc,jsonb_build_object('prescription_id',target_prescription));return doc;
end$$;

create or replace function public.update_prescription_document(target_document uuid,document_title text,document_description text,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;old_record jsonb;begin
 select e.facility_id,pa.organization_id,to_jsonb(d) into fac,org,old_record from public.prescription_documents d join public.prescriptions p on p.id=d.prescription_id join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where d.id=target_document and d.status='active';
 if fac is null or not public.has_privilege('pharmacy.write',fac) or length(trim(document_title))<2 or length(trim(coalesce(modification_reason,'')))<5 then raise exception 'Invalid document update';end if;
 update public.prescription_documents set display_name=trim(document_title),description=nullif(trim(document_description),''),updated_by=auth.uid(),updated_at=now() where id=target_document;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'prescription_document.updated','prescription_document',target_document,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

create or replace function public.remove_prescription_document(target_document uuid,removal_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;begin
 select e.facility_id,pa.organization_id into fac,org from public.prescription_documents d join public.prescriptions p on p.id=d.prescription_id join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where d.id=target_document and d.status='active';
 if fac is null or not public.has_privilege('pharmacy.write',fac) or length(trim(coalesce(removal_reason,'')))<5 then raise exception 'Removal reason is required';end if;
 update public.prescription_documents set status='inactive',removed_by=auth.uid(),removed_at=now(),removal_reason=trim(removal_reason) where id=target_document;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason) values(org,fac,auth.uid(),'prescription_document.removed','prescription_document',target_document,trim(removal_reason));
end$$;

grant select on public.products,public.stock_lots,public.prescriptions,public.prescription_items,public.dispenses,public.prescription_documents to authenticated;
grant execute on function public.create_medicine(uuid,text,text,text,numeric) to authenticated;
grant execute on function public.update_medicine(uuid,uuid,text,text,numeric,integer,text) to authenticated;
grant execute on function public.set_medicine_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.create_prescription_with_doctor(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.amend_prescription(uuid,uuid,text,jsonb,integer,text) to authenticated;
grant execute on function public.validate_prescription(uuid) to authenticated;
grant execute on function public.cancel_prescription(uuid,text) to authenticated;
grant execute on function public.dispense_medication(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.add_prescription_document(uuid,text,text,text,text,text,bigint) to authenticated;
grant execute on function public.update_prescription_document(uuid,text,text,text) to authenticated;
grant execute on function public.remove_prescription_document(uuid,text) to authenticated;

commit;
