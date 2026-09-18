begin;

insert into public.privileges(code,description,risk_level) values
 ('billing.post','Post patient charges and payments','high_risk'),
 ('billing.reverse','Reverse eligible patient ledger entries','high_risk'),
 ('cashier.shift','Open and reconcile cashier shifts','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('billing.post','billing.reverse','cashier.shift')
on conflict do nothing;

insert into public.reference_groups(organization_id,code,name,description)
select o.id,'payment_method','Payment methods','Methods accepted by the cashier' from public.organizations o
on conflict(organization_id,code) do nothing;
insert into public.reference_options(group_id,code,label,sort_order,active)
select g.id,v.code,v.label,v.ord,true from public.reference_groups g cross join(values('cash','Cash',10),('card','Credit / debit card',20),('bank_transfer','Bank transfer',30),('e_wallet','E-wallet',40))v(code,label,ord)
where g.code='payment_method' on conflict(group_id,code) do nothing;

create unique index if not exists patient_accounts_facility_patient_uidx on public.patient_accounts(facility_id,patient_id);
create index if not exists ledger_entries_account_posted_idx on public.ledger_entries(account_id,posted_at desc);
create index if not exists payments_account_posted_idx on public.payments(account_id,posted_at desc);
create unique index if not exists one_open_shift_per_cashier on public.cashier_shifts(facility_id,cashier_id) where status='open';
create sequence if not exists public.official_receipt_seq start 1;

drop policy if exists "assigned ledger read" on public.ledger_entries;
create policy "assigned ledger read" on public.ledger_entries for select using(exists(select 1 from public.patient_accounts a where a.id=ledger_entries.account_id and public.user_has_facility(a.facility_id)));
drop policy if exists "assigned payment read" on public.payments;
create policy "assigned payment read" on public.payments for select using(exists(select 1 from public.patient_accounts a where a.id=payments.account_id and public.user_has_facility(a.facility_id)));
drop policy if exists "assigned payment group read" on public.reference_groups;
create policy "assigned payment group read" on public.reference_groups for select using(code='payment_method' and exists(select 1 from public.facilities f where f.organization_id=reference_groups.organization_id and public.user_has_facility(f.id)));
drop policy if exists "assigned payment option read" on public.reference_options;
create policy "assigned payment option read" on public.reference_options for select using(exists(select 1 from public.reference_groups g join public.facilities f on f.organization_id=g.organization_id where g.id=reference_options.group_id and g.code='payment_method' and public.user_has_facility(f.id)));

-- Existing installations may have older return types. PostgreSQL requires dropping
-- those signatures before they can be recreated with the current contracts.
drop function if exists public.open_cashier_shift(uuid,numeric);
drop function if exists public.close_cashier_shift(uuid,numeric);
drop function if exists public.post_patient_charge(uuid,uuid,text,numeric);
drop function if exists public.post_patient_payment(uuid,uuid,numeric,text,text);
drop function if exists public.reverse_ledger_entry(uuid,text);

create or replace function public.open_cashier_shift(target_facility uuid,opening_cash numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not public.has_privilege('cashier.shift',target_facility) then raise exception 'Not authorized for cashier shift operations';end if;
 if opening_cash is null or opening_cash<0 then raise exception 'Opening cash cannot be negative';end if;
 if exists(select 1 from public.cashier_shifts where facility_id=target_facility and cashier_id=auth.uid() and status='open') then raise exception 'You already have an open cashier shift';end if;
 insert into public.cashier_shifts(facility_id,cashier_id,opening_amount,status) values(target_facility,auth.uid(),opening_cash,'open') returning id into result;
 insert into public.audit_events(facility_id,actor_id,event_type,object_type,object_id,details) values(target_facility,auth.uid(),'cashier_shift.opened','cashier_shift',result,jsonb_build_object('opening_cash',opening_cash));
 return result;
end$$;

create or replace function public.close_cashier_shift(target_shift uuid,actual_cash numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.cashier_shifts%rowtype; expected numeric;
begin
 select * into s from public.cashier_shifts where id=target_shift for update;
 if not found or auth.uid() is null or s.cashier_id<>auth.uid() or not public.has_privilege('cashier.shift',s.facility_id) then raise exception 'Open cashier shift not found or not authorized';end if;
 if s.status<>'open' then raise exception 'Cashier shift is already closed';end if;if actual_cash is null or actual_cash<0 then raise exception 'Actual cash cannot be negative';end if;
 select s.opening_amount+coalesce(sum(p.amount),0) into expected from public.payments p where p.shift_id=s.id and p.status='posted' and p.payment_method='cash';
 update public.cashier_shifts set closed_at=now(),expected_amount=expected,actual_amount=actual_cash,status='closed' where id=s.id;
 insert into public.audit_events(facility_id,actor_id,event_type,object_type,object_id,details) values(s.facility_id,auth.uid(),'cashier_shift.closed','cashier_shift',s.id,jsonb_build_object('expected_cash',expected,'actual_cash',actual_cash,'variance',actual_cash-expected));
 return s.id;
end$$;

create or replace function public.post_patient_charge(target_facility uuid,target_encounter uuid,charge_description text,charge_amount numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.encounters%rowtype; account uuid; result uuid;
begin
 if auth.uid() is null or not public.has_privilege('billing.post',target_facility) then raise exception 'Not authorized to post patient charges';end if;
 if charge_amount is null or charge_amount<=0 or length(trim(coalesce(charge_description,'')))<2 then raise exception 'Valid charge description and amount are required';end if;
 select * into e from public.encounters where id=target_encounter and facility_id=target_facility;if not found then raise exception 'Encounter not found';end if;
 insert into public.patient_accounts(patient_id,facility_id) values(e.patient_id,target_facility) on conflict(facility_id,patient_id) do update set patient_id=excluded.patient_id returning id into account;
 insert into public.ledger_entries(account_id,encounter_id,kind,source_type,description,amount,posted_by,idempotency_key) values(account,e.id,'charge','manual_charge',trim(charge_description),charge_amount,auth.uid(),'manual-charge-'||gen_random_uuid()) returning id into result;
 insert into public.audit_events(facility_id,actor_id,event_type,object_type,object_id,details) values(target_facility,auth.uid(),'billing.charge_posted','ledger_entry',result,jsonb_build_object('amount',charge_amount,'encounter_id',target_encounter));return result;
end$$;

create or replace function public.post_patient_payment(target_facility uuid,target_patient uuid,payment_amount numeric,method_code text,external_ref text) returns text language plpgsql security definer set search_path='' as $$
declare shift_id uuid;account uuid;payment_id uuid;receipt text;remaining numeric;row record;allocated numeric;
begin
 if auth.uid() is null or not public.has_privilege('billing.post',target_facility) then raise exception 'Not authorized to post patient payments';end if;if payment_amount is null or payment_amount<=0 then raise exception 'Payment must be positive';end if;
 if not exists(select 1 from public.reference_options o join public.reference_groups g on g.id=o.group_id join public.facilities f on f.organization_id=g.organization_id where f.id=target_facility and g.code='payment_method' and o.code=method_code and o.active) then raise exception 'Invalid payment method';end if;
 select id into shift_id from public.cashier_shifts where facility_id=target_facility and cashier_id=auth.uid() and status='open' for update;if not found then raise exception 'Open cashier shift required';end if;
 insert into public.patient_accounts(patient_id,facility_id) values(target_patient,target_facility) on conflict(facility_id,patient_id) do update set patient_id=excluded.patient_id returning id into account;
 receipt:='OR-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.official_receipt_seq')::text,8,'0');
 insert into public.payments(shift_id,account_id,receipt_no,payment_method,amount,external_reference,posted_by) values(shift_id,account,receipt,method_code,payment_amount,nullif(trim(external_ref),''),auth.uid()) returning id into payment_id;
 insert into public.ledger_entries(account_id,kind,source_type,source_id,description,amount,posted_by,idempotency_key) values(account,'payment','cashier_payment',payment_id,'Payment '||receipt,-payment_amount,auth.uid(),'payment-'||payment_id);
 remaining:=payment_amount;
 for row in select l.id,greatest(l.amount-coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.ledger_entry_id=l.id),0),0) balance from public.ledger_entries l where l.account_id=account and l.kind in('charge','adjustment') and l.amount>0 and not exists(select 1 from public.ledger_entries r where r.reverses_entry_id=l.id) order by l.posted_at,l.id loop exit when remaining<=0;allocated:=least(remaining,row.balance);if allocated>0 then insert into public.payment_allocations(payment_id,ledger_entry_id,amount) values(payment_id,row.id,allocated);remaining:=remaining-allocated;end if;end loop;
 insert into public.audit_events(facility_id,actor_id,event_type,object_type,object_id,details) values(target_facility,auth.uid(),'billing.payment_posted','payment',payment_id,jsonb_build_object('receipt_no',receipt,'amount',payment_amount,'allocated',payment_amount-remaining));return receipt;
