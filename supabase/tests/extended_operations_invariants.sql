-- Read-only checks after applying 202609250001 and completing manual UAT.
-- Every query should return zero rows.

select c.id from public.care_cases c join public.encounters e on e.id=c.encounter_id
where c.facility_id<>e.facility_id;

select d.id from public.diet_orders d join public.encounters e on e.id=d.encounter_id
where d.facility_id<>e.facility_id;

select c.id from public.phic_claims c join public.encounters e on e.id=c.encounter_id
where c.facility_id<>e.facility_id or c.patient_id<>e.patient_id;

select m.id from public.material_items m where m.quantity_on_hand<0;

select i.id,i.quantity_on_hand,coalesce(sum(case when m.kind='receipt' then m.quantity else -m.quantity end),0) as movement_balance
from public.material_items i left join public.material_movements m on m.item_id=i.id
group by i.id having i.quantity_on_hand<>coalesce(sum(case when m.kind='receipt' then m.quantity else -m.quantity end),0);

select o.id from public.purchase_orders o where o.quantity_received>o.quantity
or (o.status='received' and o.quantity_received<>o.quantity);

select c.id from public.phic_claims c where c.status in('submitted_external','approved','paid')
and nullif(trim(c.external_claim_no),'') is null;
