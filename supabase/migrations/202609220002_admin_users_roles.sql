begin;

insert into public.privileges(code,description,risk_level) values
 ('admin.users.read','View facility users, staff profiles, and role assignments','high_risk'),
 ('admin.users.write','Invite, configure, activate, and deactivate facility users','high_risk'),
 ('admin.roles.read','View roles and their privilege grants','high_risk'),
 ('admin.roles.write','Create roles and govern privilege grants','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code
from public.roles r
join public.organizations o on o.id=r.organization_id
cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator'
on conflict do nothing;

alter table public.profiles
 add column if not exists email text,
 add column if not exists updated_at timestamptz,
 add column if not exists version integer not null default 1;

alter table public.roles
 add column if not exists status public.record_status not null default 'active',
 add column if not exists version integer not null default 1,
 add column if not exists updated_at timestamptz,
 add column if not exists updated_by uuid references public.profiles;

update public.profiles p set email=u.email
from auth.users u where u.id=p.id and p.email is distinct from u.email;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=''
as $$
declare admin_role uuid;pilot_facility uuid;
begin
 insert into public.profiles(id,full_name,employee_no,email)
 values(
  new.id,
  coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,'User'),'@',1)),
  nullif(new.raw_user_meta_data->>'employee_no',''),
  new.email
 )
 on conflict(id) do update set email=coalesce(public.profiles.email,excluded.email);
 if not exists(select 1 from public.user_roles) then
  select r.id into admin_role from public.roles r join public.organizations o on o.id=r.organization_id where o.code='INF' and r.name='Hospital Administrator';
  select f.id into pilot_facility from public.facilities f join public.organizations o on o.id=f.organization_id where o.code='INF' and f.code='PILOT';
  if admin_role is not null and pilot_facility is not null then
   insert into public.user_roles(user_id,role_id,facility_id) values(new.id,admin_role,pilot_facility) on conflict do nothing;
  end if;
 end if;
 return new;
end$$;

alter table public.roles enable row level security;
alter table public.privileges enable row level security;
alter table public.role_privileges enable row level security;

drop policy if exists "admin users read" on public.profiles;
create policy "admin users read" on public.profiles for select to authenticated using(
 id=auth.uid() or exists(
  select 1 from public.user_roles target_assignment
  where target_assignment.user_id=profiles.id
    and public.has_privilege('admin.users.read',target_assignment.facility_id)
 )
);

drop policy if exists "assigned roles read" on public.user_roles;
drop policy if exists "assigned or admin roles read" on public.user_roles;
create policy "assigned or admin roles read" on public.user_roles for select to authenticated using(
 user_id=auth.uid() or public.has_privilege('admin.users.read',facility_id)
);

drop policy if exists "admin roles read" on public.roles;
create policy "admin roles read" on public.roles for select to authenticated using(
 exists(select 1 from public.facilities f where f.organization_id=roles.organization_id and public.has_privilege('admin.roles.read',f.id))
);

drop policy if exists "admin privileges read" on public.privileges;
create policy "admin privileges read" on public.privileges for select to authenticated using(
 exists(select 1 from public.facilities f where public.has_privilege('admin.roles.read',f.id))
);

drop policy if exists "admin role privileges read" on public.role_privileges;
create policy "admin role privileges read" on public.role_privileges for select to authenticated using(
 exists(
  select 1 from public.roles r join public.facilities f on f.organization_id=r.organization_id
  where r.id=role_privileges.role_id and public.has_privilege('admin.roles.read',f.id)
 )
);

