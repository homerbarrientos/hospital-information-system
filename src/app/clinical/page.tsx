import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { ClinicalWorkspace } from "@/components/clinical-workspace";
import { createClient } from "@/lib/supabase/server";

type Vital = {
  encounter_id: string;
  code: string;
  value: number | string;
  unit: string;
  observed_at: string;
};

export default async function Clinical() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");

  const { data: roles } = await supabase
    .from("user_roles")
    .select("facility_id")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;

  const [{ data: patients }, { data: allergies }, { data: encounters }] =
    await Promise.all([
      supabase
        .from("patients")
        .select("id,mrn,first_name,last_name")
        .order("last_name"),
      supabase
        .from("allergies")
        .select("patient_id,substance,reaction")
        .eq("status", "active"),
      supabase
        .from("encounters")
        .select("id,encounter_no,status,service_date,patient_id")
        .eq("facility_id", facilityId)
        .eq("encounter_type", "OPD")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const encounterIds = (encounters || []).map((encounter) => encounter.id);
  let consultationDetails: Array<{
    encounter_id: string;
    chief_complaint: string;
    soap_note: string;
    diagnosis: string;
    version: number;
    vitals: Array<{ code: string; value: number | string; unit: string }>;
  }> = [];

  if (encounterIds.length) {
    const [{ data: notes }, { data: vitals }, { data: diagnoses }] = await Promise.all([
      supabase
        .from("clinical_notes")
        .select("id,encounter_id,current_version,created_at")
        .in("encounter_id", encounterIds)
        .eq("note_type", "consultation")
        .order("created_at", { ascending: false }),
      supabase
        .from("vital_observations")
        .select("encounter_id,code,value,unit,observed_at")
        .in("encounter_id", encounterIds)
        .order("observed_at", { ascending: false }),
      supabase
        .from("diagnoses")
        .select("encounter_id,description,created_at")
        .in("encounter_id", encounterIds)
        .eq("diagnosis_type", "working")
        .order("created_at", { ascending: false }),
    ]);

    const noteIds = (notes || []).map((note) => note.id);
    const { data: versions } = noteIds.length
      ? await supabase
          .from("clinical_note_versions")
          .select("note_id,version,content,created_at")
          .in("note_id", noteIds)
          .order("version", { ascending: false })
      : { data: [] };

    consultationDetails = encounterIds.map((encounterId) => {
      const note = (notes || []).find((item) => item.encounter_id === encounterId);
      const latestVersion = (versions || []).find((item) => item.note_id === note?.id);
      const content = (latestVersion?.content || {}) as {
        chief_complaint?: string;
        soap_note?: string;
      };
      const diagnosis = (diagnoses || []).find(
        (item) => item.encounter_id === encounterId,
      );
      const latestVitals = new Map<
        string,
        { code: string; value: number | string; unit: string }
      >();
      for (const vital of ((vitals || []) as Vital[]).filter(
        (item) => item.encounter_id === encounterId,
      )) {
        if (!latestVitals.has(vital.code)) {
          latestVitals.set(vital.code, {
            code: vital.code,
            value: vital.value,
            unit: vital.unit,
          });
        }
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

  return (
    <>
      <PageHeading
        eyebrow="Outpatient care"
        title="OPD clinical workspace"
        description="Create encounters, record vital signs and notes, and keep allergies visible."
      />
      <ClinicalWorkspace
        patients={patients || []}
        allergies={allergies || []}
        encounters={encounters || []}
        consultationDetails={consultationDetails}
        facilityId={facilityId}
      />
    </>
  );
}
