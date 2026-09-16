begin;

create or replace function public.transfer_patient(
  target_admission uuid,
  target_bed uuid,
  transfer_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fac uuid;
  old_bed uuid;
  org uuid;
begin
  select e.facility_id, p.organization_id
    into fac, org
  from public.admissions a
  join public.encounters e on e.id = a.encounter_id
  join public.patients p on p.id = e.patient_id
  where a.id = target_admission
    and a.status in ('admitted', 'for_transfer');

  if fac is null or not public.has_privilege('adt.write', fac) then
    raise exception 'Not authorized to transfer this admission';
  end if;

  if not exists (
    select 1
    from public.beds b
    join public.wards w on w.id = b.ward_id
    where b.id = target_bed
      and w.facility_id = fac
      and b.status = 'available'
  ) then
    raise exception 'Destination bed is unavailable';
  end if;

  select bs.bed_id
    into old_bed
  from public.bed_stays bs
  where bs.admission_id = target_admission
    and bs.ended_at is null
  for update;

  update public.bed_stays bs
  set ended_at = now(),
      transfer_reason = nullif(trim(transfer_patient.transfer_reason), '')
  where bs.admission_id = target_admission
    and bs.ended_at is null;

  update public.beds b set status = 'available' where b.id = old_bed;

  insert into public.bed_stays(
    admission_id,
    bed_id,
    started_at,
    transfer_reason,
    recorded_by
  ) values (
    target_admission,
    target_bed,
    now(),
    nullif(trim(transfer_patient.transfer_reason), ''),
    auth.uid()
  );

  update public.beds b set status = 'occupied' where b.id = target_bed;
  update public.admissions a set status = 'admitted' where a.id = target_admission;

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
    'patient.transferred',
    'admission',
    target_admission,
    nullif(trim(transfer_patient.transfer_reason), ''),
    jsonb_build_object('from_bed', old_bed, 'to_bed', target_bed)
  );
end;
$$;

grant execute on function public.transfer_patient(uuid, uuid, text) to authenticated;

commit;
