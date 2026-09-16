begin;

insert into public.privileges(code,description,risk_level) values
 ('services.read','View the service and test catalog','privileged'),
 ('services.write','Maintain the service and test catalog','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;
insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('services.read','services.write') on conflict do nothing;

alter table public.service_catalog add column if not exists version integer not null default 1,
 add column if not exists updated_by uuid references public.profiles,
 add column if not exists updated_at timestamptz;

alter table public.service_catalog enable row level security;
drop policy if exists "service catalog read" on public.service_catalog;
create policy "service catalog read" on public.service_catalog for select using(exists(select 1 from public.facilities f where f.organization_id=service_catalog.organization_id and public.has_privilege('services.read',f.id)));
alter table public.service_prices enable row level security;
drop policy if exists "service prices read" on public.service_prices;
create policy "service prices read" on public.service_prices for select using(public.has_privilege('services.read',facility_id));

insert into public.reference_groups(organization_id,code,name,description)
select id,'service_category','Service category','Categories used by the service and test catalog' from public.organizations where code='INF'
on conflict(organization_id,code) do update set name=excluded.name,description=excluded.description;
insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g join public.organizations o on o.id=g.organization_id cross join(values
 ('laboratory','Laboratory',10),('imaging','Imaging',20),('procedure','Procedure',30),('supply','Supply',40),('other','Other',50)
)v(code,label,sort_order) where o.code='INF' and g.code='service_category'
on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;

create or replace function public.create_service(target_facility uuid,service_code text,service_name text,service_category text,is_billable boolean,service_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;sid uuid;begin
 if not public.has_privilege('services.write',target_facility) then raise exception 'Not authorized to maintain services';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if length(trim(service_code))<2 or length(trim(service_name))<2 then raise exception 'Service code and name require at least 2 characters';end if;
 if not public.valid_reference_option(org,'service_category',service_category) then raise exception 'Select a valid service category';end if;
 insert into public.service_catalog(organization_id,code,name,category,billable,status) values(org,upper(trim(service_code)),trim(service_name),service_category,is_billable,'active') returning id into sid;
 if is_billable then insert into public.service_prices(service_id,facility_id,amount,effective_from) values(sid,target_facility,greatest(coalesce(service_amount,0),0),current_date);end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,target_facility,auth.uid(),'service.created','service',sid,jsonb_build_object('code',upper(trim(service_code)),'amount',service_amount));return sid;
end$$;

create or replace function public.update_service(target_facility uuid,target_service uuid,service_name text,service_category text,is_billable boolean,service_amount numeric,expected_version integer,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;old_record jsonb;begin
 if not public.has_privilege('services.write',target_facility) then raise exception 'Not authorized to maintain services';end if;
 select s.organization_id,to_jsonb(s) into org,old_record from public.service_catalog s join public.facilities f on f.organization_id=s.organization_id where s.id=target_service and f.id=target_facility for update of s;
 if org is null then raise exception 'Service not found';end if;if length(trim(modification_reason))<5 then raise exception 'Modification reason requires at least 5 characters';end if;
 if not public.valid_reference_option(org,'service_category',service_category) then raise exception 'Select a valid service category';end if;
 update public.service_catalog set name=trim(service_name),category=service_category,billable=is_billable,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_service and version=expected_version;
 if not found then raise exception 'Service changed. Refresh and try again';end if;
 delete from public.service_prices where service_id=target_service and facility_id=target_facility and effective_from=current_date;
 update public.service_prices set effective_to=current_date-1 where service_id=target_service and facility_id=target_facility and effective_to is null;
 if is_billable then insert into public.service_prices(service_id,facility_id,amount,effective_from) values(target_service,target_facility,greatest(coalesce(service_amount,0),0),current_date);end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'service.updated','service',target_service,trim(modification_reason),jsonb_build_object('previous',old_record,'amount',service_amount));
end$$;

create or replace function public.set_service_status(target_facility uuid,target_service uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;begin
 if not public.has_privilege('services.write',target_facility) then raise exception 'Not authorized to maintain services';end if;if length(trim(change_reason))<5 then raise exception 'Status reason requires at least 5 characters';end if;
 select s.organization_id into org from public.service_catalog s join public.facilities f on f.organization_id=s.organization_id where s.id=target_service and f.id=target_facility;
 if org is null then raise exception 'Service not found';end if;update public.service_catalog set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_service;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'service.status_changed','service',target_service,trim(change_reason),jsonb_build_object('status',next_status));
end$$;

create or replace function public.create_order(target_encounter uuid,order_type text,order_priority text,order_instructions text,order_items_json jsonb)
returns uuid language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;oid uuid;ono text;item jsonb;sid uuid;trigger_code text;service_name text;begin
 select e.facility_id,p.organization_id into fac,org from public.encounters e join public.patients p on p.id=e.patient_id where e.id=target_encounter and e.status<>'cancelled';
 if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Not authorized to create orders';end if;
 if not public.valid_reference_option(org,'order_type',order_type) or not public.valid_reference_option(org,'order_priority',order_priority) then raise exception 'Select a valid order type and priority';end if;
 if jsonb_typeof(order_items_json)<>'array' or jsonb_array_length(order_items_json)<1 or jsonb_array_length(order_items_json)>20 then raise exception 'Add between 1 and 20 order items';end if;
 ono:='ORD-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.clinical_order_no_seq')::text,6,'0');
 insert into public.clinical_orders(encounter_id,order_no,order_type,priority,status,ordered_by,instructions) values(target_encounter,ono,order_type,order_priority,'requested',auth.uid(),nullif(trim(order_instructions),'')) returning id into oid;
 for item in select value from jsonb_array_elements(order_items_json) loop
  begin sid:=(item->>'service_id')::uuid;exception when others then raise exception 'Select a valid service or test';end;
  select name into service_name from public.service_catalog where id=sid and organization_id=org and status='active';if service_name is null then raise exception 'Selected service is inactive or invalid';end if;
  trigger_code:=coalesce(item->>'charge_on','none');if not public.valid_reference_option(org,'order_charge_trigger',trigger_code) then raise exception 'Select a valid charge trigger';end if;
  insert into public.order_items(order_id,service_id,description,status,charge_on) values(oid,sid,service_name,'requested',trigger_code);
 end loop;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'order.created','clinical_order',oid,jsonb_build_object('order_no',ono,'item_count',jsonb_array_length(order_items_json)));return oid;
