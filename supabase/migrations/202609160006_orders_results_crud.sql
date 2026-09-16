begin;

insert into public.privileges(code, description, risk_level) values
  ('orders.read', 'View clinical orders and results', 'privileged'),
  ('orders.write', 'Create and modify clinical orders and results', 'high_risk')
on conflict(code) do update set description = excluded.description, risk_level = excluded.risk_level;

insert into public.role_privileges(role_id, privilege_code)
select r.id, p.code
from public.roles r
join public.organizations o on o.id = r.organization_id
cross join public.privileges p
where o.code = 'INF'
  and r.name = 'Hospital Administrator'
  and p.code in ('orders.read', 'orders.write')
on conflict do nothing;

create sequence if not exists public.clinical_order_no_seq;

alter table public.clinical_orders
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles;

drop policy if exists "orders read" on public.clinical_orders;
create policy "orders read" on public.clinical_orders for select using (
  exists (select 1 from public.encounters e where e.id = clinical_orders.encounter_id and public.has_privilege('orders.read', e.facility_id))
);
drop policy if exists "order items read" on public.order_items;
create policy "order items read" on public.order_items for select using (
  exists (select 1 from public.clinical_orders o join public.encounters e on e.id = o.encounter_id where o.id = order_items.order_id and public.has_privilege('orders.read', e.facility_id))
);
drop policy if exists "order results read" on public.clinical_results;
create policy "order results read" on public.clinical_results for select using (
  exists (
    select 1 from public.order_items oi
    join public.clinical_orders o on o.id = oi.order_id
    join public.encounters e on e.id = o.encounter_id
    where oi.id = clinical_results.order_item_id and public.has_privilege('orders.read', e.facility_id)
  )
);

create or replace function public.create_order(
  target_encounter uuid,
  order_type text,
  order_priority text,
  order_instructions text,
  order_items_json jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  fac uuid; org uuid; order_id uuid; order_no text; item jsonb;
begin
  select e.facility_id, p.organization_id into fac, org
  from public.encounters e join public.patients p on p.id = e.patient_id
  where e.id = target_encounter and e.status <> 'cancelled';
  if fac is null or not public.has_privilege('orders.write', fac) then raise exception 'Not authorized to create orders'; end if;
  if order_type not in ('laboratory','imaging','procedure','supply','other') then raise exception 'Select a valid order type'; end if;
  if order_priority not in ('routine','urgent','stat') then raise exception 'Select a valid priority'; end if;
  if jsonb_typeof(order_items_json) <> 'array' or jsonb_array_length(order_items_json) < 1 or jsonb_array_length(order_items_json) > 20 then
    raise exception 'Add between 1 and 20 order items';
  end if;
  if length(coalesce(order_instructions, '')) > 2000 then raise exception 'Instructions cannot exceed 2000 characters'; end if;
  order_no := 'ORD-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.clinical_order_no_seq')::text,6,'0');
  insert into public.clinical_orders(encounter_id,order_no,order_type,priority,status,ordered_by,instructions)
  values(target_encounter,order_no,order_type,order_priority,'requested',auth.uid(),nullif(trim(order_instructions),''))
  returning id into order_id;
  for item in select value from jsonb_array_elements(order_items_json) loop
    if length(trim(coalesce(item->>'description',''))) < 2 or length(trim(item->>'description')) > 250 then
      raise exception 'Each order item must contain 2 to 250 characters';
    end if;
    if coalesce(item->>'charge_on','none') not in ('request','collection','completion','release','none') then
      raise exception 'Invalid charge trigger';
    end if;
    insert into public.order_items(order_id,description,status,charge_on)
    values(order_id,trim(item->>'description'),'requested',coalesce(item->>'charge_on','none'));
  end loop;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
  values(org,fac,auth.uid(),'order.created','clinical_order',order_id,jsonb_build_object('order_no',order_no,'item_count',jsonb_array_length(order_items_json)));
  return order_id;
end;
$$;

create or replace function public.amend_order(
  target_order uuid,
  order_type text,
  order_priority text,
  order_instructions text,
  order_items_json jsonb,
  modification_reason text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  fac uuid; org uuid; old_record jsonb; item jsonb;
begin
  select e.facility_id,p.organization_id,to_jsonb(o) into fac,org,old_record
  from public.clinical_orders o
  join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id
  where o.id=target_order and o.status in ('requested','acknowledged') for update of o;
  if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Only requested or acknowledged orders can be modified'; end if;
  if exists(select 1 from public.order_items oi join public.clinical_results r on r.order_item_id=oi.id where oi.order_id=target_order) then
    raise exception 'Orders with results cannot be modified; create a replacement order';
  end if;
  if length(trim(coalesce(modification_reason,''))) < 5 or length(trim(modification_reason)) > 500 then raise exception 'Modification reason must contain 5 to 500 characters'; end if;
  if order_type not in ('laboratory','imaging','procedure','supply','other') or order_priority not in ('routine','urgent','stat') then raise exception 'Invalid type or priority'; end if;
  if jsonb_typeof(order_items_json) <> 'array' or jsonb_array_length(order_items_json) < 1 or jsonb_array_length(order_items_json) > 20 then raise exception 'Add between 1 and 20 order items'; end if;
  delete from public.order_items where order_id=target_order;
  for item in select value from jsonb_array_elements(order_items_json) loop
    if length(trim(coalesce(item->>'description',''))) < 2 or length(trim(item->>'description')) > 250 then raise exception 'Each order item must contain 2 to 250 characters'; end if;
    insert into public.order_items(order_id,description,status,charge_on)
    values(target_order,trim(item->>'description'),'requested',coalesce(item->>'charge_on','none'));
  end loop;
  update public.clinical_orders set order_type=amend_order.order_type,priority=order_priority,
    instructions=nullif(trim(order_instructions),''),version=version+1,updated_at=now(),updated_by=auth.uid()
  where id=target_order;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,fac,auth.uid(),'order.amended','clinical_order',target_order,trim(modification_reason),jsonb_build_object('previous',old_record,'item_count',jsonb_array_length(order_items_json)));
