"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ChargeMasterState={ok:boolean;message:string};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const numberOrNull=(form:FormData,key:string)=>{const raw=value(form,key);return raw===""?null:Number(raw)};
const done=(message:string):ChargeMasterState=>({ok:true,message});
const fail=(message:string):ChargeMasterState=>({ok:false,message});

export async function saveChargeItem(_:ChargeMasterState,form:FormData):Promise<ChargeMasterState>{
 const supabase=await createClient();
 const serviceId=value(form,"service_id")||null,amount=Number(value(form,"standard_amount"));
 if(!value(form,"facility_id")||value(form,"code").length<2||value(form,"name").length<2||!Number.isFinite(amount)||amount<0)return fail("Complete the charge code, name, category, and valid standard price.");
 const{error}=await supabase.rpc("save_charge_master_item",{target_facility:value(form,"facility_id"),target_service:serviceId,service_code:value(form,"code"),service_name:value(form,"name"),service_category:value(form,"category"),department:value(form,"department_id")||null,unit_name:value(form,"unit_of_measure")||"service",revenue_type:value(form,"revenue_class")||"hospital",is_billable:value(form,"billable")==="on",standard_amount:amount,minimum_price:numberOrNull(form,"minimum_amount"),maximum_price:numberOrNull(form,"maximum_amount"),allow_override:value(form,"allow_override")==="on",approval_required:value(form,"requires_approval")==="on",expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")});
 if(error)return fail(error.message);revalidatePath("/administration/charge-master");revalidatePath("/administration/services");return done(serviceId?"Charge item updated with audit history.":"Charge item created.");
}

export async function saveDoctorFee(_:ChargeMasterState,form:FormData):Promise<ChargeMasterState>{
 const supabase=await createClient(),amount=Number(value(form,"standard_amount"));
 if(!value(form,"doctor_id")||!Number.isFinite(amount)||amount<0)return fail("Select a doctor and enter a valid standard fee.");
 const{error}=await supabase.rpc("save_doctor_fee_schedule",{target_facility:value(form,"facility_id"),target_schedule:value(form,"schedule_id")||null,target_doctor:value(form,"doctor_id"),target_service:value(form,"service_id")||null,fee_encounter_type:value(form,"encounter_type")||"all",fee_room_type:value(form,"room_type")||"all",standard_amount:amount,minimum_price:numberOrNull(form,"minimum_amount"),maximum_price:numberOrNull(form,"maximum_amount"),hospital_share:Number(value(form,"hospital_share")||0),effective_date:value(form,"effective_from")||new Date().toISOString().slice(0,10),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")});
 if(error)return fail(error.message);revalidatePath("/administration/charge-master");return done(value(form,"schedule_id")?"Doctor fee schedule updated.":"Doctor fee schedule created.");
}

export async function decideAdjustment(_:ChargeMasterState,form:FormData):Promise<ChargeMasterState>{
 const supabase=await createClient(),decision=value(form,"decision");
 if(!["approved","rejected"].includes(decision)||value(form,"reason").length<5)return fail("Select a decision and provide at least five characters for the reason.");
 const{error}=await supabase.rpc("decide_charge_adjustment",{target_request:value(form,"request_id"),decision,decision_notes:value(form,"reason")});
 if(error)return fail(error.message);revalidatePath("/administration/charge-master");revalidatePath("/billing");return done(`Adjustment ${decision}.`);
}

export async function setMasterRecordStatus(_:ChargeMasterState,form:FormData):Promise<ChargeMasterState>{
 const supabase=await createClient(),recordType=value(form,"record_type"),makeActive=value(form,"make_active")==="true",reason=value(form,"reason");
 if(!value(form,"record_id")||!['charge','doctor_fee'].includes(recordType)||reason.length<5)return fail("Select a record and enter a reason of at least five characters.");
 const{error}=await supabase.rpc("set_charge_master_status",{target_facility:value(form,"facility_id"),target_record:value(form,"record_id"),record_type:recordType,make_active:makeActive,change_reason:reason});
 if(error)return fail(error.message);revalidatePath("/administration/charge-master");return done(makeActive?"Master record activated.":"Master record deactivated with audit history.");
}
