begin;

alter table public.profiles
 add column if not exists login_method text not null default 'email'
  check(login_method in('email','employee_id')),
 add column if not exists employee_login_key text,
 add column if not exists must_change_password boolean not null default false,
 add column if not exists credential_updated_at timestamptz;

create unique index if not exists profiles_employee_login_key_unique
 on public.profiles(lower(employee_login_key))
 where employee_login_key is not null;

create or replace function public.normalize_staff_login_identity() returns trigger
language plpgsql set search_path=''
as $$
begin
 if new.login_method='employee_id' then
  if nullif(trim(coalesce(new.employee_no,'')),'') is null then raise exception 'Employee number is required for Employee ID login';end if;
  new.employee_login_key:=lower(trim(new.employee_no));
 else
  new.employee_login_key:=null;
 end if;
 return new;
end$$;

drop trigger if exists normalize_staff_login_identity on public.profiles;
create trigger normalize_staff_login_identity
before insert or update of employee_no,login_method on public.profiles
for each row execute function public.normalize_staff_login_identity();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=''
as $$
declare admin_role uuid;pilot_facility uuid;method text;employee_key text;
begin
 method:=case when new.raw_user_meta_data->>'login_method'='employee_id' then 'employee_id' else 'email' end;
 employee_key:=case when method='employee_id' then nullif(lower(trim(new.raw_user_meta_data->>'employee_no')),'') else null end;
 insert into public.profiles(id,full_name,employee_no,email,login_method,employee_login_key,must_change_password,credential_updated_at)
 values(
  new.id,
  coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,'User'),'@',1)),
  nullif(new.raw_user_meta_data->>'employee_no',''),
  new.email,
  method,
  employee_key,
  method='employee_id',
  case when method='employee_id' then now() else null end
 )
 on conflict(id) do update set
  email=coalesce(public.profiles.email,excluded.email),
  login_method=excluded.login_method,
  employee_login_key=excluded.employee_login_key,
  must_change_password=excluded.must_change_password,
  credential_updated_at=excluded.credential_updated_at;
 if not exists(select 1 from public.user_roles) then
  select r.id into admin_role from public.roles r join public.organizations o on o.id=r.organization_id where o.code='INF' and r.name='Hospital Administrator';
  select f.id into pilot_facility from public.facilities f join public.organizations o on o.id=f.organization_id where o.code='INF' and f.code='PILOT';
  if admin_role is not null and pilot_facility is not null then
   insert into public.user_roles(user_id,role_id,facility_id) values(new.id,admin_role,pilot_facility) on conflict do nothing;
  end if;
 end if;
 return new;
end$$;

create or replace function public.user_has_facility(target uuid) returns boolean
language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public.user_roles ur
  join public.profiles p on p.id=ur.user_id
  where ur.user_id=auth.uid() and ur.facility_id=target and ur.active
    and p.status='active' and not p.must_change_password
 )
$$;

create or replace function public.has_privilege(privilege text,target_facility uuid) returns boolean
language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public.user_roles ur
  join public.profiles pr on pr.id=ur.user_id
  join public.roles r on r.id=ur.role_id
  join public.role_privileges rp on rp.role_id=ur.role_id
  where ur.user_id=auth.uid() and ur.facility_id=target_facility and ur.active
    and pr.status='active' and not pr.must_change_password and r.status='active'
    and rp.privilege_code=privilege
 )
$$;

create or replace function public.configure_new_staff_identity(
 target_facility uuid,
 target_user uuid,
 staff_full_name text,
 staff_employee_no text,
 selected_roles uuid[],
 target_department uuid,
 staff_login_method text
) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;employee_key text;
begin
 if staff_login_method not in('email','employee_id') then raise exception 'Login method must be email or employee ID';end if;
 if staff_login_method='employee_id' and nullif(trim(coalesce(staff_employee_no,'')),'') is null then raise exception 'Employee number is required for employee ID login';end if;
 employee_key:=case when staff_login_method='employee_id' then lower(trim(staff_employee_no)) else null end;
 if employee_key is not null and exists(select 1 from public.profiles where lower(employee_login_key)=employee_key and id<>target_user) then raise exception 'Employee ID is already assigned to another account';end if;

 perform public.configure_staff_member(
  target_facility,target_user,staff_full_name,staff_employee_no,selected_roles,target_department,
  case when staff_login_method='employee_id' then 'Initial employee ID account creation' else 'Initial facility staff invitation' end
 );
 select organization_id into org from public.facilities where id=target_facility;
 update public.profiles set
  login_method=staff_login_method,
  employee_login_key=employee_key,
  must_change_password=staff_login_method='employee_id',
  credential_updated_at=case when staff_login_method='employee_id' then now() else credential_updated_at end,
  updated_at=now(),version=version+1
 where id=target_user;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),'staff.account_created','profile',target_user,
  case when staff_login_method='employee_id' then 'Employee ID account provisioned' else 'Email invitation issued' end,
  jsonb_build_object('login_method',staff_login_method,'employee_no',nullif(trim(staff_employee_no),''),'must_change_password',staff_login_method='employee_id'));
