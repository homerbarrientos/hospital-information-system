begin;

insert into public.privileges(code,description,risk_level) values
 ('charge_master.read','View hospital charge master and professional fee schedules','privileged'),
 ('charge_master.write','Maintain hospital charge master and professional fee schedules','high_risk'),
 ('billing.adjust.request','Request patient charge price adjustments','high_risk'),
 ('billing.adjust.approve','Approve or reject patient charge price adjustments','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('charge_master.read','charge_master.write','billing.adjust.request','billing.adjust.approve')
on conflict do nothing;

alter table public.service_catalog
 add column if not exists department_id uuid references public.departments,
 add column if not exists unit_of_measure text not null default 'service',
 add column if not exists revenue_class text not null default 'hospital',
 add column if not exists allow_price_override boolean not null default true,
 add column if not exists requires_override_approval boolean not null default true;

alter table public.service_prices
 add column if not exists minimum_amount numeric(14,2),
 add column if not exists maximum_amount numeric(14,2),
 add column if not exists version integer not null default 1,
 add column if not exists created_by uuid references public.profiles,
 add column if not exists created_at timestamptz not null default now();

alter table public.service_prices drop constraint if exists service_prices_valid_range;
alter table public.service_prices add constraint service_prices_valid_range
 check(minimum_amount is null or maximum_amount is null or maximum_amount>=minimum_amount);

create table if not exists public.doctor_fee_schedules(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities,
 doctor_id uuid not null references public.doctors,
 service_id uuid references public.service_catalog,
 encounter_type text not null default 'all',
 room_type text not null default 'all',
 standard_amount numeric(14,2) not null check(standard_amount>=0),
 minimum_amount numeric(14,2),
 maximum_amount numeric(14,2),
 hospital_share_percent numeric(5,2) not null default 0 check(hospital_share_percent between 0 and 100),
 effective_from date not null,
 effective_to date,
 active boolean not null default true,
 version integer not null default 1,
 created_by uuid not null references public.profiles,
 updated_by uuid references public.profiles,
 created_at timestamptz not null default now(),
 updated_at timestamptz,
 check(effective_to is null or effective_to>=effective_from),
 check(minimum_amount is null or maximum_amount is null or maximum_amount>=minimum_amount)
);

create table if not exists public.billing_adjustment_requests(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities,
 ledger_entry_id uuid not null references public.ledger_entries,
 original_amount numeric(14,2) not null,
 proposed_amount numeric(14,2) not null check(proposed_amount>=0),
 adjustment_amount numeric(14,2) generated always as(proposed_amount-original_amount) stored,
 reason text not null,
 attachment_path text,
 status text not null default 'pending' check(status in('pending','approved','rejected','cancelled')),
 requested_by uuid not null references public.profiles,
 requested_at timestamptz not null default now(),
 decided_by uuid references public.profiles,
 decided_at timestamptz,
 decision_reason text,
 posted_adjustment_id uuid references public.ledger_entries
);

create index if not exists service_prices_active_lookup_idx on public.service_prices(facility_id,service_id,effective_from desc) where effective_to is null;
create index if not exists doctor_fee_active_lookup_idx on public.doctor_fee_schedules(facility_id,doctor_id,service_id,encounter_type,room_type,effective_from desc) where active;
create index if not exists billing_adjustment_status_idx on public.billing_adjustment_requests(facility_id,status,requested_at desc);
create unique index if not exists billing_adjustment_one_pending_idx on public.billing_adjustment_requests(ledger_entry_id) where status='pending';

alter table public.doctor_fee_schedules enable row level security;
alter table public.billing_adjustment_requests enable row level security;
drop policy if exists "charge master doctor fee read" on public.doctor_fee_schedules;
create policy "charge master doctor fee read" on public.doctor_fee_schedules for select using(public.has_privilege('charge_master.read',facility_id));
drop policy if exists "billing adjustment read" on public.billing_adjustment_requests;
create policy "billing adjustment read" on public.billing_adjustment_requests for select using(public.has_privilege('billing.adjust.request',facility_id) or public.has_privilege('billing.adjust.approve',facility_id));

create or replace function public.save_charge_master_item(target_facility uuid,target_service uuid,service_code text,service_name text,service_category text,department uuid,unit_name text,revenue_type text,is_billable boolean,standard_amount numeric,minimum_price numeric,maximum_price numeric,allow_override boolean,approval_required boolean,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;sid uuid;old_record jsonb;
begin
 if not public.has_privilege('charge_master.write',target_facility) then raise exception 'Not authorized to maintain the charge master';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if org is null or length(trim(service_code))<2 or length(trim(service_name))<2 then raise exception 'Valid charge code and name are required';end if;
 if not public.valid_reference_option(org,'service_category',service_category) then raise exception 'Select a valid category';end if;
 if revenue_type not in('hospital','professional_fee','pass_through') then raise exception 'Select a valid revenue class';end if;
 if coalesce(standard_amount,-1)<0 or coalesce(minimum_price,0)<0 or coalesce(maximum_price,standard_amount)<coalesce(minimum_price,0) then raise exception 'Enter a valid price range';end if;
 if target_service is null then
  insert into public.service_catalog(organization_id,code,name,category,department_id,unit_of_measure,revenue_class,billable,allow_price_override,requires_override_approval,status)
  values(org,upper(trim(service_code)),trim(service_name),service_category,department,nullif(trim(unit_name),''),revenue_type,is_billable,allow_override,approval_required,'active') returning id into sid;
 else
  select to_jsonb(s) into old_record from public.service_catalog s where s.id=target_service and s.organization_id=org for update;
  if old_record is null then raise exception 'Charge item not found';end if;
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'Modification reason requires at least five characters';end if;
  update public.service_catalog set name=trim(service_name),category=service_category,department_id=department,unit_of_measure=coalesce(nullif(trim(unit_name),''),'service'),revenue_class=revenue_type,billable=is_billable,allow_price_override=allow_override,requires_override_approval=approval_required,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_service and version=expected_version returning id into sid;
  if sid is null then raise exception 'Charge item changed. Refresh and try again';end if;
 end if;
 update public.service_prices set effective_to=current_date-1 where service_id=sid and facility_id=target_facility and effective_to is null and effective_from<current_date;
 delete from public.service_prices where service_id=sid and facility_id=target_facility and effective_from=current_date;
 if is_billable then insert into public.service_prices(service_id,facility_id,amount,minimum_amount,maximum_amount,effective_from,created_by) values(sid,target_facility,standard_amount,minimum_price,maximum_price,current_date,auth.uid());end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_service is null then 'charge_master.created' else 'charge_master.updated' end,'service',sid,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'standard_amount',standard_amount,'minimum_amount',minimum_price,'maximum_amount',maximum_price,'revenue_class',revenue_type));
 return sid;
