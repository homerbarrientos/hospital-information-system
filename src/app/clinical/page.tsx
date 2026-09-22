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
    .select("id,encounter_no,status,service_date,patient_id,responsible_doctor_id,patients(id,mrn,first_name,last_name,allergies(id,patient_id,substance,reaction,severity,status,version,recorded_at)),clinical_notes(id,encounter_id,note_type,current_version,created_at,clinical_note_versions(note_id,version,content,created_at)),vital_observations(encounter_id,code,value,unit,observed_at),diagnoses(encounter_id,description,diagnosis_type,created_at)", { count: "exact" })
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

  const loadedEncounters = encounters || [];
  const patients = [...new Map(loadedEncounters.flatMap((encounter) => {
    const patientRelation = encounter.patients;
    const patient = Array.isArray(patientRelation) ? patientRelation[0] : patientRelation;
    return patient ? [[patient.id, { id: patient.id, mrn: patient.mrn, first_name: patient.first_name, last_name: patient.last_name }] as const] : [];
  })).values()];
  const allergies = loadedEncounters.flatMap((encounter) => {
    const patientRelation = encounter.patients;
    const patient = Array.isArray(patientRelation) ? patientRelation[0] : patientRelation;
    return patient?.allergies || [];
  }).sort((left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()).map((allergy) => ({ id: allergy.id, patient_id: allergy.patient_id, substance: allergy.substance, reaction: allergy.reaction, severity: allergy.severity, status: allergy.status, version: allergy.version }));
  const consultationDetails = loadedEncounters.map((encounter) => {
      const note = [...(encounter.clinical_notes || [])].filter((item) => item.note_type === "consultation").sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
      const latestVersion = [...(note?.clinical_note_versions || [])].sort((left, right) => right.version - left.version)[0];
      const content = (latestVersion?.content || {}) as { chief_complaint?: string; soap_note?: string };
      const diagnosis = [...(encounter.diagnoses || [])].filter((item) => item.diagnosis_type === "working").sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
      const latestVitals = new Map<string, { code: string; value: number | string; unit: string }>();
      for (const vital of ([...(encounter.vital_observations || [])] as Vital[]).sort((left, right) => new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime())) {
        if (!latestVitals.has(vital.code)) latestVitals.set(vital.code, { code: vital.code, value: vital.value, unit: vital.unit });
      }
      return {
        encounter_id: encounter.id,
        chief_complaint: content.chief_complaint || "",
        soap_note: content.soap_note || "",
        diagnosis: diagnosis?.description || "",
        version: note?.current_version || 1,
        vitals: Array.from(latestVitals.values()),
      };
    });
  const encounterRows = loadedEncounters.map((encounter) => ({ id: encounter.id, encounter_no: encounter.encounter_no, status: encounter.status, service_date: encounter.service_date, patient_id: encounter.patient_id, responsible_doctor_id: encounter.responsible_doctor_id }));

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
      encounters={encounterRows}
      consultationDetails={consultationDetails}
      facilityId={facilityId}
      doctors={doctors}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </>;
}