create or replace function public.authorize_staff_invite(
 target_facility uuid,
 selected_roles uuid[],
 target_department uuid default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;
begin
 if auth.uid() is null or not public.has_privilege('admin.users.write',target_facility) then
  raise exception 'Not authorized to invite facility users';
 end if;
 select organization_id into org from public.facilities where id=target_facility and status='active';
 if org is null then raise exception 'Facility is unavailable';end if;
 if coalesce(array_length(selected_roles,1),0)=0 then raise exception 'Select at least one role';end if;
 if exists(select 1 from unnest(selected_roles) as selected(role_id) left join public.roles r on r.id=selected.role_id and r.organization_id=org and r.status='active' where r.id is null) then
  raise exception 'One or more roles are invalid or inactive';
 end if;
 if target_department is not null and not exists(select 1 from public.departments d where d.id=target_department and d.facility_id=target_facility and d.status='active') then
  raise exception 'Department is outside this facility or inactive';
 end if;
end$$;

create or replace function public.configure_staff_member(
 target_facility uuid,
 target_user uuid,
 staff_full_name text,
 staff_employee_no text,
 selected_roles uuid[],
 target_department uuid,
 change_reason text
) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;old_roles uuid[];new_roles uuid[];
begin
 if auth.uid() is null or not public.has_privilege('admin.users.write',target_facility) then
  raise exception 'Not authorized to manage facility users';
 end if;
 if target_user=auth.uid() then raise exception 'Use another administrator to change your own role assignments';end if;
 if nullif(trim(staff_full_name),'') is null then raise exception 'Staff name is required';end if;
 if length(trim(staff_full_name))>160 or length(trim(coalesce(staff_employee_no,'')))>80 then raise exception 'Staff details exceed the allowed length';end if;
 if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A change reason of at least 5 characters is required';end if;
 perform public.authorize_staff_invite(target_facility,selected_roles,target_department);
 select organization_id into org from public.facilities where id=target_facility;
 if not exists(select 1 from public.profiles where id=target_user) then raise exception 'Staff profile was not created';end if;
 if exists(
  select 1 from public.user_roles ur join public.facilities f on f.id=ur.facility_id
  where ur.user_id=target_user and f.organization_id<>org
 ) then raise exception 'Staff account is already assigned to another organization';end if;
 select coalesce(array_agg(role_id order by role_id),'{}'::uuid[]) into old_roles
 from public.user_roles where user_id=target_user and facility_id=target_facility and active;

 update public.profiles set
  full_name=trim(staff_full_name),
  employee_no=nullif(trim(staff_employee_no),''),
  updated_at=now(),version=version+1
 where id=target_user;

 update public.user_roles set active=false
 where user_id=target_user and facility_id=target_facility and not(role_id=any(selected_roles));

 insert into public.user_roles(user_id,role_id,facility_id,department_id,active)
 select distinct target_user,selected.role_id,target_facility,target_department,true from unnest(selected_roles) as selected(role_id)
 on conflict(user_id,role_id,facility_id) do update set department_id=excluded.department_id,active=true;

 select coalesce(array_agg(distinct selected.role_id order by selected.role_id),'{}'::uuid[]) into new_roles from unnest(selected_roles) as selected(role_id);
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),'staff.configuration_updated','profile',target_user,trim(change_reason),jsonb_build_object('old_roles',old_roles,'new_roles',new_roles,'department_id',target_department));
end$$;

create or replace function public.set_staff_status(
 target_facility uuid,
 target_user uuid,
 next_status public.record_status,
 change_reason text
) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;current_status public.record_status;
begin
 if auth.uid() is null or not public.has_privilege('admin.users.write',target_facility) then raise exception 'Not authorized to change staff status';end if;
 if target_user=auth.uid() then raise exception 'You cannot change your own account status';end if;
 if next_status not in('active','inactive') then raise exception 'Staff status must be active or inactive';end if;
 if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A change reason of at least 5 characters is required';end if;
 select f.organization_id,p.status into org,current_status
 from public.facilities f
 join public.user_roles ur on ur.facility_id=f.id and ur.user_id=target_user
 join public.profiles p on p.id=ur.user_id
 where f.id=target_facility limit 1;
 if org is null then raise exception 'Staff member is not assigned to this facility';end if;
 if current_status=next_status then raise exception 'Staff account already has this status';end if;
 if next_status='inactive' and exists(
  select 1 from public.user_roles ur join public.role_privileges rp on rp.role_id=ur.role_id
  where ur.user_id=target_user and ur.facility_id=target_facility and ur.active and rp.privilege_code='admin.users.write'
 ) and not exists(
  select 1 from public.user_roles ur
  join public.profiles p on p.id=ur.user_id and p.status='active'
  join public.role_privileges rp on rp.role_id=ur.role_id and rp.privilege_code='admin.users.write'
  where ur.facility_id=target_facility and ur.active and ur.user_id<>target_user
 ) then raise exception 'The last active user administrator cannot be deactivated';end if;
 update public.profiles set status=next_status,updated_at=now(),version=version+1 where id=target_user;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),case when next_status='active' then 'staff.activated' else 'staff.deactivated' end,'profile',target_user,trim(change_reason),jsonb_build_object('from',current_status,'to',next_status));
