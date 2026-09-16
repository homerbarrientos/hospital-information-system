"use client";

import { Fragment, useActionState, useState } from "react";
import { AlertTriangle, Pencil, Plus, Stethoscope, X } from "lucide-react";
import {
  changeAllergyStatus,
  createConsultation,
  type ClinicalState,
  updateAllergy,
} from "@/app/clinical/actions";
import { EncounterDetailModal } from "@/components/encounter-detail-modal";

type Patient = {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
};

type Allergy = {
  id: string;
  patient_id: string;
  substance: string;
  reaction: string | null;
  severity: string | null;
  status: string;
  version: number;
};

type Encounter = {
  id: string;
  encounter_no: string;
  status: string;
  service_date: string;
  patient_id: string;
  responsible_doctor_id: string | null;
};
type Doctor = { id:string; first_name:string; last_name:string; suffix:string|null; specialty:string };

type ConsultationDetail = {
  encounter_id: string;
  chief_complaint: string;
  soap_note: string;
  diagnosis: string;
  version: number;
  vitals: Array<{ code: string; value: number | string; unit: string }>;
};

const initial: ClinicalState = { ok: false, message: "" };
const doctorLabel=(doctor?:Doctor)=>doctor?`Dr. ${doctor.last_name}, ${doctor.first_name}${doctor.suffix?` ${doctor.suffix}`:""}`:"Not assigned";

