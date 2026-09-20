-- Hospital ONE billing-completion release checks. Every query must return zero rows.

-- No duplicate daily accommodation charges.
select idempotency_key,count(*) duplicate_count
from public.ledger_entries
where idempotency_key like 'auto-bed-day-%'
group by idempotency_key having count(*)>1;

-- Approved coverage must have exactly one posted ledger credit.
select ca.id,ca.status,ca.ledger_entry_id
from public.billing_coverage_adjustments ca
left join public.ledger_entries le on le.id=ca.ledger_entry_id
where ca.status='approved'
and (ca.ledger_entry_id is null or le.kind<>'discount' or le.amount>=0);

-- Rejected or pending coverage must never post a credit.
select id,status,ledger_entry_id
from public.billing_coverage_adjustments
where status in('pending','rejected','cancelled') and ledger_entry_id is not null;

-- Cleared cases must have no remaining amount due.
select id,admission_id,final_balance
from public.billing_cases
where status='cleared' and final_balance>0.009;

-- Finalized/cleared cases cannot retain pending deduction requests.
select c.id,c.status,count(ca.id) pending_count
from public.billing_cases c
join public.billing_coverage_adjustments ca on ca.billing_case_id=c.id and ca.status='pending'
where c.status in('finalized','cleared')
group by c.id,c.status;

-- One billing case per admission and encounter.
select admission_id,count(*) from public.billing_cases where admission_id is not null group by admission_id having count(*)>1;
select encounter_id,count(*) from public.billing_cases group by encounter_id having count(*)>1;
