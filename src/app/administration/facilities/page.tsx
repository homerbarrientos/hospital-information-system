import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { FacilityWorkspace } from "@/components/facility-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function FacilitiesPage(){
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:assignments}=await supabase.from("user_roles").select("facility_id,facilities(organization_id)").eq("user_id",userId).eq("active",true).limit(1);const assignment=assignments?.[0],facilityId=assignment?.facility_id,facilityRelation=assignment?.facilities,organizationId=(Array.isArray(facilityRelation)?facilityRelation[0]:facilityRelation)?.organization_id;if(!facilityId||!organizationId)return <div className="form-error">No active facility assignment.</div>;
 const[{data:facility,error:facilityError},{data:departments,error:departmentError},{data:wards,error:wardError},{data:beds,error:bedError},{data:buildings},{data:services},{data:procedureRooms,error:procedureRoomError}]=await Promise.all([
  supabase.from("facilities").select("id,organization_id,code,name,level,timezone,address,phone,email,license_no,version").eq("id",facilityId).single(),
  supabase.from("departments").select("id,code,name,location,contact_no,operating_hours,status,version").eq("facility_id",facilityId).order("name"),
  supabase.from("wards").select("id,code,name,floor_id,billing_service_id,status,version").eq("facility_id",facilityId).order("name"),
  supabase.from("beds").select("id,ward_id,code,bed_type,daily_rate,gender_restriction,age_group,isolation_capable,status,version,wards!inner(facility_id)").eq("wards.facility_id",facilityId).order("code").limit(500),
  supabase.from("buildings").select("id,name,floors(id,name)").eq("facility_id",facilityId).order("name"),
  supabase.from("service_catalog").select("id,code,name").eq("organization_id",organizationId).eq("status","active").order("name"),
  supabase.from("procedure_rooms").select("id,room_kind,code,name,status,version").eq("facility_id",facilityId).order("room_kind").order("code")
 ]);
 const floors=(buildings||[]).flatMap(building=>(building.floors||[]).map(floor=>({id:floor.id,name:`${building.name} · ${floor.name}`})));
 const error=facilityError||departmentError||wardError||bedError||procedureRoomError;
 const facilityBeds=(beds||[]).map(row=>({id:row.id,ward_id:row.ward_id,code:row.code,bed_type:row.bed_type,daily_rate:row.daily_rate,gender_restriction:row.gender_restriction,age_group:row.age_group,isolation_capable:row.isolation_capable,status:row.status,version:row.version}));
 return <><PageHeading eyebrow="Facility governance" title="Facility and departments" description="Maintain hospital identity, departments, locations, OR/DR rooms, wards, and ADT-safe bed availability."/>{error?<div className="form-error">Unable to load facility administration: {error.message}</div>:null}{facility&&!error?<FacilityWorkspace facility={facility} departments={departments||[]} wards={wards||[]} beds={facilityBeds} floors={floors} services={services||[]} procedureRooms={procedureRooms||[]}/>:null}</>;
}
