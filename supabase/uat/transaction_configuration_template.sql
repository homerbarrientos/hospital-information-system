-- OPTIONAL UAT configuration template. Review amounts and identities before running.
-- This does not create synthetic doctors automatically. Add the second doctor through
-- Administration > Doctors so licensing, specialty, assignment, and audit data are explicit.

begin;

-- Replace the sample amounts below with the facility-approved schedule.
-- Zero-priced rows are intentionally left untouched unless listed here.
with configured(service_code,amount) as(values
 ('002'::text,500.00::numeric)
)
insert into public.service_prices(service_id,facility_id,amount,effective_from)
select s.id,f.id,c.amount,current_date
from configured c
join public.service_catalog s on s.code=c.service_code
join public.facilities f on f.organization_id=s.organization_id
join public.organizations o on o.id=f.organization_id
where o.code='INF' and f.status='active' and not exists(
 select 1 from public.service_prices p where p.service_id=s.id and p.facility_id=f.id
 and p.effective_from<=current_date and(p.effective_to is null or p.effective_to>=current_date)
);

commit;

-- Then configure each doctor's approved fee through:
-- Administration > Charge Master > Doctor fee schedules.
-- Do not use a generic fee until the hospital approves encounter type, room type,
-- minimum/maximum, hospital share, and effective date.
