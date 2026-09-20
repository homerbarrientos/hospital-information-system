begin;

insert into public.privileges(code,description,risk_level) values
 ('billing.coverage.request','Record PhilHealth, HMO, statutory, and assistance deductions','high_risk'),
 ('billing.coverage.approve','Approve patient coverage and discount deductions','high_risk'),
 ('billing.finalize','Finalize or reopen a patient hospital bill','high_risk'),
 ('billing.clearance','Issue final billing clearance','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator'
and p.code in('billing.coverage.request','billing.coverage.approve','billing.finalize','billing.clearance')
on conflict do nothing;

create table if not exists public.billing_cases(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities,
 patient_id uuid not null references public.patients,
 admission_id uuid references public.admissions,
 encounter_id uuid not null references public.encounters,
 account_id uuid not null references public.patient_accounts,
 status text not null default 'draft' check(status in('draft','for_review','finalized','cleared','reopened')),
 gross_charges numeric(14,2) not null default 0,
 approved_deductions numeric(14,2) not null default 0,
 payments numeric(14,2) not null default 0,
 final_balance numeric(14,2) not null default 0,
 finalized_by uuid references public.profiles,
 finalized_at timestamptz,
 cleared_by uuid references public.profiles,
 cleared_at timestamptz,
 reopened_by uuid references public.profiles,
 reopened_at timestamptz,
 reopen_reason text,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz,
 unique(admission_id),
 unique(encounter_id)
);

create table if not exists public.billing_coverage_adjustments(
 id uuid primary key default gen_random_uuid(),
 billing_case_id uuid not null references public.billing_cases,
 coverage_type text not null check(coverage_type in('philhealth','hmo','senior_pwd','charity','government','other')),
 reference_no text,
 description text not null,
 requested_amount numeric(14,2) not null check(requested_amount>0),
 approved_amount numeric(14,2) check(approved_amount>=0),
 status text not null default 'pending' check(status in('pending','approved','rejected','cancelled')),
 requested_by uuid not null references public.profiles,
 requested_at timestamptz not null default now(),
 decided_by uuid references public.profiles,
 decided_at timestamptz,
 decision_reason text,
 ledger_entry_id uuid references public.ledger_entries,
 idempotency_key text not null unique
);

create index if not exists billing_cases_facility_status_idx on public.billing_cases(facility_id,status,created_at desc);
create index if not exists billing_coverage_case_status_idx on public.billing_coverage_adjustments(billing_case_id,status,requested_at desc);

alter table public.billing_cases enable row level security;
alter table public.billing_coverage_adjustments enable row level security;
drop policy if exists "assigned billing case read" on public.billing_cases;
create policy "assigned billing case read" on public.billing_cases for select using(public.user_has_facility(facility_id));
drop policy if exists "assigned coverage read" on public.billing_coverage_adjustments;
create policy "assigned coverage read" on public.billing_coverage_adjustments for select using(exists(select 1 from public.billing_cases c where c.id=billing_coverage_adjustments.billing_case_id and public.user_has_facility(c.facility_id)));

create or replace function public.refresh_billing_case(target_case uuid) returns public.billing_cases
language plpgsql security definer set search_path='' as $$
declare result public.billing_cases%rowtype;
begin
 update public.billing_cases c set
  gross_charges=coalesce((select sum(le.amount) from public.ledger_entries le where le.account_id=c.account_id and le.encounter_id=c.encounter_id and le.amount>0),0),
  approved_deductions=coalesce((select abs(sum(le.amount)) from public.ledger_entries le where le.account_id=c.account_id and le.encounter_id=c.encounter_id and le.amount<0 and le.kind<>'payment'),0),
  payments=coalesce((select sum(pa.amount) from public.payment_allocations pa join public.ledger_entries charged on charged.id=pa.ledger_entry_id where charged.account_id=c.account_id and charged.encounter_id=c.encounter_id),0),
  final_balance=coalesce((select sum(le.amount) from public.ledger_entries le where le.account_id=c.account_id and le.encounter_id=c.encounter_id and le.kind<>'payment'),0)-coalesce((select sum(pa.amount) from public.payment_allocations pa join public.ledger_entries charged on charged.id=pa.ledger_entry_id where charged.account_id=c.account_id and charged.encounter_id=c.encounter_id),0),
  updated_at=now()
 where c.id=target_case returning * into result;
 return result;
end$$;

create or replace function public.post_accommodation_through(target_admission uuid,through_date date default current_date)
returns integer language plpgsql security definer set search_path='' as $$
declare fac uuid;enc uuid;patient uuid;account uuid;stay record;service uuid;price numeric;charge_date date;posted integer:=0;entry uuid;key text;org uuid;
begin
 select e.facility_id,e.id,e.patient_id,p.organization_id into fac,enc,patient,org
 from public.admissions a join public.encounters e on e.id=a.encounter_id join public.patients p on p.id=e.patient_id
 where a.id=target_admission;
 if fac is null or not (public.has_privilege('billing.post',fac) or public.has_privilege('adt.write',fac)) then raise exception 'Not authorized to accrue accommodation charges';end if;
 select id into account from public.patient_accounts where patient_id=patient and facility_id=fac and status='open' order by created_at desc limit 1;
 if account is null then insert into public.patient_accounts(patient_id,facility_id,status) values(patient,fac,'open') returning id into account;end if;
 for stay in
  select bs.id,bs.started_at,bs.ended_at,b.code bed_code,w.name ward_name,w.billing_service_id
  from public.bed_stays bs join public.beds b on b.id=bs.bed_id join public.wards w on w.id=b.ward_id
  where bs.admission_id=target_admission
 loop
  service:=stay.billing_service_id;
  if service is null or exists(select 1 from public.ledger_entries where idempotency_key='auto-bed_stay-'||stay.id::text) then continue;end if;
  select amount into price from public.service_prices where facility_id=fac and service_id=service and effective_from<=through_date and(effective_to is null or effective_to>=through_date) order by effective_from desc limit 1;
  if price is null then continue;end if;
  for charge_date in select generate_series(stay.started_at::date,least(coalesce(stay.ended_at::date,through_date),through_date),'1 day'::interval)::date loop
   key:='auto-bed-day-'||stay.id::text||'-'||charge_date::text;
   insert into public.ledger_entries(account_id,encounter_id,kind,source_type,source_id,idempotency_key,description,amount,posted_by)
   values(account,enc,'charge','bed_day',stay.id,key,'Accommodation — '||stay.ward_name||' / '||stay.bed_code||' ('||charge_date::text||')',price,auth.uid())
   on conflict(idempotency_key) do nothing returning id into entry;
   if entry is not null then posted:=posted+1;end if;entry:=null;
  end loop;
 end loop;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
 values(org,fac,auth.uid(),'billing.accommodation_accrued','admission',target_admission,jsonb_build_object('through_date',through_date,'charges_posted',posted));
 return posted;
end$$;

create or replace function public.bill_completed_bed_stay() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.ended_at is null and new.ended_at is not null then
  perform public.post_accommodation_through(new.admission_id,new.ended_at::date);
 end if;
 return new;
end$$;

create or replace function public.reopen_case_for_late_ledger_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare case_id uuid;fac uuid;org uuid;previous text;
begin
 if new.encounter_id is null then return new;end if;
 select id,facility_id,status into case_id,fac,previous from public.billing_cases where encounter_id=new.encounter_id and status in('finalized','cleared') for update;
 if case_id is null then return new;end if;
 update public.billing_cases set status='reopened',reopened_by=new.posted_by,reopened_at=now(),reopen_reason='Automatic reopening due to new ledger activity',cleared_by=null,cleared_at=null,version=version+1,updated_at=now() where id=case_id;
 select organization_id into org from public.facilities where id=fac;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,new.posted_by,'billing.case_auto_reopened','billing_case',case_id,'New ledger activity after finalization',jsonb_build_object('previous_status',previous,'ledger_entry_id',new.id));
 return new;
