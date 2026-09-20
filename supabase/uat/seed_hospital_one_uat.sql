-- Hospital ONE controlled UAT seed. Run after all migrations, including 202609200001.
-- Safe to rerun: all records use stable UAT-* codes.
begin;

do $$
declare
  org uuid; fac uuid; actor uuid; main_store uuid; supplier uuid; ward_id uuid;
  paracetamol uuid; amoxicillin uuid; syringe uuid;
  svc_paracetamol uuid; svc_amoxicillin uuid; svc_syringe uuid; svc_ward uuid; svc_pf uuid;
  doctor uuid;
begin
  select f.organization_id,f.id into org,fac from public.facilities f where f.status='active' order by f.created_at limit 1;
  if fac is null then raise exception 'Create an active facility before running the UAT seed'; end if;
  select ur.user_id into actor from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.facility_id=fac and ur.active and p.status='active' limit 1;
  if actor is null then raise exception 'Assign an active user to the facility before running the UAT seed'; end if;

  insert into public.service_catalog(organization_id,code,name,category,billable,status,unit_of_measure,revenue_class,allow_price_override,requires_override_approval)
  values
    (org,'UAT-MED-PARA','UAT Paracetamol 500 mg','medicine',true,'active','tablet','pharmacy',true,true),
    (org,'UAT-MED-AMOX','UAT Amoxicillin 500 mg','medicine',true,'active','capsule','pharmacy',true,true),
    (org,'UAT-SUP-SYR','UAT Disposable Syringe 5 mL','supply',true,'active','piece','supplies',true,true),
    (org,'UAT-ROOM-WARD','UAT General Ward Daily Rate','room',true,'active','day','room',true,true),
    (org,'UAT-PF-GEN','UAT General Professional Fee','professional_fee',true,'active','service','professional_fee',true,true)
  on conflict(organization_id,code) do update set name=excluded.name,category=excluded.category,billable=true,status='active';

  select id into svc_paracetamol from public.service_catalog where organization_id=org and code='UAT-MED-PARA';
  select id into svc_amoxicillin from public.service_catalog where organization_id=org and code='UAT-MED-AMOX';
  select id into svc_syringe from public.service_catalog where organization_id=org and code='UAT-SUP-SYR';
  select id into svc_ward from public.service_catalog where organization_id=org and code='UAT-ROOM-WARD';
  select id into svc_pf from public.service_catalog where organization_id=org and code='UAT-PF-GEN';

  delete from public.service_prices where facility_id=fac and service_id in(svc_paracetamol,svc_amoxicillin,svc_syringe,svc_ward,svc_pf);
  insert into public.service_prices(service_id,facility_id,amount,minimum_amount,maximum_amount,effective_from,approved_by,created_by)
  values
    (svc_paracetamol,fac,8,5,15,current_date,actor,actor),(svc_amoxicillin,fac,25,20,40,current_date,actor,actor),
    (svc_syringe,fac,18,10,30,current_date,actor,actor),(svc_ward,fac,1200,1000,1800,current_date,actor,actor),
    (svc_pf,fac,800,500,1500,current_date,actor,actor);

  insert into public.products(organization_id,code,name,product_type,unit,reorder_level,status,billing_service_id)
  values
    (org,'UAT-PARA-500','UAT Paracetamol 500 mg','medicine','tablet',100,'active',svc_paracetamol),
    (org,'UAT-AMOX-500','UAT Amoxicillin 500 mg','medicine','capsule',50,'active',svc_amoxicillin),
    (org,'UAT-SYR-5ML','UAT Disposable Syringe 5 mL','supply','piece',50,'active',svc_syringe)
  on conflict(organization_id,code) do update set name=excluded.name,status='active',billing_service_id=excluded.billing_service_id;
  select id into paracetamol from public.products where organization_id=org and code='UAT-PARA-500';
  select id into amoxicillin from public.products where organization_id=org and code='UAT-AMOX-500';
  select id into syringe from public.products where organization_id=org and code='UAT-SYR-5ML';

  insert into public.wards(facility_id,code,name,status,billing_service_id) values(fac,'UAT-WARD','UAT General Ward','active',svc_ward)
  on conflict(facility_id,code) do update set name=excluded.name,status='active',billing_service_id=excluded.billing_service_id returning id into ward_id;
  if ward_id is null then select id into ward_id from public.wards where facility_id=fac and code='UAT-WARD'; end if;
  insert into public.beds(ward_id,code,status) values(ward_id,'UAT-BED-01','available'),(ward_id,'UAT-BED-02','available') on conflict(ward_id,code) do update set status='available';

  insert into public.stores(facility_id,code,name,store_type,status) values(fac,'UAT-PHARM','UAT Pharmacy Store','pharmacy','active')
  on conflict(facility_id,code) do update set name=excluded.name,status='active' returning id into main_store;
  if main_store is null then select id into main_store from public.stores where facility_id=fac and code='UAT-PHARM'; end if;
  insert into public.suppliers(organization_id,code,name,status,created_by) values(org,'UAT-SUPPLIER','UAT Medical Supplier','active',actor)
  on conflict(organization_id,code) do update set name=excluded.name,status='active' returning id into supplier;
  if supplier is null then select id into supplier from public.suppliers where organization_id=org and code='UAT-SUPPLIER'; end if;

  insert into public.stock_lots(store_id,product_id,lot_no,expiry_date,quantity_on_hand,unit_cost,supplier_id,received_at)
  values(main_store,paracetamol,'UAT-PARA-L01',current_date+365,500,3.50,supplier,now()),(main_store,amoxicillin,'UAT-AMOX-L01',current_date+365,200,12,supplier,now()),(main_store,syringe,'UAT-SYR-L01',current_date+730,300,7,supplier,now())
  on conflict(store_id,product_id,lot_no) do update set quantity_on_hand=excluded.quantity_on_hand,unit_cost=excluded.unit_cost,expiry_date=excluded.expiry_date,supplier_id=excluded.supplier_id;

  select dfa.doctor_id into doctor from public.doctor_facility_assignments dfa join public.doctors d on d.id=dfa.doctor_id where dfa.facility_id=fac and dfa.active and d.status='active' limit 1;
  if doctor is not null and not exists(select 1 from public.doctor_fee_schedules where facility_id=fac and doctor_id=doctor and service_id=svc_pf and active) then
    insert into public.doctor_fee_schedules(facility_id,doctor_id,service_id,encounter_type,room_type,standard_amount,minimum_amount,maximum_amount,hospital_share_percent,effective_from,created_by)
    values(fac,doctor,svc_pf,'all','all',800,500,1500,20,current_date,actor);
  end if;

  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,reason,details)
  values(org,fac,actor,'uat.seed_loaded','uat_dataset','Controlled Hospital ONE workflow testing',jsonb_build_object('prefix','UAT-','services',5,'products',3,'ward','UAT-WARD'));
end$$;
commit;

select 'UAT seed ready' result,code,name from public.service_catalog where code like 'UAT-%' order by code;
