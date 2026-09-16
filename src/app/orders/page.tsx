import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { OrdersWorkspace } from "@/components/orders-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function Orders() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;

  const [{ data: patients }, { data: encounters }, { data: orders }, {data:doctorAssignments}] = await Promise.all([
    supabase.from("patients").select("id,mrn,first_name,last_name").order("last_name"),
    supabase.from("encounters").select("id,encounter_no,patient_id,status,service_date,encounter_type,responsible_doctor_id").eq("facility_id", facilityId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(100),
    supabase.from("clinical_orders").select("id,encounter_id,order_no,order_type,priority,status,ordered_at,instructions,version,cancellation_reason,ordering_doctor_id").order("ordered_at", { ascending: false }).limit(100),
    supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id",facilityId).eq("active",true),
  ]);
  const orderIds = (orders || []).map((order) => order.id);
  const { data: items } = orderIds.length
    ? await supabase.from("order_items").select("id,order_id,description,status,charge_on").in("order_id", orderIds)
    : { data: [] };
  const itemIds = (items || []).map((item) => item.id);
  const { data: results } = itemIds.length
    ? await supabase.from("clinical_results").select("id,order_item_id,result_text,status,entered_at,validated_at,correction_reason").in("order_item_id", itemIds).order("entered_at", { ascending: false })
    : { data: [] };

  const doctors=(doctorAssignments||[]).flatMap((row)=>{const doctor=Array.isArray(row.doctors)?row.doctors[0]:row.doctors;return doctor&&doctor.status==="active"?[doctor]:[];});
  return <>
    <PageHeading eyebrow="Diagnostics" title="Orders and results" description="Create clinical requests, manage work status, validate results, and return them to the patient chart."/>
    <OrdersWorkspace patients={patients || []} encounters={encounters || []} orders={orders || []} items={items || []} results={results || []} doctors={doctors}/>
  </>;
}
