"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SettingsState={ok:boolean;message:string};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const fail=(message:string):SettingsState=>({ok:false,message});
async function call(name:string,args:Record<string,unknown>,success:string){const supabase=await createClient();const{error}=await supabase.rpc(name,args);if(error)return fail(error.message);revalidatePath("/administration/templates-settings");return{ok:true,message:success};}

export async function saveTemplate(_:SettingsState,form:FormData):Promise<SettingsState>{
 if(value(form,"code").length<2||value(form,"name").length<3||value(form,"content").length<3)return fail("Complete the template code, name, category, and content.");
 const editing=Boolean(value(form,"template_id"));
 return call("save_facility_template",{target_facility:value(form,"facility_id"),target_template:value(form,"template_id")||null,template_code:value(form,"code"),template_name:value(form,"name"),template_category:value(form,"category"),template_description:value(form,"description"),template_content:value(form,"content"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")},editing?"Template updated.":"Template created.");
}

export async function changeTemplateStatus(_:SettingsState,form:FormData):Promise<SettingsState>{
 return call("set_facility_template_status",{target_facility:value(form,"facility_id"),target_template:value(form,"template_id"),next_status:value(form,"status"),change_reason:value(form,"reason")},"Template status updated.");
}

export async function saveSetting(_:SettingsState,form:FormData):Promise<SettingsState>{
 if(value(form,"label").length<3||!value(form,"setting_value")||value(form,"reason").length<5)return fail("Enter a label, value, and a reason of at least five characters.");
 return call("save_facility_setting",{target_facility:value(form,"facility_id"),target_setting:value(form,"setting_id"),setting_label:value(form,"label"),setting_value:value(form,"setting_value"),expected_version:Number(value(form,"version")),change_reason:value(form,"reason")},"Setting updated with audit history.");
}
