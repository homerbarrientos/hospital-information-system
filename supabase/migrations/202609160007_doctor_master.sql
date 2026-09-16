begin;

insert into public.privileges(code, description, risk_level) values
  ('doctors.read', 'View the doctor master list', 'privileged'),
  ('doctors.write', 'Create and maintain doctor records', 'high_risk')
on conflict(code) do update set description=excluded.description, risk_level=excluded.risk_level;

insert into public.role_privileges(role_id, privilege_code)
select r.id, p.code from public.roles r
join public.organizations o on o.id=r.organization_id
cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in ('doctors.read','doctors.write')
on conflict do nothing;

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  license_number text not null,
  specialty text not null,
  phone text,
  email text,
  status text not null default 'active' check(status in ('active','inactive')),
  version integer not null default 1,
  created_by uuid not null references public.profiles,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  updated_at timestamptz,
  unique(organization_id, license_number)
);

create table if not exists public.doctor_facility_assignments (
  doctor_id uuid not null references public.doctors on delete restrict,
  facility_id uuid not null references public.facilities on delete restrict,
  department_id uuid references public.departments on delete set null,
  active boolean not null default true,
  assigned_by uuid not null references public.profiles,
  assigned_at timestamptz not null default now(),
  primary key(doctor_id, facility_id)
);

alter table public.encounters add column if not exists responsible_doctor_id uuid references public.doctors;
alter table public.admissions
  add column if not exists admitting_doctor_id uuid references public.doctors,
  add column if not exists attending_doctor_id uuid references public.doctors;
alter table public.clinical_orders add column if not exists ordering_doctor_id uuid references public.doctors;
alter table public.discharge_summaries add column if not exists discharging_doctor_id uuid references public.doctors;

alter table public.doctors enable row level security;
alter table public.doctor_facility_assignments enable row level security;

create policy "doctor master read" on public.doctors for select using (
  exists(select 1 from public.doctor_facility_assignments a where a.doctor_id=doctors.id and public.has_privilege('doctors.read',a.facility_id))
);
create policy "doctor assignments read" on public.doctor_facility_assignments for select using (
  public.has_privilege('doctors.read',facility_id)
);

create or replace function public.active_facility_doctor(target_doctor uuid, target_facility uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.doctors d join public.doctor_facility_assignments a on a.doctor_id=d.id
    where d.id=target_doctor and d.status='active' and a.facility_id=target_facility and a.active
  )
$$;

