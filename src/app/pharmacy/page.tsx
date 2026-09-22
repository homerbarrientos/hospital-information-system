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
  const { data: roles } = await supabase.from("user_roles").select("facility_id,facilities(organization_id)").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;

  let patientIds: string[] | null = null;
  if (query) {
    const { data: matches } = await supabase.from("patients").select("id").or(`mrn.ilike.%${query}%,first_name.ilike.%${query}%,middle_name.ilike.%${query}%,last_name.ilike.%${query}%`).limit(500);
    patientIds = (matches || []).map((patient) => patient.id);
  }
  let prescriptionQuery = supabase
    .from("prescriptions")
    .select("id,encounter_id,prescription_no,status,prescribed_at,prescribing_doctor_id,notes,cancellation_reason,version,encounters!inner(id,facility_id,patient_id,encounter_no,encounter_type,service_date,patients(id,mrn,first_name,last_name)),prescription_items(id,prescription_id,product_id,dose,route,frequency,duration,quantity,instructions,products(id,code,name,unit),dispenses(id,prescription_item_id,stock_lot_id,quantity,status,dispensed_at)),prescription_documents(id,prescription_id,storage_path,display_name,description,mime_type,size_bytes,uploaded_at,status)", { count: "exact" })
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

  const loadedPrescriptions = prescriptions || [];
  const encounterRows = loadedPrescriptions.flatMap((record) => {
    const encounter = Array.isArray(record.encounters) ? record.encounters[0] : record.encounters;
    return encounter ? [{ id: encounter.id, encounter_no: encounter.encounter_no, patient_id: encounter.patient_id, encounter_type: encounter.encounter_type, service_date: encounter.service_date }] : [];
  });
  const patientRows = loadedPrescriptions.flatMap((record) => {
    const encounter = Array.isArray(record.encounters) ? record.encounters[0] : record.encounters;
    if (!encounter) return [];
    const patient = Array.isArray(encounter.patients) ? encounter.patients[0] : encounter.patients;
    return patient ? [patient] : [];
  });
  const nestedItems = loadedPrescriptions.flatMap((record) => record.prescription_items || []);
  const productRows = nestedItems.flatMap((item) => {
    const product = Array.isArray(item.products) ? item.products[0] : item.products;
    return product ? [product] : [];
  });
  const dispenses = nestedItems.flatMap((item) => item.dispenses || []);
  const documents = loadedPrescriptions.flatMap((record) => record.prescription_documents || []).filter((document) => document.status === "active").sort((left, right) => new Date(right.uploaded_at).getTime() - new Date(left.uploaded_at).getTime());
  const encounters = [...new Map(encounterRows.map((encounter) => [encounter.id, encounter])).values()];
  const patients = [...new Map(patientRows.map((patient) => [patient.id, patient])).values()];
  const products = [...new Map(productRows.map((product) => [product.id, product])).values()];
  const items = nestedItems.map((item) => ({ id: item.id, prescription_id: item.prescription_id, product_id: item.product_id, dose: item.dose, route: item.route, frequency: item.frequency, duration: item.duration, quantity: item.quantity, instructions: item.instructions }));
  const productIds = [...new Set((items || []).map((item) => item.product_id))];
  const { data: lots } = productIds.length ? await supabase.from("stock_lots").select("id,product_id,lot_no,expiry_date,quantity_on_hand,store_id,stores!inner(facility_id,name)").in("product_id", productIds).eq("stores.facility_id", facilityId).gt("quantity_on_hand", 0).order("expiry_date") : { data: [] };

  const documentPaths = documents.map((document) => document.storage_path);
  const { data: signedDocuments } = documentPaths.length ? await supabase.storage.from("pharmacy-documents").createSignedUrls(documentPaths, 600) : { data: [] };
  const signedDocumentMap = new Map((signedDocuments || []).map((document) => [document.path, document.signedUrl]));
  const documentRows = documents.map((document) => ({ id: document.id, prescription_id: document.prescription_id, storage_path: document.storage_path, display_name: document.display_name, description: document.description, mime_type: document.mime_type, size_bytes: document.size_bytes, uploaded_at: document.uploaded_at, url: signedDocumentMap.get(document.storage_path) || "" }));
  const prescriptionRows = loadedPrescriptions.map((record) => ({ id: record.id, encounter_id: record.encounter_id, prescription_no: record.prescription_no, status: record.status, prescribed_at: record.prescribed_at, prescribing_doctor_id: record.prescribing_doctor_id, notes: record.notes, cancellation_reason: record.cancellation_reason, version: record.version }));
  const doctors = (doctorAssignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor && doctor.status === "active" ? [doctor] : [];
  });

  return <>
    <PageHeading eyebrow="Medication workflow" title="Pharmacy" description="Validate prescriptions, dispense by lot and expiry, manage documents, and preserve an audited medication history."/>
    {error && <div className="form-error">Unable to load prescriptions: {error.message}</div>}
    <PharmacyWorkspace
      prescriptions={prescriptionRows} encounters={encounters} patients={patients}
      items={items} products={products} dispenses={dispenses} lots={lots || []}
      doctors={doctors} references={references || []} documents={documentRows}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </>;
}
