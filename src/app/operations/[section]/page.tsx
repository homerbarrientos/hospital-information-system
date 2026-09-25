import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { OperationWorkspace, type OperationRow, type EncounterOption, type MaterialOption, type SupplierOption, type DoctorOption, type ServiceOption } from "@/components/operation-workspace";
import { createClient } from "@/lib/supabase/server";

const descriptions = {
  or: ["Operating Room", "Schedule procedures against patient encounters, record the responsible doctor, and document completion."],
  dr: ["Delivery Room", "Track delivery cases against patient encounters with schedules, care notes, and outcomes."],
  dietary: ["Dietary", "Record patient meal orders and dietary precautions and track preparation and service."],
  materials: ["Materials Inventory", "Manage non-medicine material stock, patient issues, receipts, and reorder levels."],
  purchasing: ["Purchasing & Procurement", "Request and approve material purchases, then receive deliveries into material stock."],
  philhealth: ["PhilHealth Claims", "Prepare claim records against patient encounters and track externally submitted eClaims."],
} as const;
type Section = keyof typeof descriptions;

export default async function OperationsPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in descriptions)) notFound();
  const kind = section as Section;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("facility_id").eq("user_id", claims.claims.sub).eq("active", true).limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;
  const { data: facility } = await supabase.from("facilities").select("organization_id").eq("id", facilityId).single();

  const table = kind === "or" || kind === "dr" ? "care_cases" : kind === "dietary" ? "diet_orders" : kind === "materials" ? "material_items" : kind === "purchasing" ? "purchase_orders" : "phic_claims";
  let recordsQuery = supabase.from(table).select("*").eq("facility_id", facilityId).limit(200);
  if (kind === "or" || kind === "dr") recordsQuery = recordsQuery.eq("case_type", kind.toUpperCase());
  const [recordsResult, encountersResult, materialsResult, suppliersResult, doctorsResult, movementsResult, servicesResult] = await Promise.all([
    recordsQuery.order("created_at", { ascending: false }),
    supabase.from("encounters").select("id,encounter_no,patient_id,status,patients(first_name,last_name,mrn,philhealth_no)").eq("facility_id", facilityId).order("created_at", { ascending: false }).limit(500),
    kind === "materials" || kind === "purchasing" ? supabase.from("material_items").select("id,code,name,unit,quantity_on_hand").eq("facility_id", facilityId).eq("status", "active").order("name") : Promise.resolve({ data: [] as MaterialOption[], error: null }),
    kind === "purchasing" ? supabase.from("suppliers").select("id,code,name").eq("organization_id", facility?.organization_id || "00000000-0000-0000-0000-000000000000").eq("status", "active").order("name").limit(300) : Promise.resolve({ data: [] as SupplierOption[], error: null }),
    kind === "or" || kind === "dr" ? supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name)").eq("facility_id", facilityId).eq("active", true) : Promise.resolve({ data: [], error: null }),
    kind === "materials" ? supabase.from("material_movements").select("id,item_id,kind,quantity,balance_after,reference_no,created_at,encounter_id").eq("facility_id", facilityId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    ["materials", "or", "dr"].includes(kind) ? supabase.from("service_catalog").select("id,code,name").eq("organization_id", facility?.organization_id || "00000000-0000-0000-0000-000000000000").eq("status", "active").eq("billable", true).order("name") : Promise.resolve({ data: [] as ServiceOption[], error: null }),
  ]);
  const errors = [recordsResult.error, encountersResult.error, materialsResult.error, suppliersResult.error, doctorsResult.error, movementsResult.error, servicesResult.error].filter(Boolean);
  const encounters: EncounterOption[] = (encountersResult.data || []).map(row => {
    const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
    return { id: row.id, label: `${row.encounter_no} · ${patient?.last_name || "Patient"}, ${patient?.first_name || ""} · ${patient?.mrn || ""}`, status: row.status, philhealth_no: patient?.philhealth_no || null };
  });
  const doctors: DoctorOption[] = (doctorsResult.data || []).flatMap(row => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor ? [{ id: row.doctor_id, name: `${doctor.last_name}, ${doctor.first_name}` }] : [];
  });
  const [title, description] = descriptions[kind];
  return <>
    <PageHeading eyebrow="Hospital operations" title={title} description={description} />
    {errors.length ? <div className="form-error">Unable to load module data: {errors[0]?.message}. Apply the new Supabase migration before using this module.</div> : null}
    {!errors.length ? <OperationWorkspace section={kind} facilityId={facilityId} records={(recordsResult.data || []) as OperationRow[]} encounters={encounters} materials={(materialsResult.data || []) as MaterialOption[]} suppliers={(suppliersResult.data || []) as SupplierOption[]} doctors={doctors} movements={(movementsResult.data || []) as OperationRow[]} services={(servicesResult.data || []) as ServiceOption[]} /> : null}
  </>;
}
