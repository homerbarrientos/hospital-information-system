begin;

-- OR and DR rooms are procedure spaces, separate from ward accommodation rooms.
create table public.procedure_rooms (
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities(id),
 room_kind text not null check(room_kind in ('OR','DR')),
 code text not null check(length(trim(code))>=2),
 name text not null check(length(trim(name))>=2),
 status public.record_status not null default 'active',
 version integer not null default 1,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 updated_at timestamptz,
 unique(facility_id,room_kind,code)
);

alter table public.procedure_rooms enable row level security;
create policy procedure_room_read on public.procedure_rooms for select to authenticated
 using(public.has_privilege('theatre.read',facility_id) or public.has_privilege('theatre.write',facility_id));
grant select on public.procedure_rooms to authenticated;

-- Preserve the history of existing free-text cases. New cases require a room ID.
alter table public.care_cases add column procedure_room_id uuid references public.procedure_rooms(id);

create or replace function public.save_procedure_room(target_facility uuid,target_room uuid,target_kind text,room_code text,room_label text,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;room_id uuid;
begin
 select organization_id into org from public.facilities where id=target_facility;
 if org is null or not public.has_privilege('theatre.write',target_facility) then raise exception 'Not authorized to manage procedure rooms';end if;
 if target_kind not in ('OR','DR') or length(trim(coalesce(room_code,'')))<2 or length(trim(coalesce(room_label,'')))<2 then raise exception 'Room type, code, and name are required';end if;
 if target_room is null then
  insert into public.procedure_rooms(facility_id,room_kind,code,name,created_by)
  values(target_facility,target_kind,upper(trim(room_code)),trim(room_label),auth.uid()) returning id into room_id;
 else
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'Enter a reason for changing the room';end if;
  update public.procedure_rooms set name=trim(room_label),version=version+1,updated_by=auth.uid(),updated_at=now()
  where id=target_room and facility_id=target_facility and room_kind=target_kind
   and code=upper(trim(room_code)) and version=expected_version returning id into room_id;
  if room_id is null then raise exception 'Room changed or no longer exists. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason)
 values(org,target_facility,auth.uid(),case when target_room is null then 'procedure_room.created' else 'procedure_room.updated' end,'procedure_room',room_id,nullif(trim(change_reason),''));
 return room_id;
end$$;

create or replace function public.set_procedure_room_status(target_facility uuid,target_room uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare room public.procedure_rooms%rowtype;org uuid;
begin
 if not public.has_privilege('theatre.write',target_facility) or next_status not in ('active','inactive') or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorized room, status, and reason are required';end if;
 select * into room from public.procedure_rooms where id=target_room and facility_id=target_facility for update;
 if room.id is null then raise exception 'Room not found';end if;
 if room.status=next_status then raise exception 'Room already has this status';end if;
 if next_status='inactive' and exists(select 1 from public.care_cases c where c.facility_id=target_facility and c.case_type=room.room_kind and c.status in ('scheduled','in_progress') and (c.procedure_room_id=target_room or (c.procedure_room_id is null and upper(trim(c.room_name))=room.code))) then raise exception 'Complete or cancel active cases before deactivating this room';end if;
 update public.procedure_rooms set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_room;
 select organization_id into org from public.facilities where id=target_facility;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason)
 values(org,target_facility,auth.uid(),'procedure_room.status_changed','procedure_room',target_room,trim(change_reason));
end$$;

create or replace function public.create_care_case(target_facility uuid,target_encounter uuid,kind text,procedure_name text,room_name text,scheduled_at timestamptz,lead_doctor uuid,notes text,target_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;new_id uuid;room public.procedure_rooms%rowtype;
begin
 select organization_id into org from public.facilities where id=target_facility;
 if not public.has_privilege('theatre.write',target_facility) or org is null then raise exception 'Not authorized';end if;
 if kind not in ('OR','DR') then raise exception 'Choose OR or DR';end if;
 if not exists(select 1 from public.encounters where id=target_encounter and facility_id=target_facility and status not in('completed','cancelled')) then raise exception 'Choose an active encounter at this facility';end if;
 select * into room from public.procedure_rooms where facility_id=target_facility and room_kind=kind and code=upper(trim(room_name)) and status='active';
 if room.id is null then raise exception 'Choose an active room from the OR/DR room master';end if;
 if lead_doctor is not null and not exists(select 1 from public.doctor_facility_assignments where facility_id=target_facility and doctor_id=lead_doctor and active) then raise exception 'Choose an assigned doctor';end if;
 if target_service is not null and not exists(select 1 from public.service_catalog where id=target_service and organization_id=org and status='active' and billable) then raise exception 'Choose a billable service in this organization';end if;
 insert into public.care_cases(facility_id,encounter_id,case_type,procedure_name,room_name,procedure_room_id,scheduled_at,lead_doctor_id,clinical_note,billing_service_id,created_by)
 values(target_facility,target_encounter,kind,trim(procedure_name),room.code,room.id,scheduled_at,lead_doctor,nullif(trim(notes),''),target_service,auth.uid()) returning id into new_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id) values(org,target_facility,auth.uid(),'care_case.created','care_case',new_id);
 return new_id;
end$$;

revoke all on function public.save_procedure_room(uuid,uuid,text,text,text,integer,text),public.set_procedure_room_status(uuid,uuid,public.record_status,text) from public;
grant execute on function public.save_procedure_room(uuid,uuid,text,text,text,integer,text),public.set_procedure_room_status(uuid,uuid,public.record_status,text) to authenticated;

commit;
