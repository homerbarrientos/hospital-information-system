import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { ClinicalRegistryWorkspace } from "@/components/clinical-registry-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function ClinicalRegistryPage(){
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const{data:facility}=await supabase.from("facilities").select("organization_id").eq("id",facilityId).single();
 const[{data:catalog},{data:encounters},{data:assignments},{data:doctorRows},{data:fees},{data:census}]=await Promise.all([
  supabase.from("diagnosis_catalog").select("id,code_system,code,title,chapter,category,disease_class,clinical_course,reportable,philhealth_case_rate_code,source_version,status,version").eq("organization_id",facility?.organization_id).order("code").limit(1000),
  supabase.from("encounters").select("id,encounter_no,encounter_type,status,service_date,patient_id").eq("facility_id",facilityId).order("service_date",{ascending:false}).limit(200),
  supabase.from("encounter_care_team").select("id,encounter_id,doctor_id,role,is_primary,assigned_from,assigned_to,fee_schedule_id,professional_fee,status,notes,version").order("assigned_from",{ascending:false}).limit(1000),
  supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id",facilityId).eq("active",true),
  supabase.from("doctor_fee_schedules").select("id,doctor_id,service_id,encounter_type,room_type,standard_amount,active").eq("facility_id",facilityId).eq("active",true).limit(500),
  supabase.from("disease_census").select("census_month,encounter_type,code,description,chapter,category,disease_class,clinical_course,reportable,classification,verification_status,encounter_count,patient_count,male_patients,female_patients").eq("facility_id",facilityId).order("census_month",{ascending:false}).limit(500)
 ]);
 const encounterIds=(encounters||[]).map(item=>item.id),patientIds=[...new Set((encounters||[]).map(item=>item.patient_id))];
 const[{data:diagnoses},{data:patients},{data:vitals}]=await Promise.all([
  encounterIds.length?supabase.from("diagnoses").select("id,encounter_id,diagnosis_catalog_id,code_system,code,description,classification,verification_status,clinical_status,present_on_admission,is_comorbidity,is_complication,onset_date,resolved_at,version,created_at").in("encounter_id",encounterIds).order("created_at",{ascending:false}):Promise.resolve({data:[]}),
  patientIds.length?supabase.from("patients").select("id,mrn,first_name,last_name,birth_date,sex_at_birth").in("id",patientIds):Promise.resolve({data:[]}),
  encounterIds.length?supabase.from("vital_observations").select("encounter_id,code,value,unit,observed_at").in("encounter_id",encounterIds).order("observed_at",{ascending:false}).limit(1000):Promise.resolve({data:[]})
 ]);
 const doctors=(doctorRows||[]).flatMap(row=>{const doctor=Array.isArray(row.doctors)?row.doctors[0]:row.doctors;return doctor&&doctor.status==="active"?[doctor]:[]});
 return <><PageHeading eyebrow="Clinical intelligence foundation" title="Diagnosis, care team, and disease registry" description="Maintain structured diagnoses, multiple doctors per encounter, patient timelines, and hospital disease classifications—the governed data foundation for future AI assistance."/><ClinicalRegistryWorkspace facilityId={facilityId} catalog={catalog||[]} encounters={encounters||[]} diagnoses={diagnoses||[]} assignments={assignments||[]} patients={patients||[]} doctors={doctors} fees={fees||[]} vitals={vitals||[]} census={census||[]}/></>;
}
