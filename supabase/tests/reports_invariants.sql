-- Hospital ONE reports release checks. Every query must return zero rows.

select * from public.report_daily_operations where encounters<0 or admissions<0 or discharges<0 or charges<0 or collections<0;
select * from public.report_patient_balances where gross_charges<0 or approved_deductions<0 or payments<0;
select * from public.report_bed_occupancy where occupied_beds+available_beds+unavailable_beds<>total_beds;
select * from public.report_bed_occupancy where occupancy_percent<0 or occupancy_percent>100;
select * from public.report_inventory_risk where quantity_on_hand<0 or stock_value<0;

-- Daily collections must reconcile to posted payment records.
select r.facility_id,r.business_date,r.collections,coalesce(p.total,0) payment_total
from public.report_daily_operations r
left join(
 select pa.facility_id,p.posted_at::date business_date,sum(p.amount) total
 from public.payments p join public.patient_accounts pa on pa.id=p.account_id
 where p.status='posted' group by pa.facility_id,p.posted_at::date
)p using(facility_id,business_date)
where abs(r.collections-coalesce(p.total,0))>0.009;