end$$;

create or replace function public.save_doctor_fee_schedule(target_facility uuid,target_schedule uuid,target_doctor uuid,target_service uuid,fee_encounter_type text,fee_room_type text,standard_amount numeric,minimum_price numeric,maximum_price numeric,hospital_share numeric,effective_date date,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid;org uuid;old_record jsonb;
begin
 if not public.has_privilege('charge_master.write',target_facility) then raise exception 'Not authorized to maintain professional fees';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if not exists(select 1 from public.doctor_facility_assignments where facility_id=target_facility and doctor_id=target_doctor and active) then raise exception 'Doctor is not active in this facility';end if;
 if coalesce(standard_amount,-1)<0 or coalesce(minimum_price,0)<0 or coalesce(maximum_price,standard_amount)<coalesce(minimum_price,0) or coalesce(hospital_share,0) not between 0 and 100 then raise exception 'Enter a valid professional fee range and hospital share';end if;
 if target_schedule is null then
  insert into public.doctor_fee_schedules(facility_id,doctor_id,service_id,encounter_type,room_type,standard_amount,minimum_amount,maximum_amount,hospital_share_percent,effective_from,created_by)
  values(target_facility,target_doctor,target_service,coalesce(nullif(trim(fee_encounter_type),''),'all'),coalesce(nullif(trim(fee_room_type),''),'all'),standard_amount,minimum_price,maximum_price,coalesce(hospital_share,0),coalesce(effective_date,current_date),auth.uid()) returning id into sid;
 else
  select to_jsonb(d) into old_record from public.doctor_fee_schedules d where d.id=target_schedule and d.facility_id=target_facility for update;
  if old_record is null or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Schedule and modification reason are required';end if;
  update public.doctor_fee_schedules set doctor_id=target_doctor,service_id=target_service,encounter_type=coalesce(nullif(trim(fee_encounter_type),''),'all'),room_type=coalesce(nullif(trim(fee_room_type),''),'all'),standard_amount=save_doctor_fee_schedule.standard_amount,minimum_amount=minimum_price,maximum_amount=maximum_price,hospital_share_percent=coalesce(hospital_share,0),effective_from=coalesce(effective_date,current_date),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_schedule and version=expected_version returning id into sid;
  if sid is null then raise exception 'Fee schedule changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_schedule is null then 'doctor_fee.created' else 'doctor_fee.updated' end,'doctor_fee_schedule',sid,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'standard_amount',standard_amount));return sid;
end$$;

create or replace function public.set_charge_master_status(target_facility uuid,target_record uuid,record_type text,make_active boolean,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;object_name text;
begin
 if not public.has_privilege('charge_master.write',target_facility) then raise exception 'Not authorized to maintain the charge master';end if;
 if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A reason of at least five characters is required';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if record_type='charge' then
  update public.service_catalog s set status=case when make_active then 'active'::public.record_status else 'inactive'::public.record_status end,version=s.version+1,updated_by=auth.uid(),updated_at=now()
  where s.id=target_record and s.organization_id=org returning s.name into object_name;
 elsif record_type='doctor_fee' then
  update public.doctor_fee_schedules d set active=make_active,version=d.version+1,updated_by=auth.uid(),updated_at=now()
  where d.id=target_record and d.facility_id=target_facility returning 'Doctor fee schedule' into object_name;
 else raise exception 'Invalid master record type';
 end if;
 if object_name is null then raise exception 'Master record not found';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
 values(org,target_facility,auth.uid(),'charge_master.status_changed',record_type,target_record,trim(change_reason),jsonb_build_object('active',make_active,'name',object_name));
end$$;

create or replace function public.request_charge_adjustment(target_entry uuid,proposed_price numeric,adjustment_reason text,attachment text)
returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;original public.ledger_entries%rowtype;rid uuid;override_allowed boolean;
begin
 select le.* into original from public.ledger_entries le join public.patient_accounts a on a.id=le.account_id where le.id=target_entry and le.kind in('charge','adjustment') and le.amount>0 for update of le;
 if not found then raise exception 'Charge not found';end if;
 select a.facility_id,f.organization_id into fac,org from public.patient_accounts a join public.facilities f on f.id=a.facility_id where a.id=original.account_id;
 if fac is null or not public.has_privilege('billing.adjust.request',fac) then raise exception 'Charge not found or not authorized';end if;
 if exists(select 1 from public.payment_allocations where ledger_entry_id=target_entry) then raise exception 'Allocated charges require a controlled refund workflow';end if;
 if coalesce(proposed_price,-1)<0 or length(trim(coalesce(adjustment_reason,'')))<5 then raise exception 'Proposed price and reason are required';end if;
 select s.allow_price_override into override_allowed from public.service_catalog s where s.id=original.source_id;
 if override_allowed is false then raise exception 'This charge does not allow a price override';end if;
 insert into public.billing_adjustment_requests(facility_id,ledger_entry_id,original_amount,proposed_amount,reason,attachment_path,requested_by,status)
 values(fac,target_entry,original.amount,proposed_price,trim(adjustment_reason),nullif(trim(attachment),''),auth.uid(),'pending') returning id into rid;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'billing.adjustment_requested','billing_adjustment',rid,trim(adjustment_reason),jsonb_build_object('ledger_entry_id',target_entry,'original_amount',original.amount,'proposed_amount',proposed_price));return rid;
end$$;

create or replace function public.decide_charge_adjustment(target_request uuid,decision text,decision_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare req public.billing_adjustment_requests%rowtype;org uuid;posted uuid;
begin
 select * into req from public.billing_adjustment_requests where id=target_request and status='pending' for update;
 if not found or not public.has_privilege('billing.adjust.approve',req.facility_id) then raise exception 'Pending adjustment not found or not authorized';end if;
 if decision not in('approved','rejected') or length(trim(coalesce(decision_notes,'')))<5 then raise exception 'Decision and reason are required';end if;
 select organization_id into org from public.facilities where id=req.facility_id;
 if decision='approved' then
  insert into public.ledger_entries(account_id,encounter_id,kind,source_type,source_id,idempotency_key,description,amount,currency,posted_by,reason)
  select account_id,encounter_id,'adjustment','price_adjustment',req.id,'adjustment-'||req.id::text,'Approved price adjustment: '||description,req.adjustment_amount,currency,auth.uid(),trim(decision_notes) from public.ledger_entries where id=req.ledger_entry_id returning id into posted;
 end if;
 update public.billing_adjustment_requests set status=decision,decided_by=auth.uid(),decided_at=now(),decision_reason=trim(decision_notes),posted_adjustment_id=posted where id=req.id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,req.facility_id,auth.uid(),'billing.adjustment_'||decision,'billing_adjustment',req.id,trim(decision_notes),jsonb_build_object('posted_adjustment_id',posted,'adjustment_amount',req.adjustment_amount));return posted;
end$$;

create or replace view public.billing_patient_balances with(security_invoker=true) as
select a.facility_id,a.patient_id,a.id account_id,
 coalesce(sum(le.amount) filter(where le.kind in('charge','adjustment','reversal','discount','refund')),0) gross_and_adjustments,
 coalesce(abs(sum(le.amount) filter(where le.kind='payment')),0) payments,
 coalesce(sum(le.amount),0) balance,
 greatest(coalesce(sum(le.amount),0),0) amount_due,
 greatest(-coalesce(sum(le.amount),0),0) advance_credit,
 max(le.posted_at) last_activity_at
from public.patient_accounts a left join public.ledger_entries le on le.account_id=a.id group by a.facility_id,a.patient_id,a.id;

create or replace view public.billing_daily_summary with(security_invoker=true) as
select a.facility_id,le.posted_at::date business_date,
 coalesce(sum(le.amount) filter(where le.kind in('charge','adjustment') and le.amount>0),0) charges,
 coalesce(abs(sum(le.amount) filter(where le.kind='payment')),0) collections,
 coalesce(abs(sum(le.amount) filter(where le.kind in('discount','reversal') or (le.kind='adjustment' and le.amount<0)),0) adjustments_and_discounts,
 count(*) transaction_count
from public.ledger_entries le join public.patient_accounts a on a.id=le.account_id group by a.facility_id,le.posted_at::date;

grant select on public.doctor_fee_schedules,public.billing_adjustment_requests,public.billing_patient_balances,public.billing_daily_summary to authenticated;
grant execute on function public.save_charge_master_item(uuid,uuid,text,text,text,uuid,text,text,boolean,numeric,numeric,numeric,boolean,boolean,integer,text) to authenticated;
grant execute on function public.save_doctor_fee_schedule(uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,integer,text) to authenticated;
grant execute on function public.set_charge_master_status(uuid,uuid,text,boolean,text) to authenticated;
grant execute on function public.request_charge_adjustment(uuid,numeric,text,text) to authenticated;
grant execute on function public.decide_charge_adjustment(uuid,text,text) to authenticated;

commit;