end$$;

create or replace function public.create_governed_role(
 target_facility uuid,
 role_name text,
 role_description text,
 selected_privileges text[]
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare org uuid;new_role uuid;grants text[];
begin
 if auth.uid() is null or not public.has_privilege('admin.roles.write',target_facility) then raise exception 'Not authorized to create roles';end if;
 select organization_id into org from public.facilities where id=target_facility and status='active';
 if org is null then raise exception 'Facility is unavailable';end if;
 if length(trim(coalesce(role_name,'')))<3 or length(trim(role_name))>100 then raise exception 'Role name must contain 3 to 100 characters';end if;
 if exists(select 1 from public.roles where organization_id=org and lower(name)=lower(trim(role_name))) then raise exception 'A role with this name already exists';end if;
 if exists(select 1 from unnest(coalesce(selected_privileges,'{}'::text[])) as selected(code) left join public.privileges p on p.code=selected.code where p.code is null) then raise exception 'One or more privileges are invalid';end if;
 select coalesce(array_agg(distinct selected.code order by selected.code),'{}'::text[]) into grants from unnest(coalesce(selected_privileges,'{}'::text[])) as selected(code);
 insert into public.roles(organization_id,name,description,updated_at,updated_by)
 values(org,trim(role_name),nullif(trim(role_description),''),now(),auth.uid()) returning id into new_role;
 insert into public.role_privileges(role_id,privilege_code) select new_role,selected.code from unnest(grants) as selected(code);
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
 values(org,target_facility,auth.uid(),'role.created','role',new_role,jsonb_build_object('name',trim(role_name),'privileges',grants));
 return new_role;
end$$;

create or replace function public.update_governed_role(
 target_facility uuid,
 target_role uuid,
 expected_version integer,
 role_name text,
 role_description text,
 selected_privileges text[],
 change_reason text
) returns integer
language plpgsql security definer set search_path=''
as $$
declare org uuid;current_name text;old_grants text[];new_grants text[];next_version integer;
begin
 if auth.uid() is null or not public.has_privilege('admin.roles.write',target_facility) then raise exception 'Not authorized to update roles';end if;
 if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A change reason of at least 5 characters is required';end if;
 select f.organization_id,r.name into org,current_name from public.facilities f join public.roles r on r.organization_id=f.organization_id where f.id=target_facility and r.id=target_role for update of r;
 if org is null then raise exception 'Role is outside this organization';end if;
 if current_name='Hospital Administrator' then raise exception 'The system administrator role is managed by migrations';end if;
 if length(trim(coalesce(role_name,'')))<3 or length(trim(role_name))>100 then raise exception 'Role name must contain 3 to 100 characters';end if;
 if exists(select 1 from public.roles where organization_id=org and id<>target_role and lower(name)=lower(trim(role_name))) then raise exception 'A role with this name already exists';end if;
 if exists(select 1 from unnest(coalesce(selected_privileges,'{}'::text[])) as selected(code) left join public.privileges p on p.code=selected.code where p.code is null) then raise exception 'One or more privileges are invalid';end if;
 select coalesce(array_agg(privilege_code order by privilege_code),'{}'::text[]) into old_grants from public.role_privileges where role_id=target_role;
 select coalesce(array_agg(distinct selected.code order by selected.code),'{}'::text[]) into new_grants from unnest(coalesce(selected_privileges,'{}'::text[])) as selected(code);
 if 'admin.users.write'=any(old_grants) and not('admin.users.write'=any(new_grants)) and exists(
  select 1 from public.user_roles target_assignment
  join public.facilities target_facility_row on target_facility_row.id=target_assignment.facility_id and target_facility_row.organization_id=org
  join public.profiles target_profile on target_profile.id=target_assignment.user_id and target_profile.status='active'
  where target_assignment.role_id=target_role and target_assignment.active
    and not exists(
     select 1 from public.user_roles other_assignment
     join public.profiles other_profile on other_profile.id=other_assignment.user_id and other_profile.status='active'
     join public.role_privileges other_grant on other_grant.role_id=other_assignment.role_id and other_grant.privilege_code='admin.users.write'
     where other_assignment.facility_id=target_assignment.facility_id and other_assignment.active and other_assignment.role_id<>target_role
    )
 ) then raise exception 'Cannot remove the last user-administration grant from an active facility';end if;
 if 'admin.roles.write'=any(old_grants) and not('admin.roles.write'=any(new_grants)) and exists(
  select 1 from public.user_roles target_assignment
  join public.facilities target_facility_row on target_facility_row.id=target_assignment.facility_id and target_facility_row.organization_id=org
  join public.profiles target_profile on target_profile.id=target_assignment.user_id and target_profile.status='active'
  where target_assignment.role_id=target_role and target_assignment.active
    and not exists(
     select 1 from public.user_roles other_assignment
     join public.profiles other_profile on other_profile.id=other_assignment.user_id and other_profile.status='active'
     join public.role_privileges other_grant on other_grant.role_id=other_assignment.role_id and other_grant.privilege_code='admin.roles.write'
     where other_assignment.facility_id=target_assignment.facility_id and other_assignment.active and other_assignment.role_id<>target_role
    )
 ) then raise exception 'Cannot remove the last role-administration grant from an active facility';end if;
 update public.roles set name=trim(role_name),description=nullif(trim(role_description),''),updated_at=now(),updated_by=auth.uid(),version=version+1
 where id=target_role and version=expected_version returning version into next_version;
 if next_version is null then raise exception 'Role was changed by another administrator. Refresh and try again';end if;
 delete from public.role_privileges where role_id=target_role;
 insert into public.role_privileges(role_id,privilege_code) select target_role,selected.code from unnest(new_grants) as selected(code);
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),'role.updated','role',target_role,trim(change_reason),jsonb_build_object('old_privileges',old_grants,'new_privileges',new_grants));
 return next_version;
