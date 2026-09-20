-- Hospital ONE transaction workflow invariant checks.
-- Expected result: every query returns zero rows, except the first query which returns five true values.

select
 to_regprocedure('public.advance_order(uuid,text)') is not null as advance_order_installed,
 to_regprocedure('public.record_order_result(uuid,text,boolean,text)') is not null as order_result_installed,
 to_regprocedure('public.post_inventory_stock(uuid,uuid,uuid,uuid,text,date,numeric,numeric,text,text,text)') is not null as inventory_receipt_installed,
 to_regprocedure('public.create_walk_in(uuid,uuid,uuid,text,text)') is not null as walk_in_installed,
 to_regprocedure('public.transition_queue(uuid,text)') is not null as queue_transition_installed;

-- Discharged admissions must have a financially cleared case.
select a.id,a.admission_no,a.status,c.status as billing_status,c.final_balance
from public.admissions a
left join public.billing_cases c on c.admission_id=a.id
where a.status='discharged' and coalesce(c.status,'missing')<>'cleared';

-- Cleared cases may not retain a positive patient balance.
select id,admission_id,status,final_balance
from public.billing_cases
where status='cleared' and final_balance>0.009;

-- Active queue rows must point to an active encounter and same department.
select q.id,q.queue_no,q.status,e.status as encounter_status
from public.queue_entries q join public.encounters e on e.id=q.encounter_id
where q.status in('waiting','called','in_service')
and(e.status in('completed','cancelled') or e.department_id<>q.department_id);

-- Every stock lot balance must agree with its most recent posted movement balance.
with latest as(
 select distinct on(m.lot_id)m.lot_id,m.balance_after
 from public.stock_movements m where m.balance_after is not null order by m.lot_id,m.posted_at desc,m.id desc
)
select l.id,l.lot_no,l.quantity_on_hand,x.balance_after
from public.stock_lots l join latest x on x.lot_id=l.id
where abs(l.quantity_on_hand-x.balance_after)>0.0001;

-- Billable active services need an effective price for every active pilot facility.
select f.code as facility_code,s.code as service_code,s.name
from public.facilities f join public.service_catalog s on s.organization_id=f.organization_id
where f.status='active' and s.status='active' and s.billable
and not exists(select 1 from public.service_prices p where p.facility_id=f.id and p.service_id=s.id and p.effective_from<=current_date and(p.effective_to is null or p.effective_to>=current_date));

-- At least two active doctors are required before multiple-doctor UAT can pass.
select f.code,count(a.doctor_id) as active_doctors
from public.facilities f left join public.doctor_facility_assignments a on a.facility_id=f.id and a.active
where f.status='active'
group by f.id having count(a.doctor_id)<2;

-- Active doctors need at least one current professional-fee schedule.
select f.code as facility_code,d.license_number,d.last_name
from public.doctor_facility_assignments a join public.facilities f on f.id=a.facility_id join public.doctors d on d.id=a.doctor_id
where a.active and d.status='active' and not exists(select 1 from public.doctor_fee_schedules s where s.facility_id=f.id and s.doctor_id=d.id and s.active and s.effective_from<=current_date and(s.effective_to is null or s.effective_to>=current_date));
