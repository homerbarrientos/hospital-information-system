-- Hospital ONE Administration foundation integrity checks.
-- PASS CONDITION: every query returns zero rows.

-- Departments assigned to active users must belong to the same facility.
select ur.user_id,ur.facility_id,ur.department_id
from public.user_roles ur
join public.departments d on d.id=ur.department_id
where ur.department_id is not null and d.facility_id<>ur.facility_id;

-- Occupied beds require one current bed stay; non-occupied beds must not have one.
select b.id,b.code,b.status,count(bs.id) as active_stays
from public.beds b
left join public.bed_stays bs on bs.bed_id=b.id and bs.ended_at is null
group by b.id,b.code,b.status
having (b.status='occupied' and count(bs.id)<>1)
    or (b.status<>'occupied' and count(bs.id)>0);

-- Final workflow decisions require complete decision metadata.
select id,request_type,status,decided_by,decided_at,decision_reason
from public.workflow_requests
where status in('approved','rejected')
  and (decided_by is null or decided_at is null or nullif(trim(decision_reason),'') is null);

-- Pending workflow requests must not contain decision metadata.
select id,request_type,status,decided_by,decided_at
from public.workflow_requests
where status='pending' and (decided_by is not null or decided_at is not null);

-- Active templates require usable codes, names, and content.
select id,facility_id,code,name,status
from public.facility_templates
where status='active'
  and (length(trim(code))<2 or length(trim(name))<3 or length(trim(content))<3);

-- Every facility must have unique, populated setting keys and values.
select facility_id,setting_key,count(*)
from public.facility_settings
where nullif(trim(setting_key),'') is null or nullif(trim(setting_value),'') is null
group by facility_id,setting_key
having count(*)>0;
