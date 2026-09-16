begin;

insert into public.privileges(code,description,risk_level) values
 ('reference.read','View configurable reference data','privileged'),
 ('reference.write','Maintain configurable dropdown choices','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;
insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('reference.read','reference.write') on conflict do nothing;

create table if not exists public.reference_groups(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 code text not null, name text not null, description text, system_controlled boolean not null default false,
 created_by uuid references public.profiles, created_at timestamptz not null default now(), unique(organization_id,code)
);
create table if not exists public.reference_options(
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.reference_groups on delete restrict,
 code text not null, label text not null, sort_order integer not null default 100, active boolean not null default true,
 metadata jsonb not null default '{}', version integer not null default 1,
 created_by uuid references public.profiles, created_at timestamptz not null default now(), updated_by uuid references public.profiles, updated_at timestamptz,
 unique(group_id,code)
);
alter table public.reference_groups enable row level security;
alter table public.reference_options enable row level security;
create policy "reference groups read" on public.reference_groups for select using(exists(select 1 from public.facilities f where f.organization_id=reference_groups.organization_id and public.has_privilege('reference.read',f.id)));
create policy "reference options read" on public.reference_options for select using(exists(select 1 from public.reference_groups g join public.facilities f on f.organization_id=g.organization_id where g.id=reference_options.group_id and public.has_privilege('reference.read',f.id)));

insert into public.reference_groups(organization_id,code,name,description)
select o.id,v.code,v.name,v.description from public.organizations o cross join(values
 ('sex_at_birth','Sex at birth','Patient demographic choices'),('doctor_specialty','Doctor specialty','Clinical specialties used in the doctor registry'),
 ('order_type','Order type','Clinical diagnostic and service order types'),('order_priority','Order priority','Clinical order urgency'),
 ('order_charge_trigger','Order charge trigger','When an order item becomes billable'),('discharge_disposition','Discharge disposition','Patient outcome or destination at discharge')
)v(code,name,description) where o.code='INF' on conflict(organization_id,code) do update set name=excluded.name,description=excluded.description;

insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g join public.organizations o on o.id=g.organization_id cross join(values
 ('sex_at_birth','female','Female',10),('sex_at_birth','male','Male',20),('sex_at_birth','intersex','Intersex',30),('sex_at_birth','unknown','Unknown',40),
 ('doctor_specialty','general_medicine','General Medicine',10),('doctor_specialty','family_medicine','Family Medicine',20),('doctor_specialty','internal_medicine','Internal Medicine',30),('doctor_specialty','pediatrics','Pediatrics',40),('doctor_specialty','surgery','Surgery',50),('doctor_specialty','obstetrics_gynecology','Obstetrics and Gynecology',60),
 ('order_type','laboratory','Laboratory',10),('order_type','imaging','Imaging',20),('order_type','procedure','Procedure',30),('order_type','supply','Supply',40),('order_type','other','Other',50),
 ('order_priority','routine','Routine',10),('order_priority','urgent','Urgent',20),('order_priority','stat','STAT',30),
 ('order_charge_trigger','none','No automatic charge',10),('order_charge_trigger','request','On request',20),('order_charge_trigger','collection','On collection',30),('order_charge_trigger','completion','On completion',40),('order_charge_trigger','release','On release',50),
 ('discharge_disposition','home','Home',10),('discharge_disposition','transferred','Transferred to another facility',20),('discharge_disposition','against_medical_advice','Home against medical advice',30),('discharge_disposition','expired','Expired',40),('discharge_disposition','other','Other',50)
)v(group_code,code,label,sort_order) on v.group_code=g.code where o.code='INF' on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;

create or replace function public.valid_reference_option(target_organization uuid,group_code text,option_code text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.reference_options ro join public.reference_groups rg on rg.id=ro.group_id where rg.organization_id=target_organization and rg.code=group_code and ro.code=option_code and ro.active)
$$;
create or replace function public.create_reference_group(target_facility uuid,group_code text,group_name text,group_description text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;gid uuid;begin
 if not public.has_privilege('reference.write',target_facility) then raise exception 'Not authorized to maintain reference data';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if lower(trim(group_code))!~'^[a-z][a-z0-9_]{2,49}$' then raise exception 'Code must use lowercase letters, numbers, and underscores';end if;
 if length(trim(group_name))<2 then raise exception 'List name is required';end if;
 insert into public.reference_groups(organization_id,code,name,description,created_by) values(org,lower(trim(group_code)),trim(group_name),nullif(trim(group_description),''),auth.uid()) returning id into gid;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,target_facility,auth.uid(),'reference_group.created','reference_group',gid,jsonb_build_object('code',lower(trim(group_code))));return gid;
end$$;
create or replace function public.create_reference_option(target_facility uuid,target_group uuid,option_code text,option_label text,option_sort integer)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;oid uuid;begin
 if not public.has_privilege('reference.write',target_facility) then raise exception 'Not authorized to maintain reference data';end if;
 select g.organization_id into org from public.reference_groups g join public.facilities f on f.organization_id=g.organization_id where g.id=target_group and f.id=target_facility;
 if org is null then raise exception 'Reference list is outside this facility';end if;
 if lower(trim(option_code))!~'^[a-z0-9][a-z0-9_\-]{0,79}$' or length(trim(option_label))<1 then raise exception 'A valid code and label are required';end if;
 insert into public.reference_options(group_id,code,label,sort_order,created_by) values(target_group,lower(trim(option_code)),trim(option_label),greatest(option_sort,0),auth.uid()) returning id into oid;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,target_facility,auth.uid(),'reference_option.created','reference_option',oid,jsonb_build_object('group_id',target_group,'code',lower(trim(option_code))));return oid;
