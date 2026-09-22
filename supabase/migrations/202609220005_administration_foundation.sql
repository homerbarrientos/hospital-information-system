begin;

insert into public.privileges(code,description,risk_level) values
 ('facilities.read','View facility identity, departments, wards, and beds','privileged'),
 ('facilities.write','Maintain facility identity, departments, wards, and beds','high_risk'),
 ('workflow_approvals.read','View governed workflow requests and decisions','privileged'),
 ('workflow_approvals.request','Submit governed workflow requests','high_risk'),
 ('workflow_approvals.decide','Approve or reject governed workflow requests','high_risk'),
 ('settings.read','View facility templates and operational settings','privileged'),
 ('settings.write','Maintain facility templates and operational settings','high_risk')
on conflict(code) do update set description=excluded.description,risk_level=excluded.risk_level;

insert into public.role_privileges(role_id,privilege_code)
select r.id,p.code from public.roles r
join public.organizations o on o.id=r.organization_id
cross join public.privileges p
where o.code='INF' and r.name='Hospital Administrator'
and p.code in('facilities.read','facilities.write','workflow_approvals.read','workflow_approvals.request','workflow_approvals.decide','settings.read','settings.write')
on conflict do nothing;

alter table public.facilities
 add column if not exists address text,
 add column if not exists phone text,
 add column if not exists email text,
 add column if not exists license_no text,
 add column if not exists version integer not null default 1,
 add column if not exists updated_at timestamptz,
 add column if not exists updated_by uuid references public.profiles;

alter table public.departments
 add column if not exists location text,
 add column if not exists contact_no text,
 add column if not exists operating_hours text,
 add column if not exists version integer not null default 1,
 add column if not exists created_at timestamptz not null default now(),
 add column if not exists updated_at timestamptz,
 add column if not exists updated_by uuid references public.profiles;

alter table public.wards
 add column if not exists version integer not null default 1,
 add column if not exists updated_at timestamptz,
 add column if not exists updated_by uuid references public.profiles;

alter table public.beds
 add column if not exists version integer not null default 1,
 add column if not exists created_at timestamptz not null default now(),
 add column if not exists updated_by uuid references public.profiles;

grant select on public.facilities,public.departments,public.wards,public.beds to authenticated;

drop policy if exists "facility governance read" on public.facilities;
create policy "facility governance read" on public.facilities for select using(
 public.has_privilege('facilities.read',id) or public.user_has_facility(id)
);
drop policy if exists "department governance read" on public.departments;
create policy "department governance read" on public.departments for select using(
 public.has_privilege('facilities.read',facility_id) or public.user_has_facility(facility_id)
);

create or replace function public.save_facility_profile(
 target_facility uuid,facility_name text,facility_level text,facility_timezone text,
 facility_address text,facility_phone text,facility_email text,facility_license text,
 expected_version integer,change_reason text
) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;old_record jsonb;
begin
 if not public.has_privilege('facilities.write',target_facility) then raise exception 'Not authorized to maintain this facility';end if;
 if length(trim(coalesce(facility_name,'')))<3 or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Facility name and a five-character change reason are required';end if;
 select organization_id,to_jsonb(f) into org,old_record from public.facilities f where f.id=target_facility for update;
 update public.facilities set name=trim(facility_name),level=coalesce(nullif(trim(facility_level),''),'Infirmary'),timezone=coalesce(nullif(trim(facility_timezone),''),'Asia/Manila'),address=nullif(trim(facility_address),''),phone=nullif(trim(facility_phone),''),email=nullif(lower(trim(facility_email)),''),license_no=nullif(trim(facility_license),''),version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_facility and version=expected_version;
 if not found then raise exception 'Facility profile changed. Refresh and try again';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'facility.updated','facility',target_facility,trim(change_reason),jsonb_build_object('previous',old_record));
end$$;

