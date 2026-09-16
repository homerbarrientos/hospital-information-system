begin;

alter table public.clinical_orders
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles;

drop function if exists public.cancel_order(uuid,text);

create function public.cancel_order(target_order uuid,cancel_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  org uuid;
  current_status text;
begin
  select e.facility_id,p.organization_id,o.status
  into fac,org,current_status
  from public.clinical_orders o
  join public.encounters e on e.id=o.encounter_id
  join public.patients p on p.id=e.patient_id
  where o.id=target_order and o.status not in ('cancelled','released')
  for update of o;

  if fac is null or not public.has_privilege('orders.write',fac) then
    raise exception 'This order cannot be cancelled';
  end if;
  if length(trim(coalesce(cancel_reason,''))) < 5 or length(trim(cancel_reason)) > 500 then
    raise exception 'Cancellation reason must contain 5 to 500 characters';
  end if;

  update public.clinical_orders
  set status='cancelled',cancellation_reason=trim(cancel_reason),cancelled_at=now(),
      cancelled_by=auth.uid(),updated_at=now(),updated_by=auth.uid()
  where id=target_order;
  update public.order_items set status='cancelled' where order_id=target_order;

  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,fac,auth.uid(),'order.cancelled','clinical_order',target_order,trim(cancel_reason),
    jsonb_build_object('previous_status',current_status));
end;
$$;

revoke all on function public.cancel_order(uuid,text) from public;
grant execute on function public.cancel_order(uuid,text) to authenticated;

notify pgrst, 'reload schema';

commit;
