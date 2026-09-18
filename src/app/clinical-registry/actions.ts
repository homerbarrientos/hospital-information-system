"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RegistryState={ok:boolean;message:string};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const nullable=(form:FormData,key:string)=>value(form,key)||null;
const fail=(message:string):RegistryState=>({ok:false,message});
const done=(message:string):RegistryState=>({ok:true,message});
const refresh=()=>{revalidatePath("/clinical-registry");revalidatePath("/clinical");revalidatePath("/reports")};
const parseCsv=(source:string)=>{const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;for(let index=0;index<source.length;index++){const char=source[index],next=source[index+1];if(char==='"'&&quoted&&next==='"'){cell+='"';index++}else if(char==='"'){quoted=!quoted}else if(char===','&&!quoted){row.push(cell.trim());cell=""}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')index++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=""}else cell+=char}row.push(cell.trim());if(row.some(Boolean))rows.push(row);if(rows.length<2)return[];const headers=rows[0].map(item=>item.toLowerCase().replace(/[^a-z0-9]+/g,"_"));return rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]||""])))};

export async function saveDiagnosisMaster(_:RegistryState,form:FormData):Promise<RegistryState>{
 const code=value(form,"code"),title=value(form,"title");if(code.length<2||title.length<3)return fail("Enter a valid diagnosis code and title.");
 const supabase=await createClient();const{error}=await supabase.rpc("save_diagnosis_master",{target_facility:value(form,"facility_id"),target_diagnosis:nullable(form,"diagnosis_id"),diagnosis_code:code,diagnosis_title:title,diagnosis_chapter:value(form,"chapter"),diagnosis_category:value(form,"category"),disease_classification:value(form,"disease_class"),course_classification:value(form,"clinical_course"),is_reportable:value(form,"reportable")==="on",case_rate_code:value(form,"case_rate_code"),source_version_name:value(form,"source_version"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")});
 if(error)return fail(error.message);refresh();return done(value(form,"diagnosis_id")?"Diagnosis master record updated.":"Diagnosis master record created.");
}

export async function setDiagnosisMasterStatus(_:RegistryState,form:FormData):Promise<RegistryState>{
 const reason=value(form,"reason");if(reason.length<5)return fail("Enter a reason of at least five characters.");const supabase=await createClient();const{error}=await supabase.rpc("set_diagnosis_master_status",{target_facility:value(form,"facility_id"),target_diagnosis:value(form,"diagnosis_id"),next_status:value(form,"next_status"),change_reason:reason});if(error)return fail(error.message);refresh();return done("Diagnosis master status updated.");
}

export async function saveEncounterDiagnosis(_:RegistryState,form:FormData):Promise<RegistryState>{
 if(!value(form,"encounter_id")||!value(form,"catalog_id"))return fail("Select an encounter and diagnosis.");const supabase=await createClient();const{error}=await supabase.rpc("save_encounter_diagnosis",{target_encounter:value(form,"encounter_id"),target_record:nullable(form,"record_id"),target_catalog:value(form,"catalog_id"),diagnosis_description:value(form,"description"),diagnosis_classification:value(form,"classification"),diagnosis_verification:value(form,"verification_status"),present_at_admission:value(form,"present_on_admission")==="on",comorbidity:value(form,"is_comorbidity")==="on",complication:value(form,"is_complication")==="on",diagnosis_onset:nullable(form,"onset_date"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")});if(error)return fail(error.message);refresh();return done(value(form,"record_id")?"Encounter diagnosis updated.":"Encounter diagnosis added.");
}

export async function resolveEncounterDiagnosis(_:RegistryState,form:FormData):Promise<RegistryState>{
 const reason=value(form,"reason");if(reason.length<5)return fail("Enter a resolution reason of at least five characters.");const supabase=await createClient();const{error}=await supabase.rpc("resolve_encounter_diagnosis",{target_diagnosis:value(form,"diagnosis_id"),resolution_reason:reason});if(error)return fail(error.message);refresh();return done("Diagnosis marked resolved with audit history.");
}

export async function saveCareTeamMember(_:RegistryState,form:FormData):Promise<RegistryState>{
 if(!value(form,"encounter_id")||!value(form,"doctor_id"))return fail("Select an encounter and doctor.");const rawFee=value(form,"professional_fee"),fee=rawFee===""?null:Number(rawFee);if(fee!==null&&(!Number.isFinite(fee)||fee<0))return fail("Enter a valid professional fee.");const supabase=await createClient();const{error}=await supabase.rpc("save_care_team_member",{target_encounter:value(form,"encounter_id"),target_assignment:nullable(form,"assignment_id"),target_doctor:value(form,"doctor_id"),doctor_role:value(form,"role"),primary_doctor:value(form,"is_primary")==="on",fee_schedule:nullable(form,"fee_schedule_id"),fee_amount:fee,assignment_notes:value(form,"notes"),expected_version:Number(value(form,"version")||0),change_reason:value(form,"reason")});if(error)return fail(error.message);refresh();return done(value(form,"assignment_id")?"Care-team assignment updated.":"Doctor added to the encounter care team.");
}

export async function endCareTeamAssignment(_:RegistryState,form:FormData):Promise<RegistryState>{
 const reason=value(form,"reason");if(reason.length<5)return fail("Enter an end-assignment reason of at least five characters.");const supabase=await createClient();const{error}=await supabase.rpc("end_care_team_assignment",{target_assignment:value(form,"assignment_id"),end_reason:reason});if(error)return fail(error.message);refresh();return done("Care-team assignment completed with audit history.");
}

export async function importDiagnosisBatch(_:RegistryState,form:FormData):Promise<RegistryState>{
 const file=form.get("file");if(!(file instanceof File)||file.size===0)return fail("Select a CSV file.");if(file.size>5_000_000)return fail("CSV file must not exceed 5 MB.");const rows=parseCsv(await file.text());if(!rows.length)return fail("The CSV must contain a header row and at least one diagnosis.");if(rows.length>20_000)return fail("Import is limited to 20,000 rows per file.");const supabase=await createClient();let imported=0,updated=0,skipped=0;for(let index=0;index<rows.length;index+=500){const{data,error}=await supabase.rpc("import_diagnosis_master_batch",{target_facility:value(form,"facility_id"),rows_json:rows.slice(index,index+500),source_name:value(form,"source_name")});if(error)return fail(`Import stopped at row ${index+2}: ${error.message}`);const result=data as{imported?:number;updated?:number;skipped?:number};imported+=result.imported||0;updated+=result.updated||0;skipped+=result.skipped||0}refresh();return done(`Import complete: ${imported} added, ${updated} updated, ${skipped} skipped.`);
}

export async function approveProfessionalFee(_:RegistryState,form:FormData):Promise<RegistryState>{
 const reason=value(form,"reason");if(reason.length<5)return fail("Enter an approval reason of at least five characters.");const supabase=await createClient();const{error}=await supabase.rpc("approve_professional_fee",{target_assignment:value(form,"assignment_id"),approval_reason:reason});if(error)return fail(error.message);refresh();revalidatePath("/billing");return done("Professional fee approved and posted to the patient ledger.");
}
