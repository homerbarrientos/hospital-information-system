-- Hospital ONE full-system UAT data-integrity suite.
-- Run after completing the manual workflow scenarios in docs/HOSPITAL_ONE_UAT.md.
-- PASS CONDITION: every query returns zero rows.

-- Master Patient Index
select organization_id,mrn,count(*) from public.patients group by organization_id,mrn having count(*)>1;
select e.id,e.encounter_no from public.encounters e left join public.patients p on p.id=e.patient_id where p.id is null;

-- Appointments, queue, and consultation
select q.id,q.queue_no from public.queue_entries q left join public.encounters e on e.id=q.encounter_id where e.id is null;
select n.id,n.encounter_id from public.clinical_notes n left join public.encounters e on e.id=n.encounter_id where e.id is null;
select d.id,d.encounter_id from public.diagnoses d left join public.encounters e on e.id=d.encounter_id where e.id is null;

-- Admission, transfer, room, and bed
select admission_id,count(*) active_stays from public.bed_stays where ended_at is null group by admission_id having count(*)>1;
select a.id,a.admission_no from public.admissions a where a.status='admitted' and not exists(select 1 from public.bed_stays bs where bs.admission_id=a.id and bs.ended_at is null);
select b.id,b.code,b.status from public.beds b where b.status='occupied' and not exists(select 1 from public.bed_stays bs where bs.bed_id=b.id and bs.ended_at is null);

-- Orders and clinical results
select oi.id,oi.order_id from public.order_items oi left join public.clinical_orders o on o.id=oi.order_id where o.id is null;
select r.id,r.order_item_id from public.clinical_results r left join public.order_items oi on oi.id=r.order_item_id where oi.id is null;
select idempotency_key,count(*) duplicate_count from public.ledger_entries where idempotency_key like 'auto-%' group by idempotency_key having count(*)>1;

-- Pharmacy and inventory
select d.id,d.prescription_item_id from public.dispenses d left join public.prescription_items pi on pi.id=d.prescription_item_id where pi.id is null;
select id,lot_no,quantity_on_hand from public.stock_lots where quantity_on_hand<0;
select idempotency_key,count(*) duplicate_count from public.stock_movements where idempotency_key is not null group by idempotency_key having count(*)>1;

-- Billing, coverage, and clearance
select idempotency_key,count(*) duplicate_count from public.ledger_entries where idempotency_key is not null group by idempotency_key having count(*)>1;
select c.id,c.final_balance from public.billing_cases c where c.status='cleared' and c.final_balance>0.009;
select ca.id,ca.status,ca.ledger_entry_id from public.billing_coverage_adjustments ca left join public.ledger_entries le on le.id=ca.ledger_entry_id where ca.status='approved' and(le.id is null or le.amount>=0);
select c.id,c.status from public.billing_cases c where c.status in('finalized','cleared') and exists(select 1 from public.billing_coverage_adjustments ca where ca.billing_case_id=c.id and ca.status='pending');

-- Reports reconciliation
select r.facility_id,r.business_date,r.collections,coalesce(p.total,0) payment_total
from public.report_daily_operations r left join(
 select pa.facility_id,p.posted_at::date business_date,sum(p.amount) total from public.payments p join public.patient_accounts pa on pa.id=p.account_id where p.status='posted' group by pa.facility_id,p.posted_at::date
)p using(facility_id,business_date) where abs(r.collections-coalesce(p.total,0))>0.009;
select * from public.report_bed_occupancy where occupied_beds+available_beds+unavailable_beds<>total_beds;
select * from public.report_inventory_risk where quantity_on_hand<0 or stock_value<0;
