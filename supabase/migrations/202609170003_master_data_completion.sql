begin;

-- Patient identity, PhilHealth, contact and emergency information.
alter table public.patients
  add column if not exists civil_status text,
  add column if not exists nationality text,
  add column if not exists religion text,
  add column if not exists blood_type text,
  add column if not exists occupation text,
  add column if not exists philhealth_no text,
  add column if not exists philhealth_membership_type text,
  add column if not exists philhealth_relationship text,
  add column if not exists philhealth_status text,
  add column if not exists philhealth_valid_until date,
  add column if not exists government_id_type text,
  add column if not exists government_id_no text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists emergency_contact_phone text;

create unique index if not exists patients_org_philhealth_unique
  on public.patients(organization_id,philhealth_no)
  where philhealth_no is not null;
create index if not exists patients_government_id_search
  on public.patients(organization_id,government_id_type,government_id_no)
  where government_id_no is not null;

-- Doctor credential and accreditation information.
alter table public.doctors
  add column if not exists prc_issued_on date,
  add column if not exists prc_expires_on date,
  add column if not exists credential_status text not null default 'unverified',
  add column if not exists philhealth_accreditation_no text,
  add column if not exists philhealth_valid_from date,
  add column if not exists philhealth_valid_until date,
  add column if not exists subspecialty text,
  add column if not exists doctor_type text,
  add column if not exists clinic_schedule text,
  add column if not exists professional_fee numeric(14,2);

create unique index if not exists doctors_org_philhealth_accreditation_unique
  on public.doctors(organization_id,philhealth_accreditation_no)
  where philhealth_accreditation_no is not null;

-- Complete facility hierarchy while retaining all current ward and bed records.
create table if not exists public.buildings(
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities on delete restrict,
  code text not null,
  name text not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique(facility_id,code)
);

create table if not exists public.floors(
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete restrict,
  code text not null,
  name text not null,
  floor_number integer,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique(building_id,code)
);

alter table public.wards add column if not exists floor_id uuid references public.floors on delete set null;

create table if not exists public.rooms(
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards on delete restrict,
  code text not null,
  name text,
  room_type text,
  accommodation_class text,
  daily_rate numeric(14,2) not null default 0 check(daily_rate>=0),
  gender_restriction text not null default 'any',
  age_group text not null default 'any',
  isolation_capable boolean not null default false,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique(ward_id,code)
);

alter table public.beds
  add column if not exists room_id uuid references public.rooms on delete set null,
  add column if not exists bed_type text,
  add column if not exists daily_rate numeric(14,2) not null default 0,
  add column if not exists gender_restriction text not null default 'any',
  add column if not exists age_group text not null default 'any',
  add column if not exists isolation_capable boolean not null default false,
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz not null default now();

alter table public.beds drop constraint if exists beds_status_check;
alter table public.beds add constraint beds_status_check
  check(status in('available','occupied','reserved','cleaning','isolation','maintenance','blocked','inactive'));

alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.rooms enable row level security;

drop policy if exists "assigned building read" on public.buildings;
create policy "assigned building read" on public.buildings for select using(public.user_has_facility(facility_id));
drop policy if exists "assigned floor read" on public.floors;
create policy "assigned floor read" on public.floors for select using(exists(
  select 1 from public.buildings b where b.id=floors.building_id and public.user_has_facility(b.facility_id)
));
drop policy if exists "assigned room read" on public.rooms;
create policy "assigned room read" on public.rooms for select using(exists(
  select 1 from public.wards w where w.id=rooms.ward_id and public.user_has_facility(w.facility_id)
));

grant select on public.buildings,public.floors,public.rooms to authenticated;

-- Dynamic reference-data groups for the newly exposed fields.
insert into public.reference_groups(organization_id,code,name,description)
select o.id,v.code,v.name,v.description from public.organizations o cross join (values
  ('civil_status','Civil status','Patient civil status'),
  ('blood_type','Blood type','ABO and Rh blood group'),
  ('philhealth_membership_type','PhilHealth membership type','PhilHealth member category'),
  ('philhealth_relationship','PhilHealth relationship','Relationship to principal member'),
  ('philhealth_status','PhilHealth status','Recorded eligibility or membership state'),
  ('government_id_type','Government ID type','Supported identity document types'),
  ('doctor_type','Doctor type','Facility role or appointment type'),
  ('credential_status','Credential verification status','Credential verification state'),
  ('room_type','Room type','Hospital accommodation type'),
  ('gender_restriction','Gender restriction','Room or bed patient restriction'),
  ('age_group','Age group','Room or bed age restriction')
) as v(code,name,description)
on conflict(organization_id,code) do update set name=excluded.name,description=excluded.description;

insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order from public.reference_groups g join (values
  ('civil_status','single','Single',10),('civil_status','married','Married',20),('civil_status','widowed','Widowed',30),('civil_status','separated','Separated',40),('civil_status','annulled','Annulled',50),
  ('blood_type','a_pos','A+',10),('blood_type','a_neg','A-',20),('blood_type','b_pos','B+',30),('blood_type','b_neg','B-',40),('blood_type','ab_pos','AB+',50),('blood_type','ab_neg','AB-',60),('blood_type','o_pos','O+',70),('blood_type','o_neg','O-',80),('blood_type','unknown','Unknown',90),
  ('philhealth_membership_type','formal_economy','Formal Economy',10),('philhealth_membership_type','informal_economy','Informal Economy',20),('philhealth_membership_type','indigent','Indigent',30),('philhealth_membership_type','sponsored','Sponsored',40),('philhealth_membership_type','senior_citizen','Senior Citizen',50),('philhealth_membership_type','lifetime','Lifetime Member',60),('philhealth_membership_type','pwd','Person with Disability',70),
  ('philhealth_relationship','principal','Principal Member',10),('philhealth_relationship','spouse','Spouse',20),('philhealth_relationship','child','Child',30),('philhealth_relationship','parent','Parent',40),('philhealth_relationship','other_dependent','Other Dependent',50),
  ('philhealth_status','unverified','Unverified',10),('philhealth_status','eligible','Eligible',20),('philhealth_status','ineligible','Ineligible',30),('philhealth_status','expired','Expired',40),
  ('government_id_type','national_id','PhilSys National ID',10),('government_id_type','passport','Passport',20),('government_id_type','drivers_license','Driver License',30),('government_id_type','sss','SSS ID',40),('government_id_type','gsis','GSIS ID',50),('government_id_type','umid','UMID',60),('government_id_type','senior_id','Senior Citizen ID',70),('government_id_type','pwd_id','PWD ID',80),('government_id_type','other','Other',90),
  ('doctor_type','consultant','Consultant',10),('doctor_type','resident','Resident',20),('doctor_type','visiting','Visiting Consultant',30),('doctor_type','referring','Referring Physician',40),('doctor_type','medical_officer','Medical Officer',50),
  ('credential_status','unverified','Unverified',10),('credential_status','verified','Verified',20),('credential_status','expired','Expired',30),('credential_status','suspended','Suspended',40),
  ('room_type','ward','Ward',10),('room_type','semi_private','Semi-private',20),('room_type','private','Private',30),('room_type','icu','Intensive Care Unit',40),('room_type','isolation','Isolation',50),('room_type','observation','Observation',60),
  ('gender_restriction','any','Any',10),('gender_restriction','male','Male only',20),('gender_restriction','female','Female only',30),
  ('age_group','any','Any',10),('age_group','adult','Adult',20),('age_group','pediatric','Pediatric',30),('age_group','neonatal','Neonatal',40),('age_group','geriatric','Geriatric',50)
) as v(group_code,code,label,sort_order) on g.code=v.group_code
on conflict(group_id,code) do update set label=excluded.label,sort_order=excluded.sort_order;

