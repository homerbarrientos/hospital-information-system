import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { BillingWorkspace } from "@/components/billing-workspace";
import { BillingClearanceWorkspace } from "@/components/billing-clearance-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function BillingPage(){
 const supabase=await createClient();
 const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;
 if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const today=new Date().toISOString().slice(0,10);
 const[{data:accounts,error:accountError},{data:entries,error:ledgerError},{data:payments,error:paymentError},{data:shifts,error:shiftError},{data:references,error:referenceError},{data:admissions,error:admissionError},{data:cases,error:caseError},{data:coverages,error:coverageError}]=await Promise.all([
  supabase.from("patient_accounts").select("id,patient_id,patients!inner(id,mrn,first_name,last_name)").eq("facility_id",facilityId),
  supabase.from("ledger_entries").select("id,account_id,encounter_id,kind,source_type,description,amount,currency,reverses_entry_id,posted_at,reason,patient_accounts!inner(facility_id,patients!inner(id,mrn,first_name,last_name))").eq("patient_accounts.facility_id",facilityId).order("posted_at",{ascending:false}).limit(1000),
  supabase.from("payments").select("id,shift_id,account_id,receipt_no,payment_method,amount,status,external_reference,posted_at,patient_accounts!inner(facility_id,patients!inner(id,mrn,first_name,last_name))").eq("patient_accounts.facility_id",facilityId).order("posted_at",{ascending:false}).limit(500),
  supabase.from("cashier_shifts").select("id,cashier_id,opened_at,opening_amount,closed_at,expected_amount,actual_amount,status").eq("facility_id",facilityId).order("opened_at",{ascending:false}).limit(50),
  supabase.from("reference_options").select("code,label,reference_groups!inner(code)").eq("reference_groups.code","payment_method").eq("active",true).order("sort_order"),
  supabase.from("admissions").select("id,admission_no,status,encounter_id,encounters!inner(patients!inner(mrn,first_name,last_name),facility_id)").eq("encounters.facility_id",facilityId).order("admitted_at",{ascending:false}).limit(250),
  supabase.from("billing_clearance_summary").select("id,patient_id,admission_id,status,gross_charges,approved_deductions,payments,final_balance,mrn,first_name,last_name,admission_no,admission_status,pending_deductions").eq("facility_id",facilityId).order("created_at",{ascending:false}).limit(250),
  supabase.from("billing_coverage_adjustments").select("id,billing_case_id,coverage_type,reference_no,description,requested_amount,approved_amount,status,requested_at,billing_cases!inner(facility_id)").eq("billing_cases.facility_id",facilityId).order("requested_at",{ascending:false}).limit(500),
 ]);
 const loadError=accountError||ledgerError||paymentError||shiftError||referenceError||admissionError||caseError||coverageError;
 return <><PageHeading eyebrow="Revenue cycle" title="Billing and cashier" description="Post traceable patient charges, apply approved benefits, finalize balances, and issue billing clearance."/>{loadError?<div className="form-error">Unable to load billing data: {loadError.message}</div>:null}<BillingClearanceWorkspace facilityId={facilityId} admissions={admissions||[]} cases={cases||[]} coverages={coverages||[]}/><BillingWorkspace facilityId={facilityId} userId={userId} today={today} accounts={accounts||[]} entries={entries||[]} payments={payments||[]} shifts={shifts||[]} paymentMethods={references||[]}/></>;
}