end$$;

create or replace function public.reverse_ledger_entry(target_entry uuid,reversal_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare original public.ledger_entries%rowtype;facility uuid;result uuid;
begin
 if length(trim(coalesce(reversal_reason,'')))<5 then raise exception 'Reversal reason must contain at least five characters';end if;
 select l.* into original from public.ledger_entries l where l.id=target_entry for update;
 select a.facility_id into facility from public.patient_accounts a where a.id=original.account_id;
 if not found or auth.uid() is null or not public.has_privilege('billing.reverse',facility) then raise exception 'Ledger entry not found or not authorized';end if;
 if original.kind not in('charge','adjustment') then raise exception 'Only charge or adjustment entries can be reversed';end if;if exists(select 1 from public.ledger_entries where reverses_entry_id=original.id) then raise exception 'Ledger entry has already been reversed';end if;
 insert into public.ledger_entries(account_id,encounter_id,kind,source_type,source_id,description,amount,currency,reverses_entry_id,posted_by,reason,idempotency_key) values(original.account_id,original.encounter_id,'reversal','ledger_reversal',original.id,'Reversal: '||original.description,-original.amount,original.currency,original.id,auth.uid(),trim(reversal_reason),'reversal-'||original.id) returning id into result;
 insert into public.audit_events(facility_id,actor_id,event_type,object_type,object_id,reason,details) values(facility,auth.uid(),'billing.entry_reversed','ledger_entry',result,trim(reversal_reason),jsonb_build_object('reversed_entry_id',original.id));return result;
end$$;

grant execute on function public.open_cashier_shift(uuid,numeric),public.close_cashier_shift(uuid,numeric),public.post_patient_charge(uuid,uuid,text,numeric),public.post_patient_payment(uuid,uuid,numeric,text,text),public.reverse_ledger_entry(uuid,text) to authenticated;
commit;
