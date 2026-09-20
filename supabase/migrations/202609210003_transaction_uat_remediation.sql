begin;

-- Restore order workflow RPCs in environments where the original orders migration
-- was skipped or PostgREST retained a stale function signature.
create or replace function public.advance_order(target_order uuid,next_status text)
returns void language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;current_status text;
begin
 select e.facility_id,p.organization_id,o.status into fac,org,current_status
 from public.clinical_orders o join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id
 where o.id=target_order for update of o;
 if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Not authorized to update this order';end if;
 if not((current_status='requested' and next_status='acknowledged')or(current_status='acknowledged' and next_status in('collected','in_progress'))or(current_status='collected' and next_status='in_progress')or(current_status='in_progress' and next_status='completed')or(current_status='completed' and next_status='validated')or(current_status='validated' and next_status='released')) then raise exception 'Invalid order status transition from % to %',current_status,next_status;end if;
 if next_status='validated' and exists(select 1 from public.order_items oi where oi.order_id=target_order and not exists(select 1 from public.clinical_results r where r.order_item_id=oi.id and r.status='final')) then raise exception 'Every order item needs a final result before validation';end if;
 update public.clinical_orders set status=next_status,updated_at=now(),updated_by=auth.uid() where id=target_order;
 if next_status in('collected','in_progress','completed','validated','released') then update public.order_items set status=next_status where order_id=target_order and status<>'cancelled';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'order.status_changed','clinical_order',target_order,jsonb_build_object('from',current_status,'to',next_status));
end$$;

create or replace function public.record_order_result(target_item uuid,result_text text,validate_result boolean,correction_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;order_id uuid;result_id uuid;has_final boolean;
begin
 select e.facility_id,p.organization_id,o.id into fac,org,order_id from public.order_items oi join public.clinical_orders o on o.id=oi.order_id join public.encounters e on e.id=o.encounter_id join public.patients p on p.id=e.patient_id where oi.id=target_item and o.status not in('cancelled','released');
 if fac is null or not public.has_privilege('orders.write',fac) then raise exception 'Not authorized to record this result';end if;
 if length(trim(coalesce(result_text,'')))<2 or length(trim(result_text))>5000 then raise exception 'Result must contain 2 to 5000 characters';end if;
 select exists(select 1 from public.clinical_results where order_item_id=target_item and status='final') into has_final;
 if has_final and(length(trim(coalesce(correction_reason,'')))<5 or length(trim(correction_reason))>500) then raise exception 'Correction reason must contain 5 to 500 characters';end if;
 if has_final then update public.clinical_results set status='corrected',correction_reason=trim(record_order_result.correction_reason) where order_item_id=target_item and status='final';end if;
 insert into public.clinical_results(order_item_id,result_data,result_text,status,entered_by,validated_by,validated_at,correction_reason) values(target_item,jsonb_build_object('text',trim(record_order_result.result_text)),trim(record_order_result.result_text),case when validate_result then 'final' else 'draft' end,auth.uid(),case when validate_result then auth.uid() else null end,case when validate_result then now() else null end,case when has_final then trim(record_order_result.correction_reason) else null end) returning id into result_id;
 update public.order_items set status=case when validate_result then 'completed' else 'in_progress' end where id=target_item;
 update public.clinical_orders set status='in_progress',updated_at=now(),updated_by=auth.uid() where id=order_id and status in('requested','acknowledged','collected');
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'order.result_recorded','clinical_result',result_id,nullif(trim(correction_reason),''),jsonb_build_object('order_id',order_id,'item_id',target_item,'status',case when validate_result then 'final' else 'draft' end));
 return result_id;
end$$;

