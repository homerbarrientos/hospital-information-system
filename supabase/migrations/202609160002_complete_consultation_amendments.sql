begin;

create or replace function public.amend_consultation_details(
  target_encounter uuid,
  new_chief_complaint text,
  new_soap_note text,
  new_diagnosis text,
  new_allergies jsonb,
  systolic numeric,
  diastolic numeric,
  temperature numeric,
  spo2 numeric,
  amendment_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  org uuid;
  patient uuid;
  note uuid;
  next_version integer;
  enc_status public.encounter_status;
  allergy_item jsonb;
begin
  select e.facility_id, p.organization_id, e.patient_id, e.status
    into fac, org, patient, enc_status
  from public.encounters e
  join public.patients p on p.id = e.patient_id
  where e.id = target_encounter and e.encounter_type = 'OPD';

  if fac is null or not public.has_privilege('clinical.write', fac) then
    raise exception 'Not authorized';
  end if;
  if enc_status = 'cancelled' then
    raise exception 'Cancelled encounters are read-only';
  end if;
  if nullif(trim(amendment_reason), '') is null then
    raise exception 'Modification reason is required';
  end if;
  if jsonb_typeof(coalesce(new_allergies, '[]'::jsonb)) <> 'array' then
    raise exception 'Allergies must be a list';
  end if;
  if systolic is not null and (systolic < 40 or systolic > 300) then
    raise exception 'Systolic blood pressure must be between 40 and 300';
  end if;
  if diastolic is not null and (diastolic < 20 or diastolic > 200) then
    raise exception 'Diastolic blood pressure must be between 20 and 200';
  end if;
  if temperature is not null and (temperature < 25 or temperature > 45) then
    raise exception 'Temperature must be between 25 and 45 °C';
  end if;
  if spo2 is not null and (spo2 < 40 or spo2 > 100) then
    raise exception 'SpO2 must be between 40 and 100 percent';
  end if;

  select id, current_version
    into note, next_version
  from public.clinical_notes
  where encounter_id = target_encounter and note_type = 'consultation'
  order by created_at desc
  limit 1
  for update;

  if note is null then
    raise exception 'Consultation note not found';
  end if;

  next_version := coalesce(next_version, 0) + 1;
  insert into public.clinical_note_versions(
    note_id, version, content, amendment_reason, author_id
  ) values (
    note,
    next_version,
    jsonb_build_object(
      'chief_complaint', trim(new_chief_complaint),
      'soap_note', trim(new_soap_note)
    ),
    trim(amendment_reason),
    auth.uid()
  );
  update public.clinical_notes set current_version = next_version where id = note;

  delete from public.diagnoses
  where encounter_id = target_encounter and diagnosis_type = 'working';
  if nullif(trim(new_diagnosis), '') is not null then
    insert into public.diagnoses(encounter_id, description, diagnosis_type, recorded_by)
    values(target_encounter, trim(new_diagnosis), 'working', auth.uid());
  end if;

  update public.allergies
  set status = 'inactive'
  where patient_id = patient and status = 'active';
  for allergy_item in
    select value from jsonb_array_elements(coalesce(new_allergies, '[]'::jsonb))
  loop
    if nullif(trim(allergy_item ->> 'substance'), '') is not null then
      insert into public.allergies(patient_id, substance, reaction, recorded_by)
      values(
        patient,
        trim(allergy_item ->> 'substance'),
        nullif(trim(allergy_item ->> 'reaction'), ''),
        auth.uid()
      );
    end if;
  end loop;

  if systolic is not null then
    insert into public.vital_observations(encounter_id, code, value, unit, observed_by)
    values(target_encounter, 'BP-SYS', systolic, 'mmHg', auth.uid());
  end if;
  if diastolic is not null then
    insert into public.vital_observations(encounter_id, code, value, unit, observed_by)
    values(target_encounter, 'BP-DIA', diastolic, 'mmHg', auth.uid());
  end if;
  if temperature is not null then
    insert into public.vital_observations(encounter_id, code, value, unit, observed_by)
    values(target_encounter, 'TEMP', temperature, 'Cel', auth.uid());
  end if;
  if spo2 is not null then
    insert into public.vital_observations(encounter_id, code, value, unit, observed_by)
    values(target_encounter, 'SPO2', spo2, '%', auth.uid());
  end if;

  insert into public.audit_events(
    organization_id,
    facility_id,
    actor_id,
    event_type,
    object_type,
    object_id,
    reason,
    details
  ) values (
    org,
    fac,
    auth.uid(),
    'consultation.amended',
    'encounter',
    target_encounter,
    trim(amendment_reason),
    jsonb_build_object(
      'version', next_version,
      'allergy_count', jsonb_array_length(coalesce(new_allergies, '[]'::jsonb)),
      'vitals_updated', jsonb_build_object(
        'BP-SYS', systolic,
        'BP-DIA', diastolic,
        'TEMP', temperature,
        'SPO2', spo2
      )
    )
  );
end;
$$;

grant execute on function public.amend_consultation_details(
  uuid, text, text, text, jsonb, numeric, numeric, numeric, numeric, text
) to authenticated;

commit;
