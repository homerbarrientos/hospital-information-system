import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { WorkflowApprovalsWorkspace } from "@/components/workflow-approvals-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function WorkflowApprovalsPage(){
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:assignments}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=assignments?.[0]?.facility_id;if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const{data:requests,error}=await supabase.from("workflow_requests").select("id,request_type,subject,object_type,object_id,request_details,reason,status,requested_by,requested_at,decided_by,decided_at,decision_reason,version,requester:profiles!workflow_requests_requested_by_fkey(full_name,employee_no),decider:profiles!workflow_requests_decided_by_fkey(full_name,employee_no)").eq("facility_id",facilityId).order("requested_at",{ascending:false}).limit(500);
 return <><PageHeading eyebrow="Governed decisions" title="Workflow approvals" description="Review merge, discount, void, refund, and publication requests with explicit reasons and immutable audit events."/>{error?<div className="form-error">Unable to load approval queue: {error.message}</div>:null}<WorkflowApprovalsWorkspace facilityId={facilityId} requests={(requests||[]).map(row=>({...row,requester:Array.isArray(row.requester)?row.requester[0]:row.requester,decider:Array.isArray(row.decider)?row.decider[0]:row.decider}))}/></>;
}