end$$;

drop trigger if exists reopen_billing_case_on_ledger on public.ledger_entries;
create trigger reopen_billing_case_on_ledger after insert on public.ledger_entries for each row execute function public.reopen_case_for_late_ledger_activity();

create or replace function public.prepare_billing_case(target_admission uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare fac uuid;enc uuid;patient uuid;account uuid;case_id uuid;org uuid;
begin
 select e.facility_id,e.id,e.patient_id,p.organization_id into fac,enc,patient,org
 from public.admissions a join public.encounters e on e.id=a.encounter_id join public.patients p on p.id=e.patient_id where a.id=target_admission;
 if fac is null or not public.has_privilege('billing.post',fac) then raise exception 'Not authorized to prepare billing';end if;
 perform public.post_accommodation_through(target_admission,current_date);
 select id into account from public.patient_accounts where patient_id=patient and facility_id=fac and status='open' order by created_at desc limit 1;
 if account is null then insert into public.patient_accounts(patient_id,facility_id,status) values(patient,fac,'open') returning id into account;end if;
 insert into public.billing_cases(facility_id,patient_id,admission_id,encounter_id,account_id,status)
 values(fac,patient,target_admission,enc,account,'for_review')
 on conflict(admission_id) do update set status=case when public.billing_cases.status in('draft','reopened') then 'for_review' else public.billing_cases.status end,updated_at=now()
 returning id into case_id;
 perform public.refresh_billing_case(case_id);
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'billing.case_prepared','billing_case',case_id,jsonb_build_object('admission_id',target_admission));
 return case_id;
