begin;

create table if not exists public.discharge_summaries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null unique references public.admissions,
  final_diagnosis text not null,
  condition_at_discharge text not null,
  instructions text not null,
  follow_up_plan text,
  discharge_medications text,
  completed_by uuid not null references public.profiles,
  completed_at timestamptz not null default now()
);

create table if not exists public.discharge_documents (
  id uuid primary key default gen_random_uuid(),
  discharge_summary_id uuid not null references public.discharge_summaries on delete restrict,
  admission_id uuid not null references public.admissions,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 3145728),
  uploaded_by uuid not null references public.profiles,
  uploaded_at timestamptz not null default now()
);

alter table public.discharge_summaries enable row level security;
alter table public.discharge_documents enable row level security;

drop policy if exists "adt discharge summary read" on public.discharge_summaries;
create policy "adt discharge summary read" on public.discharge_summaries
for select using (
  exists (
    select 1 from public.admissions a
    join public.encounters e on e.id = a.encounter_id
    where a.id = discharge_summaries.admission_id
      and public.has_privilege('adt.read', e.facility_id)
  )
);

drop policy if exists "adt discharge document read" on public.discharge_documents;
create policy "adt discharge document read" on public.discharge_documents
for select using (
  exists (
    select 1 from public.admissions a
    join public.encounters e on e.id = a.encounter_id
    where a.id = discharge_documents.admission_id
      and public.has_privilege('adt.read', e.facility_id)
  )
);

drop policy if exists "clinical order read" on public.clinical_orders;
create policy "clinical order read" on public.clinical_orders for select using (
  exists (select 1 from public.encounters e where e.id = clinical_orders.encounter_id and public.has_privilege('clinical.read', e.facility_id))
);
drop policy if exists "clinical order item read" on public.order_items;
create policy "clinical order item read" on public.order_items for select using (
  exists (select 1 from public.clinical_orders o join public.encounters e on e.id = o.encounter_id where o.id = order_items.order_id and public.has_privilege('clinical.read', e.facility_id))
);
drop policy if exists "clinical result read" on public.clinical_results;
create policy "clinical result read" on public.clinical_results for select using (
  exists (select 1 from public.order_items oi join public.clinical_orders o on o.id = oi.order_id join public.encounters e on e.id = o.encounter_id where oi.id = clinical_results.order_item_id and public.has_privilege('clinical.read', e.facility_id))
);
drop policy if exists "clinical prescription read" on public.prescriptions;
create policy "clinical prescription read" on public.prescriptions for select using (
  exists (select 1 from public.encounters e where e.id = prescriptions.encounter_id and public.has_privilege('clinical.read', e.facility_id))
);
drop policy if exists "clinical prescription item read" on public.prescription_items;
create policy "clinical prescription item read" on public.prescription_items for select using (
  exists (select 1 from public.prescriptions p join public.encounters e on e.id = p.encounter_id where p.id = prescription_items.prescription_id and public.has_privilege('clinical.read', e.facility_id))
);
drop policy if exists "clinical product read" on public.products;
create policy "clinical product read" on public.products for select using (
  exists (select 1 from public.facilities f where f.organization_id = products.organization_id and public.has_privilege('clinical.read', f.id))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'discharge-documents',
  'discharge-documents',
  false,
  3145728,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "adt discharge object insert" on storage.objects;
create policy "adt discharge object insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'discharge-documents'
  and public.has_privilege('adt.write', ((storage.foldername(name))[1])::uuid)
);
drop policy if exists "adt discharge object read" on storage.objects;
create policy "adt discharge object read" on storage.objects
for select to authenticated using (
  bucket_id = 'discharge-documents'
  and public.has_privilege('adt.read', ((storage.foldername(name))[1])::uuid)
);
drop policy if exists "adt discharge object delete" on storage.objects;
create policy "adt discharge object delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'discharge-documents'
  and public.has_privilege('adt.write', ((storage.foldername(name))[1])::uuid)
);

create or replace function public.complete_discharge(
  target_admission uuid,
  discharge_disposition text,
  final_diagnosis text,
  condition_at_discharge text,
  discharge_instructions text,
  follow_up_plan text,
  discharge_medications text,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  org uuid;
  enc uuid;
  old_bed uuid;
  summary_id uuid;
begin
  select e.facility_id, p.organization_id, e.id
    into fac, org, enc
  from public.admissions a
  join public.encounters e on e.id = a.encounter_id
  join public.patients p on p.id = e.patient_id
  where a.id = target_admission
    and a.status <> 'discharged'
  for update of a;

  if fac is null or not public.has_privilege('adt.write', fac) then
    raise exception 'Not authorized to discharge this admission';
  end if;
  if nullif(trim(discharge_disposition), '') is null
    or nullif(trim(final_diagnosis), '') is null
    or nullif(trim(condition_at_discharge), '') is null
    or nullif(trim(discharge_instructions), '') is null then
    raise exception 'Disposition, final diagnosis, condition, and instructions are required';
  end if;
  if attachment_path is not null and (
    attachment_name is null or attachment_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or attachment_size is null or attachment_size < 1 or attachment_size > 3145728
  ) then
    raise exception 'Attachment metadata is invalid';
  end if;

  select bs.bed_id into old_bed
  from public.bed_stays bs
  where bs.admission_id = target_admission and bs.ended_at is null
  for update;

  insert into public.discharge_summaries (
    admission_id, final_diagnosis, condition_at_discharge, instructions,
    follow_up_plan, discharge_medications, completed_by
  ) values (
    target_admission, trim(complete_discharge.final_diagnosis),
    trim(complete_discharge.condition_at_discharge), trim(discharge_instructions),
    nullif(trim(complete_discharge.follow_up_plan), ''),
    nullif(trim(complete_discharge.discharge_medications), ''), auth.uid()
  ) returning id into summary_id;

  if attachment_path is not null then
    insert into public.discharge_documents (
      discharge_summary_id, admission_id, storage_path, original_name,
      mime_type, size_bytes, uploaded_by
    ) values (
      summary_id, target_admission, attachment_path, attachment_name,
      attachment_type, attachment_size, auth.uid()
    );
  end if;

  update public.bed_stays set ended_at = now()
  where admission_id = target_admission and ended_at is null;
  if old_bed is not null then
    update public.beds set status = 'cleaning' where id = old_bed;
  end if;
  update public.admissions
    set status = 'discharged', discharged_at = now(), discharge_disposition = trim(complete_discharge.discharge_disposition)
  where id = target_admission;
  update public.encounters set status = 'completed' where id = enc;

  insert into public.audit_events (
    organization_id, facility_id, actor_id, event_type,
    object_type, object_id, details
  ) values (
    org, fac, auth.uid(), 'patient.discharged', 'admission', target_admission,
    jsonb_build_object(
      'summary_id', summary_id,
      'disposition', trim(complete_discharge.discharge_disposition),
      'attachment_count', case when attachment_path is null then 0 else 1 end
    )
  );
  return summary_id;
end;
$$;

grant execute on function public.complete_discharge(
  uuid, text, text, text, text, text, text, text, text, text, bigint
) to authenticated;

commit;