create or replace function public.register_patient_extended(
  target_facility uuid, first_name text, middle_name text, last_name text, birth_date date,
  sex_at_birth text, phone text, email text, civil_status text, nationality text, religion text,
  blood_type text, occupation text, philhealth_no text, philhealth_membership_type text,
  philhealth_relationship text, philhealth_status text, philhealth_valid_until date,
  government_id_type text, government_id_no text, emergency_contact_name text,
  emergency_contact_relationship text, emergency_contact_phone text, address_line1 text,
  barangay text, city_municipality text, province text, postal_code text
) returns uuid language plpgsql security definer set search_path='' as $$
declare patient_id uuid; target_org uuid; generated_mrn text; normalized_pin text;
begin
  if auth.uid() is null or not public.has_privilege('patients.create',target_facility) then raise exception 'Not authorized to register patients'; end if;
  if nullif(trim(first_name),'') is null or nullif(trim(last_name),'') is null then raise exception 'First and last name are required'; end if;
  if birth_date is not null and birth_date>current_date then raise exception 'Birth date cannot be in the future'; end if;
  normalized_pin:=nullif(regexp_replace(coalesce(philhealth_no,''),'[^0-9]','','g'),'');
  if normalized_pin is not null and length(normalized_pin)<>12 then raise exception 'PhilHealth number must contain exactly 12 digits'; end if;
  if nullif(trim(government_id_no),'') is not null and nullif(trim(government_id_type),'') is null then raise exception 'Select the government ID type'; end if;
  if nullif(trim(emergency_contact_phone),'') is not null and nullif(trim(emergency_contact_name),'') is null then raise exception 'Emergency contact name is required when a phone number is provided'; end if;
  select organization_id into target_org from public.facilities where id=target_facility and status='active';
  if target_org is null then raise exception 'Facility is unavailable'; end if;
  generated_mrn:='INF-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.patient_mrn_seq')::text,6,'0');
  insert into public.patients(
    organization_id,mrn,first_name,middle_name,last_name,birth_date,sex_at_birth,phone,email,address,
    civil_status,nationality,religion,blood_type,occupation,philhealth_no,philhealth_membership_type,
    philhealth_relationship,philhealth_status,philhealth_valid_until,government_id_type,government_id_no,
    emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,created_by
  ) values(
    target_org,generated_mrn,trim(first_name),nullif(trim(middle_name),''),trim(last_name),birth_date,
    nullif(trim(sex_at_birth),''),nullif(trim(phone),''),nullif(trim(email),''),
    jsonb_strip_nulls(jsonb_build_object('line1',nullif(trim(address_line1),''),'barangay',nullif(trim(barangay),''),'city_municipality',nullif(trim(city_municipality),''),'province',nullif(trim(province),''),'postal_code',nullif(trim(postal_code),''))),
    nullif(trim(civil_status),''),nullif(trim(nationality),''),nullif(trim(religion),''),nullif(trim(blood_type),''),nullif(trim(occupation),''),normalized_pin,
    nullif(trim(philhealth_membership_type),''),nullif(trim(philhealth_relationship),''),nullif(trim(philhealth_status),''),philhealth_valid_until,
    nullif(trim(government_id_type),''),nullif(trim(government_id_no),''),nullif(trim(emergency_contact_name),''),nullif(trim(emergency_contact_relationship),''),nullif(trim(emergency_contact_phone),''),auth.uid()
  ) returning id into patient_id;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
  values(target_org,target_facility,auth.uid(),'patient.registered','patient',patient_id,jsonb_build_object('mrn',generated_mrn,'extended_profile',true));
  return patient_id;
end$$;

