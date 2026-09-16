begin;

grant select on public.clinical_orders, public.order_items, public.clinical_results to authenticated;

drop policy if exists "clinical order read" on public.clinical_orders;
drop policy if exists "orders read" on public.clinical_orders;
create policy "orders read" on public.clinical_orders for select using (
  exists (
    select 1 from public.encounters e
    where e.id=clinical_orders.encounter_id
      and public.has_privilege('orders.read',e.facility_id)
  )
);

drop policy if exists "clinical order item read" on public.order_items;
drop policy if exists "order items read" on public.order_items;
create policy "order items read" on public.order_items for select using (
  exists (
    select 1 from public.clinical_orders o
    join public.encounters e on e.id=o.encounter_id
    where o.id=order_items.order_id
      and public.has_privilege('orders.read',e.facility_id)
  )
);

drop policy if exists "clinical result read" on public.clinical_results;
drop policy if exists "order results read" on public.clinical_results;
create policy "order results read" on public.clinical_results for select using (
  exists (
    select 1 from public.order_items oi
    join public.clinical_orders o on o.id=oi.order_id
    join public.encounters e on e.id=o.encounter_id
    where oi.id=clinical_results.order_item_id
      and public.has_privilege('orders.read',e.facility_id)
  )
);

commit;
