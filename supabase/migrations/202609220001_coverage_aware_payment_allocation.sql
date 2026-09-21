begin;

-- Payment allocations are derived bookkeeping. Rebuild them against each
-- encounter's net payable charges so approved coverage is not paid again.
create or replace function public.rebuild_payment_allocations_for_account(target_account uuid)
returns numeric
language plpgsql
security definer
set search_path=''
as $$
declare
 payment_row record;
 charge_row record;
 remaining numeric;
 allocation numeric;
 allocated_total numeric:=0;
begin
 perform 1 from public.patient_accounts where id=target_account for update;
 if not found then raise exception 'Patient account not found';end if;

 delete from public.payment_allocations pa
 using public.payments p
 where pa.payment_id=p.id and p.account_id=target_account;

 for payment_row in
  select p.id,p.amount
  from public.payments p
  where p.account_id=target_account and p.status='posted'
  order by p.posted_at,p.id
 loop
  remaining:=payment_row.amount;
  for charge_row in
   with positive_entries as(
    select
     le.id,
     le.encounter_id,
     le.posted_at,
     le.amount,
     sum(le.amount) over(
      partition by le.encounter_id
      order by le.posted_at,le.id
      rows between unbounded preceding and current row
     ) cumulative_amount,
     coalesce(sum(le.amount) over(
      partition by le.encounter_id
      order by le.posted_at,le.id
      rows between unbounded preceding and 1 preceding
     ),0) prior_amount
    from public.ledger_entries le
    where le.account_id=target_account
    and le.kind in('charge','adjustment')
    and le.amount>0
    and not exists(select 1 from public.ledger_entries reversed where reversed.reverses_entry_id=le.id)
   )
   select
    positive.id,
    greatest(
     greatest(positive.cumulative_amount-credit.total,0)
     -greatest(positive.prior_amount-credit.total,0)
     -coalesce(applied.total,0),
     0
    ) balance
   from positive_entries positive
   cross join lateral(
    select abs(coalesce(sum(le.amount),0)) total
    from public.ledger_entries le
    where le.account_id=target_account
    and le.encounter_id is not distinct from positive.encounter_id
    and le.amount<0
    and le.kind not in('payment','reversal')
   ) credit
   left join lateral(
    select sum(pa.amount) total
    from public.payment_allocations pa
    where pa.ledger_entry_id=positive.id
   ) applied on true
   order by positive.posted_at,positive.id
  loop
   exit when remaining<=0;
   allocation:=least(remaining,charge_row.balance);
   if allocation>0 then
    insert into public.payment_allocations(payment_id,ledger_entry_id,amount)
    values(payment_row.id,charge_row.id,allocation);
    remaining:=remaining-allocation;
    allocated_total:=allocated_total+allocation;
   end if;
  end loop;
 end loop;
 return allocated_total;
end$$;

revoke all on function public.rebuild_payment_allocations_for_account(uuid) from public,anon,authenticated;

create or replace function public.post_patient_payment(target_facility uuid,target_patient uuid,payment_amount numeric,method_code text,external_ref text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare shift_id uuid;account uuid;payment_id uuid;receipt text;allocated numeric;
begin
 if auth.uid() is null or not public.has_privilege('billing.post',target_facility) then raise exception 'Not authorized to post patient payments';end if;
 if payment_amount is null or payment_amount<=0 then raise exception 'Payment must be positive';end if;
 if not exists(select 1 from public.reference_options o join public.reference_groups g on g.id=o.group_id join public.facilities f on f.organization_id=g.organization_id where f.id=target_facility and g.code='payment_method' and o.code=method_code and o.active) then raise exception 'Invalid payment method';end if;
 select id into shift_id from public.cashier_shifts where facility_id=target_facility and cashier_id=auth.uid() and status='open' for update;
 if not found then raise exception 'Open cashier shift required';end if;
 insert into public.patient_accounts(patient_id,facility_id) values(target_patient,target_facility) on conflict(facility_id,patient_id) do update set patient_id=excluded.patient_id returning id into account;
 receipt:='OR-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.official_receipt_seq')::text,8,'0');
 insert into public.payments(shift_id,account_id,receipt_no,payment_method,amount,external_reference,posted_by) values(shift_id,account,receipt,method_code,payment_amount,nullif(trim(external_ref),''),auth.uid()) returning id into payment_id;
 insert into public.ledger_entries(account_id,kind,source_type,source_id,description,amount,posted_by,idempotency_key) values(account,'payment','cashier_payment',payment_id,'Payment '||receipt,-payment_amount,auth.uid(),'payment-'||payment_id);
 perform public.rebuild_payment_allocations_for_account(account);
 select coalesce(sum(pa.amount),0) into allocated from public.payment_allocations pa where pa.payment_id=payment_id;
 insert into public.audit_events(facility_id,actor_id,event_type,object_type,object_id,details) values(target_facility,auth.uid(),'billing.payment_posted','payment',payment_id,jsonb_build_object('receipt_no',receipt,'amount',payment_amount,'allocated',allocated));
 return receipt;
end$$;

grant execute on function public.post_patient_payment(uuid,uuid,numeric,text,text) to authenticated;

create or replace function public.decide_coverage_adjustment(target_adjustment uuid,decision text,approved_value numeric,decision_notes text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
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
  perform public.rebuild_payment_allocations_for_account(case_data.account_id);
 end if;
 update public.billing_coverage_adjustments set status=decision,approved_amount=case when decision='approved' then approved_value else 0 end,decided_by=auth.uid(),decided_at=now(),decision_reason=trim(decision_notes),ledger_entry_id=entry where id=target_adjustment;
 perform public.refresh_billing_case(case_data.id);
 select organization_id into org from public.facilities where id=case_data.facility_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,case_data.facility_id,auth.uid(),'billing.coverage_'||decision,'billing_coverage',target_adjustment,trim(decision_notes),jsonb_build_object('approved_amount',approved_value,'ledger_entry_id',entry));
 return entry;
end$$;

grant execute on function public.decide_coverage_adjustment(uuid,text,numeric,text) to authenticated;

-- Rebuild existing derived allocations only for accounts that contain both
-- posted payments and non-reversal credits such as approved coverage.
do $$
declare account_row record;case_row record;org uuid;allocated numeric;
begin
 for account_row in
  select distinct pa.id,pa.facility_id
  from public.patient_accounts pa
  join public.payments p on p.account_id=pa.id and p.status='posted'
  where exists(
   select 1 from public.ledger_entries le
   where le.account_id=pa.id and le.amount<0 and le.kind not in('payment','reversal')
  )
 loop
  allocated:=public.rebuild_payment_allocations_for_account(account_row.id);
  for case_row in select id from public.billing_cases where account_id=account_row.id loop
   perform public.refresh_billing_case(case_row.id);
  end loop;
  select organization_id into org from public.facilities where id=account_row.facility_id;
  insert into public.audit_events(organization_id,facility_id,event_type,object_type,object_id,reason,details)
  values(org,account_row.facility_id,'billing.payment_allocations_rebuilt','patient_account',account_row.id,'Coverage-aware allocation migration',jsonb_build_object('allocated_total',allocated));
 end loop;
end$$;

commit;
