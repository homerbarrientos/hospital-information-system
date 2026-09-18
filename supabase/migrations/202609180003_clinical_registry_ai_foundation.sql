begin;

insert into public.privileges(code,description,risk_level) values
 ('clinical_registry.read','View diagnosis master, encounter diagnoses, care teams, timeline, and disease census','privileged'),
 ('clinical_registry.write','Maintain diagnosis master, encounter diagnoses, and care teams','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r join public.organizations o on o.id=r.organization_id cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator' and p.code in('clinical_registry.read','clinical_registry.write')
on conflict do nothing;

create table if not exists public.diagnosis_catalog(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations,
 code_system text not null default 'ICD-10',
 code text not null,
 title text not null,
 chapter text,
 category text,
 disease_class text not null default 'unclassified' check(disease_class in('communicable','non_communicable','injury','maternal','neonatal','other','unclassified')),
 clinical_course text not null default 'unspecified' check(clinical_course in('acute','chronic','recurrent','congenital','unspecified')),
 reportable boolean not null default false,
 philhealth_case_rate_code text,
 source_version text,
 status public.record_status not null default 'active',
 version integer not null default 1,
 created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(),
 updated_by uuid references public.profiles,
 updated_at timestamptz,
 unique(organization_id,code_system,code)
);

alter table public.diagnoses
 add column if not exists diagnosis_catalog_id uuid references public.diagnosis_catalog,
 add column if not exists classification text not null default 'secondary' check(classification in('principal','secondary')),
 add column if not exists verification_status text not null default 'provisional' check(verification_status in('provisional','confirmed','final','ruled_out')),
 add column if not exists clinical_status text not null default 'active' check(clinical_status in('active','resolved','inactive')),
 add column if not exists present_on_admission boolean,
 add column if not exists is_comorbidity boolean not null default false,
 add column if not exists is_complication boolean not null default false,
 add column if not exists onset_date date,
 add column if not exists resolved_at timestamptz,
 add column if not exists version integer not null default 1,
 add column if not exists updated_by uuid references public.profiles,
 add column if not exists updated_at timestamptz;

create table if not exists public.encounter_care_team(
 id uuid primary key default gen_random_uuid(),
 encounter_id uuid not null references public.encounters,
 doctor_id uuid not null references public.doctors,
 role text not null check(role in('attending','consultant','surgeon','anesthesiologist','resident','referring')),
 is_primary boolean not null default false,
 assigned_from timestamptz not null default now(),
 assigned_to timestamptz,
 fee_schedule_id uuid references public.doctor_fee_schedules,
 professional_fee numeric(14,2) check(professional_fee is null or professional_fee>=0),
 status text not null default 'active' check(status in('active','completed','removed')),
 notes text,
 version integer not null default 1,
 assigned_by uuid not null references public.profiles,
 updated_by uuid references public.profiles,
 updated_at timestamptz,
 unique(encounter_id,doctor_id,role)
);

create unique index if not exists diagnoses_one_active_principal_idx on public.diagnoses(encounter_id) where classification='principal' and clinical_status='active' and verification_status<>'ruled_out';
create index if not exists diagnosis_catalog_search_idx on public.diagnosis_catalog(organization_id,status,code,title);
create index if not exists diagnoses_registry_lookup_idx on public.diagnoses(encounter_id,classification,clinical_status,created_at desc);
create index if not exists care_team_encounter_lookup_idx on public.encounter_care_team(encounter_id,status,role);
create unique index if not exists care_team_one_primary_idx on public.encounter_care_team(encounter_id) where is_primary and status='active';

alter table public.diagnosis_catalog enable row level security;
alter table public.encounter_care_team enable row level security;
drop policy if exists "diagnosis catalog read" on public.diagnosis_catalog;
create policy "diagnosis catalog read" on public.diagnosis_catalog for select using(exists(select 1 from public.facilities f where f.organization_id=diagnosis_catalog.organization_id and public.has_privilege('clinical_registry.read',f.id)));
drop policy if exists "care team read" on public.encounter_care_team;
create policy "care team read" on public.encounter_care_team for select using(exists(select 1 from public.encounters e where e.id=encounter_care_team.encounter_id and public.has_privilege('clinical_registry.read',e.facility_id)));
drop policy if exists "clinical diagnosis read" on public.diagnoses;
create policy "clinical diagnosis read" on public.diagnoses for select using(exists(select 1 from public.encounters e where e.id=diagnoses.encounter_id and (public.has_privilege('clinical.read',e.facility_id) or public.has_privilege('clinical_registry.read',e.facility_id))));

create or replace function public.save_diagnosis_master(target_facility uuid,target_diagnosis uuid,diagnosis_code text,diagnosis_title text,diagnosis_chapter text,diagnosis_category text,disease_classification text,course_classification text,is_reportable boolean,case_rate_code text,source_version_name text,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;did uuid;old_record jsonb;
begin
 if not public.has_privilege('clinical_registry.write',target_facility) then raise exception 'Not authorized to maintain the diagnosis master';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if org is null or length(trim(coalesce(diagnosis_code,'')))<2 or length(trim(coalesce(diagnosis_title,'')))<3 then raise exception 'Diagnosis code and title are required';end if;
 if target_diagnosis is null then
  insert into public.diagnosis_catalog(organization_id,code,title,chapter,category,disease_class,clinical_course,reportable,philhealth_case_rate_code,source_version,created_by)
  values(org,upper(trim(diagnosis_code)),trim(diagnosis_title),nullif(trim(diagnosis_chapter),''),nullif(trim(diagnosis_category),''),disease_classification,course_classification,is_reportable,nullif(trim(case_rate_code),''),nullif(trim(source_version_name),''),auth.uid()) returning id into did;
 else
  select to_jsonb(d) into old_record from public.diagnosis_catalog d where d.id=target_diagnosis and d.organization_id=org for update;
  if old_record is null or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Diagnosis and a modification reason are required';end if;
  update public.diagnosis_catalog d set title=trim(diagnosis_title),chapter=nullif(trim(diagnosis_chapter),''),category=nullif(trim(diagnosis_category),''),disease_class=disease_classification,clinical_course=course_classification,reportable=is_reportable,philhealth_case_rate_code=nullif(trim(case_rate_code),''),source_version=nullif(trim(source_version_name),''),version=d.version+1,updated_by=auth.uid(),updated_at=now()
  where d.id=target_diagnosis and d.version=expected_version returning d.id into did;
  if did is null then raise exception 'Diagnosis master record changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_diagnosis is null then 'diagnosis_master.created' else 'diagnosis_master.updated' end,'diagnosis_catalog',did,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'code',upper(trim(diagnosis_code))));return did;
end$$;

create or replace function public.set_diagnosis_master_status(target_facility uuid,target_diagnosis uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$declare org uuid;begin
 if not public.has_privilege('clinical_registry.write',target_facility) or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization and a reason are required';end if;
 select organization_id into org from public.facilities where id=target_facility;
 update public.diagnosis_catalog d set status=next_status,version=d.version+1,updated_by=auth.uid(),updated_at=now() where d.id=target_diagnosis and d.organization_id=org;
 if not found then raise exception 'Diagnosis master record not found';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'diagnosis_master.status_changed','diagnosis_catalog',target_diagnosis,trim(change_reason),jsonb_build_object('status',next_status));
end$$;

create or replace function public.save_encounter_diagnosis(target_encounter uuid,target_record uuid,target_catalog uuid,diagnosis_description text,diagnosis_classification text,diagnosis_verification text,present_at_admission boolean,comorbidity boolean,complication boolean,diagnosis_onset date,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;did uuid;master record;old_record jsonb;
begin
 select e.facility_id,p.organization_id into fac,org from public.encounters e join public.patients p on p.id=e.patient_id where e.id=target_encounter;
 if fac is null or not public.has_privilege('clinical_registry.write',fac) then raise exception 'Encounter not found or not authorized';end if;
 select code_system,code,title into master from public.diagnosis_catalog where id=target_catalog and organization_id=org and status='active';
 if not found then raise exception 'Select an active diagnosis from the master list';end if;
 if diagnosis_classification not in('principal','secondary') or diagnosis_verification not in('provisional','confirmed','final','ruled_out') then raise exception 'Select valid diagnosis classifications';end if;
 if target_record is null then
  insert into public.diagnoses(encounter_id,diagnosis_catalog_id,code_system,code,description,diagnosis_type,classification,verification_status,present_on_admission,is_comorbidity,is_complication,onset_date,recorded_by)
  values(target_encounter,target_catalog,master.code_system,master.code,coalesce(nullif(trim(diagnosis_description),''),master.title),case when diagnosis_verification='final' then 'final' else 'working' end,diagnosis_classification,diagnosis_verification,present_at_admission,comorbidity,complication,diagnosis_onset,auth.uid()) returning id into did;
 else
  select to_jsonb(d) into old_record from public.diagnoses d where d.id=target_record and d.encounter_id=target_encounter for update;
  if old_record is null or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Diagnosis and modification reason are required';end if;
  update public.diagnoses d set diagnosis_catalog_id=target_catalog,code_system=master.code_system,code=master.code,description=coalesce(nullif(trim(diagnosis_description),''),master.title),diagnosis_type=case when diagnosis_verification='final' then 'final' else 'working' end,classification=diagnosis_classification,verification_status=diagnosis_verification,present_on_admission=present_at_admission,is_comorbidity=comorbidity,is_complication=complication,onset_date=diagnosis_onset,version=d.version+1,updated_by=auth.uid(),updated_at=now()
  where d.id=target_record and d.version=expected_version returning d.id into did;
  if did is null then raise exception 'Diagnosis record changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),case when target_record is null then 'encounter_diagnosis.created' else 'encounter_diagnosis.updated' end,'diagnosis',did,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'classification',diagnosis_classification,'verification',diagnosis_verification));return did;
end$$;

create or replace function public.resolve_encounter_diagnosis(target_diagnosis uuid,resolution_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;begin
 select e.facility_id,p.organization_id into fac,org from public.diagnoses d join public.encounters e on e.id=d.encounter_id join public.patients p on p.id=e.patient_id where d.id=target_diagnosis;
 if fac is null or not public.has_privilege('clinical_registry.write',fac) or length(trim(coalesce(resolution_reason,'')))<5 then raise exception 'Authorization and a resolution reason are required';end if;
 update public.diagnoses d set clinical_status='resolved',resolved_at=now(),version=d.version+1,updated_by=auth.uid(),updated_at=now() where d.id=target_diagnosis and d.clinical_status='active';
 if not found then raise exception 'Active diagnosis not found';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason) values(org,fac,auth.uid(),'encounter_diagnosis.resolved','diagnosis',target_diagnosis,trim(resolution_reason));
end$$;

create or replace function public.save_care_team_member(target_encounter uuid,target_assignment uuid,target_doctor uuid,doctor_role text,primary_doctor boolean,fee_schedule uuid,fee_amount numeric,assignment_notes text,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare fac uuid;org uuid;cid uuid;old_record jsonb;
begin
 select e.facility_id,p.organization_id into fac,org from public.encounters e join public.patients p on p.id=e.patient_id where e.id=target_encounter;
 if fac is null or not public.has_privilege('clinical_registry.write',fac) then raise exception 'Encounter not found or not authorized';end if;
 if doctor_role not in('attending','consultant','surgeon','anesthesiologist','resident','referring') then raise exception 'Select a valid doctor role';end if;
 if not exists(select 1 from public.doctor_facility_assignments where facility_id=fac and doctor_id=target_doctor and active) then raise exception 'Doctor is not active in this facility';end if;
 if primary_doctor then update public.encounter_care_team set is_primary=false,version=version+1,updated_by=auth.uid(),updated_at=now() where encounter_id=target_encounter and is_primary and status='active' and id is distinct from target_assignment;end if;
 if target_assignment is null then
  insert into public.encounter_care_team(encounter_id,doctor_id,role,is_primary,fee_schedule_id,professional_fee,notes,assigned_by) values(target_encounter,target_doctor,doctor_role,primary_doctor,fee_schedule,fee_amount,nullif(trim(assignment_notes),''),auth.uid()) returning id into cid;
 else
  select to_jsonb(c) into old_record from public.encounter_care_team c where c.id=target_assignment and c.encounter_id=target_encounter for update;
  if old_record is null or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Care-team assignment and modification reason are required';end if;
  update public.encounter_care_team c set doctor_id=target_doctor,role=doctor_role,is_primary=primary_doctor,fee_schedule_id=fee_schedule,professional_fee=fee_amount,notes=nullif(trim(assignment_notes),''),version=c.version+1,updated_by=auth.uid(),updated_at=now() where c.id=target_assignment and c.version=expected_version returning c.id into cid;
  if cid is null then raise exception 'Care-team assignment changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,fac,auth.uid(),case when target_assignment is null then 'care_team.assigned' else 'care_team.updated' end,'encounter_care_team',cid,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'role',doctor_role,'primary',primary_doctor,'professional_fee',fee_amount));return cid;
end$$;

create or replace function public.end_care_team_assignment(target_assignment uuid,end_reason text)
returns void language plpgsql security definer set search_path='' as $$declare fac uuid;org uuid;begin
 select e.facility_id,p.organization_id into fac,org from public.encounter_care_team c join public.encounters e on e.id=c.encounter_id join public.patients p on p.id=e.patient_id where c.id=target_assignment;
 if fac is null or not public.has_privilege('clinical_registry.write',fac) or length(trim(coalesce(end_reason,'')))<5 then raise exception 'Authorization and a reason are required';end if;
 update public.encounter_care_team c set status='completed',assigned_to=now(),is_primary=false,version=c.version+1,updated_by=auth.uid(),updated_at=now() where c.id=target_assignment and c.status='active';
 if not found then raise exception 'Active care-team assignment not found';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason) values(org,fac,auth.uid(),'care_team.completed','encounter_care_team',target_assignment,trim(end_reason));
end$$;

create or replace view public.disease_census with(security_invoker=true) as
select e.facility_id,date_trunc('month',e.service_date)::date census_month,e.encounter_type,d.code,d.description,dc.chapter,dc.category,dc.disease_class,dc.clinical_course,dc.reportable,d.classification,d.verification_status,
 count(distinct e.id) encounter_count,count(distinct e.patient_id) patient_count,
 count(distinct e.patient_id) filter(where p.sex_at_birth='Male') male_patients,count(distinct e.patient_id) filter(where p.sex_at_birth='Female') female_patients
from public.diagnoses d join public.encounters e on e.id=d.encounter_id join public.patients p on p.id=e.patient_id left join public.diagnosis_catalog dc on dc.id=d.diagnosis_catalog_id
where d.verification_status<>'ruled_out' group by e.facility_id,date_trunc('month',e.service_date)::date,e.encounter_type,d.code,d.description,dc.chapter,dc.category,dc.disease_class,dc.clinical_course,dc.reportable,d.classification,d.verification_status;

create or replace view public.clinical_ai_patient_context with(security_invoker=true) as
select e.facility_id,e.id encounter_id,e.patient_id,e.encounter_no,e.encounter_type,e.status encounter_status,e.service_date,
 jsonb_build_object('age_years',extract(year from age(e.service_date,p.birth_date)),'sex_at_birth',p.sex_at_birth) patient_context,
 coalesce((select jsonb_agg(jsonb_build_object('code',d.code,'description',d.description,'classification',d.classification,'verification',d.verification_status,'status',d.clinical_status,'present_on_admission',d.present_on_admission,'comorbidity',d.is_comorbidity,'complication',d.is_complication) order by d.created_at) from public.diagnoses d where d.encounter_id=e.id),'[]'::jsonb) diagnoses,
 coalesce((select jsonb_agg(jsonb_build_object('role',c.role,'primary',c.is_primary,'doctor_id',c.doctor_id) order by c.assigned_from) from public.encounter_care_team c where c.encounter_id=e.id and c.status='active'),'[]'::jsonb) care_team,
 coalesce((select jsonb_agg(jsonb_build_object('code',v.code,'value',v.value,'unit',v.unit,'observed_at',v.observed_at) order by v.observed_at desc) from public.vital_observations v where v.encounter_id=e.id),'[]'::jsonb) vital_signs
from public.encounters e join public.patients p on p.id=e.patient_id;

grant select on public.diagnosis_catalog,public.encounter_care_team,public.disease_census,public.clinical_ai_patient_context to authenticated;
grant execute on function public.save_diagnosis_master(uuid,uuid,text,text,text,text,text,text,boolean,text,text,integer,text) to authenticated;
grant execute on function public.set_diagnosis_master_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.save_encounter_diagnosis(uuid,uuid,uuid,text,text,text,boolean,boolean,boolean,date,integer,text) to authenticated;
grant execute on function public.resolve_encounter_diagnosis(uuid,text) to authenticated;
grant execute on function public.save_care_team_member(uuid,uuid,uuid,text,boolean,uuid,numeric,text,integer,text) to authenticated;
grant execute on function public.end_care_team_assignment(uuid,text) to authenticated;

commit;