create or replace function public.update_patient_extended(
  target_patient uuid, expected_version integer, new_first_name text, new_middle_name text,
  new_last_name text, new_birth_date date, new_sex_at_birth text, new_phone text, new_email text,
  new_civil_status text, new_nationality text, new_religion text, new_blood_type text,
  new_occupation text, new_philhealth_no text, new_philhealth_membership_type text,
  new_philhealth_relationship text, new_philhealth_status text, new_philhealth_valid_until date,
  new_government_id_type text, new_government_id_no text, new_emergency_contact_name text,
  new_emergency_contact_relationship text, new_emergency_contact_phone text, new_address_line1 text,
  new_barangay text, new_city_municipality text, new_province text, new_postal_code text,
  modification_reason text
) returns integer language plpgsql security definer set search_path='' as $$
declare target_facility uuid; target_org uuid; next_version integer; normalized_pin text; old_record jsonb;
begin
  select p.organization_id,f.id,to_jsonb(p) into target_org,target_facility,old_record
  from public.patients p join public.facilities f on f.organization_id=p.organization_id
  where p.id=target_patient and public.has_privilege('patients.update',f.id) limit 1;
  if target_facility is null then raise exception 'Not authorized to update this patient'; end if;
  if length(trim(modification_reason))<5 then raise exception 'Modification reason must contain at least 5 characters'; end if;
  if nullif(trim(new_first_name),'') is null or nullif(trim(new_last_name),'') is null then raise exception 'First and last name are required'; end if;
  if new_birth_date is not null and new_birth_date>current_date then raise exception 'Birth date cannot be in the future'; end if;
  normalized_pin:=nullif(regexp_replace(coalesce(new_philhealth_no,''),'[^0-9]','','g'),'');
  if normalized_pin is not null and length(normalized_pin)<>12 then raise exception 'PhilHealth number must contain exactly 12 digits'; end if;
  update public.patients set
    first_name=trim(new_first_name),middle_name=nullif(trim(new_middle_name),''),last_name=trim(new_last_name),birth_date=new_birth_date,
    sex_at_birth=nullif(trim(new_sex_at_birth),''),phone=nullif(trim(new_phone),''),email=nullif(trim(new_email),''),
    address=jsonb_strip_nulls(jsonb_build_object('line1',nullif(trim(new_address_line1),''),'barangay',nullif(trim(new_barangay),''),'city_municipality',nullif(trim(new_city_municipality),''),'province',nullif(trim(new_province),''),'postal_code',nullif(trim(new_postal_code),''))),
    civil_status=nullif(trim(new_civil_status),''),nationality=nullif(trim(new_nationality),''),religion=nullif(trim(new_religion),''),blood_type=nullif(trim(new_blood_type),''),occupation=nullif(trim(new_occupation),''),
    philhealth_no=normalized_pin,philhealth_membership_type=nullif(trim(new_philhealth_membership_type),''),philhealth_relationship=nullif(trim(new_philhealth_relationship),''),philhealth_status=nullif(trim(new_philhealth_status),''),philhealth_valid_until=new_philhealth_valid_until,
    government_id_type=nullif(trim(new_government_id_type),''),government_id_no=nullif(trim(new_government_id_no),''),
    emergency_contact_name=nullif(trim(new_emergency_contact_name),''),emergency_contact_relationship=nullif(trim(new_emergency_contact_relationship),''),emergency_contact_phone=nullif(trim(new_emergency_contact_phone),''),
    updated_at=now(),version=version+1
  where id=target_patient and version=expected_version returning version into next_version;
  if next_version is null then raise exception 'Patient was changed by another user. Refresh and try again'; end if;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(target_org,target_facility,auth.uid(),'patient.updated','patient',target_patient,trim(modification_reason),jsonb_build_object('previous',old_record,'version',next_version));
  return next_version;
end$$;

create or replace function public.create_doctor_extended(
  target_facility uuid, first_name text, middle_name text, last_name text, suffix text,
  license_number text, specialty text, phone text, email text, target_department uuid,
  prc_issued_on date, prc_expires_on date, credential_status text, philhealth_accreditation_no text,
  philhealth_valid_from date, philhealth_valid_until date, subspecialty text, doctor_type text,
  clinic_schedule text, professional_fee numeric
) returns uuid language plpgsql security definer set search_path='' as $$
declare doc uuid; org uuid;
begin
  if not public.has_privilege('doctors.write',target_facility) then raise exception 'Not authorized to maintain doctors'; end if;
  select organization_id into org from public.facilities where id=target_facility;
  if org is null then raise exception 'Facility not found'; end if;
  if length(trim(first_name))<2 or length(trim(last_name))<2 then raise exception 'Doctor first and last name are required'; end if;
  if length(trim(license_number))<3 or length(trim(specialty))<2 then raise exception 'A valid license number and specialty are required'; end if;
  if prc_issued_on is not null and prc_expires_on is not null and prc_expires_on<prc_issued_on then raise exception 'PRC expiry must be after the issue date'; end if;
  if philhealth_valid_from is not null and philhealth_valid_until is not null and philhealth_valid_until<philhealth_valid_from then raise exception 'PhilHealth validity end must be after its start'; end if;
  if professional_fee is not null and professional_fee<0 then raise exception 'Professional fee cannot be negative'; end if;
  insert into public.doctors(organization_id,first_name,middle_name,last_name,suffix,license_number,specialty,phone,email,created_by,prc_issued_on,prc_expires_on,credential_status,philhealth_accreditation_no,philhealth_valid_from,philhealth_valid_until,subspecialty,doctor_type,clinic_schedule,professional_fee)
  values(org,trim(first_name),nullif(trim(middle_name),''),trim(last_name),nullif(trim(suffix),''),trim(license_number),trim(specialty),nullif(trim(phone),''),nullif(trim(email),''),auth.uid(),prc_issued_on,prc_expires_on,coalesce(nullif(trim(credential_status),''),'unverified'),nullif(trim(philhealth_accreditation_no),''),philhealth_valid_from,philhealth_valid_until,nullif(trim(subspecialty),''),nullif(trim(doctor_type),''),nullif(trim(clinic_schedule),''),professional_fee) returning id into doc;
  insert into public.doctor_facility_assignments(doctor_id,facility_id,department_id,assigned_by) values(doc,target_facility,target_department,auth.uid());
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,details)
  values(org,target_facility,auth.uid(),'doctor.created','doctor',doc,jsonb_build_object('license_number',trim(license_number),'specialty',trim(specialty),'credential_status',credential_status));
  return doc;
