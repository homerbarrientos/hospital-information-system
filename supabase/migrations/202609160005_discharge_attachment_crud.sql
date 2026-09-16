begin;

alter table public.discharge_documents
  add column if not exists display_name text,
  add column if not exists description text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles,
  add column if not exists removal_reason text;

update public.discharge_documents
set display_name = original_name
where display_name is null;

alter table public.discharge_documents
  alter column display_name set not null;

create or replace function public.add_discharge_document(
  target_admission uuid,
  file_path text,
  original_file_name text,
  document_title text,
  document_description text,
  file_type text,
  file_size bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  org uuid;
  summary_id uuid;
  document_id uuid;
begin
  select e.facility_id, p.organization_id, ds.id
    into fac, org, summary_id
  from public.admissions a
  join public.encounters e on e.id = a.encounter_id
  join public.patients p on p.id = e.patient_id
  join public.discharge_summaries ds on ds.admission_id = a.id
  where a.id = target_admission and a.status = 'discharged';

  if fac is null or not public.has_privilege('adt.write', fac) then
    raise exception 'Not authorized to add discharge documents';
  end if;
  if nullif(trim(document_title), '') is null or length(trim(document_title)) > 120 then
    raise exception 'Document title is required and cannot exceed 120 characters';
  end if;
  if length(coalesce(document_description, '')) > 1000 then
    raise exception 'Description cannot exceed 1000 characters';
  end if;
  if file_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or file_size < 1 or file_size > 3145728 then
    raise exception 'Attachment must be a PDF, JPG, or PNG file no larger than 3 MB';
  end if;
  if file_path not like fac::text || '/' || target_admission::text || '/%' then
    raise exception 'Attachment path is invalid';
  end if;

  insert into public.discharge_documents (
    discharge_summary_id, admission_id, storage_path, original_name,
    display_name, description, mime_type, size_bytes, uploaded_by
  ) values (
    summary_id, target_admission, file_path, original_file_name,
    trim(document_title), nullif(trim(document_description), ''),
    file_type, file_size, auth.uid()
  ) returning id into document_id;

  insert into public.audit_events (
    organization_id, facility_id, actor_id, event_type,
    object_type, object_id, details
  ) values (
    org, fac, auth.uid(), 'discharge_document.added',
    'discharge_document', document_id,
    jsonb_build_object('admission_id', target_admission, 'title', trim(document_title))
  );
  return document_id;
end;
$$;

create or replace function public.update_discharge_document(
  target_document uuid,
  document_title text,
  document_description text,
  modification_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  org uuid;
  old_title text;
  old_description text;
begin
  select e.facility_id, p.organization_id, d.display_name, d.description
    into fac, org, old_title, old_description
  from public.discharge_documents d
  join public.admissions a on a.id = d.admission_id
  join public.encounters e on e.id = a.encounter_id
  join public.patients p on p.id = e.patient_id
  where d.id = target_document and d.removed_at is null
  for update of d;

  if fac is null or not public.has_privilege('adt.write', fac) then
    raise exception 'Not authorized to modify this discharge document';
  end if;
  if nullif(trim(document_title), '') is null or length(trim(document_title)) > 120 then
    raise exception 'Document title is required and cannot exceed 120 characters';
  end if;
  if length(coalesce(document_description, '')) > 1000 then
    raise exception 'Description cannot exceed 1000 characters';
  end if;
  if length(trim(coalesce(modification_reason, ''))) < 5
    or length(trim(modification_reason)) > 500 then
    raise exception 'Modification reason must contain 5 to 500 characters';
  end if;

  update public.discharge_documents
  set display_name = trim(document_title),
      description = nullif(trim(document_description), ''),
      version = version + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_document;

  insert into public.audit_events (
    organization_id, facility_id, actor_id, event_type,
    object_type, object_id, reason, details
  ) values (
    org, fac, auth.uid(), 'discharge_document.updated',
    'discharge_document', target_document, trim(modification_reason),
    jsonb_build_object(
      'old_title', old_title, 'new_title', trim(document_title),
      'old_description', old_description,
      'new_description', nullif(trim(document_description), '')
    )
  );
end;
$$;

create or replace function public.remove_discharge_document(
  target_document uuid,
  removal_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  org uuid;
  admission uuid;
  title text;
begin
  select e.facility_id, p.organization_id, d.admission_id, d.display_name
    into fac, org, admission, title
  from public.discharge_documents d
  join public.admissions a on a.id = d.admission_id
  join public.encounters e on e.id = a.encounter_id
  join public.patients p on p.id = e.patient_id
  where d.id = target_document and d.removed_at is null
  for update of d;

  if fac is null or not public.has_privilege('adt.write', fac) then
    raise exception 'Not authorized to remove this discharge document';
  end if;
  if length(trim(coalesce(removal_reason, ''))) < 5
    or length(trim(removal_reason)) > 500 then
    raise exception 'Removal reason must contain 5 to 500 characters';
  end if;

  update public.discharge_documents
  set removed_at = now(),
      removed_by = auth.uid(),
      removal_reason = trim(remove_discharge_document.removal_reason),
      version = version + 1
  where id = target_document;

  insert into public.audit_events (
    organization_id, facility_id, actor_id, event_type,
    object_type, object_id, reason, details
  ) values (
    org, fac, auth.uid(), 'discharge_document.removed',
    'discharge_document', target_document, trim(removal_reason),
    jsonb_build_object('admission_id', admission, 'title', title)
  );
end;
$$;

grant execute on function public.add_discharge_document(
  uuid, text, text, text, text, text, bigint
) to authenticated;
grant execute on function public.update_discharge_document(
  uuid, text, text, text
) to authenticated;
grant execute on function public.remove_discharge_document(
  uuid, text
) to authenticated;

commit;