create or replace function public.save_department(
 target_facility uuid,target_department uuid,department_code text,department_name text,
 department_location text,department_contact text,department_hours text,
 expected_version integer,change_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;row_id uuid;old_record jsonb;
begin
 if not public.has_privilege('facilities.write',target_facility) then raise exception 'Not authorized to maintain departments';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if org is null or length(trim(coalesce(department_code,'')))<2 or length(trim(coalesce(department_name,'')))<2 then raise exception 'Valid department code and name are required';end if;
 if target_department is null then
  insert into public.departments(facility_id,code,name,location,contact_no,operating_hours,status) values(target_facility,upper(trim(department_code)),trim(department_name),nullif(trim(department_location),''),nullif(trim(department_contact),''),nullif(trim(department_hours),''),'active') returning id into row_id;
 else
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A five-character modification reason is required';end if;
  select to_jsonb(d) into old_record from public.departments d where d.id=target_department and d.facility_id=target_facility for update;
  update public.departments set name=trim(department_name),location=nullif(trim(department_location),''),contact_no=nullif(trim(department_contact),''),operating_hours=nullif(trim(department_hours),''),version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_department and facility_id=target_facility and version=expected_version returning id into row_id;
  if row_id is null then raise exception 'Department changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_department is null then 'department.created' else 'department.updated' end,'department',row_id,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'code',upper(trim(department_code))));
 return row_id;
end$$;

create or replace function public.set_department_status(target_facility uuid,target_department uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;current_status public.record_status;
begin
 if not public.has_privilege('facilities.write',target_facility) or next_status not in('active','inactive') or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization, valid status, and reason are required';end if;
 select f.organization_id,d.status into org,current_status from public.departments d join public.facilities f on f.id=d.facility_id where d.id=target_department and d.facility_id=target_facility for update;
 if org is null then raise exception 'Department not found';end if;
 if next_status='inactive' and exists(select 1 from public.encounters where department_id=target_department and status not in('completed','cancelled')) then raise exception 'Department has active encounters';end if;
 update public.departments set status=next_status,version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_department;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'department.status_changed','department',target_department,trim(change_reason),jsonb_build_object('from',current_status,'to',next_status));
end$$;

create or replace function public.save_ward(
 target_facility uuid,target_ward uuid,ward_code text,ward_name text,target_floor uuid,
 target_billing_service uuid,expected_version integer,change_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;row_id uuid;old_record jsonb;
begin
 if not public.has_privilege('facilities.write',target_facility) then raise exception 'Not authorized to maintain wards';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if org is null or length(trim(coalesce(ward_code,'')))<2 or length(trim(coalesce(ward_name,'')))<2 then raise exception 'Valid ward code and name are required';end if;
 if target_floor is not null and not exists(select 1 from public.floors fl join public.buildings b on b.id=fl.building_id where fl.id=target_floor and b.facility_id=target_facility) then raise exception 'Floor is outside this facility';end if;
 if target_billing_service is not null and not exists(select 1 from public.service_catalog s where s.id=target_billing_service and s.organization_id=org and s.status='active') then raise exception 'Billing service is invalid';end if;
 if target_ward is null then
  insert into public.wards(facility_id,code,name,floor_id,billing_service_id,status) values(target_facility,upper(trim(ward_code)),trim(ward_name),target_floor,target_billing_service,'active') returning id into row_id;
 else
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A five-character modification reason is required';end if;
  select to_jsonb(w) into old_record from public.wards w where w.id=target_ward and w.facility_id=target_facility for update;
  update public.wards set name=trim(ward_name),floor_id=target_floor,billing_service_id=target_billing_service,version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_ward and facility_id=target_facility and version=expected_version returning id into row_id;
  if row_id is null then raise exception 'Ward changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_ward is null then 'ward.created' else 'ward.updated' end,'ward',row_id,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'code',upper(trim(ward_code))));
 return row_id;
end$$;

create or replace function public.set_ward_status(target_facility uuid,target_ward uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;current_status public.record_status;
begin
 if not public.has_privilege('facilities.write',target_facility) or next_status not in('active','inactive') or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization, valid status, and reason are required';end if;
 select f.organization_id,w.status into org,current_status from public.wards w join public.facilities f on f.id=w.facility_id where w.id=target_ward and w.facility_id=target_facility for update;
 if org is null then raise exception 'Ward not found';end if;
 if next_status='inactive' and exists(select 1 from public.beds where ward_id=target_ward and status='occupied') then raise exception 'Ward has occupied beds';end if;
 update public.wards set status=next_status,version=version+1,updated_at=now(),updated_by=auth.uid() where id=target_ward;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'ward.status_changed','ward',target_ward,trim(change_reason),jsonb_build_object('from',current_status,'to',next_status));
end$$;

create or replace function public.save_bed(
 target_facility uuid,target_bed uuid,target_ward uuid,bed_code text,bed_type_name text,
 bed_daily_rate numeric,bed_gender text,bed_age_group text,bed_isolation boolean,
 next_status text,expected_version integer,change_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;row_id uuid;old_record jsonb;current_status text;
begin
 if not public.has_privilege('facilities.write',target_facility) then raise exception 'Not authorized to maintain beds';end if;
 select f.organization_id into org from public.wards w join public.facilities f on f.id=w.facility_id where w.id=target_ward and w.facility_id=target_facility and w.status='active';
 if org is null or length(trim(coalesce(bed_code,'')))<1 or next_status not in('available','cleaning','isolation','maintenance','blocked','inactive') or coalesce(bed_daily_rate,0)<0 then raise exception 'Valid ward, bed code, status, and rate are required';end if;
 if target_bed is null then
  insert into public.beds(ward_id,code,bed_type,daily_rate,gender_restriction,age_group,isolation_capable,status,status_reason,updated_by) values(target_ward,upper(trim(bed_code)),nullif(trim(bed_type_name),''),coalesce(bed_daily_rate,0),coalesce(nullif(trim(bed_gender),''),'any'),coalesce(nullif(trim(bed_age_group),''),'any'),coalesce(bed_isolation,false),next_status,nullif(trim(change_reason),''),auth.uid()) returning id into row_id;
 else
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A five-character modification reason is required';end if;
  select to_jsonb(b),b.status into old_record,current_status from public.beds b join public.wards w on w.id=b.ward_id where b.id=target_bed and w.facility_id=target_facility for update of b;
  if current_status='occupied' then raise exception 'Occupied beds are controlled by ADT';end if;
  update public.beds set ward_id=target_ward,bed_type=nullif(trim(bed_type_name),''),daily_rate=coalesce(bed_daily_rate,0),gender_restriction=coalesce(nullif(trim(bed_gender),''),'any'),age_group=coalesce(nullif(trim(bed_age_group),''),'any'),isolation_capable=coalesce(bed_isolation,false),status=next_status,status_reason=trim(change_reason),status_changed_at=now(),version=version+1,updated_by=auth.uid() where id=target_bed and version=expected_version returning id into row_id;
  if row_id is null then raise exception 'Bed changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_bed is null then 'bed.created' else 'bed.updated' end,'bed',row_id,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'status',next_status));
 return row_id;
end$$;

create table if not exists public.workflow_requests(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities on delete restrict,
 request_type text not null check(request_type in('patient_merge','discount','void','refund','publication')),
 subject text not null,
 object_type text,
 object_id uuid,
 request_details text,
 reason text not null,
 status text not null default 'pending' check(status in('pending','approved','rejected','cancelled')),
 requested_by uuid not null references public.profiles,
 requested_at timestamptz not null default now(),
 decided_by uuid references public.profiles,
 decided_at timestamptz,
 decision_reason text,
 version integer not null default 1
);
create index if not exists workflow_requests_queue_idx on public.workflow_requests(facility_id,status,requested_at desc);
alter table public.workflow_requests enable row level security;
drop policy if exists "workflow request read" on public.workflow_requests;
create policy "workflow request read" on public.workflow_requests for select using(public.has_privilege('workflow_approvals.read',facility_id));
grant select on public.workflow_requests to authenticated;

create or replace function public.submit_workflow_request(target_facility uuid,workflow_type text,request_subject text,related_type text,related_id uuid,details text,request_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;row_id uuid;
begin
 if not public.has_privilege('workflow_approvals.request',target_facility) then raise exception 'Not authorized to submit approval requests';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if workflow_type not in('patient_merge','discount','void','refund','publication') or length(trim(coalesce(request_subject,'')))<3 or length(trim(coalesce(request_reason,'')))<5 then raise exception 'Request type, subject, and a five-character reason are required';end if;
 insert into public.workflow_requests(facility_id,request_type,subject,object_type,object_id,request_details,reason,requested_by) values(target_facility,workflow_type,trim(request_subject),nullif(trim(related_type),''),related_id,nullif(trim(details),''),trim(request_reason),auth.uid()) returning id into row_id;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'workflow.requested','workflow_request',row_id,trim(request_reason),jsonb_build_object('request_type',workflow_type,'subject',trim(request_subject),'related_type',related_type,'related_id',related_id));
 return row_id;
end$$;

create or replace function public.decide_workflow_request(target_request uuid,decision text,decision_notes text,expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare row_data public.workflow_requests%rowtype;org uuid;
begin
 select * into row_data from public.workflow_requests where id=target_request for update;
 if row_data.id is null or not public.has_privilege('workflow_approvals.decide',row_data.facility_id) then raise exception 'Not authorized to decide this request';end if;
 if row_data.status<>'pending' or row_data.version<>expected_version then raise exception 'Request is no longer pending. Refresh and try again';end if;
 if decision not in('approved','rejected') or length(trim(coalesce(decision_notes,'')))<5 then raise exception 'Decision and a five-character reason are required';end if;
 select organization_id into org from public.facilities where id=row_data.facility_id;
 update public.workflow_requests set status=decision,decided_by=auth.uid(),decided_at=now(),decision_reason=trim(decision_notes),version=version+1 where id=target_request;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,row_data.facility_id,auth.uid(),'workflow.'||decision,'workflow_request',target_request,trim(decision_notes),jsonb_build_object('request_type',row_data.request_type,'subject',row_data.subject,'requested_by',row_data.requested_by));
end$$;

create table if not exists public.facility_templates(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities on delete restrict,
 code text not null,
 name text not null,
 category text not null check(category in('clinical','administrative','billing','notification')),
 description text,
 content text not null,
 status public.record_status not null default 'active',
 version integer not null default 1,
 created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(),
 updated_by uuid references public.profiles,
 updated_at timestamptz,
 unique(facility_id,code)
);

create table if not exists public.facility_settings(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities on delete restrict,
 setting_key text not null,
 category text not null check(category in('numbering','notification','clinical','general')),
 label text not null,
 setting_value text not null,
 description text,
 version integer not null default 1,
 updated_by uuid references public.profiles,
 updated_at timestamptz not null default now(),
 unique(facility_id,setting_key)
);
create index if not exists facility_templates_category_idx on public.facility_templates(facility_id,category,status);
alter table public.facility_templates enable row level security;
alter table public.facility_settings enable row level security;
drop policy if exists "facility templates read" on public.facility_templates;
create policy "facility templates read" on public.facility_templates for select using(public.has_privilege('settings.read',facility_id));
drop policy if exists "facility settings read" on public.facility_settings;
create policy "facility settings read" on public.facility_settings for select using(public.has_privilege('settings.read',facility_id));
grant select on public.facility_templates,public.facility_settings to authenticated;

insert into public.facility_templates(facility_id,code,name,category,description,content,created_by)
select f.id,v.code,v.name,v.category,v.description,v.content,creator.user_id
from public.facilities f
join lateral(
 select ur.user_id from public.user_roles ur join public.profiles p on p.id=ur.user_id
 where ur.facility_id=f.id and ur.active and p.status='active' order by p.created_at limit 1
) creator on true
cross join(values
 ('OPD-SOAP','Outpatient SOAP note','clinical','Standard consultation note structure','Subjective:\nObjective:\nAssessment:\nPlan:'),
 ('DISCHARGE-INSTRUCTIONS','Discharge instructions','clinical','Standard patient discharge guidance','Diagnosis:\nMedications:\nHome care instructions:\nFollow-up schedule:\nReturn precautions:'),
 ('RECEIPT-FOOTER','Official receipt footer','billing','Cashier receipt closing text','Thank you. Please keep this receipt for your records.')
) as v(code,name,category,description,content)
on conflict(facility_id,code) do nothing;

insert into public.facility_settings(facility_id,setting_key,category,label,setting_value,description)
select f.id,v.setting_key,v.category,v.label,v.setting_value,v.description from public.facilities f cross join(values
 ('numbering.patient_prefix','numbering','Patient MRN prefix','INF','Prefix used by the patient-numbering workflow'),
 ('numbering.receipt_prefix','numbering','Official receipt prefix','OR','Prefix used for cashier receipts'),
 ('notification.low_stock','notification','Low-stock notifications','enabled','Notify inventory users when reorder levels are reached'),
 ('notification.approval_queue','notification','Approval queue notifications','enabled','Notify approvers when governed requests are submitted'),
 ('clinical.require_allergy_review','clinical','Require allergy review','enabled','Require allergy review during consultation')
) as v(setting_key,category,label,setting_value,description)
on conflict(facility_id,setting_key) do nothing;

create or replace function public.save_facility_template(target_facility uuid,target_template uuid,template_code text,template_name text,template_category text,template_description text,template_content text,expected_version integer,change_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;row_id uuid;old_record jsonb;
begin
 if not public.has_privilege('settings.write',target_facility) then raise exception 'Not authorized to maintain templates';end if;
 select organization_id into org from public.facilities where id=target_facility;
 if template_category not in('clinical','administrative','billing','notification') or length(trim(coalesce(template_code,'')))<2 or length(trim(coalesce(template_name,'')))<3 or length(trim(coalesce(template_content,'')))<3 then raise exception 'Valid code, name, category, and content are required';end if;
 if target_template is null then
  insert into public.facility_templates(facility_id,code,name,category,description,content,created_by) values(target_facility,upper(trim(template_code)),trim(template_name),template_category,nullif(trim(template_description),''),trim(template_content),auth.uid()) returning id into row_id;
 else
  if length(trim(coalesce(change_reason,'')))<5 then raise exception 'A five-character modification reason is required';end if;
  select to_jsonb(t) into old_record from public.facility_templates t where t.id=target_template and t.facility_id=target_facility for update;
  update public.facility_templates set name=trim(template_name),category=template_category,description=nullif(trim(template_description),''),content=trim(template_content),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_template and facility_id=target_facility and version=expected_version returning id into row_id;
  if row_id is null then raise exception 'Template changed. Refresh and try again';end if;
 end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),case when target_template is null then 'template.created' else 'template.updated' end,'facility_template',row_id,nullif(trim(change_reason),''),jsonb_build_object('previous',old_record,'code',upper(trim(template_code)),'category',template_category));
 return row_id;
end$$;

create or replace function public.set_facility_template_status(target_facility uuid,target_template uuid,next_status public.record_status,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;current_status public.record_status;
begin
 if not public.has_privilege('settings.write',target_facility) or next_status not in('active','inactive') or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization, valid status, and reason are required';end if;
 select f.organization_id,t.status into org,current_status from public.facility_templates t join public.facilities f on f.id=t.facility_id where t.id=target_template and t.facility_id=target_facility for update;
 if org is null then raise exception 'Template not found';end if;
 update public.facility_templates set status=next_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_template;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'template.status_changed','facility_template',target_template,trim(change_reason),jsonb_build_object('from',current_status,'to',next_status));
end$$;

create or replace function public.save_facility_setting(target_facility uuid,target_setting uuid,setting_label text,setting_value text,expected_version integer,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid;old_record jsonb;
begin
 if not public.has_privilege('settings.write',target_facility) or length(trim(coalesce(setting_label,'')))<3 or length(trim(coalesce(setting_value,'')))<1 or length(trim(coalesce(change_reason,'')))<5 then raise exception 'Authorization, label, value, and a five-character reason are required';end if;
 select f.organization_id,to_jsonb(s) into org,old_record from public.facility_settings s join public.facilities f on f.id=s.facility_id where s.id=target_setting and s.facility_id=target_facility for update;
 if org is null then raise exception 'Setting not found';end if;
 update public.facility_settings set label=trim(setting_label),setting_value=trim(setting_value),version=version+1,updated_by=auth.uid(),updated_at=now() where id=target_setting and version=expected_version;
 if not found then raise exception 'Setting changed. Refresh and try again';end if;
 insert into public.audit_events(organization_id,facility_id,actor_id,event_type,object_type,object_id,reason,details) values(org,target_facility,auth.uid(),'facility_setting.updated','facility_setting',target_setting,trim(change_reason),jsonb_build_object('previous',old_record,'value',trim(setting_value)));
end$$;

grant execute on function public.save_facility_profile(uuid,text,text,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.save_department(uuid,uuid,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.set_department_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.save_ward(uuid,uuid,text,text,uuid,uuid,integer,text) to authenticated;
grant execute on function public.set_ward_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.save_bed(uuid,uuid,uuid,text,text,numeric,text,text,boolean,text,integer,text) to authenticated;
grant execute on function public.submit_workflow_request(uuid,text,text,text,uuid,text,text) to authenticated;
grant execute on function public.decide_workflow_request(uuid,text,text,integer) to authenticated;
grant execute on function public.save_facility_template(uuid,uuid,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.set_facility_template_status(uuid,uuid,public.record_status,text) to authenticated;
grant execute on function public.save_facility_setting(uuid,uuid,text,text,integer,text) to authenticated;

commit;
