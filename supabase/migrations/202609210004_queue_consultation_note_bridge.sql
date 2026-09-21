begin;

create or replace function public.transition_queue(target_queue uuid,next_status text)
returns void language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;enc uuid;appointment uuid;current_status text;note uuid;
begin
 select d.facility_id,f.organization_id,q.encounter_id,e.appointment_id,q.status into fac,org,enc,appointment,current_status from public.queue_entries q join public.departments d on d.id=q.department_id join public.facilities f on f.id=d.facility_id join public.encounters e on e.id=q.encounter_id where q.id=target_queue for update of q;
 if fac is null or not public.has_privilege('queue.write',fac) then raise exception 'Not authorized to manage this queue';end if;
 if not((current_status='waiting' and next_status in('called','in_service','cancelled'))or(current_status='called' and next_status in('in_service','waiting','cancelled'))or(current_status='in_service' and next_status in('completed','cancelled'))) then raise exception 'Invalid queue transition from % to %',current_status,next_status;end if;
 update public.queue_entries set status=next_status,called_at=case when next_status='called' then now() else called_at end,service_started_at=case when next_status='in_service' then now() else service_started_at end,completed_at=case when next_status in('completed','cancelled') then now() else completed_at end where id=target_queue;
 update public.encounters set status=case next_status when 'in_service' then 'in_consultation'::public.encounter_status when 'completed' then 'completed'::public.encounter_status when 'cancelled' then 'cancelled'::public.encounter_status else 'arrived'::public.encounter_status end where id=enc;
 if appointment is not null then update public.appointments set status=case next_status when 'in_service' then 'in_service'::public.appointment_status when 'completed' then 'completed'::public.appointment_status when 'cancelled' then 'cancelled'::public.appointment_status else 'in_queue'::public.appointment_status end where id=appointment;end if;

 if next_status='in_service' and not exists(select 1 from public.clinical_notes where encounter_id=enc and note_type='consultation') then
  insert into public.clinical_notes(encounter_id,note_type,status,created_by) values(enc,'consultation','draft',auth.uid()) returning id into note;
  insert into public.clinical_note_versions(note_id,version,content,author_id) values(note,1,jsonb_build_object('chief_complaint','','soap_note',''),auth.uid());
 end if;

 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details) values(org,fac,auth.uid(),'queue.status_changed','queue_entry',target_queue,jsonb_build_object('from',current_status,'to',next_status));
end$$;

insert into public.clinical_notes(encounter_id,note_type,status,created_by)
select e.id,'consultation','draft',e.created_by
from public.encounters e
where e.encounter_type='OPD'
  and e.status='in_consultation'
  and exists(select 1 from public.queue_entries q where q.encounter_id=e.id)
  and not exists(select 1 from public.clinical_notes n where n.encounter_id=e.id and n.note_type='consultation');

insert into public.clinical_note_versions(note_id,version,content,author_id)
select n.id,1,jsonb_build_object('chief_complaint','','soap_note',''),n.created_by
from public.clinical_notes n
where n.note_type='consultation'
  and not exists(select 1 from public.clinical_note_versions v where v.note_id=n.id);

grant execute on function public.transition_queue(uuid,text) to authenticated;

commit;
