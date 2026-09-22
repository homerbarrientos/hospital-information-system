begin;

alter table public.patients
  add column if not exists profile_photo_path text,
  add column if not exists profile_photo_name text,
  add column if not exists profile_photo_mime text,
  add column if not exists profile_photo_size bigint,
  add column if not exists profile_photo_updated_at timestamptz;

alter table public.doctors
  add column if not exists profile_photo_path text,
  add column if not exists profile_photo_name text,
  add column if not exists profile_photo_mime text,
  add column if not exists profile_photo_size bigint,
  add column if not exists profile_photo_updated_at timestamptz;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,3145728,array['image/jpeg','image/png'])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "profile photo read" on storage.objects;
create policy "profile photo read" on storage.objects for select to authenticated using(
  bucket_id='profile-photos'
  and case (storage.foldername(name))[2]
    when 'patients' then public.has_privilege('patients.read',((storage.foldername(name))[1])::uuid)
    when 'doctors' then public.has_privilege('doctors.read',((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "profile photo insert" on storage.objects;
create policy "profile photo insert" on storage.objects for insert to authenticated with check(
  bucket_id='profile-photos'
  and case (storage.foldername(name))[2]
    when 'patients' then public.has_privilege('patients.update',((storage.foldername(name))[1])::uuid)
    when 'doctors' then public.has_privilege('doctors.write',((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "profile photo delete" on storage.objects;
create policy "profile photo delete" on storage.objects for delete to authenticated using(
  bucket_id='profile-photos'
  and case (storage.foldername(name))[2]
    when 'patients' then public.has_privilege('patients.update',((storage.foldername(name))[1])::uuid)
    when 'doctors' then public.has_privilege('doctors.write',((storage.foldername(name))[1])::uuid)
    else false
  end
);

create or replace function public.set_patient_profile_photo(
  target_patient uuid,
  target_facility uuid,
  new_path text,
  original_file_name text,
  file_type text,
  file_size bigint,
  change_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  old_path text;
begin
  select p.organization_id,p.profile_photo_path into target_org,old_path
  from public.patients p
  join public.facilities f on f.organization_id=p.organization_id
  where p.id=target_patient and f.id=target_facility
    and public.has_privilege('patients.update',target_facility)
  for update of p;
  if target_org is null then raise exception 'Not authorized to update this patient photo'; end if;
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A reason of at least five characters is required'; end if;
  if new_path is not null and (
    new_path not like target_facility::text||'/patients/%'
    or original_file_name is null
    or file_type not in ('image/jpeg','image/png')
    or file_size is null or file_size<1 or file_size>3145728
  ) then raise exception 'Invalid patient profile photo'; end if;

  update public.patients set
    profile_photo_path=new_path,
    profile_photo_name=case when new_path is null then null else original_file_name end,
    profile_photo_mime=case when new_path is null then null else file_type end,
    profile_photo_size=case when new_path is null then null else file_size end,
    profile_photo_updated_at=now(),
    updated_at=now(),
    version=version+1
  where id=target_patient;

  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(target_org,target_facility,auth.uid(),case when new_path is null then 'patient.photo_removed' else 'patient.photo_updated' end,
    'patient',target_patient,trim(change_reason),jsonb_build_object('previous_path',old_path,'new_path',new_path));
  return old_path;
end$$;

create or replace function public.set_doctor_profile_photo(
  target_doctor uuid,
  target_facility uuid,
  new_path text,
  original_file_name text,
  file_type text,
  file_size bigint,
  change_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  old_path text;
begin
  select d.organization_id,d.profile_photo_path into target_org,old_path
  from public.doctors d
  join public.doctor_facility_assignments a on a.doctor_id=d.id
  where d.id=target_doctor and a.facility_id=target_facility
    and public.has_privilege('doctors.write',target_facility)
  for update of d;
  if target_org is null then raise exception 'Not authorized to update this doctor photo'; end if;
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A reason of at least five characters is required'; end if;
  if new_path is not null and (
    new_path not like target_facility::text||'/doctors/%'
    or original_file_name is null
    or file_type not in ('image/jpeg','image/png')
    or file_size is null or file_size<1 or file_size>3145728
  ) then raise exception 'Invalid doctor profile photo'; end if;

  update public.doctors set
    profile_photo_path=new_path,
    profile_photo_name=case when new_path is null then null else original_file_name end,
    profile_photo_mime=case when new_path is null then null else file_type end,
    profile_photo_size=case when new_path is null then null else file_size end,
    profile_photo_updated_at=now(),
    updated_by=auth.uid(),
    updated_at=now(),
    version=version+1
  where id=target_doctor;

  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(target_org,target_facility,auth.uid(),case when new_path is null then 'doctor.photo_removed' else 'doctor.photo_updated' end,
    'doctor',target_doctor,trim(change_reason),jsonb_build_object('previous_path',old_path,'new_path',new_path));
  return old_path;
end$$;

grant execute on function public.set_patient_profile_photo(uuid,uuid,text,text,text,bigint,text) to authenticated;
grant execute on function public.set_doctor_profile_photo(uuid,uuid,text,text,text,bigint,text) to authenticated;

commit;
