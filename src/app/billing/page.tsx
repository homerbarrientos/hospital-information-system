import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { BillingWorkspace } from "@/components/billing-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function BillingPage(){
 const supabase=await createClient();
 const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;
 if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const today=new Date().toISOString().slice(0,10);
 const[{data:accounts,error:accountError},{data:entries,error:ledgerError},{data:payments,error:paymentError},{data:shifts,error:shiftError},{data:references,error:referenceError}]=await Promise.all([
  supabase.from("patient_accounts").select("id,patient_id,patients!inner(id,mrn,first_name,last_name)").eq("facility_id",facilityId),
  supabase.from("ledger_entries").select("id,account_id,encounter_id,kind,source_type,description,amount,currency,reverses_entry_id,posted_at,reason,patient_accounts!inner(facility_id,patients!inner(id,mrn,first_name,last_name))").eq("patient_accounts.facility_id",facilityId).order("posted_at",{ascending:false}).limit(1000),
  supabase.from("payments").select("id,account_id,receipt_no,payment_method,amount,status,external_reference,posted_at,patient_accounts!inner(facility_id,patients!inner(id,mrn,first_name,last_name))").eq("patient_accounts.facility_id",facilityId).order("posted_at",{ascending:false}).limit(500),
  supabase.from("cashier_shifts").select("id,cashier_id,opened_at,opening_amount,closed_at,expected_amount,actual_amount,status").eq("facility_id",facilityId).order("opened_at",{ascending:false}).limit(50),
  supabase.from("reference_options").select("code,label,reference_groups!inner(code)").eq("reference_groups.code","payment_method").eq("active",true).order("sort_order"),
 ]);
 const loadError=accountError||ledgerError||paymentError||shiftError||referenceError;
 return <><PageHeading eyebrow="Revenue cycle" title="Billing and cashier" description="Post traceable patient charges, collect and allocate payments, and reconcile cashier shifts."/>{loadError?<div className="form-error">Unable to load billing data: {loadError.message}</div>:null}<BillingWorkspace facilityId={facilityId} userId={userId} today={today} accounts={accounts||[]} entries={entries||[]} payments={payments||[]} shifts={shifts||[]} paymentMethods={references||[]}/></>;
}
