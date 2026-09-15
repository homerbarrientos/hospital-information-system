"use server";
import{revalidatePath}from"next/cache";import{createClient}from"@/lib/supabase/server";const value=(f:FormData,k:string)=>String(f.get(k)||"").trim();async function call(name:string,args:Record<string,string>){const supabase=await createClient();const{error}=await supabase.rpc(name,args);if(error)throw new Error(error.message);revalidatePath("/admissions")}
export async function admitPatient(form:FormData){await call("admit_patient",{target_facility:value(form,"facility_id"),target_patient:value(form,"patient_id"),target_bed:value(form,"bed_id")})}
export async function transferPatient(form:FormData){await call("transfer_patient",{target_admission:value(form,"admission_id"),target_bed:value(form,"bed_id"),transfer_reason:value(form,"reason")})}
export async function dischargePatient(form:FormData){await call("discharge_patient",{target_admission:value(form,"admission_id"),disposition:value(form,"disposition")})}
