"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
export type MedicineState={ok:boolean;message:string};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
async function call(name:string,args:Record<string,unknown>,message:string):Promise<MedicineState>{const supabase=await createClient();const{error}=await supabase.rpc(name,args);if(error)return{ok:false,message:error.message};revalidatePath("/administration/medicines");return{ok:true,message}}
export async function createMedicine(_:MedicineState,form:FormData){return call("create_medicine",{target_facility:value(form,"facility_id"),medicine_code:value(form,"code"),medicine_name:value(form,"name"),medicine_unit:value(form,"unit"),reorder_quantity:Number(value(form,"reorder_level")||0)},"Medicine added to the master list.")}
export async function updateMedicine(_:MedicineState,form:FormData){if(value(form,"reason").length<5)return{ok:false,message:"Modification reason must contain at least 5 characters."};return call("update_medicine",{target_facility:value(form,"facility_id"),target_product:value(form,"product_id"),medicine_name:value(form,"name"),medicine_unit:value(form,"unit"),reorder_quantity:Number(value(form,"reorder_level")||0),expected_version:Number(value(form,"version")),modification_reason:value(form,"reason")},"Medicine updated.")}
export async function setMedicineStatus(form:FormData){if(value(form,"reason").length<5)return{ok:false,message:"Status reason must contain at least 5 characters."};return call("set_medicine_status",{target_facility:value(form,"facility_id"),target_product:value(form,"product_id"),next_status:value(form,"status"),change_reason:value(form,"reason")},"Medicine status updated.")}