export function ClinicalWorkspace({
  patients,
  allergies,
  encounters,
  consultationDetails,
  facilityId,
  doctors,
}: {
  patients: Patient[];
  allergies: Allergy[];
  encounters: Encounter[];
  consultationDetails: ConsultationDetail[];
  facilityId: string;
  doctors: Doctor[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Encounter | null>(null);

  return (
    <>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          Start consultation
        </button>
      </div>
      <section className="card">
        <div className="card-header">
          <h3>Recent consultations</h3>
          <span className="badge blue">Live data</span>
        </div>
        <div className="table-wrap">
          <table className="data-table consultation-table">
            <thead>
              <tr>
                <th>Encounter</th>
                <th>Patient</th>
                <th>Date</th>
                <th>Doctor</th>
                <th>Allergy alert</th>
                <th>Status / Action</th>
              </tr>
            </thead>
            <tbody>
              {encounters.map((encounter) => {
                const patient = patients.find((item) => item.id === encounter.patient_id);
                const alerts = allergies.filter(
                  (item) => item.patient_id === encounter.patient_id && item.status === "active",
                );
                const detail = consultationDetails.find(
                  (item) => item.encounter_id === encounter.id,
                );
                const vitalSummary = detail?.vitals.length
                  ? detail.vitals
                      .map((vital) => `${vital.code}: ${vital.value} ${vital.unit}`)
                      .join(" · ")
                  : "Not recorded";

                return (
                  <Fragment key={encounter.id}>
                    <tr className="consultation-main-row">
                      <td>
                        <strong>{encounter.encounter_no}</strong>
                        <span className="record-version">Version {detail?.version || 1}</span>
                      </td>
                      <td className="name-cell">
                        <strong>
                          {patient
                            ? `${patient.last_name}, ${patient.first_name}`
                            : "Patient"}
                        </strong>
                        <span>{patient?.mrn}</span>
                      </td>
                      <td>{encounter.service_date}</td>
                      <td>{doctorLabel(doctors.find((doctor)=>doctor.id===encounter.responsible_doctor_id))}</td>
                      <td>
                        {alerts.length ? (
                          <span className="allergy-alert">
                            <AlertTriangle size={13} />
                            {alerts
                              .map(
                                (alert) =>
                                  `${alert.substance}${alert.reaction ? ` (${alert.reaction})` : ""}`,
                              )
                              .join(", ")}
                          </span>
                        ) : (
                          "None documented"
                        )}
                      </td>
                      <td>
                        <div className="consultation-actions">
                          <span className="badge green">
                            {encounter.status.replaceAll("_", " ")}
                          </span>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setSelected(encounter)}
                          >
                            View / modify
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr className="consultation-detail-row">
                      <td colSpan={6}>
                        <div className="consultation-summary-grid">
                          <ClinicalSummary
                            label="Chief complaint"
                            value={detail?.chief_complaint || "Not recorded"}
                          />
                          <ClinicalSummary label="Vital signs" value={vitalSummary} />
                          <ClinicalSummary
                            label="Working diagnosis"
                            value={detail?.diagnosis || "Not recorded"}
                          />
                          <ClinicalSummary
                            label="Clinical / SOAP note"
                            value={detail?.soap_note || "Not recorded"}
                            wide
                          />
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {!encounters.length && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No consultations recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <EncounterDetailModal
          encounter={selected}
          patient={patients.find((patient) => patient.id === selected.patient_id)}
          allergies={allergies}
          providerName={doctorLabel(doctors.find((doctor)=>doctor.id===selected.responsible_doctor_id))}
          onClose={() => setSelected(null)}
        />
      )}
      {open && (
        <ConsultationDialog
          patients={patients}
          allergies={allergies}
          facilityId={facilityId}
          doctors={doctors}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ClinicalSummary({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "clinical-summary wide" : "clinical-summary"}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function ConsultationDialog({
  patients,
  allergies,
  facilityId,
  doctors,
  close,
}: {
  patients: Patient[];
  allergies: Allergy[];
  facilityId: string;
  doctors: Doctor[];
  close: () => void;
}) {
  const [state, action, pending] = useActionState(createConsultation, initial);
  const [patientId, setPatientId] = useState("");
  const [manageAllergies, setManageAllergies] = useState(false);
  const [vitals, setVitals] = useState({ systolic: "", diastolic: "", temperature: "", spo2: "" });
  const patientAllergies = allergies.filter((allergy) => allergy.patient_id === patientId);
  const active = patientAllergies.filter((allergy) => allergy.status === "active");
  const systolic = vitals.systolic === "" ? null : Number(vitals.systolic);
  const diastolic = vitals.diastolic === "" ? null : Number(vitals.diastolic);
  const temperature = vitals.temperature === "" ? null : Number(vitals.temperature);
  const spo2 = vitals.spo2 === "" ? null : Number(vitals.spo2);
  const vitalWarning =
    ((systolic === null) !== (diastolic === null) && "Enter both systolic and diastolic blood pressure.") ||
    (systolic !== null && (systolic < 40 || systolic > 300) && "Systolic BP must be between 40 and 300 mmHg.") ||
    (diastolic !== null && (diastolic < 20 || diastolic > 200) && "Diastolic BP must be between 20 and 200 mmHg.") ||
    (systolic !== null && diastolic !== null && systolic <= diastolic && "Systolic BP must be higher than diastolic BP.") ||
    (temperature !== null && (temperature < 25 || temperature > 45) && "Temperature must be between 25 and 45 °C.") ||
    (spo2 !== null && (spo2 < 40 || spo2 > 100) && "SpO₂ must be between 40 and 100%.") || "";

  return (
    <div className="modal-backdrop">
      <section className="modal clinical-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Outpatient care</p>
            <h3>New consultation</h3>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <form action={action} className="patient-form">
          <input type="hidden" name="facility_id" value={facilityId} />
          <label className="wide">
            Patient
            <select
              required
              name="patient_id"
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
            >
              <option value="">Select a registered patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.mrn} · {patient.last_name}, {patient.first_name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">Responsible doctor<select required name="doctor_id" defaultValue=""><option value="" disabled>Select attending or consulting doctor</option>{doctors.map((doctor)=><option key={doctor.id} value={doctor.id}>{doctorLabel(doctor)} · {doctor.specialty}</option>)}</select></label>
          {patientId && (
            <div className={`${active.length ? "allergy-panel" : "notice"} allergy-panel-row wide`}>
              <div>{active.length ? (
                <span className="allergy-panel-copy">
                  <AlertTriangle size={17} />
                  <strong>
                    Allergy alert:{" "}
                    {active
                      .map(
                        (allergy) =>
                          `${allergy.substance}${allergy.reaction ? ` (${allergy.reaction})` : ""}`,
                      )
                      .join(", ")}
                  </strong>
                </span>
              ) : (
                "No active allergies documented. Confirm with the patient."
              )}</div>
              <button type="button" className="btn btn-secondary" onClick={() => setManageAllergies(true)}>
                <Pencil size={14} /> Manage allergies
              </button>
            </div>
          )}
          <label className="wide">
            Chief complaint
            <textarea required name="chief_complaint" rows={2} />
          </label>
          <label>
            Systolic BP
            <input type="number" name="systolic" min="40" max="300" value={vitals.systolic} onChange={(event) => setVitals({ ...vitals, systolic: event.target.value })} />
          </label>
          <label>
            Diastolic BP
            <input type="number" name="diastolic" min="20" max="200" value={vitals.diastolic} onChange={(event) => setVitals({ ...vitals, diastolic: event.target.value })} />
          </label>
          <label>
            Temperature °C
            <input type="number" step="0.1" name="temperature" min="25" max="45" value={vitals.temperature} onChange={(event) => setVitals({ ...vitals, temperature: event.target.value })} />
          </label>
          <label>
            SpO₂ %
            <input type="number" name="spo2" min="40" max="100" value={vitals.spo2} onChange={(event) => setVitals({ ...vitals, spo2: event.target.value })} />
          </label>
          <label>
            New allergy
            <input name="allergy_substance" placeholder="Leave blank if none" />
          </label>
          <label>
            Allergic reaction
            <input name="allergy_reaction" />
          </label>
          <label className="wide">
            Clinical/SOAP note
            <textarea required name="soap_note" rows={5} />
          </label>
          <label className="wide">
            Working diagnosis
            <input name="diagnosis" />
          </label>
          {state.message && (
            <div className={state.ok ? "form-success wide" : "form-error wide"}>
              {state.message}
            </div>
          )}
          {vitalWarning && <div className="form-error wide">{vitalWarning}</div>}
          <div className="form-actions wide">
            <button type="button" className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
            <button disabled={pending || Boolean(vitalWarning)} className="btn btn-primary">
              <Stethoscope size={15} />
              {pending ? "Saving…" : "Save consultation"}
            </button>
          </div>
        </form>
      </section>
      {manageAllergies && (
        <AllergyManager allergies={patientAllergies} close={() => setManageAllergies(false)} />
      )}
    </div>
  );
}

function AllergyManager({ allergies, close }: { allergies: Allergy[]; close: () => void }) {
  return (
    <div className="modal-backdrop nested-modal">
      <section className="modal allergy-manager" role="dialog" aria-modal="true" aria-label="Manage allergies">
        <div className="modal-head">
          <div><p className="eyebrow">Patient safety</p><h3>Manage allergies</h3></div>
          <button className="icon-btn" onClick={close} aria-label="Close allergy manager"><X size={17} /></button>
        </div>
        <div className="allergy-manager-body">
          <p className="notice">Do not delete clinical history. Correct the entry or mark it inactive with a reason.</p>
          {allergies.map((allergy) => <AllergyEditor key={allergy.id} allergy={allergy} />)}
          {!allergies.length && <div className="empty-state">No allergy records for this patient.</div>}
        </div>
      </section>
    </div>
  );
}

function AllergyEditor({ allergy }: { allergy: Allergy }) {
  const [editState, editAction, editPending] = useActionState(updateAllergy, initial);
  const [statusState, statusAction, statusPending] = useActionState(changeAllergyStatus, initial);
  return (
    <article className="allergy-record">
      <div className="allergy-record-title">
        <strong>{allergy.substance}</strong>
        <span className={`badge ${allergy.status === "active" ? "red" : "blue"}`}>{allergy.status}</span>
      </div>
      <form action={editAction} className="allergy-edit-grid">
        <input type="hidden" name="allergy_id" value={allergy.id} /><input type="hidden" name="version" value={allergy.version} />
        <label>Allergen<input required minLength={2} name="substance" defaultValue={allergy.substance} /></label>
        <label>Reaction<input name="reaction" defaultValue={allergy.reaction || ""} /></label>
        <label>Severity<select name="severity" defaultValue={allergy.severity || ""}><option value="">Not specified</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select></label>
        <label className="wide">Reason for correction<textarea required minLength={5} name="reason" rows={2} placeholder="Required for the audit trail" /></label>
        {editState.message && <div className={editState.ok ? "form-success wide" : "form-error wide"}>{editState.message}</div>}
        <div className="form-actions wide"><button disabled={editPending} className="btn btn-primary">{editPending ? "Saving…" : "Save correction"}</button></div>
      </form>
      <form action={statusAction} className="allergy-status-form">
        <input type="hidden" name="allergy_id" value={allergy.id} />
        <input type="hidden" name="next_status" value={allergy.status === "active" ? "inactive" : "active"} />
        <label>Status change reason<input required minLength={5} name="reason" placeholder="Example: entered in error" /></label>
        <button disabled={statusPending} className="btn btn-secondary">{allergy.status === "active" ? "Mark inactive" : "Reactivate"}</button>
        {statusState.message && <div className={statusState.ok ? "form-success wide" : "form-error wide"}>{statusState.message}</div>}
      </form>
    </article>
  );
}
