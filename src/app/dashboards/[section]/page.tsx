import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { philippineDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const dashboards = {
  patient: {
    title: "Patient Care Dashboard",
    description: "Registration, appointments, queue, and patient movement for this facility.",
    links: [
      ["/patients", "Patients", "Search and register patients."],
      ["/queue", "Appointments & Queue", "Review arrivals and waiting patients."],
      ["/admissions", "Admission & Transfer", "Manage admitted patients and beds."],
    ],
  },
  clinical: {
    title: "Clinical Care Dashboard",
    description: "Orders, prescriptions, procedures, and dietary work awaiting care teams.",
    links: [
      ["/clinical", "Consultation", "Document clinical encounters."],
      ["/clinical-registry", "Clinical Registry", "Review diagnoses and care records."],
      ["/orders", "Orders & Results", "Manage clinical orders and results."],
      ["/pharmacy", "Pharmacy", "Validate and dispense prescriptions."],
      ["/operations/or", "Operating Room", "Manage scheduled procedures."],
      ["/operations/dr", "Delivery Room", "Track deliveries and outcomes."],
      ["/operations/dietary", "Dietary", "Prepare and serve meal orders."],
    ],
  },
  materials: {
    title: "Materials & Supply Chain Dashboard",
    description: "Material stock, purchase requests, and medicine inventory risk.",
    links: [
      ["/inventory", "Inventory Management", "Review medicine stock and movements."],
      ["/operations/materials", "Materials Management", "Receive and issue non-medicine materials."],
      ["/operations/purchasing", "Purchasing & Procurement", "Approve and receive purchases."],
    ],
  },
  revenue: {
    title: "Revenue & Claims Dashboard",
    description: "Outstanding balances, cashier activity, and PhilHealth claim progress.",
    links: [
      ["/billing", "Billing & Cashiering", "Review patient ledgers and payments."],
      ["/operations/philhealth", "PhilHealth Claims", "Prepare and track claims."],
    ],
  },
} as const;
type Section = keyof typeof dashboards;
type Metric = { label: string; value: string; detail: string };
type CountResult = { count: number | null; error: { message: string } | null };
const metric = (label: string, result: CountResult, detail: string): Metric => ({
  label,
  value: result.error || result.count === null ? "—" : new Intl.NumberFormat("en-PH").format(result.count),
  detail,
});

export default async function AreaDashboard({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in dashboards)) notFound();
  const area = section as Section;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("facility_id,facilities(organization_id)").eq("user_id", userId).eq("active", true).limit(1);
  const assignment = roles?.[0];
  if (!assignment?.facility_id) return <div className="form-error">No active facility assignment.</div>;
  const facilityId = assignment.facility_id;
  const relatedFacility = Array.isArray(assignment.facilities) ? assignment.facilities[0] : assignment.facilities;
  const organizationId = relatedFacility?.organization_id;
  const today = philippineDateKey();
  const start = new Date(`${today}T00:00:00+08:00`).toISOString();
  const end = new Date(`${today}T23:59:59.999+08:00`).toISOString();
  let metrics: Metric[] = [];
  let errors: ({ message: string } | null)[] = [];

  if (area === "patient") {
    const results = await Promise.all([
      organizationId ? supabase.from("patients").select("id", { count: "exact", head: true }).eq("organization_id", organizationId) : Promise.resolve({ count: null, error: { message: "Facility organization is missing" } }),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).gte("scheduled_at", start).lte("scheduled_at", end),
      supabase.from("encounters").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("service_date", today),
      supabase.from("queue_entries").select("id,encounters!inner(facility_id)", { count: "exact", head: true }).eq("encounters.facility_id", facilityId).eq("status", "waiting"),
    ]);
    metrics = [
      metric("Registered patients", results[0], "Organization patient index"),
      metric("Appointments today", results[1], "Scheduled for today"),
      metric("Encounters today", results[2], "Facility encounters"),
      metric("Waiting in queue", results[3], "Current waiting entries"),
    ];
    errors = results.map(result => result.error);
  } else if (area === "clinical") {
    const results = await Promise.all([
      supabase.from("clinical_orders").select("id,encounters!inner(facility_id)", { count: "exact", head: true }).eq("encounters.facility_id", facilityId).in("status", ["requested", "acknowledged", "collected", "in_progress"]),
      supabase.from("prescriptions").select("id,encounters!inner(facility_id)", { count: "exact", head: true }).eq("encounters.facility_id", facilityId).in("status", ["ordered", "validated", "partially_dispensed"]),
      supabase.from("care_cases").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).in("status", ["scheduled", "in_progress"]),
      supabase.from("diet_orders").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).in("status", ["ordered", "prepared"]),
    ]);
    metrics = [
      metric("Open clinical orders", results[0], "Awaiting completion"),
      metric("Open prescriptions", results[1], "Awaiting full dispensing"),
      metric("OR & DR cases", results[2], "Scheduled or in progress"),
      metric("Pending meal orders", results[3], "Ordered or prepared"),
    ];
    errors = results.map(result => result.error);
  } else if (area === "materials") {
    const results = await Promise.all([
      supabase.from("material_items").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "active"),
      supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "requested"),
      supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "partially_received"),
      supabase.from("report_inventory_risk").select("product_id", { count: "exact", head: true }).eq("facility_id", facilityId).neq("risk_status", "healthy"),
    ]);
    metrics = [
      metric("Active material items", results[0], "Non-medicine stock catalog"),
      metric("Purchases for approval", results[1], "Requested purchase orders"),
      metric("Partially received", results[2], "Open material deliveries"),
      metric("Medicine stock risks", results[3], "Low stock or nearing expiry"),
    ];
    errors = results.map(result => result.error);
  } else {
    const results = await Promise.all([
      supabase.from("report_patient_balances").select("billing_case_id", { count: "exact", head: true }).eq("facility_id", facilityId).gt("final_balance", 0),
      supabase.from("phic_claims").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "ready"),
      supabase.from("phic_claims").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "submitted_external"),
      supabase.from("cashier_shifts").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "open"),
    ]);
    metrics = [
      metric("Open patient balances", results[0], "Billing cases with amounts due"),
      metric("Claims ready", results[1], "Prepared for submission"),
      metric("Submitted claims", results[2], "Awaiting external outcome"),
      metric("Open cashier shifts", results[3], "Current facility shifts"),
    ];
    errors = results.map(result => result.error);
  }

  const dashboard = dashboards[area];
  return <>
    <PageHeading eyebrow="Facility dashboard" title={dashboard.title} description={dashboard.description} />
    {errors.some(Boolean) ? <div className="form-error">Some metrics are unavailable for this account. Review access or module setup.</div> : null}
    <section className="metric-grid">{metrics.map(item => <article className="metric" key={item.label}><div className="metric-head">{item.label}</div><strong>{item.value}</strong><small>{item.detail}</small></article>)}</section>
    <div className="section-grid">{dashboard.links.map(([href, label, detail]) => <Link className="quick-card" href={href} key={href}><strong>{label}</strong><span>{detail}</span></Link>)}</div>
  </>;
}
