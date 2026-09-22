import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { TemplatesSettingsWorkspace } from "@/components/templates-settings-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function TemplatesSettingsPage(){
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:assignments}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=assignments?.[0]?.facility_id;if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const[{data:templates,error:templateError},{data:settings,error:settingError}]=await Promise.all([
  supabase.from("facility_templates").select("id,code,name,category,description,content,status,version").eq("facility_id",facilityId).order("name"),
  supabase.from("facility_settings").select("id,setting_key,category,label,setting_value,description,version,updated_at").eq("facility_id",facilityId).order("category").order("label")
 ]);
 const error=templateError||settingError;
 return <><PageHeading eyebrow="Controlled configuration" title="Templates and settings" description="Maintain versioned templates, numbering rules, notification behavior, and clinical facility defaults."/>{error?<div className="form-error">Unable to load templates and settings: {error.message}</div>:null}<TemplatesSettingsWorkspace facilityId={facilityId} templates={templates||[]} settings={settings||[]}/></>;
}
