begin;

insert into public.privileges(code,description,risk_level) values
 ('reports.read','View facility operational, clinical, financial, and inventory reports','privileged'),
 ('reports.export','Export facility reports','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('reports.read','reports.export')
on conflict do nothing;

create or replace view public.report_daily_operations with(security_invoker=true) as
with dates as(
 select facility_id,service_date business_date from public.encounters
 union select e.facility_id,a.admitted_at::date from public.admissions a join public.encounters e on e.id=a.encounter_id
 union select e.facility_id,a.discharged_at::date from public.admissions a join public.encounters e on e.id=a.encounter_id where a.discharged_at is not null
 union select pa.facility_id,le.posted_at::date from public.ledger_entries le join public.patient_accounts pa on pa.id=le.account_id
), daily as(select distinct facility_id,business_date from dates)
select d.facility_id,d.business_date,
 (select count(*) from public.encounters e where e.facility_id=d.facility_id and e.service_date=d.business_date) encounters,
 (select count(*) from public.encounters e where e.facility_id=d.facility_id and e.service_date=d.business_date and upper(e.encounter_type)='OPD') opd_visits,
 (select count(*) from public.admissions a join public.encounters e on e.id=a.encounter_id where e.facility_id=d.facility_id and a.admitted_at::date=d.business_date) admissions,
 (select count(*) from public.admissions a join public.encounters e on e.id=a.encounter_id where e.facility_id=d.facility_id and a.discharged_at::date=d.business_date) discharges,
 (select count(*) from public.clinical_orders o join public.encounters e on e.id=o.encounter_id where e.facility_id=d.facility_id and o.ordered_at::date=d.business_date) orders,
 (select count(*) from public.prescriptions rx join public.encounters e on e.id=rx.encounter_id where e.facility_id=d.facility_id and rx.prescribed_at::date=d.business_date) prescriptions,
 coalesce((select sum(le.amount) from public.ledger_entries le join public.patient_accounts pa on pa.id=le.account_id where pa.facility_id=d.facility_id and le.posted_at::date=d.business_date and le.amount>0),0) charges,
 coalesce((select sum(p.amount) from public.payments p join public.patient_accounts pa on pa.id=p.account_id where pa.facility_id=d.facility_id and p.posted_at::date=d.business_date and p.status='posted'),0) collections
from daily d;

create or replace view public.report_revenue_by_source with(security_invoker=true) as
select pa.facility_id,le.posted_at::date business_date,le.source_type,
 coalesce(sum(le.amount) filter(where le.amount>0),0) gross_charges,
 coalesce(abs(sum(le.amount) filter(where le.amount<0 and le.kind<>'payment')),0) deductions,
 count(*) transaction_count
from public.ledger_entries le join public.patient_accounts pa on pa.id=le.account_id
group by pa.facility_id,le.posted_at::date,le.source_type;

create or replace view public.report_patient_balances with(security_invoker=true) as
select c.facility_id,c.id billing_case_id,c.status,c.admission_no,c.mrn,c.last_name,c.first_name,
 c.gross_charges,c.approved_deductions,c.payments,c.final_balance,c.pending_deductions,
 case when c.final_balance<=0 then 'settled' when c.final_balance<=5000 then 'up_to_5k' when c.final_balance<=25000 then '5k_to_25k' else 'over_25k' end ageing_band
from public.billing_clearance_summary c;

create or replace view public.report_bed_occupancy with(security_invoker=true) as
select w.facility_id,w.id ward_id,w.code ward_code,w.name ward_name,
 count(b.id) filter(where b.status<>'inactive') total_beds,
 count(b.id) filter(where b.status='occupied') occupied_beds,
 count(b.id) filter(where b.status='available') available_beds,
 count(b.id) filter(where b.status in('cleaning','maintenance','reserved')) unavailable_beds,
 round(100.0*count(b.id) filter(where b.status='occupied')/nullif(count(b.id) filter(where b.status<>'inactive'),0),1) occupancy_percent
from public.wards w left join public.beds b on b.ward_id=w.id
group by w.facility_id,w.id,w.code,w.name;

create or replace view public.report_inventory_risk with(security_invoker=true) as
select s.facility_id,s.id store_id,s.name store_name,p.id product_id,p.code product_code,p.name product_name,p.unit,
 coalesce(sum(l.quantity_on_hand),0) quantity_on_hand,p.reorder_level,
 min(l.expiry_date) filter(where l.quantity_on_hand>0) nearest_expiry,
 coalesce(sum(l.quantity_on_hand*l.unit_cost),0) stock_value,
 case when coalesce(sum(l.quantity_on_hand),0)<=p.reorder_level then 'low_stock'
      when min(l.expiry_date) filter(where l.quantity_on_hand>0)<=current_date+30 then 'expiring_30_days'
      else 'healthy' end risk_status
from public.stores s join public.stock_lots l on l.store_id=s.id join public.products p on p.id=l.product_id
group by s.facility_id,s.id,s.name,p.id,p.code,p.name,p.unit,p.reorder_level;

grant select on public.report_daily_operations,public.report_revenue_by_source,public.report_patient_balances,public.report_bed_occupancy,public.report_inventory_risk to authenticated;

commit;