end$$;

create or replace function public.amend_order(target_order uuid,order_type text,order_priority text,order_instructions text,order_items_json jsonb,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;old_record jsonb;item jsonb;sid uuid;trigger_code text;service_name text;begin
 select e.facility_id,p.organization_id,to_jsonb(o) into fac,org,old_record from public.clinical_orders o join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id where o.id=target_order and o.status in('requested','acknowledged') for update of o;
 if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Only requested or acknowledged orders can be modified';end if;if length(trim(coalesce(modification_reason,'')))<5 then raise exception 'Modification reason requires at least 5 characters';end if;
 if exists(select 1 from public.order_items oi join public.clinical_results r on r.order_item_id=oi.id where oi.order_id=target_order) then raise exception 'Orders with results cannot be modified';end if;
 if not public.valid_reference_option(org,'order_type',order_type) or not public.valid_reference_option(org,'order_priority',order_priority) then raise exception 'Select a valid type and priority';end if;
 delete from public.order_items where order_id=target_order;
 for item in select value from jsonb_array_elements(order_items_json) loop sid:=(item->>'service_id')::uuid;select name into service_name from public.service_catalog where id=sid and organization_id=org and status='active';if service_name is null then raise exception 'Selected service is inactive or invalid';end if;trigger_code:=coalesce(item->>'charge_on','none');if not public.valid_reference_option(org,'order_charge_trigger',trigger_code) then raise exception 'Select a valid charge trigger';end if;insert into public.order_items(order_id,service_id,description,status,charge_on) values(target_order,sid,service_name,'requested',trigger_code);end loop;
 update public.clinical_orders set order_type=amend_order.order_type,priority=order_priority,instructions=nullif(trim(order_instructions),''),version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_order;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'order.amended','clinical_order',target_order,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

grant select on public.service_catalog,public.service_prices to authenticated;
grant execute on function public.create_service(uuid,text,text,text,boolean,numeric) to authenticated;
grant execute on function public.update_service(uuid,uuid,text,text,boolean,numeric,integer,text) to authenticated;
grant execute on function public.set_service_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.create_order(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.amend_order(uuid,text,text,text,jsonb,text) to authenticated;
commit;
