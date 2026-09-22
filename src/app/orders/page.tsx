import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { OrdersWorkspace } from "@/components/orders-workspace";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;
const activeOrderStatuses = ["requested", "acknowledged", "collected", "in_progress", "completed", "validated"];
const orderStatusFilters = new Set([...activeOrderStatuses, "active", "released", "cancelled", "all"]);
const cleanTerm = (value: string) => value.replace(/[,%()]/g, " ").trim().slice(0, 100);

export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = cleanTerm(params.q || "");
  const status = orderStatusFilters.has(params.status || "") ? String(params.status) : "active";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? String(params.date) : "";
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;

  let matchingPatientIds: string[] | null = null;
  if (query) {
    const { data: matches } = await supabase
      .from("patients")
      .select("id")
      .or(`mrn.ilike.%${query}%,first_name.ilike.%${query}%,middle_name.ilike.%${query}%,last_name.ilike.%${query}%`)
      .limit(500);
    matchingPatientIds = (matches || []).map((patient) => patient.id);
  }

  let ordersQuery = supabase
    .from("clinical_orders")
    .select("id,encounter_id,order_no,order_type,priority,status,ordered_at,instructions,version,cancellation_reason,ordering_doctor_id,encounters!inner(id,facility_id,patient_id,encounter_no,status,service_date,encounter_type,responsible_doctor_id,patients(id,mrn,first_name,last_name)),order_items(id,order_id,service_id,description,status,charge_on,clinical_results(id,order_item_id,result_text,status,entered_at,validated_at,correction_reason))", { count: "exact" })
    .eq("encounters.facility_id", facilityId)
    .order("ordered_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (status === "active") ordersQuery = ordersQuery.in("status", activeOrderStatuses);
  else if (status !== "all") ordersQuery = ordersQuery.eq("status", status);
  if (matchingPatientIds) {
    ordersQuery = matchingPatientIds.length
      ? ordersQuery.in("encounters.patient_id", matchingPatientIds)
      : ordersQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (date) ordersQuery = ordersQuery.gte("ordered_at", `${date}T00:00:00`).lt("ordered_at", `${date}T23:59:59.999`);

  const [{ data: orders, error: ordersError, count }, { data: doctorAssignments }, { data: referenceOptions }] = await Promise.all([
    ordersQuery,
    supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id", facilityId).eq("active", true),
    supabase.from("reference_options").select("code,label,reference_groups!inner(code)").in("reference_groups.code", ["order_type", "order_priority", "order_charge_trigger"]).eq("active", true).order("sort_order"),
  ]);

  const loadedOrders=orders||[];
  const encounterRows=loadedOrders.flatMap(order=>{
    const encounter=Array.isArray(order.encounters)?order.encounters[0]:order.encounters;
    if(!encounter)return[];
    return[{id:encounter.id,encounter_no:encounter.encounter_no,patient_id:encounter.patient_id,status:encounter.status,service_date:encounter.service_date,encounter_type:encounter.encounter_type,responsible_doctor_id:encounter.responsible_doctor_id}];
  });
  const patientRows=loadedOrders.flatMap(order=>{
    const encounter=Array.isArray(order.encounters)?order.encounters[0]:order.encounters;
    if(!encounter)return[];
    const patient=Array.isArray(encounter.patients)?encounter.patients[0]:encounter.patients;
    return patient?[patient]:[];
  });
  const items=loadedOrders.flatMap(order=>order.order_items||[]);
  const results=items.flatMap(item=>item.clinical_results||[]).sort((left,right)=>new Date(right.entered_at).getTime()-new Date(left.entered_at).getTime());
  const encounters=[...new Map(encounterRows.map(encounter=>[encounter.id,encounter])).values()];
  const patients=[...new Map(patientRows.map(patient=>[patient.id,patient])).values()];
  const orderRows=loadedOrders.map(order=>({id:order.id,encounter_id:order.encounter_id,order_no:order.order_no,order_type:order.order_type,priority:order.priority,status:order.status,ordered_at:order.ordered_at,instructions:order.instructions,version:order.version,cancellation_reason:order.cancellation_reason,ordering_doctor_id:order.ordering_doctor_id}));
  const itemRows=items.map(item=>({id:item.id,order_id:item.order_id,service_id:item.service_id,description:item.description,status:item.status,charge_on:item.charge_on}));

  const doctors = (doctorAssignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor && doctor.status === "active" ? [doctor] : [];
  });

  return <>
    <PageHeading eyebrow="Diagnostics" title="Orders and results" description="Create clinical requests, manage work status, validate results, and return them to the patient chart."/>
    {ordersError && <div className="form-error">Unable to load clinical orders: {ordersError.message}</div>}
    <OrdersWorkspace
      patients={patients || []}
      encounters={encounters || []}
      orders={orderRows}
      items={itemRows}
      results={results}
      doctors={doctors}
      referenceOptions={referenceOptions || []}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </>;
}
