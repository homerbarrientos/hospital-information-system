begin;

insert into public.privileges(code,description,risk_level) values
 ('inventory.read','View inventory balances and stock cards','privileged'),
 ('inventory.write','Post inventory receipts, balances, adjustments, and transfers','high_risk'),
 ('inventory.approve','Approve controlled inventory adjustments','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code like 'inventory.%'
on conflict do nothing;

create sequence if not exists public.inventory_reference_seq start 1;

create table if not exists public.suppliers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 code text not null, name text not null, contact_person text, phone text, email text, address text,
 status public.record_status not null default 'active', version integer not null default 1,
 created_by uuid references public.profiles, created_at timestamptz not null default now(),
 updated_by uuid references public.profiles, updated_at timestamptz,
 unique(organization_id,code)
);
alter table public.suppliers enable row level security;

alter table public.stores add column if not exists status public.record_status not null default 'active';
alter table public.stock_lots add column if not exists supplier_id uuid references public.suppliers,
 add column if not exists received_at timestamptz,
 add column if not exists version integer not null default 1;
alter table public.stock_movements add column if not exists reference_no text,
 add column if not exists balance_after numeric(14,3),
 add column if not exists unit_cost numeric(14,2),
 add column if not exists supplier_id uuid references public.suppliers,
 add column if not exists related_movement_id uuid references public.stock_movements,
 add column if not exists remarks text;

create table if not exists public.inventory_documents(
 id uuid primary key default gen_random_uuid(), movement_id uuid not null references public.stock_movements,
 storage_path text not null unique, original_name text not null, display_name text not null,
 description text, mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 5242880),
 status public.record_status not null default 'active', uploaded_by uuid not null references public.profiles,
 uploaded_at timestamptz not null default now(), removed_by uuid references public.profiles,
 removed_at timestamptz, removal_reason text
);
alter table public.inventory_documents enable row level security;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inventory-documents','inventory-documents',false,5242880,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

insert into public.reference_groups(organization_id,code,name,description)
select id,v.code,v.name,v.description from public.organizations cross join(values
 ('inventory_adjustment_reason','Inventory adjustment reason','Controlled reasons for increasing or decreasing stock'),
 ('inventory_location_type','Inventory location type','Types of stock storage locations')
)v(code,name,description)
on conflict(organization_id,code) do update set name=excluded.name,description=excluded.description;

insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g cross join(values
 ('physical_count','Physical count correction',10),('damaged','Damaged stock',20),('expired','Expired stock',30),
 ('lost','Lost or missing',40),('supplier_return','Returned to supplier',50),('data_correction','Data correction',60),('other','Other',70)
)v(code,label,sort_order) where g.code='inventory_adjustment_reason'
on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;

insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g cross join(values
 ('pharmacy','Pharmacy',10),('central_supply','Central supply',20),('ward','Ward stock',30),('emergency','Emergency cabinet',40),('other','Other',50)
)v(code,label,sort_order) where g.code='inventory_location_type'
on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;

insert into public.stores(facility_id,code,name,store_type)
select f.id,'MAIN-PHARM','Main Pharmacy','pharmacy' from public.facilities f
where not exists(select 1 from public.stores s where s.facility_id=f.id and s.code='MAIN-PHARM');

drop policy if exists "inventory supplier read" on public.suppliers;
create policy "inventory supplier read" on public.suppliers for select using(
 exists(select 1 from public.facilities f where f.organization_id=suppliers.organization_id and public.has_privilege('inventory.read',f.id))
);
drop policy if exists "inventory store read" on public.stores;
create policy "inventory store read" on public.stores for select using(public.has_privilege('inventory.read',facility_id) or public.has_privilege('pharmacy.read',facility_id));
drop policy if exists "inventory lot read" on public.stock_lots;
create policy "inventory lot read" on public.stock_lots for select using(exists(select 1 from public.stores s where s.id=stock_lots.store_id and (public.has_privilege('inventory.read',s.facility_id) or public.has_privilege('pharmacy.read',s.facility_id))));
drop policy if exists "inventory movement read" on public.stock_movements;
create policy "inventory movement read" on public.stock_movements for select using(exists(select 1 from public.stores s where s.id=stock_movements.store_id and public.has_privilege('inventory.read',s.facility_id)));
drop policy if exists "inventory document read" on public.inventory_documents;
create policy "inventory document read" on public.inventory_documents for select using(exists(select 1 from public.stock_movements m join public.stores s on s.id=m.store_id where m.id=inventory_documents.movement_id and public.has_privilege('inventory.read',s.facility_id)));

