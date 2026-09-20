-- Run only after UAT transactions using UAT products/ward have been reversed or removed.
-- The transaction rolls back automatically if foreign-key-linked UAT activity still exists.
begin;
do $$
declare org uuid;fac uuid;actor uuid;
begin
 select f.organization_id,f.id into org,fac from public.facilities f where f.status='active' order by f.created_at limit 1;
 select ur.user_id into actor from public.user_roles ur where ur.facility_id=fac and ur.active limit 1;
 delete from public.doctor_fee_schedules where facility_id=fac and service_id in(select id from public.service_catalog where organization_id=org and code like 'UAT-%');
 delete from public.stock_movements where product_id in(select id from public.products where organization_id=org and code like 'UAT-%');
 delete from public.stock_lots where product_id in(select id from public.products where organization_id=org and code like 'UAT-%');
 delete from public.beds where ward_id in(select id from public.wards where facility_id=fac and code like 'UAT-%');
 delete from public.wards where facility_id=fac and code like 'UAT-%';
 delete from public.products where organization_id=org and code like 'UAT-%';
 delete from public.stores where facility_id=fac and code like 'UAT-%';
 delete from public.suppliers where organization_id=org and code like 'UAT-%';
 delete from public.service_prices where facility_id=fac and service_id in(select id from public.service_catalog where organization_id=org and code like 'UAT-%');
 delete from public.service_catalog where organization_id=org and code like 'UAT-%';
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,reason,details) values(org,fac,actor,'uat.seed_removed','uat_dataset','Hospital ONE UAT cleanup',jsonb_build_object('prefix','UAT-'));
end$$;
commit;
