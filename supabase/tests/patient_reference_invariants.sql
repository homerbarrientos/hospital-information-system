-- Hospital ONE patient demographic reference-data integrity checks.
-- PASS CONDITION: every query returns zero rows.

-- Every organization must have the patient demographic lists used by registration.
select o.id as organization_id, required.code as missing_group
from public.organizations o
cross join (values
  ('sex_at_birth'),
  ('civil_status'),
  ('blood_type'),
  ('nationality'),
  ('religion'),
  ('occupation'),
  ('emergency_contact_relationship')
) as required(code)
where not exists (
  select 1
  from public.reference_groups g
  where g.organization_id=o.id and g.code=required.code
);

-- The newly completed lists must each expose at least one active option.
select g.organization_id,g.code
from public.reference_groups g
left join public.reference_options o on o.group_id=g.id and o.active
where g.code in ('nationality','religion','occupation','emergency_contact_relationship')
group by g.organization_id,g.code
having count(o.id)=0;

-- Active labels must not be duplicated within the same list.
select g.organization_id,g.code,lower(trim(o.label)) as duplicate_label,count(*)
from public.reference_groups g
join public.reference_options o on o.group_id=g.id and o.active
where g.code in ('nationality','religion','occupation','emergency_contact_relationship')
group by g.organization_id,g.code,lower(trim(o.label))
having count(*)>1;