create or replace function public.create_doctor(
  target_facility uuid, first_name text, middle_name text, last_name text, suffix text,
  license_number text, specialty text, phone text, email text, target_department uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare doc uuid; org uuid;
begin
  if not public.has_privilege('doctors.write',target_facility) then raise exception 'Not authorized to maintain doctors'; end if;
  select organization_id into org from public.facilities where id=target_facility;
  if org is null then raise exception 'Facility not found'; end if;
  if length(trim(first_name))<2 or length(trim(last_name))<2 then raise exception 'Doctor first and last name are required'; end if;
  if length(trim(license_number))<3 then raise exception 'A valid license number is required'; end if;
  if length(trim(specialty))<2 then raise exception 'Specialty is required'; end if;
  if target_department is not null and not exists(select 1 from public.departments where id=target_department and facility_id=target_facility) then raise exception 'Department is outside this facility'; end if;
  insert into public.doctors(organization_id,first_name,middle_name,last_name,suffix,license_number,specialty,phone,email,created_by)
  values(org,trim(first_name),nullif(trim(middle_name),''),trim(last_name),nullif(trim(suffix),''),trim(license_number),trim(specialty),nullif(trim(phone),''),nullif(trim(email),''),auth.uid()) returning id into doc;
  insert into public.doctor_facility_assignments(doctor_id,facility_id,department_id,assigned_by) values(doc,target_facility,target_department,auth.uid());
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
  values(org,target_facility,auth.uid(),'doctor.created','doctor',doc,jsonb_build_object('license_number',trim(license_number),'specialty',trim(specialty)));
  return doc;
end$$;

create or replace function public.update_doctor(
  target_doctor uuid, target_facility uuid, first_name text, middle_name text, last_name text, suffix text,
  license_number text, specialty text, phone text, email text, target_department uuid, expected_version integer, modification_reason text
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; old_record jsonb;
begin
  if not public.has_privilege('doctors.write',target_facility) then raise exception 'Not authorized to maintain doctors'; end if;
  select d.organization_id,to_jsonb(d) into org,old_record from public.doctors d join public.doctor_facility_assignments a on a.doctor_id=d.id where d.id=target_doctor and a.facility_id=target_facility for update of d;
  if org is null then raise exception 'Doctor is not assigned to this facility'; end if;
  if length(trim(modification_reason))<5 then raise exception 'Modification reason must contain at least 5 characters'; end if;
  update public.doctors set first_name=trim(update_doctor.first_name),middle_name=nullif(trim(update_doctor.middle_name),''),last_name=trim(update_doctor.last_name),suffix=nullif(trim(update_doctor.suffix),''),license_number=trim(update_doctor.license_number),specialty=trim(update_doctor.specialty),phone=nullif(trim(update_doctor.phone),''),email=nullif(trim(update_doctor.email),''),version=version+1,updated_by=auth.uid(),updated_at=now()
  where id=target_doctor and version=expected_version;
  if not found then raise exception 'Doctor record changed. Refresh and try again'; end if;
  update public.doctor_facility_assignments set department_id=target_department where doctor_id=target_doctor and facility_id=target_facility;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,target_facility,auth.uid(),'doctor.updated','doctor',target_doctor,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

create or replace function public.set_doctor_status(target_doctor uuid,target_facility uuid,next_status text,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  if not public.has_privilege('doctors.write',target_facility) then raise exception 'Not authorized to maintain doctors'; end if;
  if next_status not in ('active','inactive') then raise exception 'Invalid doctor status'; end if;
  if length(trim(change_reason))<5 then raise exception 'Status reason must contain at least 5 characters'; end if;
  select d.organization_id into org from public.doctors d join public.doctor_facility_assignments a on a.doctor_id=d.id where d.id=target_doctor and a.facility_id=target_facility;
  if org is null then raise exception 'Doctor is not assigned to this facility'; end if;
  update public.doctors set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_doctor;
  update public.doctor_facility_assignments set active=(next_status='active') where doctor_id=target_doctor and facility_id=target_facility;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,target_facility,auth.uid(),'doctor.status_changed','doctor',target_doctor,trim(change_reason),jsonb_build_object('status',next_status));
end$$;

create or replace function public.create_consultation_with_doctor(target_facility uuid,target_patient uuid,target_doctor uuid,chief_complaint text,soap_note text,diagnosis text,allergy_substance text,allergy_reaction text,systolic numeric,diastolic numeric,temperature numeric,spo2 numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare enc uuid;
begin
  if not public.active_facility_doctor(target_doctor,target_facility) then raise exception 'Select an active doctor assigned to this facility'; end if;
  enc:=public.create_consultation(target_facility,target_patient,chief_complaint,soap_note,diagnosis,allergy_substance,allergy_reaction,systolic,diastolic,temperature,spo2);
  update public.encounters set responsible_doctor_id=target_doctor where id=enc;
  return enc;
end$$;

create or replace function public.admit_patient_with_doctor(target_facility uuid,target_patient uuid,target_bed uuid,target_doctor uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare adm uuid; enc uuid;
begin
  if not public.active_facility_doctor(target_doctor,target_facility) then raise exception 'Select an active doctor assigned to this facility'; end if;
  adm:=public.admit_patient(target_facility,target_patient,target_bed);
  update public.admissions set admitting_doctor_id=target_doctor,attending_doctor_id=target_doctor where id=adm returning encounter_id into enc;
  update public.encounters set responsible_doctor_id=target_doctor where id=enc;
  return adm;
end$$;

create or replace function public.create_order_with_doctor(target_encounter uuid,target_doctor uuid,order_type text,order_priority text,order_instructions text,order_items_json jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid; order_id uuid;
begin
  select facility_id into fac from public.encounters where id=target_encounter;
  if not public.active_facility_doctor(target_doctor,fac) then raise exception 'Select an active ordering doctor assigned to this facility'; end if;
  order_id:=public.create_order(target_encounter,order_type,order_priority,order_instructions,order_items_json);
  update public.clinical_orders set ordering_doctor_id=target_doctor where id=order_id;
  return order_id;
end$$;

create or replace function public.complete_discharge_with_doctor(
  target_admission uuid, target_doctor uuid, discharge_disposition text, final_diagnosis text,
  condition_at_discharge text, discharge_instructions text, follow_up_plan text,
  discharge_medications text, attachment_path text, attachment_name text, attachment_type text, attachment_size bigint
) returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid; summary_id uuid;
begin
  select e.facility_id into fac from public.admissions a join public.encounters e on e.id=a.encounter_id where a.id=target_admission;
  if not public.active_facility_doctor(target_doctor,fac) then raise exception 'Select an active discharging doctor assigned to this facility'; end if;
  summary_id:=public.complete_discharge(target_admission,discharge_disposition,final_diagnosis,condition_at_discharge,discharge_instructions,follow_up_plan,discharge_medications,attachment_path,attachment_name,attachment_type,attachment_size);
  update public.discharge_summaries set discharging_doctor_id=target_doctor where id=summary_id;
  return summary_id;
end$$;

grant select on public.doctors,public.doctor_facility_assignments to authenticated;
grant execute on function public.active_facility_doctor(uuid,uuid) to authenticated;
grant execute on function public.create_doctor(uuid,text,text,text,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.update_doctor(uuid,uuid,text,text,text,text,text,text,text,text,uuid,integer,text) to authenticated;
grant execute on function public.set_doctor_status(uuid,uuid,text,text) to authenticated;
grant execute on function public.create_consultation_with_doctor(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.admit_patient_with_doctor(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.create_order_with_doctor(uuid,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.complete_discharge_with_doctor(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint) to authenticated;

commit;
