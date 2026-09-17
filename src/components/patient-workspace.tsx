"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { registerPatient, setPatientStatus, updatePatient, type ActionState } from "@/app/patients/actions";
import { ListControls, type ListState } from "@/components/list-controls";

export type Patient = {
  id: string; mrn: string; first_name: string; middle_name: string | null; last_name: string;
  birth_date: string | null; sex_at_birth: string | null; phone: string | null; email: string | null;
  created_at: string; version: number; status: string;
};
type Option = { code: string; label: string };
const initial: ActionState = { ok: false, message: "" };

export function PatientWorkspace({ patients, facilityId, sexOptions, listState }: {
  patients: Patient[]; facilityId: string; sexOptions: Option[]; listState: ListState;
}) {
  const [editing, setEditing] = useState<Patient | null>(null);
  const [registering, setRegistering] = useState(false);

  return <>
    <div className="toolbar">
      <button className="btn btn-primary" onClick={() => setRegistering(true)}><Plus size={15}/>Register patient</button>
    </div>
    <section className="card">
      <ListControls
        basePath="/patients"
        state={listState}
        statusOptions={[
          { value: "active", label: "Active patients" },
          { value: "inactive", label: "Archived patients" },
          { value: "all", label: "All patients" },
        ]}
        searchPlaceholder="MRN, patient name, or phone"
        dateLabel="Registration date"
      />
      <div className="table-wrap list-table-scroll"><table className="data-table">
        <thead><tr><th>MRN</th><th>Patient</th><th>Birth date</th><th>Sex</th><th>Contact</th><th>Action</th></tr></thead>
        <tbody>
          {patients.map((patient) => <tr key={patient.id}>
            <td><strong>{patient.mrn}</strong></td>
            <td className="name-cell"><strong>{patient.last_name}, {patient.first_name} {patient.middle_name || ""}</strong><span>Created {new Date(patient.created_at).toLocaleDateString()}</span></td>
            <td>{patient.birth_date || "—"}</td>
            <td>{sexOptions.find((option) => option.code === patient.sex_at_birth)?.label || patient.sex_at_birth || "—"}</td>
            <td>{patient.phone || patient.email || "—"}</td>
            <td><div className="record-actions">
              <button className="table-action" onClick={() => setEditing(patient)}><Pencil size={14}/> Edit</button>
              <form action={setPatientStatus}>
                <input type="hidden" name="patient_id" value={patient.id}/>
                <input type="hidden" name="status" value={patient.status === "active" ? "inactive" : "active"}/>
                <input required name="reason" aria-label="Reason" placeholder="Reason"/>
                <button className="table-action">{patient.status === "active" ? "Archive" : "Restore"}</button>
              </form>
            </div></td>
          </tr>)}
          {!patients.length && <tr><td colSpan={6} className="empty-state">No patients match the selected filters.</td></tr>}
        </tbody>
      </table></div>
    </section>
    {registering && <PatientDialog title="Register patient" facilityId={facilityId} sexOptions={sexOptions} action={registerPatient} close={() => setRegistering(false)}/>} 
    {editing && <PatientDialog title="Edit patient" patient={editing} sexOptions={sexOptions} action={updatePatient} close={() => setEditing(null)}/>} 
  </>;
}

function PatientDialog({ title, facilityId, patient, sexOptions, action, close }: {
  title: string; facilityId?: string; patient?: Patient; sexOptions: Option[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>; close: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
    <div className="modal-head"><div><p className="eyebrow">Master patient index</p><h3 id="patient-dialog-title">{title}</h3></div><button className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>
    <form action={formAction} className="patient-form">
      {facilityId && <input type="hidden" name="facility_id" value={facilityId}/>} 
      {patient && <><input type="hidden" name="patient_id" value={patient.id}/><input type="hidden" name="version" value={patient.version}/></>}
      <label>First name<input required name="first_name" defaultValue={patient?.first_name}/></label>
      <label>Middle name<input name="middle_name" defaultValue={patient?.middle_name || ""}/></label>
      <label>Last name<input required name="last_name" defaultValue={patient?.last_name}/></label>
      <label>Birth date<input type="date" name="birth_date" defaultValue={patient?.birth_date || ""}/></label>
      <label>Sex at birth<select name="sex_at_birth" defaultValue={patient?.sex_at_birth || ""}><option value="">Not recorded</option>{sexOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      <label>Phone<input name="phone" defaultValue={patient?.phone || ""}/></label>
      <label className="wide">Email<input type="email" name="email" defaultValue={patient?.email || ""}/></label>
      {state.message && <div className={state.ok ? "form-success wide" : "form-error wide"}>{state.message}</div>}
      <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button disabled={pending} className="btn btn-primary">{pending ? "Saving…" : "Save patient"}</button></div>
    </form>
  </section></div>;
}