end$$;

create or replace function public.request_coverage_adjustment(target_case uuid,coverage_code text,coverage_reference text,coverage_description text,amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare row_data public.billing_cases%rowtype;result uuid;org uuid;
begin
 select * into row_data from public.billing_cases where id=target_case and status in('draft','for_review','reopened') for update;
 if not found or not public.has_privilege('billing.coverage.request',row_data.facility_id) then raise exception 'Open billing case not found or not authorized';end if;
 if coverage_code not in('philhealth','hmo','senior_pwd','charity','government','other') or coalesce(amount,0)<=0 or length(trim(coalesce(coverage_description,'')))<3 then raise exception 'Valid coverage type, description, and amount are required';end if;
 insert into public.billing_coverage_adjustments(billing_case_id,coverage_type,reference_no,description,requested_amount,requested_by,idempotency_key)
 values(target_case,coverage_code,nullif(trim(coverage_reference),''),trim(coverage_description),amount,auth.uid(),'coverage-'||gen_random_uuid()) returning id into result;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,row_data.facility_id,auth.uid(),'billing.coverage_requested','billing_coverage',result,jsonb_build_object('type',coverage_code,'amount',amount));
 return result;
end$$;

create or replace function public.decide_coverage_adjustment(target_adjustment uuid,decision text,approved_value numeric,decision_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare req public.billing_coverage_adjustments%rowtype;case_data public.billing_cases%rowtype;entry uuid;org uuid;
begin
 select * into req from public.billing_coverage_adjustments where id=target_adjustment and status='pending' for update;
 select * into case_data from public.billing_cases where id=req.billing_case_id for update;
 if req.id is null or not public.has_privilege('billing.coverage.approve',case_data.facility_id) then raise exception 'Pending deduction not found or not authorized';end if;
 if decision not in('approved','rejected') or length(trim(coalesce(decision_notes,'')))<5 then raise exception 'Decision and reason are required';end if;
 if decision='approved' and(coalesce(approved_value,0)<=0 or approved_value>req.requested_amount) then raise exception 'Approved amount must be positive and not exceed the request';end if;
 if decision='approved' then
  insert into public.ledger_entries(account_id,encounter_id,kind,source_type,source_id,idempotency_key,description,amount,posted_by,reason)
  values(case_data.account_id,case_data.encounter_id,'discount','coverage_deduction',req.id,req.idempotency_key,upper(replace(req.coverage_type,'_',' '))||' — '||req.description,-approved_value,auth.uid(),trim(decision_notes)) returning id into entry;
 end if;
 update public.billing_coverage_adjustments set status=decision,approved_amount=case when decision='approved' then approved_value else 0 end,decided_by=auth.uid(),decided_at=now(),decision_reason=trim(decision_notes),ledger_entry_id=entry where id=target_adjustment;
 perform public.refresh_billing_case(case_data.id);
 select organization_id into org from public.facilities where id=case_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,case_data.facility_id,auth.uid(),'billing.coverage_'||decision,'billing_coverage',target_adjustment,trim(decision_notes),jsonb_build_object('approved_amount',approved_value,'ledger_entry_id',entry));
 return entry;
