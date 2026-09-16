"use client";

import { Fragment, useActionState, useState } from "react";
import { AlertTriangle, Plus, Stethoscope, X } from "lucide-react";
import {
  createConsultation,
  type ClinicalState,
} from "@/app/clinical/actions";
import { EncounterDetailModal } from "@/components/encounter-detail-modal";

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

type Encounter = {
  id: string;
  encounter_no: string;
  status: string;
  service_date: string;
  patient_id: string;
};

type ConsultationDetail = {
  encounter_id: string;
  chief_complaint: string;
  soap_note: string;
  diagnosis: string;
  version: number;
  vitals: Array<{ code: string; value: number | string; unit: string }>;
};

const initial: ClinicalState = { ok: false, message: "" };

export function ClinicalWorkspace({
  patients,
  allergies,
  encounters,
  consultationDetails,
  facilityId,
}: {
  patients: Patient[];
  allergies: Allergy[];
  encounters: Encounter[];
  consultationDetails: ConsultationDetail[];
  facilityId: string;
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
                <th>Allergy alert</th>
                <th>Status / Action</th>
              </tr>
            </thead>
            <tbody>
              {encounters.map((encounter) => {
                const patient = patients.find((item) => item.id === encounter.patient_id);
                const alerts = allergies.filter(
                  (item) => item.patient_id === encounter.patient_id,
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
                      <td colSpan={5}>
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
                  <td colSpan={5} className="empty-state">
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
          onClose={() => setSelected(null)}
        />
      )}
      {open && (
        <ConsultationDialog
          patients={patients}
          allergies={allergies}
          facilityId={facilityId}
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
  close,
}: {
  patients: Patient[];
  allergies: Allergy[];
  facilityId: string;
  close: () => void;
}) {
  const [state, action, pending] = useActionState(createConsultation, initial);
  const [patientId, setPatientId] = useState("");
  const active = allergies.filter((allergy) => allergy.patient_id === patientId);

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
          {patientId && (
            <div className={active.length ? "allergy-panel wide" : "notice wide"}>
              {active.length ? (
                <>
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
                </>
              ) : (
                "No active allergies documented. Confirm with the patient."
              )}
            </div>
          )}
          <label className="wide">
            Chief complaint
            <textarea required name="chief_complaint" rows={2} />
          </label>
          <label>
            Systolic BP
            <input type="number" name="systolic" min="40" max="300" />
          </label>
          <label>
            Diastolic BP
            <input type="number" name="diastolic" min="20" max="200" />
          </label>
          <label>
            Temperature °C
            <input type="number" step="0.1" name="temperature" min="25" max="45" />
          </label>
          <label>
            SpO₂ %
            <input type="number" name="spo2" min="40" max="100" />
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
          <div className="form-actions wide">
            <button type="button" className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
            <button disabled={pending} className="btn btn-primary">
              <Stethoscope size={15} />
              {pending ? "Saving…" : "Save consultation"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
