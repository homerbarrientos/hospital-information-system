import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { ClinicalWorkspace } from "@/components/clinical-workspace";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;
const activeStatuses = ["in_consultation", "awaiting_service"];
const consultationStatuses = new Set(["active", "in_consultation", "awaiting_service", "completed", "cancelled", "all"]);
const cleanTerm = (value: string) => value.replace(/[,%()]/g, " ").trim().slice(0, 100);

type Vital = { encounter_id: string; code: string; value: number | string; unit: string; observed_at: string };

export default async function Clinical({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = cleanTerm(params.q || "");
  const status = consultationStatuses.has(params.status || "") ? String(params.status) : "active";
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

  let encountersQuery = supabase
    .from("encounters")
    .select("id,encounter_no,status,service_date,patient_id,responsible_doctor_id", { count: "exact" })
    .eq("facility_id", facilityId)
    .eq("encounter_type", "OPD")
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (status === "active") encountersQuery = encountersQuery.in("status", activeStatuses);
  else if (status !== "all") encountersQuery = encountersQuery.eq("status", status);
  if (matchingPatientIds) {
    encountersQuery = matchingPatientIds.length
      ? encountersQuery.in("patient_id", matchingPatientIds)
      : encountersQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (date) encountersQuery = encountersQuery.eq("service_date", date);

  const [{ data: encounters, error, count }, { data: doctorAssignments }] = await Promise.all([
    encountersQuery,
    supabase.from("doctor_facility_assignments").select("doctor_id,doctors(id,first_name,last_name,suffix,specialty,status)").eq("facility_id", facilityId).eq("active", true),
  ]);

  const patientIds = [...new Set((encounters || []).map((encounter) => encounter.patient_id))];
  const [{ data: patients }, { data: allergies }] = await Promise.all([
    patientIds.length
      ? supabase.from("patients").select("id,mrn,first_name,last_name").in("id", patientIds)
      : Promise.resolve({ data: [] }),
    patientIds.length
      ? supabase.from("allergies").select("id,patient_id,substance,reaction,severity,status,version").in("patient_id", patientIds).order("recorded_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const encounterIds = (encounters || []).map((encounter) => encounter.id);
  let consultationDetails: Array<{
    encounter_id: string; chief_complaint: string; soap_note: string; diagnosis: string; version: number;
    vitals: Array<{ code: string; value: number | string; unit: string }>;
  }> = [];

  if (encounterIds.length) {
    const [{ data: notes }, { data: vitals }, { data: diagnoses }] = await Promise.all([
      supabase.from("clinical_notes").select("id,encounter_id,current_version,created_at").in("encounter_id", encounterIds).eq("note_type", "consultation").order("created_at", { ascending: false }),
      supabase.from("vital_observations").select("encounter_id,code,value,unit,observed_at").in("encounter_id", encounterIds).order("observed_at", { ascending: false }),
      supabase.from("diagnoses").select("encounter_id,description,created_at").in("encounter_id", encounterIds).eq("diagnosis_type", "working").order("created_at", { ascending: false }),
    ]);
    const noteIds = (notes || []).map((note) => note.id);
    const { data: versions } = noteIds.length
      ? await supabase.from("clinical_note_versions").select("note_id,version,content,created_at").in("note_id", noteIds).order("version", { ascending: false })
      : { data: [] };

    consultationDetails = encounterIds.map((encounterId) => {
      const note = (notes || []).find((item) => item.encounter_id === encounterId);
      const latestVersion = (versions || []).find((item) => item.note_id === note?.id);
      const content = (latestVersion?.content || {}) as { chief_complaint?: string; soap_note?: string };
      const diagnosis = (diagnoses || []).find((item) => item.encounter_id === encounterId);
      const latestVitals = new Map<string, { code: string; value: number | string; unit: string }>();
      for (const vital of ((vitals || []) as Vital[]).filter((item) => item.encounter_id === encounterId)) {
        if (!latestVitals.has(vital.code)) latestVitals.set(vital.code, { code: vital.code, value: vital.value, unit: vital.unit });
      }
      return {
        encounter_id: encounterId,
        chief_complaint: content.chief_complaint || "",
        soap_note: content.soap_note || "",
        diagnosis: diagnosis?.description || "",
        version: note?.current_version || 1,
        vitals: Array.from(latestVitals.values()),
      };
    });
  }

  const doctors = (doctorAssignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor && doctor.status === "active" ? [doctor] : [];
  });

  return <>
    <PageHeading eyebrow="Outpatient care" title="OPD clinical workspace" description="Create encounters, record vital signs and notes, and keep allergies visible."/>
    {error && <div className="form-error">Unable to load consultations: {error.message}</div>}
    <ClinicalWorkspace
      patients={patients || []}
      allergies={allergies || []}
      encounters={encounters || []}
      consultationDetails={consultationDetails}
      facilityId={facilityId}
      doctors={doctors}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </>;
}
