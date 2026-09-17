import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { AdtWorkspace } from "@/components/adt-workspace";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;
const admissionStatuses = new Set(["admitted", "discharged", "all"]);
const cleanTerm = (value: string) => value.replace(/[,%()]/g, " ").trim().slice(0, 100);

export default async function Admissions({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = cleanTerm(params.q || "");
  const status = admissionStatuses.has(params.status || "") ? String(params.status) : "admitted";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? String(params.date) : "";
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
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

  let admissionsQuery = supabase
    .from("admissions")
    .select("id,encounter_id,admission_no,status,admitted_at,admitting_doctor_id,attending_doctor_id,encounters!inner(facility_id,patient_id)", { count: "exact" })
    .eq("encounters.facility_id", facilityId)
    .order("admitted_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (status !== "all") admissionsQuery = admissionsQuery.eq("status", status);
  if (matchingPatientIds) {
    admissionsQuery = matchingPatientIds.length
      ? admissionsQuery.in("encounters.patient_id", matchingPatientIds)
      : admissionsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (date) admissionsQuery = admissionsQuery.gte("admitted_at", `${date}T00:00:00`).lt("admitted_at", `${date}T23:59:59.999`);

  const [{ data: admissions, error, count }, { data: wards }, { data: beds }, { data: doctorAssignments }, { data: dispositions }] = await Promise.all([
    admissionsQuery,
    supabase.from("wards").select("id,name").eq("facility_id", facilityId),
    supabase.from("beds").select("id,code,status,ward_id"),
    supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id", facilityId).eq("active", true),
    supabase.from("reference_options").select("code,label,reference_groups!inner(code)").eq("reference_groups.code", "discharge_disposition").eq("active", true).order("sort_order"),
  ]);

  const encounterIds = (admissions || []).map((admission) => admission.encounter_id);
  const { data: encounters } = encounterIds.length
    ? await supabase.from("encounters").select("id,patient_id,responsible_doctor_id").in("id", encounterIds)
    : { data: [] };
  const patientIds = [...new Set((encounters || []).map((encounter) => encounter.patient_id))];
  const [{ data: patients }, { data: stays }] = await Promise.all([
    patientIds.length
      ? supabase.from("patients").select("id,mrn,first_name,last_name").in("id", patientIds)
      : Promise.resolve({ data: [] }),
    (admissions || []).length
      ? supabase.from("bed_stays").select("admission_id,bed_id,ended_at").in("admission_id", (admissions || []).map((admission) => admission.id))
      : Promise.resolve({ data: [] }),
  ]);

  const doctors = (doctorAssignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor && doctor.status === "active" ? [doctor] : [];
  });

  return <>
    <PageHeading eyebrow="Patient movement" title="Admission, discharge and transfer" description="Track every ward, bed, transfer, and discharge without overwriting movement history."/>
    {error && <div className="form-error">Unable to load admissions: {error.message}</div>}
    <AdtWorkspace
      patients={patients || []}
      wards={wards || []}
      beds={beds || []}
      encounters={encounters || []}
      admissions={admissions || []}
      stays={stays || []}
      facilityId={facilityId}
      doctors={doctors}
      dispositions={dispositions || []}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </>;
}