end$$;

create or replace function public.set_billing_case_status(target_case uuid,next_status text,change_reason text)
returns public.billing_cases language plpgsql security definer set search_path='' as $$
declare current_case public.billing_cases%rowtype;refreshed public.billing_cases%rowtype;org uuid;
begin
 select * into current_case from public.billing_cases where id=target_case for update;
 if current_case.id is null then raise exception 'Billing case not found';end if;
 if next_status='finalized' then
  if not public.has_privilege('billing.finalize',current_case.facility_id) or current_case.status not in('for_review','reopened') then raise exception 'Billing case cannot be finalized';end if;
  if exists(select 1 from public.billing_coverage_adjustments where billing_case_id=target_case and status='pending') or exists(select 1 from public.billing_adjustment_requests r join public.ledger_entries le on le.id=r.ledger_entry_id where le.encounter_id=current_case.encounter_id and r.status='pending') then raise exception 'Resolve all pending deductions and adjustments before finalization';end if;
  perform public.post_accommodation_through(current_case.admission_id,current_date);
  refreshed:=public.refresh_billing_case(target_case);
  update public.billing_cases set status='finalized',finalized_by=auth.uid(),finalized_at=now(),version=version+1,updated_at=now() where id=target_case;
 elsif next_status='cleared' then
  if not public.has_privilege('billing.clearance',current_case.facility_id) or current_case.status<>'finalized' then raise exception 'Only finalized bills may be cleared';end if;
  refreshed:=public.refresh_billing_case(target_case);
  if refreshed.final_balance>0.009 then raise exception 'Patient still has an outstanding balance';end if;
  update public.billing_cases set status='cleared',cleared_by=auth.uid(),cleared_at=now(),version=version+1,updated_at=now() where id=target_case;
 elsif next_status='reopened' then
  if not public.has_privilege('billing.finalize',current_case.facility_id) or current_case.status not in('finalized','cleared') or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization and reopening reason are required';end if;
  update public.billing_cases set status='reopened',reopened_by=auth.uid(),reopened_at=now(),reopen_reason=trim(change_reason),cleared_by=null,cleared_at=null,version=version+1,updated_at=now() where id=target_case;
 else raise exception 'Unsupported billing status';
 end if;
 select organization_id into org from public.facilities where id=current_case.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,current_case.facility_id,auth.uid(),'billing.case_'||next_status,'billing_case',target_case,nullif(trim(change_reason),''),jsonb_build_object('previous_status',current_case.status));
 return public.refresh_billing_case(target_case);
end$$;

create or replace view public.billing_clearance_summary with(security_invoker=true) as
select c.id,c.facility_id,c.patient_id,c.admission_id,c.encounter_id,c.account_id,c.status,c.gross_charges,c.approved_deductions,c.payments,c.final_balance,c.finalized_at,c.cleared_at,c.version,c.created_at,
 p.mrn,p.first_name,p.last_name,a.admission_no,a.status admission_status,
 count(ca.id) filter(where ca.status='pending') pending_deductions
from public.billing_cases c join public.patients p on p.id=c.patient_id left join public.admissions a on a.id=c.admission_id left join public.billing_coverage_adjustments ca on ca.billing_case_id=c.id
group by c.id,p.id,a.id;

grant select on public.billing_cases,public.billing_coverage_adjustments,public.billing_clearance_summary to authenticated;
grant execute on function public.prepare_billing_case(uuid) to authenticated;
grant execute on function public.post_accommodation_through(uuid,date) to authenticated;
grant execute on function public.request_coverage_adjustment(uuid,text,text,text,numeric) to authenticated;
grant execute on function public.decide_coverage_adjustment(uuid,text,numeric,text) to authenticated;
grant execute on function public.set_billing_case_status(uuid,text,text) to authenticated;
revoke execute on function public.refresh_billing_case(uuid) from public,authenticated;

commit;
