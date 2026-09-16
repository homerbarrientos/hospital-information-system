begin;

alter table public.allergies
  add column if not exists severity text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references public.profiles,
  add column if not exists updated_at timestamptz;

create or replace function public.validate_clinical_vitals(systolic numeric, diastolic numeric, temperature numeric, spo2 numeric)
returns void language plpgsql immutable set search_path='' as $$
begin
  if (systolic is null) <> (diastolic is null) then raise exception 'Enter both systolic and diastolic blood pressure'; end if;
  if systolic is not null and (systolic < 40 or systolic > 300) then raise exception 'Systolic blood pressure must be between 40 and 300 mmHg'; end if;
  if diastolic is not null and (diastolic < 20 or diastolic > 200) then raise exception 'Diastolic blood pressure must be between 20 and 200 mmHg'; end if;
  if systolic is not null and systolic <= diastolic then raise exception 'Systolic blood pressure must be higher than diastolic blood pressure'; end if;
  if temperature is not null and (temperature < 25 or temperature > 45) then raise exception 'Temperature must be between 25 and 45 °C'; end if;
  if spo2 is not null and (spo2 < 40 or spo2 > 100) then raise exception 'SpO2 must be between 40 and 100 percent'; end if;
end$$;

create or replace function public.update_patient_allergy(target_allergy uuid, new_substance text, new_reaction text, new_severity text, expected_version integer, modification_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare fac uuid; org uuid; old_record jsonb;
begin
  select f.id,p.organization_id,to_jsonb(a) into fac,org,old_record from public.allergies a join public.patients p on p.id=a.patient_id join public.facilities f on f.organization_id=p.organization_id where a.id=target_allergy and public.has_privilege('clinical.write',f.id) limit 1;
  if fac is null then raise exception 'Not authorized to update this allergy'; end if;
  if length(trim(new_substance)) < 2 then raise exception 'Allergen must contain at least 2 characters'; end if;
  if length(trim(modification_reason)) < 5 then raise exception 'Modification reason must contain at least 5 characters'; end if;
  update public.allergies set substance=trim(new_substance),reaction=nullif(trim(new_reaction),''),severity=nullif(trim(new_severity),''),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_allergy and version=expected_version;
  if not found then raise exception 'Allergy record changed. Refresh and try again'; end if;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'allergy.updated','allergy',target_allergy,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

create or replace function public.set_patient_allergy_status(target_allergy uuid, next_status text, status_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare fac uuid; org uuid; previous_status text;
begin
  if next_status not in ('active','inactive') then raise exception 'Invalid allergy status'; end if;
  if length(trim(status_reason)) < 5 then raise exception 'Status reason must contain at least 5 characters'; end if;
  select f.id,p.organization_id,a.status into fac,org,previous_status from public.allergies a join public.patients p on p.id=a.patient_id join public.facilities f on f.organization_id=p.organization_id where a.id=target_allergy and public.has_privilege('clinical.write',f.id) limit 1;
  if fac is null then raise exception 'Not authorized to update this allergy'; end if;
  update public.allergies set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_allergy;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),'allergy.status_changed','allergy',target_allergy,trim(status_reason),jsonb_build_object('previous_status',previous_status,'status',next_status));
end$$;

create or replace function public.create_consultation_with_doctor(target_facility uuid,target_patient uuid,target_doctor uuid,chief_complaint text,soap_note text,diagnosis text,allergy_substance text,allergy_reaction text,systolic numeric,diastolic numeric,temperature numeric,spo2 numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare enc uuid;
begin
  perform public.validate_clinical_vitals(systolic,diastolic,temperature,spo2);
  if not public.active_facility_doctor(target_doctor,target_facility) then raise exception 'Select an active doctor assigned to this facility'; end if;
  enc:=public.create_consultation(target_facility,target_patient,chief_complaint,soap_note,diagnosis,allergy_substance,allergy_reaction,systolic,diastolic,temperature,spo2);
  update public.encounters set responsible_doctor_id=target_doctor where id=enc;
  return enc;
end$$;

grant execute on function public.validate_clinical_vitals(numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.update_patient_allergy(uuid,text,text,text,integer,text) to authenticated;
grant execute on function public.set_patient_allergy_status(uuid,text,text) to authenticated;

commit;
