begin;

create or replace function public.dispense_medication(target_item uuid,target_lot uuid,dispense_quantity numeric,request_key text)
returns uuid language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;pres uuid;product uuid;required numeric;already numeric;available numeric;did uuid;store uuid;new_balance numeric;begin
 select e.facility_id,pa.organization_id,p.id,pi.product_id,pi.quantity into fac,org,pres,product,required from public.prescription_items pi join public.prescriptions p on p.id=pi.prescription_id join public.encounters e on e.id=p.encounter_id join public.patients pa on pa.id=e.patient_id where pi.id=target_item and p.status in('validated','partially_dispensed') for update of p;
 if fac is null or not public.has_privilege('pharmacy.write',fac) or coalesce(dispense_quantity,0)<=0 then raise exception 'Medication cannot be dispensed';end if;
 select sl.quantity_on_hand,sl.store_id into available,store from public.stock_lots sl join public.stores s on s.id=sl.store_id where sl.id=target_lot and sl.product_id=product and s.facility_id=fac and (sl.expiry_date is null or sl.expiry_date>=current_date) for update of sl;
 if available is null or available<dispense_quantity then raise exception 'Selected lot has insufficient available stock';end if;
 select coalesce(sum(quantity),0) into already from public.dispenses where prescription_item_id=target_item and status='posted';
 if already+dispense_quantity>required then raise exception 'Dispensed quantity exceeds the prescribed quantity';end if;
 insert into public.dispenses(prescription_item_id,stock_lot_id,quantity,status,dispensed_by,idempotency_key) values(target_item,target_lot,dispense_quantity,'posted',auth.uid(),nullif(trim(request_key),'')) returning id into did;
 update public.stock_lots set quantity_on_hand=quantity_on_hand-dispense_quantity where id=target_lot returning quantity_on_hand into new_balance;
 insert into public.stock_movements(store_id,product_id,lot_id,movement_type,quantity,source_type,source_id,posted_by,idempotency_key,balance_after) values(store,product,target_lot,'dispense',-dispense_quantity,'prescription',pres,auth.uid(),'movement-'||did::text,new_balance);
 if not exists(select 1 from public.prescription_items pi where pi.prescription_id=pres and pi.quantity>(select coalesce(sum(d.quantity),0) from public.dispenses d where d.prescription_item_id=pi.id and d.status='posted')) then update public.prescriptions set status='dispensed',version=version+1,updated_by=auth.uid(),updated_at=now() where id=pres;else update public.prescriptions set status='partially_dispensed',version=version+1,updated_by=auth.uid(),updated_at=now() where id=pres;end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'medication.dispensed','dispense',did,jsonb_build_object('prescription_id',pres,'quantity',dispense_quantity,'lot_id',target_lot));return did;
end$$;

with running as (
 select id,sum(quantity) over(partition by lot_id order by posted_at,id rows between unbounded preceding and current row) as calculated_balance
 from public.stock_movements where lot_id is not null
)
update public.stock_movements movement set balance_after=running.calculated_balance
from running where running.id=movement.id and movement.balance_after is null;

commit;
