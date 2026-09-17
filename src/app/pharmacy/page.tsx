import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { PharmacyWorkspace } from "@/components/pharmacy-workspace";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;
const activeStatuses = ["ordered", "validated", "partially_dispensed"];
const allowedStatuses = new Set(["active", ...activeStatuses, "dispensed", "cancelled", "all"]);
const cleanTerm = (value: string) => value.replace(/[,%()]/g, " ").trim().slice(0, 100);

export default async function Pharmacy({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = cleanTerm(params.q || "");
  const status = allowedStatuses.has(params.status || "") ? String(params.status) : "active";
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

  let patientIds: string[] | null = null;
  if (query) {
    const { data: matches } = await supabase.from("patients").select("id").or(`mrn.ilike.%${query}%,first_name.ilike.%${query}%,middle_name.ilike.%${query}%,last_name.ilike.%${query}%`).limit(500);
    patientIds = (matches || []).map((patient) => patient.id);
  }
  let prescriptionQuery = supabase
    .from("prescriptions")
    .select("id,encounter_id,prescription_no,status,prescribed_at,prescribing_doctor_id,notes,cancellation_reason,version,encounters!inner(facility_id,patient_id)", { count: "exact" })
    .eq("encounters.facility_id", facilityId)
    .order("prescribed_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (status === "active") prescriptionQuery = prescriptionQuery.in("status", activeStatuses);
  else if (status !== "all") prescriptionQuery = prescriptionQuery.eq("status", status);
  if (patientIds) prescriptionQuery = patientIds.length ? prescriptionQuery.in("encounters.patient_id", patientIds) : prescriptionQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  if (date) prescriptionQuery = prescriptionQuery.gte("prescribed_at", `${date}T00:00:00`).lt("prescribed_at", `${date}T23:59:59.999`);

  const [{ data: prescriptions, error, count }, { data: doctorAssignments }, { data: references }] = await Promise.all([
    prescriptionQuery,
    supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id", facilityId).eq("active", true),
    supabase.from("reference_options").select("code,label,reference_groups!inner(code)").in("reference_groups.code", ["medication_route", "medication_frequency"]).eq("active", true).order("sort_order"),
  ]);

  const prescriptionIds = (prescriptions || []).map((record) => record.id);
  const encounterIds = (prescriptions || []).map((record) => record.encounter_id);
  const [{ data: encounters }, { data: items }, { data: documents }] = await Promise.all([
    encounterIds.length ? supabase.from("encounters").select("id,encounter_no,patient_id,encounter_type,service_date").in("id", encounterIds) : Promise.resolve({ data: [] }),
    prescriptionIds.length ? supabase.from("prescription_items").select("id,prescription_id,product_id,dose,route,frequency,duration,quantity,instructions").in("prescription_id", prescriptionIds) : Promise.resolve({ data: [] }),
    prescriptionIds.length ? supabase.from("prescription_documents").select("id,prescription_id,storage_path,display_name,description,mime_type,size_bytes,uploaded_at").in("prescription_id", prescriptionIds).eq("status", "active").order("uploaded_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const currentPatientIds = [...new Set((encounters || []).map((encounter) => encounter.patient_id))];
  const productIds = [...new Set((items || []).map((item) => item.product_id))];
  const itemIds = (items || []).map((item) => item.id);
  const [{ data: patients }, { data: products }, { data: dispenses }, { data: lots }] = await Promise.all([
    currentPatientIds.length ? supabase.from("patients").select("id,mrn,first_name,last_name").in("id", currentPatientIds) : Promise.resolve({ data: [] }),
    productIds.length ? supabase.from("products").select("id,code,name,unit").in("id", productIds) : Promise.resolve({ data: [] }),
    itemIds.length ? supabase.from("dispenses").select("id,prescription_item_id,stock_lot_id,quantity,status,dispensed_at").in("prescription_item_id", itemIds) : Promise.resolve({ data: [] }),
    productIds.length ? supabase.from("stock_lots").select("id,product_id,lot_no,expiry_date,quantity_on_hand,store_id,stores!inner(facility_id,name)").in("product_id", productIds).eq("stores.facility_id", facilityId).gt("quantity_on_hand", 0).order("expiry_date") : Promise.resolve({ data: [] }),
  ]);

  const documentRows = await Promise.all((documents || []).map(async (document) => {
    const { data: signed } = await supabase.storage.from("pharmacy-documents").createSignedUrl(document.storage_path, 600);
    return { ...document, url: signed?.signedUrl || "" };
  }));
  const doctors = (doctorAssignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor && doctor.status === "active" ? [doctor] : [];
  });

  return <>
    <PageHeading eyebrow="Medication workflow" title="Pharmacy" description="Validate prescriptions, dispense by lot and expiry, manage documents, and preserve an audited medication history."/>
    {error && <div className="form-error">Unable to load prescriptions: {error.message}</div>}
    <PharmacyWorkspace
      prescriptions={prescriptions || []} encounters={encounters || []} patients={patients || []}
      items={items || []} products={products || []} dispenses={dispenses || []} lots={lots || []}
      doctors={doctors} references={references || []} documents={documentRows}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </>;
}
