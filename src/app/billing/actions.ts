"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BillingState={ok:boolean;message:string;receiptNo?:string};
export const billingInitial:BillingState={ok:false,message:""};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const fail=(message:string):BillingState=>({ok:false,message});

async function authorizedClient(facilityId:string){
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;
 if(!userId)return{error:"Sign in is required." as string};
 const{data:role}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("facility_id",facilityId).eq("active",true).limit(1).maybeSingle();
 if(!role)return{error:"You are not assigned to this facility." as string};return{supabase,userId};
}
async function callRpc(facilityId:string,name:string,args:Record<string,unknown>,success:string):Promise<BillingState>{
 const auth=await authorizedClient(facilityId);if(!auth.supabase)return fail(auth.error);const{data,error}=await auth.supabase.rpc(name,args);if(error)return fail(error.message);
 revalidatePath("/billing");let receiptNo:string|undefined;if(typeof data==="string"&&name==="post_patient_payment")receiptNo=data;else if(data&&typeof data==="object"&&"receipt_no" in data)receiptNo=String((data as{receipt_no:unknown}).receipt_no);
 return{ok:true,message:receiptNo?`${success} Official receipt ${receiptNo}.`:success,receiptNo};
}
export async function openCashierShift(_:BillingState,form:FormData){const facility=value(form,"facility_id"),amount=Number(value(form,"opening_cash"));if(!facility||!Number.isFinite(amount)||amount<0)return fail("Enter a valid non-negative opening cash amount.");return callRpc(facility,"open_cashier_shift",{target_facility:facility,opening_cash:amount},"Cashier shift opened.");}
export async function closeCashierShift(_:BillingState,form:FormData){const facility=value(form,"facility_id"),amount=Number(value(form,"actual_cash"));if(!value(form,"shift_id")||!Number.isFinite(amount)||amount<0)return fail("Enter a valid non-negative actual cash amount.");return callRpc(facility,"close_cashier_shift",{target_shift:value(form,"shift_id"),actual_cash:amount},"Shift reconciled and closed.");}
export async function postPatientCharge(_:BillingState,form:FormData){const facility=value(form,"facility_id"),amount=Number(value(form,"amount")),description=value(form,"description");if(!value(form,"encounter_id")||description.length<2||!Number.isFinite(amount)||amount<=0)return fail("Select an encounter and enter a description and positive charge amount.");return callRpc(facility,"post_patient_charge",{target_facility:facility,target_encounter:value(form,"encounter_id"),charge_description:description,charge_amount:amount},"Patient charge posted.");}
export async function postPatientPayment(_:BillingState,form:FormData){const facility=value(form,"facility_id"),amount=Number(value(form,"amount"));if(!value(form,"patient_id")||!value(form,"method_code")||!Number.isFinite(amount)||amount<=0)return fail("Select a patient, payment method, and positive payment amount.");const auth=await authorizedClient(facility);if(!auth.supabase)return fail(auth.error);const{data:shift}=await auth.supabase.from("cashier_shifts").select("id").eq("facility_id",facility).eq("cashier_id",auth.userId).eq("status","open").limit(1).maybeSingle();if(!shift)return fail("Open a cashier shift before accepting a payment.");return callRpc(facility,"post_patient_payment",{target_facility:facility,target_patient:value(form,"patient_id"),payment_amount:amount,method_code:value(form,"method_code"),external_ref:value(form,"external_ref")||null},"Payment posted and allocated.");}
export async function reverseLedgerEntry(_:BillingState,form:FormData){const facility=value(form,"facility_id"),reason=value(form,"reason");if(!value(form,"entry_id")||reason.length<5)return fail("A reversal reason of at least five characters is required.");return callRpc(facility,"reverse_ledger_entry",{target_entry:value(form,"entry_id"),reversal_reason:reason},"Ledger entry reversed.");}