drop policy if exists "inventory object insert" on storage.objects;
create policy "inventory object insert" on storage.objects for insert to authenticated with check(bucket_id='inventory-documents' and public.has_privilege('inventory.write',((storage.foldername(name))[1])::uuid));
drop policy if exists "inventory object read" on storage.objects;
create policy "inventory object read" on storage.objects for select to authenticated using(bucket_id='inventory-documents' and public.has_privilege('inventory.read',((storage.foldername(name))[1])::uuid));
drop policy if exists "inventory object delete" on storage.objects;
create policy "inventory object delete" on storage.objects for delete to authenticated using(bucket_id='inventory-documents' and public.has_privilege('inventory.write',((storage.foldername(name))[1])::uuid));

create or replace function public.inventory_ref(prefix text) returns text language plpgsql security definer set search_path='' as $$
begin return upper(prefix)||'-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.inventory_reference_seq')::text,6,'0');end$$;

create or replace function public.post_inventory_stock(target_facility uuid,target_store uuid,target_product uuid,target_supplier uuid,lot_number text,expiry date,stock_quantity numeric,cost numeric,source_kind text,external_reference text,entry_remarks text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;lot uuid;movement uuid;ref text;new_balance numeric;begin
 if not public.has_privilege('inventory.write',target_facility) then raise exception 'Not authorized to post inventory';end if;
 select f.organization_id into org from public.facilities f join public.stores s on s.facility_id=f.id where f.id=target_facility and s.id=target_store and s.status='active';
 if org is null or not exists(select 1 from public.products where id=target_product and organization_id=org and status='active') then raise exception 'Select a valid product and location';end if;
 if source_kind not in('beginning_balance','receipt') or stock_quantity<=0 or cost<0 or length(trim(lot_number))<1 then raise exception 'Valid source, lot, quantity, and cost are required';end if;
 if source_kind='beginning_balance' and exists(select 1 from public.stock_movements m join public.stock_lots l on l.id=m.lot_id where m.store_id=target_store and m.product_id=target_product and l.lot_no=upper(trim(lot_number)) and m.source_type='beginning_balance') then raise exception 'Beginning balance already posted for this medicine, lot, and location';end if;
 insert into public.stock_lots(store_id,product_id,lot_no,expiry_date,quantity_on_hand,unit_cost,supplier_id,received_at)
 values(target_store,target_product,upper(trim(lot_number)),expiry,stock_quantity,cost,target_supplier,now())
 on conflict(store_id,product_id,lot_no) do update set quantity_on_hand=public.stock_lots.quantity_on_hand+excluded.quantity,expiry_date=coalesce(excluded.expiry_date,public.stock_lots.expiry_date),unit_cost=excluded.unit_cost,supplier_id=coalesce(excluded.supplier_id,public.stock_lots.supplier_id),received_at=now(),version=public.stock_lots.version+1
 returning id,quantity_on_hand into lot,new_balance;
 ref:=coalesce(nullif(trim(external_reference),''),public.inventory_ref(case when source_kind='beginning_balance' then 'BB' else 'RR' end));
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,reason,posted_by,reference_no,balance_after,unit_cost,supplier_id,remarks,idempotency_key)
 values(target_store,target_product,lot,'receipt',stock_quantity,source_kind,nullif(trim(entry_remarks),''),auth.uid(),ref,new_balance,cost,target_supplier,nullif(trim(entry_remarks),''),source_kind||'-'||target_store||'-'||target_product||'-'||upper(trim(lot_number))||'-'||ref) returning id into movement;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'inventory.'||source_kind,'stock_movement',movement,nullif(trim(entry_remarks),''),jsonb_build_object('reference',ref,'lot',upper(trim(lot_number))));return movement;
end$$;