-- Correct the receipt upsert: the inserted column is quantity_on_hand.
create or replace function public.post_inventory_stock(target_facility uuid,target_store uuid,target_product uuid,target_supplier uuid,lot_number text,expiry date,stock_quantity numeric,cost numeric,source_kind text,external_reference text,entry_remarks text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;lot uuid;movement uuid;ref text;new_balance numeric;
begin
 if not public.has_privilege('inventory.write',target_facility) then raise exception 'Not authorized to post inventory';end if;
 select f.organization_id into org from public.facilities f join public.stores s on s.facility_id=f.id where f.id=target_facility and s.id=target_store and s.status='active';
 if org is null or not exists(select 1 from public.products where id=target_product and organization_id=org and status='active') then raise exception 'Select a valid product and location';end if;
 if source_kind not in('beginning_balance','receipt') or stock_quantity<=0 or cost<0 or length(trim(lot_number))<1 then raise exception 'Valid source, lot, quantity, and cost are required';end if;
 if source_kind='beginning_balance' and exists(select 1 from public.stock_movements m join public.stock_lots l on l.id=m.lot_id where m.store_id=target_store and m.product_id=target_product and l.lot_no=upper(trim(lot_number)) and m.source_type='beginning_balance') then raise exception 'Beginning balance already posted for this medicine, lot, and location';end if;
 insert into public.stock_lots(store_id,product_id,lot_no,expiry_date,quantity_on_hand,unit_cost,supplier_id,received_at) values(target_store,target_product,upper(trim(lot_number)),expiry,stock_quantity,cost,target_supplier,now())
 on conflict(store_id,product_id,lot_no) do update set quantity_on_hand=public.stock_lots.quantity_on_hand+excluded.quantity_on_hand,expiry_date=coalesce(excluded.expiry_date,public.stock_lots.expiry_date),unit_cost=excluded.unit_cost,supplier_id=coalesce(excluded.supplier_id,public.stock_lots.supplier_id),received_at=now(),version=public.stock_lots.version+1 returning id,quantity_on_hand into lot,new_balance;
 ref:=coalesce(nullif(trim(external_reference),''),public.inventory_ref(case when source_kind='beginning_balance' then 'BB' else 'RR' end));
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,reason,posted_by,reference_no,balance_after,unit_cost,supplier_id,remarks,idempotency_key) values(target_store,target_product,lot,'receipt',stock_quantity,source_kind,nullif(trim(entry_remarks),''),auth.uid(),ref,new_balance,cost,target_supplier,nullif(trim(entry_remarks),''),source_kind||'-'||target_store||'-'||target_product||'-'||upper(trim(lot_number))||'-'||ref) returning id into movement;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'inventory.'||source_kind,'stock_movement',movement,nullif(trim(entry_remarks),''),jsonb_build_object('reference',ref,'lot',upper(trim(lot_number))));
 return movement;
end$$;

insert into public.privileges(code,description,risk_level) values('queue.read','View appointments and patient queue','privileged'),('queue.write','Create walk-ins and manage queue status','high_risk') on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;
insert into public.role_privileges(role_id,privilege_code) select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p where o.code='INF' and r.name='Hospital Administrator' and p.code in('queue.read','queue.write') on conflict do nothing;
create sequence if not exists public.queue_no_seq;
drop policy if exists "queue read" on public.queue_entries;
create policy "queue read" on public.queue_entries for select using(exists(select 1 from public.departments d where d.id=queue_entries.department_id and public.has_privilege('queue.read',d.facility_id)));

