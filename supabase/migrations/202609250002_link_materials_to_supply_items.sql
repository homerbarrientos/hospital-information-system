-- Supply items share the existing Inventory product catalog. Material balances
-- remain in material_items, where Purchasing receipts and patient issues post.
alter table public.material_items add column if not exists product_id uuid references public.products(id);

do $$
declare item record; existing public.products%rowtype; linked uuid;
begin
 for item in
  select m.id,m.code,m.name,m.unit,m.reorder_level,f.organization_id
  from public.material_items m join public.facilities f on f.id=m.facility_id
  where m.product_id is null
 loop
  select * into existing from public.products
  where organization_id=item.organization_id and code=item.code;
  if found then
   if existing.product_type <> 'supply' or existing.name <> item.name or existing.unit <> item.unit then
    raise exception 'Material code % conflicts with an Inventory product; resolve before linking',item.code;
   end if;
   if exists(select 1 from public.stock_lots l where l.product_id=existing.id and l.quantity_on_hand>0) then
    raise exception 'Supply item % has existing Inventory stock lots; reconcile the balance before linking',item.code;
   end if;
   linked:=existing.id;
  else
   insert into public.products(organization_id,code,name,product_type,unit,reorder_level,status)
   values(item.organization_id,item.code,item.name,'supply',item.unit,item.reorder_level,'active')
   returning id into linked;
  end if;
  update public.material_items set product_id=linked where id=item.id;
 end loop;
end$$;

alter table public.material_items alter column product_id set not null;
create unique index if not exists material_items_facility_product on public.material_items(facility_id,product_id);

create or replace function public.create_material_item(target_facility uuid,item_code text,item_name text,item_category text,item_unit text,reorder_quantity numeric,target_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;new_id uuid;product public.products%rowtype;
begin
 select organization_id into org from public.facilities where id=target_facility;
 if not public.has_privilege('materials.write',target_facility) or length(trim(coalesce(item_code,'')))<2 or length(trim(coalesce(item_name,'')))<2 or length(trim(coalesce(item_category,'')))<2 or length(trim(coalesce(item_unit,'')))<1 or coalesce(reorder_quantity,-1)<0 then raise exception 'Enter valid material details';end if;
 if target_service is not null and not exists(select 1 from public.service_catalog where id=target_service and organization_id=org and status='active' and billable) then raise exception 'Choose a billable service in this organization';end if;
 select * into product from public.products where organization_id=org and code=upper(trim(item_code)) for update;
 if product.id is null then
  insert into public.products(organization_id,code,name,product_type,unit,reorder_level,status)
  values(org,upper(trim(item_code)),trim(item_name),'supply',trim(item_unit),reorder_quantity,'active') returning * into product;
 elsif product.product_type<>'supply' or product.status<>'active' or product.name<>trim(item_name) or product.unit<>trim(item_unit) then
  raise exception 'Code already exists with different Inventory item details';
 end if;
 if exists(select 1 from public.stock_lots l where l.product_id=product.id and l.quantity_on_hand>0) then
  raise exception 'Supply item has stock in the old Inventory lots; reconcile before adding it to Materials';
 end if;
 insert into public.material_items(facility_id,product_id,code,name,category,unit,reorder_level,billing_service_id,created_by)
 values(target_facility,product.id,product.code,product.name,trim(item_category),product.unit,reorder_quantity,target_service,auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id)
 values(org,target_facility,auth.uid(),'material.created','material_item',new_id);
 return new_id;
end$$;
