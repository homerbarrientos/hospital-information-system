"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FacilityState={ok:boolean;message:string};
const initialFail=(message:string):FacilityState=>({ok:false,message});
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const uuidOrNull=(form:FormData,key:string)=>value(form,key)||null;

async function call(name:string,args:Record<string,unknown>,success:string){
 const supabase=await createClient();const{error}=await supabase.rpc(name,args);
 if(error)return initialFail(error.message);revalidatePath("/administration/facilities");return{ok:true,message:success};
}

export async function saveFacility(_:FacilityState,form:FormData){
 if(value(form,"name").length<3||value(form,"reason").length<5)return initialFail("Enter the facility name and a reason of at least five characters.");
 return call("save_facility_profile",{target_facility:value(form,"facility_id"),facility_name:value(form,"name"),facility_level:value(form,"level"),facility_timezone:value(form,"timezone"),facility_address:value(form,"address"),facility_phone:value(form,"phone"),facility_email:value(form,"email"),facility_license:value(form,"license_no"),expected_version:Number(value(form,"version")),change_reason:value(form,"reason")},"Facility profile updated with audit history.");
}

export async function saveDepartment(_:FacilityState,form:FormData){
 if(value(form,"code").length<2||value(form,"name").length<2)return initialFail("Enter a valid department code and name.");
 const editing=Boolean(value(form,"department_id"));
 return call("save_department",{target_facility:value(form,"facility_id"),target_department:uuidOrNull(form,"department_id"),department_code:value(form,"code"),department_name:value(form,"name"),department_location:value(form,"location"),department_contact:value(form,"contact_no"),department_hours:value(form,"operating_hours"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")},editing?"Department updated.":"Department created.");
}

export async function changeDepartmentStatus(_:FacilityState,form:FormData){
 return call("set_department_status",{target_facility:value(form,"facility_id"),target_department:value(form,"department_id"),next_status:value(form,"status"),change_reason:value(form,"reason")},"Department status updated.");
}

export async function saveWard(_:FacilityState,form:FormData){
 if(value(form,"code").length<2||value(form,"name").length<2)return initialFail("Enter a valid ward code and name.");
 const editing=Boolean(value(form,"ward_id"));
 return call("save_ward",{target_facility:value(form,"facility_id"),target_ward:uuidOrNull(form,"ward_id"),ward_code:value(form,"code"),ward_name:value(form,"name"),target_floor:uuidOrNull(form,"floor_id"),target_billing_service:uuidOrNull(form,"billing_service_id"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")},editing?"Ward updated.":"Ward created.");
}

export async function changeWardStatus(_:FacilityState,form:FormData){
 return call("set_ward_status",{target_facility:value(form,"facility_id"),target_ward:value(form,"ward_id"),next_status:value(form,"status"),change_reason:value(form,"reason")},"Ward status updated.");
}

export async function saveBed(_:FacilityState,form:FormData){
 if(!value(form,"ward_id")||!value(form,"code"))return initialFail("Select a ward and enter a bed code.");
 const editing=Boolean(value(form,"bed_id"));
 return call("save_bed",{target_facility:value(form,"facility_id"),target_bed:uuidOrNull(form,"bed_id"),target_ward:value(form,"ward_id"),bed_code:value(form,"code"),bed_type_name:value(form,"bed_type"),bed_daily_rate:Number(value(form,"daily_rate")||0),bed_gender:value(form,"gender_restriction")||"any",bed_age_group:value(form,"age_group")||"any",bed_isolation:value(form,"isolation_capable")==="on",next_status:value(form,"status")||"available",expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")},editing?"Bed updated.":"Bed created.");
}

export async function saveProcedureRoom(_:FacilityState,form:FormData){
 if(!["OR","DR"].includes(value(form,"room_kind"))||value(form,"code").length<2||value(form,"name").length<2)return initialFail("Choose OR or DR and enter a room code and name.");
 const editing=Boolean(value(form,"room_id"));
 const result=await call("save_procedure_room",{target_facility:value(form,"facility_id"),target_room:uuidOrNull(form,"room_id"),target_kind:value(form,"room_kind"),room_code:value(form,"code"),room_label:value(form,"name"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")},editing?"Room updated.":"Room created.");
 if(result.ok){revalidatePath("/operations/or");revalidatePath("/operations/dr");}return result;
}

export async function changeProcedureRoomStatus(_:FacilityState,form:FormData){
 const result=await call("set_procedure_room_status",{target_facility:value(form,"facility_id"),target_room:value(form,"room_id"),next_status:value(form,"status"),change_reason:value(form,"reason")},"Room status updated.");
 if(result.ok){revalidatePath("/operations/or");revalidatePath("/operations/dr");}return result;
}