end$$;

create or replace function public.authorize_staff_credential_reset(
 target_facility uuid,
 target_user uuid
) returns void
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.has_privilege('admin.users.write',target_facility) then raise exception 'Not authorized to reset staff credentials';end if;
 if target_user=auth.uid() then raise exception 'Use the normal password-change screen for your own account';end if;
 if not exists(
  select 1 from public.user_roles ur join public.profiles p on p.id=ur.user_id
  where ur.user_id=target_user and ur.facility_id=target_facility and p.login_method='employee_id'
 ) then raise exception 'Employee ID account is not assigned to this facility';end if;
end$$;

create or replace function public.update_staff_identity_and_access(
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
declare org uuid;old_employee_no text;method text;
begin
 select f.organization_id,p.employee_no,p.login_method into org,old_employee_no,method
 from public.facilities f
 join public.user_roles ur on ur.facility_id=f.id and ur.user_id=target_user
 join public.profiles p on p.id=ur.user_id
 where f.id=target_facility limit 1;
 if org is null then raise exception 'Staff member is not assigned to this facility';end if;
 perform public.configure_staff_member(target_facility,target_user,staff_full_name,staff_employee_no,selected_roles,target_department,change_reason);
 if old_employee_no is distinct from nullif(trim(staff_employee_no),'') then
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,target_facility,auth.uid(),'staff.employee_id_updated','profile',target_user,trim(change_reason),
   jsonb_build_object('login_method',method,'old_employee_no',old_employee_no,'new_employee_no',nullif(trim(staff_employee_no),'')));
 end if;
end$$;

create or replace function public.record_staff_temporary_password(
 target_facility uuid,
 target_user uuid,
 change_reason text
) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;
begin
 perform public.authorize_staff_credential_reset(target_facility,target_user);
 if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A reset reason of at least 5 characters is required';end if;
 select organization_id into org from public.facilities where id=target_facility;
 update public.profiles set must_change_password=true,credential_updated_at=now(),updated_at=now(),version=version+1 where id=target_user;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),'staff.temporary_password_issued','profile',target_user,trim(change_reason),jsonb_build_object('must_change_password',true));
end$$;

create or replace function public.complete_forced_password_change(target_user uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare org uuid;facility uuid;
begin
 if not exists(
  select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=target_user and p.login_method='employee_id' and p.must_change_password and u.updated_at>p.credential_updated_at
 ) then raise exception 'Update the temporary password before completing first-login setup';end if;
 select f.organization_id,ur.facility_id into org,facility
 from public.user_roles ur join public.facilities f on f.id=ur.facility_id
 where ur.user_id=target_user and ur.active limit 1;
 if facility is null then raise exception 'No active facility assignment';end if;
 update public.profiles set must_change_password=false,credential_updated_at=now(),updated_at=now(),version=version+1 where id=target_user;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,facility,target_user,'staff.password_changed','profile',target_user,'Required first-login password change completed',jsonb_build_object('must_change_password',false));
end$$;

grant execute on function public.configure_new_staff_identity(uuid,uuid,text,text,uuid[],uuid,text) to authenticated;
grant execute on function public.authorize_staff_credential_reset(uuid,uuid) to authenticated;
grant execute on function public.update_staff_identity_and_access(uuid,uuid,text,text,uuid[],uuid,text) to authenticated;
grant execute on function public.record_staff_temporary_password(uuid,uuid,text) to authenticated;
revoke all on function public.complete_forced_password_change(uuid) from public,anon,authenticated;
grant execute on function public.complete_forced_password_change(uuid) to service_role;

commit;
