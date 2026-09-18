-- Hospital ONE clinical registry and automatic billing release checks.
-- Read-only: every result must return zero rows/count.

select encounter_id, count(*) as active_principal_count
from public.diagnoses
where classification = 'principal'
  and clinical_status = 'active'
  and verification_status <> 'ruled_out'
group by encounter_id
having count(*) > 1;

select encounter_id, count(*) as active_primary_doctor_count
from public.encounter_care_team
where is_primary and status = 'active'
group by encounter_id
having count(*) > 1;

select id, encounter_id, professional_fee, fee_status
from public.encounter_care_team
where fee_status = 'posted' and billing_ledger_entry_id is null;

select idempotency_key, count(*) as duplicate_count
from public.ledger_entries
where idempotency_key like 'auto-%'
   or idempotency_key like 'professional-fee-%'
group by idempotency_key
having count(*) > 1;

select c.id as assignment_id, c.billing_ledger_entry_id
from public.encounter_care_team c
left join public.ledger_entries le on le.id = c.billing_ledger_entry_id
where c.billing_ledger_entry_id is not null
  and (le.id is null or le.source_type <> 'professional_fee' or le.source_id <> c.id);

select d.id as diagnosis_id, d.encounter_id
from public.diagnoses d
left join public.diagnosis_catalog dc on dc.id = d.diagnosis_catalog_id
where d.diagnosis_catalog_id is not null and dc.id is null;