end;
$$;

create or replace function public.advance_order(
  target_order uuid,
  next_status text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare fac uuid; org uuid; current_status text;
begin
  select e.facility_id,p.organization_id,o.status into fac,org,current_status
  from public.clinical_orders o join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id
  where o.id=target_order for update of o;
  if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Not authorized to update this order'; end if;
  if not (
    (current_status='requested' and next_status='acknowledged') or
    (current_status='acknowledged' and next_status in ('collected','in_progress')) or
    (current_status='collected' and next_status='in_progress') or
    (current_status='in_progress' and next_status='completed') or
    (current_status='completed' and next_status='validated') or
    (current_status='validated' and next_status='released')
  ) then raise exception 'Invalid order status transition from % to %',current_status,next_status; end if;
  if next_status='validated' and exists(
    select 1 from public.order_items oi where oi.order_id=target_order and not exists(
      select 1 from public.clinical_results r where r.order_item_id=oi.id and r.status='final'
    )
  ) then raise exception 'Every order item needs a final result before validation'; end if;
  update public.clinical_orders set status=next_status,updated_at=now(),updated_by=auth.uid() where id=target_order;
  if next_status in ('collected','in_progress','completed','validated','released') then
    update public.order_items set status=next_status where order_id=target_order and status<>'cancelled';
  end if;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
  values(org,fac,auth.uid(),'order.status_changed','clinical_order',target_order,jsonb_build_object('from',current_status,'to',next_status));
end;
$$;

create or replace function public.record_order_result(
  target_item uuid,
  result_text text,
  validate_result boolean,
  correction_reason text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare fac uuid; org uuid; order_id uuid; result_id uuid; has_final boolean;
begin
  select e.facility_id,p.organization_id,o.id into fac,org,order_id
  from public.order_items oi join public.clinical_orders o on o.id=oi.order_id
  join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id
  where oi.id=target_item and o.status not in ('cancelled','released');
  if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Not authorized to record this result'; end if;
  if length(trim(coalesce(result_text,''))) < 2 or length(trim(result_text)) > 5000 then raise exception 'Result must contain 2 to 5000 characters'; end if;
  select exists(select 1 from public.clinical_results where order_item_id=target_item and status='final') into has_final;
  if has_final and (length(trim(coalesce(correction_reason,''))) < 5 or length(trim(correction_reason)) > 500) then
    raise exception 'Correction reason must contain 5 to 500 characters';
  end if;
  if has_final then update public.clinical_results set status='corrected',correction_reason=trim(record_order_result.correction_reason) where order_item_id=target_item and status='final'; end if;
  insert into public.clinical_results(order_item_id,result_data,result_text,status,entered_by,validated_by,validated_at,correction_reason)
  values(target_item,jsonb_build_object('text',trim(record_order_result.result_text)),trim(record_order_result.result_text),
    case when validate_result then 'final' else 'draft' end,auth.uid(),
    case when validate_result then auth.uid() else null end,case when validate_result then now() else null end,
    case when has_final then trim(record_order_result.correction_reason) else null end)
  returning id into result_id;
  update public.order_items set status=case when validate_result then 'completed' else 'in_progress' end where id=target_item;
  update public.clinical_orders set status='in_progress',updated_at=now(),updated_by=auth.uid()
  where id=order_id and status in ('requested','acknowledged','collected');
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,fac,auth.uid(),case when validate_result then 'result.validated' else 'result.saved' end,'clinical_result',result_id,
    nullif(trim(correction_reason),''),jsonb_build_object('order_id',order_id,'item_id',target_item));
  return result_id;
end;
$$;

create or replace function public.cancel_order(target_order uuid,cancel_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare fac uuid;org uuid;current_status text;
begin
  select e.facility_id,p.organization_id,o.status into fac,org,current_status
  from public.clinical_orders o join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id
  where o.id=target_order and o.status not in ('cancelled','released') for update of o;
  if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'This order cannot be cancelled'; end if;
  if length(trim(coalesce(cancel_reason,''))) < 5 or length(trim(cancel_reason)) > 500 then raise exception 'Cancellation reason must contain 5 to 500 characters'; end if;
  update public.clinical_orders set status='cancelled',cancellation_reason=trim(cancel_reason),cancelled_at=now(),cancelled_by=auth.uid(),updated_at=now(),updated_by=auth.uid() where id=target_order;
  update public.order_items set status='cancelled' where order_id=target_order;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,fac,auth.uid(),'order.cancelled','clinical_order',target_order,trim(cancel_reason),jsonb_build_object('previous_status',current_status));
end;
$$;

grant execute on function public.create_order(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.amend_order(uuid,text,text,text,jsonb,text) to authenticated;
grant execute on function public.advance_order(uuid,text) to authenticated;
grant execute on function public.record_order_result(uuid,text,boolean,text) to authenticated;
grant execute on function public.cancel_order(uuid,text) to authenticated;

commit;