end$$;

create or replace function public.set_governed_role_status(
 target_facility uuid,
 target_role uuid,
 next_status public.record_status,
 change_reason text
) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;role_name text;current_status public.record_status;
begin
 if auth.uid() is null or not public.has_privilege('admin.roles.write',target_facility) then raise exception 'Not authorized to change role status';end if;
 if next_status not in('active','inactive') then raise exception 'Role status must be active or inactive';end if;
 if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A change reason of at least 5 characters is required';end if;
 select f.organization_id,r.name,r.status into org,role_name,current_status from public.facilities f join public.roles r on r.organization_id=f.organization_id where f.id=target_facility and r.id=target_role for update of r;
 if org is null then raise exception 'Role is outside this organization';end if;
 if role_name='Hospital Administrator' then raise exception 'The system administrator role cannot be deactivated';end if;
 if current_status=next_status then raise exception 'Role already has this status';end if;
 if next_status='inactive' and exists(select 1 from public.user_roles where role_id=target_role and active) then raise exception 'Remove or replace active staff assignments before deactivating this role';end if;
 update public.roles set status=next_status,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=target_role;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),case when next_status='active' then 'role.activated' else 'role.deactivated' end,'role',target_role,trim(change_reason),jsonb_build_object('from',current_status,'to',next_status));
end$$;

grant execute on function public.authorize_staff_invite(uuid,uuid[],uuid) to authenticated;
grant execute on function public.configure_staff_member(uuid,uuid,text,text,uuid[],uuid,text) to authenticated;
grant execute on function public.set_staff_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.create_governed_role(uuid,text,text,text[]) to authenticated;
grant execute on function public.update_governed_role(uuid,uuid,integer,text,text,text[],text) to authenticated;
grant execute on function public.set_governed_role_status(uuid,uuid,public.record_status,text) to authenticated;

commit;