create or replace function public.adjust_inventory(target_facility uuid,target_lot uuid,actual_quantity numeric,reason_code text,adjustment_remarks text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;store uuid;product uuid;current_qty numeric;delta numeric;movement uuid;ref text;begin
 if not public.has_privilege('inventory.write',target_facility) or actual_quantity<0 or length(trim(coalesce(adjustment_remarks,'')))<5 then raise exception 'Authorization, actual quantity, and detailed reason are required';end if;
 select f.organization_id,l.store_id,l.product_id,l.quantity_on_hand into org,store,product,current_qty from public.stock_lots l join public.stores s on s.id=l.store_id join public.facilities f on f.id=s.facility_id where l.id=target_lot and f.id=target_facility for update of l;
 if org is null or not public.valid_reference_option(org,'inventory_adjustment_reason',reason_code) then raise exception 'Select a valid lot and adjustment reason';end if;
 delta:=actual_quantity-current_qty;if delta=0 then raise exception 'Actual quantity is unchanged';end if;ref:=public.inventory_ref('ADJ');
 update public.stock_lots set quantity_on_hand=actual_quantity,version=version+1 where id=target_lot;
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,reason,posted_by,reference_no,balance_after,remarks,idempotency_key) values(store,product,target_lot,'adjustment',delta,'inventory_adjustment',reason_code,auth.uid(),ref,actual_quantity,trim(adjustment_remarks),'adjustment-'||ref) returning id into movement;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'inventory.adjusted','stock_movement',movement,trim(adjustment_remarks),jsonb_build_object('reference',ref,'previous_quantity',current_qty,'actual_quantity',actual_quantity,'reason_code',reason_code));return movement;
end$$;

create or replace function public.transfer_inventory(target_facility uuid,target_lot uuid,destination_store uuid,transfer_quantity numeric,transfer_remarks text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;source_store uuid;product uuid;lotno text;expiry date;cost numeric;supplier uuid;available numeric;target_lot_id uuid;out_id uuid;ref text;begin
 if not public.has_privilege('inventory.write',target_facility) or transfer_quantity<=0 or length(trim(coalesce(transfer_remarks,'')))<5 then raise exception 'Valid quantity and transfer reason are required';end if;
 select f.organization_id,l.store_id,l.product_id,l.lot_no,l.expiry_date,l.unit_cost,l.supplier_id,l.quantity_on_hand into org,source_store,product,lotno,expiry,cost,supplier,available from public.stock_lots l join public.stores s on s.id=l.store_id join public.facilities f on f.id=s.facility_id where l.id=target_lot and f.id=target_facility for update of l;
 if org is null or available<transfer_quantity or source_store=destination_store or not exists(select 1 from public.stores where id=destination_store and facility_id=target_facility and status='active') then raise exception 'Invalid source, destination, or insufficient stock';end if;ref:=public.inventory_ref('TRF');
 update public.stock_lots set quantity_on_hand=quantity_on_hand-transfer_quantity,version=version+1 where id=target_lot;
 insert into public.stock_lots(store_id,product_id,lot_no,expiry_date,quantity_on_hand,unit_cost,supplier_id,received_at) values(destination_store,product,lotno,expiry,transfer_quantity,cost,supplier,now()) on conflict(store_id,product_id,lot_no) do update set quantity_on_hand=public.stock_lots.quantity_on_hand+excluded.quantity_on_hand,version=public.stock_lots.version+1 returning id into target_lot_id;
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,reason,posted_by,reference_no,balance_after,remarks,idempotency_key) values(source_store,product,target_lot,'transfer_out',-transfer_quantity,'inventory_transfer',trim(transfer_remarks),auth.uid(),ref,available-transfer_quantity,trim(transfer_remarks),'transfer-out-'||ref) returning id into out_id;
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,source_id,reason,posted_by,reference_no,balance_after,remarks,idempotency_key) select destination_store,product,target_lot_id,'transfer_in',transfer_quantity,'inventory_transfer',out_id,trim(transfer_remarks),auth.uid(),ref,l.quantity_on_hand,trim(transfer_remarks),'transfer-in-'||ref from public.stock_lots l where l.id=target_lot_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'inventory.transferred','stock_movement',out_id,trim(transfer_remarks),jsonb_build_object('reference',ref,'destination_store',destination_store,'quantity',transfer_quantity));return out_id;
end$$;

