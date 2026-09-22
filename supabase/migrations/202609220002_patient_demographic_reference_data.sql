begin;

-- Complete the database-backed demographic lists exposed by Patient Registration.
-- These remain configurable through Administration > Reference Data.
insert into public.reference_groups(organization_id,code,name,description)
select o.id,v.code,v.name,v.description
from public.organizations o
cross join (values
  ('nationality','Nationality','Patient nationality or citizenship recorded during registration'),
  ('religion','Religion','Patient religious affiliation recorded during registration'),
  ('occupation','Occupation','Patient occupation category recorded during registration'),
  ('emergency_contact_relationship','Emergency contact relationship','Relationship of the emergency contact to the patient')
) as v(code,name,description)
on conflict(organization_id,code) do update
set name=excluded.name,description=excluded.description;

insert into public.reference_options(group_id,code,label,sort_order)
select g.id,v.code,v.label,v.sort_order
from public.reference_groups g
join (values
  ('nationality','filipino','Filipino',10),
  ('nationality','american','American',20),
  ('nationality','australian','Australian',30),
  ('nationality','british','British',40),
  ('nationality','canadian','Canadian',50),
  ('nationality','chinese','Chinese',60),
  ('nationality','indian','Indian',70),
  ('nationality','japanese','Japanese',80),
  ('nationality','korean','Korean',90),
  ('nationality','other','Other / Not listed',100),

  ('religion','roman_catholic','Roman Catholic',10),
  ('religion','islam','Islam',20),
  ('religion','iglesia_ni_cristo','Iglesia ni Cristo',30),
  ('religion','protestant','Protestant',40),
  ('religion','born_again_christian','Born-again Christian',50),
  ('religion','seventh_day_adventist','Seventh-day Adventist',60),
  ('religion','jehovahs_witness','Jehovah''s Witness',70),
  ('religion','buddhist','Buddhist',80),
  ('religion','hindu','Hindu',90),
  ('religion','none','None',100),
  ('religion','other','Other / Not listed',110),

  ('occupation','government_employee','Government employee',10),
  ('occupation','private_employee','Private-sector employee',20),
  ('occupation','self_employed','Self-employed',30),
  ('occupation','business_owner','Business owner',40),
  ('occupation','healthcare_worker','Healthcare worker',50),
  ('occupation','teacher','Teacher / Educator',60),
  ('occupation','farmer','Farmer',70),
  ('occupation','fisher','Fisher',80),
  ('occupation','skilled_worker','Skilled worker',90),
  ('occupation','driver','Driver / Transport worker',100),
  ('occupation','office_worker','Office worker',110),
  ('occupation','student','Student',120),
  ('occupation','homemaker','Homemaker',130),
  ('occupation','retired','Retired',140),
  ('occupation','unemployed','Unemployed',150),
  ('occupation','overseas_worker','Overseas Filipino worker',160),
  ('occupation','other','Other / Not listed',170),

  ('emergency_contact_relationship','spouse','Spouse',10),
  ('emergency_contact_relationship','parent','Parent',20),
  ('emergency_contact_relationship','child','Child',30),
  ('emergency_contact_relationship','sibling','Sibling',40),
  ('emergency_contact_relationship','guardian','Guardian',50),
  ('emergency_contact_relationship','relative','Other relative',60),
  ('emergency_contact_relationship','friend','Friend',70),
  ('emergency_contact_relationship','other','Other / Not listed',80)
) as v(group_code,code,label,sort_order) on g.code=v.group_code
on conflict(group_id,code) do update
set label=excluded.label,sort_order=excluded.sort_order,active=true;

commit;
