import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { ChargeMasterWorkspace } from "@/components/charge-master-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function ChargeMasterPage(){
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const{data:facility}=await supabase.from("facilities").select("organization_id").eq("id",facilityId).single();
 const[{data:charges},{data:prices},{data:fees},{data:doctors},{data:departments},{data:categories},{data:adjustments}]=await Promise.all([
  supabase.from("service_catalog").select("id,code,name,category,department_id,unit_of_measure,revenue_class,billable,allow_price_override,requires_override_approval,status,version").eq("organization_id",facility?.organization_id).order("name").limit(500),
  supabase.from("service_prices").select("service_id,amount,minimum_amount,maximum_amount,effective_from,effective_to").eq("facility_id",facilityId).is("effective_to",null),
  supabase.from("doctor_fee_schedules").select("id,doctor_id,service_id,encounter_type,room_type,standard_amount,minimum_amount,maximum_amount,hospital_share_percent,effective_from,active,version").eq("facility_id",facilityId).order("effective_from",{ascending:false}).limit(500),
  supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id",facilityId).eq("active",true),
  supabase.from("departments").select("id,name").eq("facility_id",facilityId).eq("status","active").order("name"),
  supabase.from("reference_options").select("code,label,reference_groups!inner(code)").eq("reference_groups.code","service_category").eq("active",true).order("sort_order"),
  supabase.from("billing_adjustment_requests").select("id,ledger_entry_id,original_amount,proposed_amount,adjustment_amount,reason,status,requested_at,ledger_entries(description,account_id,patient_accounts(patients(mrn,first_name,last_name)))").eq("facility_id",facilityId).order("requested_at",{ascending:false}).limit(200)
 ]);
 const activeDoctors=(doctors||[]).flatMap(row=>{const doctor=Array.isArray(row.doctors)?row.doctors[0]:row.doctors;return doctor&&doctor.status==="active"?[doctor]:[]});
 return <><PageHeading eyebrow="Revenue configuration" title="Hospital charge master" description="Maintain one governed price list, professional fee schedules, effective dates, and controlled billing adjustments."/><ChargeMasterWorkspace facilityId={facilityId} charges={charges||[]} prices={prices||[]} fees={fees||[]} doctors={activeDoctors} departments={departments||[]} categories={categories||[]} adjustments={adjustments||[]}/></>;
}
