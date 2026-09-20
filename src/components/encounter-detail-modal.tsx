"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePenLine, X } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import {
  amendConsultation,
  cancelEncounter,
  type ClinicalState,
} from "@/app/clinical/actions";
import { createClient } from "@/lib/supabase/client";

type Encounter = {
  id: string;
  encounter_no: string;
  status: string;
  service_date: string;
  patient_id: string;
};

type Patient = {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
};

type Allergy = {
  patient_id: string;
  substance: string;
  reaction: string | null;
};

type SavedAllergy = {
  substance: string;
  reaction: string | null;
};

type Vital = {
  code: string;
  value: number | string;
  unit: string;
};

type Detail = {
  complaint: string;
  soap: string;
  diagnosis: string;
  version: number;
  allergies: SavedAllergy[];
  versions: Array<{
    version: number;
    amendment_reason: string | null;
    created_at: string;
  }>;
  vitals: Vital[];
};

const initialAmendmentState: ClinicalState = { ok: false, message: "" };

export function EncounterDetailModal({
  encounter,
  patient,
  allergies: initialAllergies,
  onClose,
  providerName,
}: {
  encounter: Encounter;
  patient?: Patient;
  allergies: Allergy[];
  onClose: () => void;
  providerName?: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [amendmentState, amendmentAction, amendmentPending] = useActionState(
    amendConsultation,
    initialAmendmentState,
  );

  const loadDetail = useCallback(async () => {
    setLoadError("");
    const db = createClient();
    const [
      { data: notes, error: notesError },
      { data: vitals, error: vitalsError },
      { data: diagnoses, error: diagnosesError },
      { data: allergies, error: allergiesError },
    ] = await Promise.all([
      db
        .from("clinical_notes")
        .select("id,current_version")
        .eq("encounter_id", encounter.id)
        .order("created_at", { ascending: false })
        .limit(1),
      db
        .from("vital_observations")
        .select("code,value,unit,observed_at")
        .eq("encounter_id", encounter.id)
        .order("observed_at", { ascending: false }),
      db
        .from("diagnoses")
        .select("description")
        .eq("encounter_id", encounter.id)
        .eq("diagnosis_type", "working")
        .order("created_at", { ascending: false })
        .limit(1),
      db
        .from("allergies")
        .select("substance,reaction")
        .eq("patient_id", encounter.patient_id)
        .eq("status", "active")
        .order("recorded_at", { ascending: false }),
    ]);

    const firstError = notesError || vitalsError || diagnosesError || allergiesError;
    if (firstError) {
      setLoadError(firstError.message);
      return;
    }

    const note = notes?.[0];
    const { data: versions, error: versionsError } = note
      ? await db
          .from("clinical_note_versions")
          .select("version,content,amendment_reason,created_at")
          .eq("note_id", note.id)
          .order("version", { ascending: false })
      : { data: [], error: null };

    if (versionsError) {
      setLoadError(versionsError.message);
      return;
    }

    const latest = versions?.[0];
    const content = (latest?.content || {}) as {
      chief_complaint?: string;
      soap_note?: string;
    };
    const latestVitals = new Map<string, Vital>();
    for (const vital of vitals || []) {
      if (!latestVitals.has(vital.code)) {
        latestVitals.set(vital.code, vital);
      }
    }

    setDetail({
      complaint: content.chief_complaint || "",
      soap: content.soap_note || "",
      diagnosis: diagnoses?.[0]?.description || "",
      version: note?.current_version || 1,
      allergies:
        allergies ||
        initialAllergies.filter((allergy) => allergy.patient_id === encounter.patient_id),
      versions: (versions || []).map((version) => ({
        version: version.version,
        amendment_reason: version.amendment_reason,
        created_at: version.created_at,
      })),
      vitals: Array.from(latestVitals.values()),
    });
  }, [encounter.id, encounter.patient_id, initialAllergies]);

  useEffect(() => {
    const timer=window.setTimeout(()=>void loadDetail(),0);
    return ()=>window.clearTimeout(timer);
  }, [loadDetail]);

  useEffect(() => {
    if (!amendmentState.ok) return;
    const timer=window.setTimeout(()=>{
      setEditing(false);
      void loadDetail();
      router.refresh();
    },0);
    return ()=>window.clearTimeout(timer);
  }, [amendmentState, loadDetail, router]);

  const vitalValue = (code: string) =>
    detail?.vitals.find((vital) => vital.code === code)?.value ?? "";

  return (
    <div className="modal-backdrop">
      <section
        className="modal encounter-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Consultation details"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Outpatient care</p>
            <h3>{editing ? "Edit consultation" : encounter.encounter_no}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        {!detail ? (
          <div className="detail-loading">
            {loadError || "Loading saved clinical record…"}
          </div>
        ) : (
          <div className="detail-body">
            {!editing && (
              <div className="detail-summary">
                <Info
                  label="Patient"
                  value={
                    patient
                      ? `${patient.last_name}, ${patient.first_name} · ${patient.mrn}`
                      : "Patient"
                  }
                />
                <Info label="Date" value={encounter.service_date} />
                <Info label="Status" value={encounter.status.replaceAll("_", " ")} />
                <Info label="Version" value={`v${detail.version}`} />
              </div>
            )}

            {!editing ? (
              <>
                <Info
                  label="Allergies"
                  value={
                    detail.allergies.length
                      ? detail.allergies
                          .map(
                            (allergy) =>
                              `${allergy.substance}${allergy.reaction ? ` (${allergy.reaction})` : ""}`,
                          )
                          .join(", ")
                      : "None documented"
                  }
                />
                <Info
                  label="Vital signs"
                  value={
                    detail.vitals.length
                      ? detail.vitals
                          .map((vital) => `${vital.code}: ${vital.value} ${vital.unit}`)
                          .join(" · ")
                      : "None recorded"
                  }
                />
                <Info label="Responsible doctor" value={providerName || "Not assigned"} />
                <Info label="Chief complaint" value={detail.complaint || "Not recorded"} />
                <Info label="Clinical / SOAP note" value={detail.soap || "Not recorded"} />
                <Info label="Working diagnosis" value={detail.diagnosis || "Not recorded"} />
                {amendmentState.message && (
                  <div className={amendmentState.ok ? "form-success" : "form-error"}>
                    {amendmentState.message}
                  </div>
                )}
                <div className="detail-actions">
                  {encounter.status !== "cancelled" && (
                    <button className="btn btn-primary" onClick={() => setEditing(true)}>
                      <FilePenLine size={15} />
                      Modify record
                    </button>
                  )}
                </div>
              </>
            ) : (
              <form action={amendmentAction} className="detail-form detail-edit-form">
                <input type="hidden" name="encounter_id" value={encounter.id} />
                <p className="detail-form-note wide">
                  Clinical changes create a new audited version. Patient, encounter, date,
                  and status remain controlled fields.
                </p>
                <label className="wide">
                  Patient
                  <input
                    readOnly
                    value={
                      patient
                        ? `${patient.mrn} · ${patient.last_name}, ${patient.first_name}`
                        : "Patient"
                    }
                  />
                </label>
                <label className="wide">
                  Chief complaint
                  <textarea
                    required
                    name="chief_complaint"
                    defaultValue={detail.complaint}
                    rows={2}
                  />
                </label>
                <label>
                  Systolic BP
                  <input
                    type="number"
                    name="systolic"
                    min="40"
                    max="300"
                    defaultValue={vitalValue("BP-SYS")}
                  />
                </label>
                <label>
                  Diastolic BP
                  <input
                    type="number"
                    name="diastolic"
                    min="20"
                    max="200"
                    defaultValue={vitalValue("BP-DIA")}
                  />
                </label>
                <label>
                  Temperature °C
                  <input
                    type="number"
                    name="temperature"
                    step="0.1"
                    min="25"
                    max="45"
                    defaultValue={vitalValue("TEMP")}
                  />
                </label>
                <label>
                  SpO₂ %
                  <input
                    type="number"
                    name="spo2"
                    min="40"
                    max="100"
                    defaultValue={vitalValue("SPO2")}
                  />
                </label>
                <label>
                  Allergy substance
                  <input
                    name="allergy_substance"
                    defaultValue={detail.allergies[0]?.substance || ""}
                    placeholder="Leave blank if none"
                  />
                </label>
                <label>
                  Allergic reaction
                  <input
                    name="allergy_reaction"
                    defaultValue={detail.allergies[0]?.reaction || ""}
                  />
                </label>
                <label className="wide">
                  Clinical / SOAP note
                  <textarea required name="soap_note" defaultValue={detail.soap} rows={5} />
                </label>
                <label className="wide">
                  Working diagnosis
                  <input name="diagnosis" defaultValue={detail.diagnosis} />
                </label>
                <label className="wide">
                  Reason for modification <span className="required-mark">Required</span>
                  <textarea
                    required
                    name="reason"
                    rows={2}
                    placeholder="Explain why this clinical record is being amended"
                  />
                </label>
                {amendmentState.message && !amendmentState.ok && (
                  <div className="form-error wide">{amendmentState.message}</div>
                )}
                <div className="form-actions wide">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditing(false)}
                  >
                    Cancel edit
                  </button>
                  <button disabled={amendmentPending} className="btn btn-primary">
                    {amendmentPending ? "Saving…" : "Save amendment"}
                  </button>
                </div>
              </form>
            )}

            {!editing && <details className="version-history">
              <summary>Modification history ({detail.versions.length})</summary>
              {detail.versions.map((version) => (
                <div key={version.version}>
                  Version {version.version} · {formatDateTime(version.created_at)}{" "}
                  {version.amendment_reason && `· ${version.amendment_reason}`}
                </div>
              ))}
            </details>}

            {!editing && encounter.status !== "completed" && encounter.status !== "cancelled" && (
              <form action={cancelEncounter} className="detail-cancel">
                <input type="hidden" name="encounter_id" value={encounter.id} />
                <label>
                  Cancellation reason
                  <textarea required name="reason" rows={2} />
                </label>
                <button className="btn btn-danger">Cancel encounter</button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
