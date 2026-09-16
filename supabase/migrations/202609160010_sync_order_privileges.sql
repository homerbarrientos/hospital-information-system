begin;

-- Keep the administrator role synchronized when order privileges are added
-- after the original bootstrap migration has already been applied.
insert into public.privileges(code, description, risk_level) values
  ('orders.read', 'View clinical orders and results', 'privileged'),
  ('orders.write', 'Create and modify clinical orders and results', 'high_risk')
on conflict(code) do update
set description=excluded.description, risk_level=excluded.risk_level;

insert into public.role_privileges(role_id, privilege_code)
select r.id, p.code
from public.roles r
join public.organizations o on o.id=r.organization_id
cross join public.privileges p
where o.code='INF'
  and r.name='Hospital Administrator'
  and p.code in ('orders.read','orders.write')
on conflict do nothing;

commit;
