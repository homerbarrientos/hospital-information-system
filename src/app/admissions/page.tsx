import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { AdtWorkspace } from "@/components/adt-workspace";
import { createClient } from "@/lib/supabase/server";

type Patient={id:string;mrn:string;first_name:string;last_name:string};
type Encounter={id:string;patient_id:string;responsible_doctor_id:string|null;patients:Patient|Patient[]};
type Stay={admission_id:string;bed_id:string;ended_at:string|null};
type AdmissionRow={id:string;encounter_id:string;admission_no:string;status:string;admitted_at:string;admitting_doctor_id:string|null;attending_doctor_id:string|null;encounters:Encounter|Encounter[];bed_stays:Omit<Stay,"admission_id">|Omit<Stay,"admission_id">[]};
const one=<T,>(value:T|T[])=>Array.isArray(value)?value[0]:value;

export default async function Admissions(){
 const supabase=await createClient();
 const{data}=await supabase.auth.getClaims();const userId=data?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;
 if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const[{data:wards},{data:rooms},{data:beds},{data:admissionRows},{data:doctorAssignments},{data:dispositions},{data:billingCases}]=await Promise.all([
  supabase.from("wards").select("id,name").eq("facility_id",facilityId),
  supabase.from("rooms").select("id,ward_id,code,name,room_type,wards!inner(facility_id)").eq("wards.facility_id",facilityId),
  supabase.from("beds").select("id,code,status,ward_id,room_id,bed_type,daily_rate,wards!inner(facility_id)").eq("wards.facility_id",facilityId),
  supabase.from("admissions").select("id,encounter_id,admission_no,status,admitted_at,admitting_doctor_id,attending_doctor_id,encounters!inner(id,patient_id,responsible_doctor_id,facility_id,patients!inner(id,mrn,first_name,last_name)),bed_stays(bed_id,ended_at)").eq("encounters.facility_id",facilityId).order("admitted_at",{ascending:false}).limit(250),
  supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id",facilityId).eq("active",true),
  supabase.from("reference_options").select("code,label,reference_groups!inner(code)").eq("reference_groups.code","discharge_disposition").eq("active",true).order("sort_order"),
  supabase.from("billing_cases").select("admission_id,status,final_balance").eq("facility_id",facilityId),
 ]);
 const rows=(admissionRows||[]) as unknown as AdmissionRow[];
 const encounters=rows.flatMap(row=>{const encounter=one(row.encounters);return encounter?[{id:encounter.id,patient_id:encounter.patient_id,responsible_doctor_id:encounter.responsible_doctor_id}]:[]});
 const patients=[...new Map(rows.flatMap(row=>{const encounter=one(row.encounters),patient=encounter?one(encounter.patients):undefined;return patient?[[patient.id,patient] as const]:[]})).values()];
 const stays=rows.flatMap(row=>{const items=Array.isArray(row.bed_stays)?row.bed_stays:row.bed_stays?[row.bed_stays]:[];return items.map(stay=>({...stay,admission_id:row.id}))});
 const admissions=rows.map(row=>({id:row.id,encounter_id:row.encounter_id,admission_no:row.admission_no,status:row.status,admitted_at:row.admitted_at,admitting_doctor_id:row.admitting_doctor_id,attending_doctor_id:row.attending_doctor_id}));
 const doctors=(doctorAssignments||[]).flatMap(row=>{const doctor=Array.isArray(row.doctors)?row.doctors[0]:row.doctors;return doctor&&doctor.status==="active"?[doctor]:[]});
 return <><PageHeading eyebrow="Patient movement" title="Admission, discharge and transfer" description="Track every ward, room, bed, transfer, and discharge without overwriting movement history."/><AdtWorkspace patients={patients} wards={wards||[]} rooms={rooms||[]} beds={beds||[]} encounters={encounters} admissions={admissions} stays={stays} facilityId={facilityId} doctors={doctors} dispositions={dispositions||[]} billingCases={billingCases||[]}/></>;
}
