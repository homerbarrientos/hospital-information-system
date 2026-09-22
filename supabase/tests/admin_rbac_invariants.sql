-- Hospital ONE administration and RBAC integrity checks.
-- PASS CONDITION: every query returns zero rows.

-- Active assignments require active user and role records.
select ur.user_id,ur.role_id,ur.facility_id,p.status as user_status,r.status as role_status
from public.user_roles ur
join public.profiles p on p.id=ur.user_id
join public.roles r on r.id=ur.role_id
where ur.active and (p.status<>'active' or r.status<>'active');

-- Department-scoped assignments must stay within the assigned facility.
select ur.user_id,ur.role_id,ur.facility_id,ur.department_id
from public.user_roles ur
join public.departments d on d.id=ur.department_id
where ur.department_id is not null and d.facility_id<>ur.facility_id;

-- Role names must remain unique without relying on letter case.
select organization_id,lower(name) normalized_name,count(*) duplicate_count
from public.roles group by organization_id,lower(name) having count(*)>1;

-- Every active facility needs at least one active user administrator.
select f.id,f.code
from public.facilities f
where f.status='active' and not exists(
 select 1 from public.user_roles ur
 join public.profiles p on p.id=ur.user_id and p.status='active'
 join public.roles r on r.id=ur.role_id and r.status='active'
 join public.role_privileges rp on rp.role_id=r.id and rp.privilege_code='admin.users.write'
 where ur.facility_id=f.id and ur.active
);

-- The system administrator role must retain every registered privilege.
select r.id,p.code
from public.roles r
cross join public.privileges p
where r.name='Hospital Administrator'
and not exists(select 1 from public.role_privileges rp where rp.role_id=r.id and rp.privilege_code=p.code);