create or replace function public.create_walk_in(target_facility uuid,target_patient uuid,target_department uuid,visit_reason text,visit_priority text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;appointment uuid;encounter uuid;queue_id uuid;enc_no text;queue_label text;priority_value integer;
begin
 if not public.has_privilege('queue.write',target_facility) then raise exception 'Not authorized to add a walk-in';end if;
 select organization_id into org from public.facilities where id=target_facility and status='active';
 if org is null or not exists(select 1 from public.patients where id=target_patient and organization_id=org) or not exists(select 1 from public.departments where id=target_department and facility_id=target_facility and status='active') then raise exception 'Select a valid patient and clinic';end if;
 if visit_priority not in('routine','urgent','stat') then raise exception 'Select a valid priority';end if;
 priority_value:=case visit_priority when 'stat' then 100 when 'urgent' then 50 else 0 end;
 insert into public.appointments(facility_id,department_id,patient_id,scheduled_at,status,priority,reason,created_by) values(target_facility,target_department,target_patient,now(),'in_queue',visit_priority,nullif(trim(visit_reason),''),auth.uid()) returning id into appointment;
 enc_no:='OPD-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.encounter_no_seq')::text,6,'0');
 insert into public.encounters(facility_id,department_id,patient_id,appointment_id,encounter_no,encounter_type,status,created_by) values(target_facility,target_department,target_patient,appointment,enc_no,'OPD','arrived',auth.uid()) returning id into encounter;
 queue_label:='Q-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.queue_no_seq')::text,4,'0');
 insert into public.queue_entries(encounter_id,department_id,queue_no,status,priority) values(encounter,target_department,queue_label,'waiting',priority_value) returning id into queue_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,target_facility,auth.uid(),'queue.walk_in_created','queue_entry',queue_id,jsonb_build_object('encounter_id',encounter,'appointment_id',appointment,'priority',visit_priority));
 return queue_id;
end$$;

create or replace function public.transition_queue(target_queue uuid,next_status text)
returns void language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;enc uuid;appointment uuid;current_status text;
begin
 select d.facility_id,f.organization_id,q.encounter_id,e.appointment_id,q.status into fac,org,enc,appointment,current_status from public.queue_entries q join public.departments d on d.id=q.department_id join public.facilities f on f.id=d.facility_id join public.encounters e on e.id=q.encounter_id where q.id=target_queue for update of q;
 if fac is null or not public.has_privilege('queue.write',fac) then raise exception 'Not authorized to manage this queue';end if;
 if not((current_status='waiting' and next_status in('called','in_service','cancelled'))or(current_status='called' and next_status in('in_service','waiting','cancelled'))or(current_status='in_service' and next_status in('completed','cancelled'))) then raise exception 'Invalid queue transition from % to %',current_status,next_status;end if;
 update public.queue_entries set status=next_status,called_at=case when next_status='called' then now() else called_at end,service_started_at=case when next_status='in_service' then now() else service_started_at end,completed_at=case when next_status in('completed','cancelled') then now() else completed_at end where id=target_queue;
 update public.encounters set status=case next_status when 'in_service' then 'in_consultation'::public.encounter_status when 'completed' then 'completed'::public.encounter_status when 'cancelled' then 'cancelled'::public.encounter_status else 'arrived'::public.encounter_status end where id=enc;
 if appointment is not null then update public.appointments set status=case next_status when 'in_service' then 'in_service'::public.appointment_status when 'completed' then 'completed'::public.appointment_status when 'cancelled' then 'cancelled'::public.appointment_status else 'in_queue'::public.appointment_status end where id=appointment;end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'queue.status_changed','queue_entry',target_queue,jsonb_build_object('from',current_status,'to',next_status));
end$$;

-- Enforce financial clearance regardless of which application path attempts discharge.
create or replace function public.enforce_discharge_billing_clearance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='discharged' and old.status is distinct from 'discharged' and not exists(select 1 from public.billing_cases c where c.admission_id=new.id and c.status='cleared') then raise exception 'Billing clearance is required before discharge';end if;
 return new;
end$$;
drop trigger if exists require_billing_clearance_before_discharge on public.admissions;
create trigger require_billing_clearance_before_discharge before update of status on public.admissions for each row execute function public.enforce_discharge_billing_clearance();

grant execute on function public.advance_order(uuid,text),public.record_order_result(uuid,text,boolean,text),public.post_inventory_stock(uuid,uuid,uuid,uuid,text,date,numeric,numeric,text,text,text),public.create_walk_in(uuid,uuid,uuid,text,text),public.transition_queue(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