create or replace function public.create_inventory_supplier(target_facility uuid,supplier_code text,supplier_name text,contact_name text,contact_phone text,contact_email text,supplier_address text)
returns uuid language plpgsql security definer set search_path='' as $$declare org uuid;sid uuid;begin if not public.has_privilege('inventory.write',target_facility) then raise exception 'Not authorized';end if;select organization_id into org from public.facilities where id=target_facility;if length(trim(supplier_code))<2 or length(trim(supplier_name))<2 then raise exception 'Supplier code and name are required';end if;insert into public.suppliers(organization_id,code,name,contact_person,phone,email,address,created_by) values(org,upper(trim(supplier_code)),trim(supplier_name),nullif(trim(contact_name),''),nullif(trim(contact_phone),''),nullif(trim(contact_email),''),nullif(trim(supplier_address),''),auth.uid()) returning id into sid;insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'supplier.created','supplier',sid);return sid;end$$;

create or replace function public.update_inventory_supplier(target_facility uuid,target_supplier uuid,supplier_name text,contact_name text,contact_phone text,contact_email text,supplier_address text,expected_version integer,modification_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;old_record jsonb;begin if not public.has_privilege('inventory.write',target_facility) or length(trim(coalesce(modification_reason,'')))<5 then raise exception 'Authorization and modification reason are required';end if;select s.organization_id,to_jsonb(s) into org,old_record from public.suppliers s join public.facilities f on f.organization_id=s.organization_id where s.id=target_supplier and f.id=target_facility for update of s;if org is null then raise exception 'Supplier not found';end if;update public.suppliers set name=trim(supplier_name),contact_person=nullif(trim(contact_name),''),phone=nullif(trim(contact_phone),''),email=nullif(trim(contact_email),''),address=nullif(trim(supplier_address),''),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_supplier and version=expected_version;if not found then raise exception 'Supplier changed. Refresh and try again';end if;insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'supplier.updated','supplier',target_supplier,trim(modification_reason),jsonb_build_object('previous',old_record));end$$;

create or replace function public.set_inventory_supplier_status(target_facility uuid,target_supplier uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;begin if not public.has_privilege('inventory.write',target_facility) or next_status not in('active','inactive') or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Status and reason are required';end if;select s.organization_id into org from public.suppliers s join public.facilities f on f.organization_id=s.organization_id where s.id=target_supplier and f.id=target_facility;if org is null then raise exception 'Supplier not found';end if;update public.suppliers set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_supplier;insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'supplier.status_changed','supplier',target_supplier,trim(change_reason),jsonb_build_object('status',next_status));end$$;

create or replace function public.add_inventory_document(target_movement uuid,file_path text,original_file_name text,document_title text,document_description text,file_type text,file_size bigint)
returns uuid language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;did uuid;begin select s.facility_id,f.organization_id into fac,org from public.stock_movements m join public.stores s on s.id=m.store_id join public.facilities f on f.id=s.facility_id where m.id=target_movement;if fac is null or not public.has_privilege('inventory.write',fac) then raise exception 'Not authorized';end if;insert into public.inventory_documents(movement_id,storage_path,original_name,display_name,description,mime_type,size_bytes,uploaded_by) values(target_movement,file_path,original_file_name,trim(document_title),nullif(trim(document_description),''),file_type,file_size,auth.uid()) returning id into did;insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,fac,auth.uid(),'inventory.document_added','inventory_document',did);return did;end$$;

grant select on public.suppliers,public.stores,public.stock_lots,public.stock_movements,public.inventory_documents to authenticated;
grant execute on function public.post_inventory_stock(uuid,uuid,uuid,uuid,text,date,numeric,numeric,text,text,text) to authenticated;
grant execute on function public.adjust_inventory(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.transfer_inventory(uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.create_inventory_supplier(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.update_inventory_supplier(uuid,uuid,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.set_inventory_supplier_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.add_inventory_document(uuid,text,text,text,text,text,bigint) to authenticated;

commit;
