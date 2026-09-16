"use client";

import { useActionState, useState } from "react";
import { ArrowRightLeft, DoorOpen, Plus, X } from "lucide-react";
import {
  admitPatient,
  dischargePatient,
  transferPatient,
  type AdtState,
} from "@/app/admissions/actions";

type Patient = { id: string; mrn: string; first_name: string; last_name: string };
type Bed = { id: string; code: string; status: string; ward_id: string };
type Ward = { id: string; name: string };
type Encounter = { id: string; patient_id: string };
type Admission = {
  id: string;
  encounter_id: string;
  admission_no: string;
  status: string;
  admitted_at: string;
};
type Stay = { admission_id: string; bed_id: string; ended_at: string | null };

const initialState: AdtState = { ok: false, message: "" };

export function AdtWorkspace({
  patients,
  beds,
  wards,
  encounters,
  admissions,
  stays,
  facilityId,
}: {
  patients: Patient[];
  beds: Bed[];
  wards: Ward[];
  encounters: Encounter[];
  admissions: Admission[];
  stays: Stay[];
  facilityId: string;
}) {
  const [open, setOpen] = useState(false);
  const available = beds.filter((bed) => bed.status === "available");
  const bedLabel = (bedId: string) => {
    const bed = beds.find((item) => item.id === bedId);
    return bed
      ? `${wards.find((ward) => ward.id === bed.ward_id)?.name || "Ward"} · ${bed.code}`
      : "—";
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          New admission
        </button>
      </div>
      <section className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Admission</th>
              <th>Patient</th>
              <th>Current location</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {admissions.map((admission) => {
              const encounter = encounters.find(
                (item) => item.id === admission.encounter_id,
              );
              const patient = patients.find(
                (item) => item.id === encounter?.patient_id,
              );
              const stay = stays.find(
                (item) => item.admission_id === admission.id && !item.ended_at,
              );
              return (
                <tr key={admission.id}>
                  <td className="name-cell">
                    <strong>{admission.admission_no}</strong>
                    <span>{new Date(admission.admitted_at).toLocaleString()}</span>
                  </td>
                  <td>
                    {patient
                      ? `${patient.last_name}, ${patient.first_name} · ${patient.mrn}`
                      : "Patient"}
                  </td>
                  <td>{stay ? bedLabel(stay.bed_id) : "Discharged"}</td>
                  <td>
                    <span
                      className={`badge ${admission.status === "discharged" ? "blue" : "green"}`}
                    >
                      {admission.status}
                    </span>
                  </td>
                  <td>
                    {admission.status !== "discharged" && (
                      <AdmissionActions
                        admissionId={admission.id}
                        availableBeds={available}
                        bedLabel={bedLabel}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {!admissions.length && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No admissions recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {open && (
        <AdmissionDialog
          patients={patients}
          availableBeds={available}
          facilityId={facilityId}
          bedLabel={bedLabel}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AdmissionActions({
  admissionId,
  availableBeds,
  bedLabel,
}: {
  admissionId: string;
  availableBeds: Bed[];
  bedLabel: (bedId: string) => string;
}) {
  const [transferState, transferAction, transferPending] = useActionState(
    transferPatient,
    initialState,
  );
  const [dischargeState, dischargeAction, dischargePending] = useActionState(
    dischargePatient,
    initialState,
  );
  const feedback = transferState.message ? transferState : dischargeState;

  return (
    <div className="adt-actions">
      <form action={transferAction}>
        <input type="hidden" name="admission_id" value={admissionId} />
        <select required name="bed_id" defaultValue="">
          <option value="" disabled>
            Transfer bed
          </option>
          {availableBeds.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {bedLabel(bed.id)}
            </option>
          ))}
        </select>
        <input required name="reason" placeholder="Transfer reason" />
        <button disabled={transferPending} className="btn btn-secondary">
          <ArrowRightLeft size={13} />
          {transferPending ? "Transferring…" : "Transfer"}
        </button>
      </form>
      <form action={dischargeAction}>
        <input type="hidden" name="admission_id" value={admissionId} />
        <input required name="disposition" placeholder="Discharge disposition" />
        <button disabled={dischargePending} className="btn btn-secondary">
          <DoorOpen size={13} />
          {dischargePending ? "Discharging…" : "Discharge"}
        </button>
      </form>
      {feedback.message && (
        <div className={feedback.ok ? "adt-feedback success" : "adt-feedback error"}>
          {feedback.message}
        </div>
      )}
    </div>
  );
}

function AdmissionDialog({
  patients,
  availableBeds,
  facilityId,
  bedLabel,
  close,
}: {
  patients: Patient[];
  availableBeds: Bed[];
  facilityId: string;
  bedLabel: (bedId: string) => string;
  close: () => void;
}) {
  const [state, action, pending] = useActionState(admitPatient, initialState);

  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Patient movement</p>
            <h3>New admission</h3>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <form action={action} className="patient-form">
          <input type="hidden" name="facility_id" value={facilityId} />
          <label className="wide">
            Patient
            <select required name="patient_id" defaultValue="">
              <option value="" disabled>
                Select patient
              </option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.mrn} · {patient.last_name}, {patient.first_name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Available bed
            <select required name="bed_id" defaultValue="">
              <option value="" disabled>
                Select ward and bed
              </option>
              {availableBeds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bedLabel(bed.id)}
                </option>
              ))}
            </select>
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
              {pending ? "Admitting…" : "Admit patient"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
