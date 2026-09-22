"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type WorkflowState={ok:boolean;message:string};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const fail=(message:string):WorkflowState=>({ok:false,message});

export async function submitWorkflowRequest(_:WorkflowState,form:FormData):Promise<WorkflowState>{
 if(value(form,"subject").length<3||value(form,"reason").length<5)return fail("Enter a subject and a reason of at least five characters.");
 const supabase=await createClient();const{error}=await supabase.rpc("submit_workflow_request",{target_facility:value(form,"facility_id"),workflow_type:value(form,"request_type"),request_subject:value(form,"subject"),related_type:value(form,"object_type"),related_id:value(form,"object_id")||null,details:value(form,"details"),request_reason:value(form,"reason")});
 if(error)return fail(error.message);revalidatePath("/administration/workflow-approvals");return{ok:true,message:"Approval request submitted and audited."};
}

export async function decideWorkflowRequest(_:WorkflowState,form:FormData):Promise<WorkflowState>{
 if(!["approved","rejected"].includes(value(form,"decision"))||value(form,"reason").length<5)return fail("Select a decision and enter a reason of at least five characters.");
 const supabase=await createClient();const{error}=await supabase.rpc("decide_workflow_request",{target_request:value(form,"request_id"),decision:value(form,"decision"),decision_notes:value(form,"reason"),expected_version:Number(value(form,"version"))});
 if(error)return fail(error.message);revalidatePath("/administration/workflow-approvals");return{ok:true,message:`Request ${value(form,"decision")}.`};
}