end$$;
create or replace function public.update_reference_option(target_facility uuid,target_option uuid,option_label text,option_sort integer,expected_version integer,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;old_record jsonb;begin
 if not public.has_privilege('reference.write',target_facility) then raise exception 'Not authorized to maintain reference data';end if;
 select g.organization_id,to_jsonb(o) into org,old_record from public.reference_options o join public.reference_groups g on g.id=o.group_id join public.facilities f on f.organization_id=g.organization_id where o.id=target_option and f.id=target_facility for update of o;
 if org is null then raise exception 'Reference option not found';end if;if length(trim(option_label))<1 then raise exception 'Label is required';end if;if length(trim(modification_reason))<5 then raise exception 'Modification reason must contain at least 5 characters';end if;
 update public.reference_options set label=trim(option_label),sort_order=greatest(option_sort,0),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_option and version=expected_version;
 if not found then raise exception 'Reference option changed. Refresh and try again';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'reference_option.updated','reference_option',target_option,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;
create or replace function public.set_reference_option_status(target_facility uuid,target_option uuid,next_active boolean,change_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;begin
 if not public.has_privilege('reference.write',target_facility) then raise exception 'Not authorized to maintain reference data';end if;
 select g.organization_id into org from public.reference_options o join public.reference_groups g on g.id=o.group_id join public.facilities f on f.organization_id=g.organization_id where o.id=target_option and f.id=target_facility;
 if org is null then raise exception 'Reference option not found';end if;if length(trim(change_reason))<5 then raise exception 'Status reason must contain at least 5 characters';end if;
 update public.reference_options set active=next_active,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_option;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'reference_option.status_changed','reference_option',target_option,trim(change_reason),jsonb_build_object('active',next_active));
end$$;

alter table public.order_items drop constraint if exists order_items_charge_on_check;
create or replace function public.create_order(target_encounter uuid,order_type text,order_priority text,order_instructions text,order_items_json jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;order_id uuid;order_no text;item jsonb;trigger_code text;begin
 select e.facility_id,p.organization_id into fac,org from public.encounters e join public.patients p on p.id=e.patient_id where e.id=target_encounter and e.status<>'cancelled';
 if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Not authorized to create orders';end if;
 if not public.valid_reference_option(org,'order_type',order_type) then raise exception 'Select a valid order type';end if;
 if not public.valid_reference_option(org,'order_priority',order_priority) then raise exception 'Select a valid priority';end if;
 if jsonb_typeof(order_items_json)<>'array' or jsonb_array_length(order_items_json)<1 or jsonb_array_length(order_items_json)>20 then raise exception 'Add between 1 and 20 order items';end if;
 order_no:='ORD-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.clinical_order_no_seq')::text,6,'0');
 insert into public.clinical_orders(encounter_id,order_no,order_type,priority,status,ordered_by,instructions) values(target_encounter,order_no,order_type,order_priority,'requested',auth.uid(),nullif(trim(order_instructions),'')) returning id into order_id;
 for item in select value from jsonb_array_elements(order_items_json) loop trigger_code:=coalesce(item->>'charge_on','none');if length(trim(coalesce(item->>'description','')))<2 or not public.valid_reference_option(org,'order_charge_trigger',trigger_code) then raise exception 'Each item needs a valid description and charge trigger';end if;insert into public.order_items(order_id,description,status,charge_on) values(order_id,trim(item->>'description'),'requested',trigger_code);end loop;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'order.created','clinical_order',order_id,jsonb_build_object('order_no',order_no));return order_id;
end$$;
create or replace function public.amend_order(target_order uuid,order_type text,order_priority text,order_instructions text,order_items_json jsonb,modification_reason text) returns void language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;old_record jsonb;item jsonb;trigger_code text;begin
 select e.facility_id,p.organization_id,to_jsonb(o) into fac,org,old_record from public.clinical_orders o join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id where o.id=target_order and o.status in('requested','acknowledged') for update of o;
 if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Only requested or acknowledged orders can be modified';end if;if length(trim(coalesce(modification_reason,'')))<5 then raise exception 'Modification reason must contain at least 5 characters';end if;
 if not public.valid_reference_option(org,'order_type',order_type) or not public.valid_reference_option(org,'order_priority',order_priority) then raise exception 'Invalid order type or priority';end if;
 if jsonb_typeof(order_items_json)<>'array' or jsonb_array_length(order_items_json)<1 or jsonb_array_length(order_items_json)>20 then raise exception 'Add between 1 and 20 order items';end if;
 delete from public.order_items where order_id=target_order;
 for item in select value from jsonb_array_elements(order_items_json) loop trigger_code:=coalesce(item->>'charge_on','none');if length(trim(coalesce(item->>'description','')))<2 or not public.valid_reference_option(org,'order_charge_trigger',trigger_code) then raise exception 'Each item needs a valid description and charge trigger';end if;insert into public.order_items(order_id,description,status,charge_on) values(target_order,trim(item->>'description'),'requested',trigger_code);end loop;
 update public.clinical_orders set order_type=amend_order.order_type,priority=order_priority,instructions=nullif(trim(order_instructions),''),version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_order;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'order.amended','clinical_order',target_order,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

grant select on public.reference_groups,public.reference_options to authenticated;
grant execute on function public.valid_reference_option(uuid,text,text) to authenticated;
grant execute on function public.create_reference_group(uuid,text,text,text) to authenticated;
grant execute on function public.create_reference_option(uuid,uuid,text,text,integer) to authenticated;
grant execute on function public.update_reference_option(uuid,uuid,text,integer,integer,text) to authenticated;
grant execute on function public.set_reference_option_status(uuid,uuid,boolean,text) to authenticated;
commit;