end$$;

create or replace function public.update_doctor_extended(
  target_doctor uuid, target_facility uuid, first_name text, middle_name text, last_name text,
  suffix text, license_number text, specialty text, phone text, email text, target_department uuid,
  expected_version integer, modification_reason text, prc_issued_on date, prc_expires_on date,
  credential_status text, philhealth_accreditation_no text, philhealth_valid_from date,
  philhealth_valid_until date, subspecialty text, doctor_type text, clinic_schedule text,
  professional_fee numeric
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; old_record jsonb;
begin
  if not public.has_privilege('doctors.write',target_facility) then raise exception 'Not authorized to maintain doctors'; end if;
  select d.organization_id,to_jsonb(d) into org,old_record from public.doctors d join public.doctor_facility_assignments a on a.doctor_id=d.id where d.id=target_doctor and a.facility_id=target_facility for update of d;
  if org is null then raise exception 'Doctor is not assigned to this facility'; end if;
  if length(trim(modification_reason))<5 then raise exception 'Modification reason must contain at least 5 characters'; end if;
  if prc_issued_on is not null and prc_expires_on is not null and prc_expires_on<prc_issued_on then raise exception 'PRC expiry must be after the issue date'; end if;
  if philhealth_valid_from is not null and philhealth_valid_until is not null and philhealth_valid_until<philhealth_valid_from then raise exception 'PhilHealth validity end must be after its start'; end if;
  if professional_fee is not null and professional_fee<0 then raise exception 'Professional fee cannot be negative'; end if;
  update public.doctors set first_name=trim(update_doctor_extended.first_name),middle_name=nullif(trim(update_doctor_extended.middle_name),''),last_name=trim(update_doctor_extended.last_name),suffix=nullif(trim(update_doctor_extended.suffix),''),license_number=trim(update_doctor_extended.license_number),specialty=trim(update_doctor_extended.specialty),phone=nullif(trim(update_doctor_extended.phone),''),email=nullif(trim(update_doctor_extended.email),''),prc_issued_on=update_doctor_extended.prc_issued_on,prc_expires_on=update_doctor_extended.prc_expires_on,credential_status=coalesce(nullif(trim(update_doctor_extended.credential_status),''),'unverified'),philhealth_accreditation_no=nullif(trim(update_doctor_extended.philhealth_accreditation_no),''),philhealth_valid_from=update_doctor_extended.philhealth_valid_from,philhealth_valid_until=update_doctor_extended.philhealth_valid_until,subspecialty=nullif(trim(update_doctor_extended.subspecialty),''),doctor_type=nullif(trim(update_doctor_extended.doctor_type),''),clinic_schedule=nullif(trim(update_doctor_extended.clinic_schedule),''),professional_fee=update_doctor_extended.professional_fee,version=version+1,updated_by=auth.uid(),updated_at=now()
  where id=target_doctor and version=expected_version;
  if not found then raise exception 'Doctor record changed. Refresh and try again'; end if;
  update public.doctor_facility_assignments set department_id=target_department where doctor_id=target_doctor and facility_id=target_facility;
  insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details)
  values(org,target_facility,auth.uid(),'doctor.updated','doctor',target_doctor,trim(modification_reason),jsonb_build_object('previous',old_record));
end$$;

grant execute on function public.register_patient_extended(uuid,text,text,text,date,text,text,text,text,text,text,text,text,text,text,text,text,date,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.update_patient_extended(uuid,integer,text,text,text,date,text,text,text,text,text,text,text,text,text,text,text,text,date,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.create_doctor_extended(uuid,text,text,text,text,text,text,text,text,uuid,date,date,text,text,date,date,text,text,text,numeric) to authenticated;
grant execute on function public.update_doctor_extended(uuid,uuid,text,text,text,text,text,text,text,text,uuid,integer,text,date,date,text,text,date,date,text,text,text,numeric) to authenticated;

commit;
