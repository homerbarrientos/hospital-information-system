"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRightLeft, DoorOpen, ExternalLink, Eye, FilePlus2, FileUp, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  addDischargeAttachment,
  admitPatient,
  dischargePatient,
  loadPatientChart,
  removeDischargeAttachment,
  transferPatient,
  updateDischargeAttachment,
  type AdtState,
  type PatientChart,
} from "@/app/admissions/actions";
import { SearchPicker } from "@/components/search-picker";
import { ListControls, type ListState } from "@/components/list-controls";

type Patient = { id: string; mrn: string; first_name: string; last_name: string };
type Bed = { id: string; code: string; status: string; ward_id: string };
type Ward = { id: string; name: string };
type Encounter = { id: string; patient_id: string; responsible_doctor_id:string|null };
type Admission = { id: string; encounter_id: string; admission_no: string; status: string; admitted_at: string; admitting_doctor_id:string|null; attending_doctor_id:string|null };
type Doctor={id:string;first_name:string;last_name:string;suffix:string|null;specialty:string};
type ReferenceOption={code:string;label:string};
type Stay = { admission_id: string; bed_id: string; ended_at: string | null };
const initialState: AdtState = { ok: false, message: "" };
const doctorLabel=(doctor?:Doctor)=>doctor?`Dr. ${doctor.last_name}, ${doctor.first_name}${doctor.suffix?` ${doctor.suffix}`:""}`:"Not assigned";

export function AdtWorkspace({
  patients, beds, wards, encounters, admissions, stays, facilityId, doctors, dispositions, listState,
}: {
  patients: Patient[]; beds: Bed[]; wards: Ward[]; encounters: Encounter[];
  admissions: Admission[]; stays: Stay[]; facilityId: string; doctors:Doctor[];dispositions:ReferenceOption[];listState:ListState;
}) {
  const [open, setOpen] = useState(false);
  const available = beds.filter((bed) => bed.status === "available");
  const bedLabel = (bedId: string) => {
    const bed = beds.find((item) => item.id === bedId);
    return bed ? `${wards.find((ward) => ward.id === bed.ward_id)?.name || "Ward"} · ${bed.code}` : "—";
  };

  return <>
    <div className="toolbar">
      <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={15}/>New admission</button>
    </div>
    <section className="card">
      <ListControls
        basePath="/admissions"
        state={listState}
        statusOptions={[
          { value: "admitted", label: "Admitted patients" },
          { value: "discharged", label: "Discharged patients" },
          { value: "all", label: "All admissions" },
        ]}
        searchPlaceholder="Patient name or MRN"
        dateLabel="Admission date"
      />
      <div className="table-wrap list-table-scroll"><table className="data-table adt-table">
        <thead><tr><th>Admission</th><th>Patient</th><th>Attending doctor</th><th>Current location</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {admissions.map((admission) => {
            const encounter = encounters.find((item) => item.id === admission.encounter_id);
            const patient = patients.find((item) => item.id === encounter?.patient_id);
            const stay = stays.find((item) => item.admission_id === admission.id && !item.ended_at);
            return <tr key={admission.id}>
              <td className="name-cell"><strong>{admission.admission_no}</strong><span>{new Date(admission.admitted_at).toLocaleString()}</span></td>
              <td>{patient ? `${patient.last_name}, ${patient.first_name} · ${patient.mrn}` : "Patient"}</td>
              <td>{doctorLabel(doctors.find(doctor=>doctor.id===admission.attending_doctor_id))}</td>
              <td>{stay ? bedLabel(stay.bed_id) : "Discharged"}</td>
              <td><span className={`badge ${admission.status === "discharged" ? "blue" : "green"}`}>{admission.status}</span></td>
              <td><AdmissionActions admission={admission} patient={patient} availableBeds={available} bedLabel={bedLabel} doctors={doctors} dispositions={dispositions}/></td>
            </tr>;
          })}
          {!admissions.length && <tr><td colSpan={6} className="empty-state">No admissions recorded.</td></tr>}
        </tbody>
      </table></div>
    </section>
    {open && <AdmissionDialog availableBeds={available} facilityId={facilityId} bedLabel={bedLabel} close={() => setOpen(false)}/>} 
  </>;
}

function AdmissionActions({
  admission, patient, availableBeds, bedLabel, doctors, dispositions,
}: {
  admission: Admission; patient?: Patient; availableBeds: Bed[]; bedLabel: (bedId: string) => string; doctors:Doctor[];dispositions:ReferenceOption[];
}) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const active = admission.status !== "discharged";
  const patientName = patient ? `${patient.last_name}, ${patient.first_name}` : "Patient";
  return <>
    <div className="adt-row-actions">
      <button className="btn adt-view-btn" onClick={() => setChartOpen(true)}><Eye size={15}/>View chart</button>
      {active && <>
        <button className="btn adt-transfer-btn" onClick={() => setTransferOpen(true)}><ArrowRightLeft size={15}/>Transfer</button>
        <button className="btn adt-discharge-btn" onClick={() => setDischargeOpen(true)}><DoorOpen size={15}/>Prepare discharge</button>
      </>}
    </div>
    {transferOpen && <TransferDialog admissionId={admission.id} admissionNumber={admission.admission_no} patientName={patientName} availableBeds={availableBeds} bedLabel={bedLabel} close={() => setTransferOpen(false)}/>}
    {dischargeOpen && <DischargeDialog admissionId={admission.id} admissionNumber={admission.admission_no} patientName={patientName} doctors={doctors} dispositions={dispositions} defaultDoctorId={admission.attending_doctor_id||""} close={() => setDischargeOpen(false)} viewChart={() => setChartOpen(true)}/>} 
    {chartOpen && <PatientChartDialog admissionId={admission.id} close={() => setChartOpen(false)}/>}
  </>;
}

function DialogHead({ eyebrow, title, close }: { eyebrow: string; title: string; close: () => void }) {
  return <div className="modal-head"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>;
}

function TransferDialog({
  admissionId, admissionNumber, patientName, availableBeds, bedLabel, close,
}: {
  admissionId: string; admissionNumber: string; patientName: string; availableBeds: Bed[];
  bedLabel: (bedId: string) => string; close: () => void;
}) {
  const [state, action, pending] = useActionState(transferPatient, initialState);
  return <div className="modal-backdrop">
    <section className="modal adt-modal" role="dialog" aria-modal="true">
      <DialogHead eyebrow="Patient transfer" title="Transfer to another bed" close={close}/>
      <div className="adt-patient-strip"><strong>{patientName}</strong><span>{admissionNumber}</span></div>
      <form action={action} className="adt-dialog-form">
        <input type="hidden" name="admission_id" value={admissionId}/>
        <label>Destination bed<select required name="bed_id" defaultValue=""><option value="" disabled>Select an available bed</option>{availableBeds.map((bed) => <option key={bed.id} value={bed.id}>{bedLabel(bed.id)}</option>)}</select></label>
        <label>Transfer reason<textarea required minLength={5} maxLength={500} name="reason" rows={6} placeholder="Document the clinical or operational reason for this transfer"/></label>
        {state.message && <div className={state.ok ? "form-success" : "form-error"}>{state.message}</div>}
        <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button disabled={pending || state.ok} className="btn adt-transfer-btn"><ArrowRightLeft size={15}/>{pending ? "Transferring…" : state.ok ? "Transferred" : "Confirm transfer"}</button></div>
      </form>
    </section>
  </div>;
}

function DischargeDialog({
  admissionId, admissionNumber, patientName, close, viewChart, doctors, defaultDoctorId, dispositions,
}: {
  admissionId: string; admissionNumber: string; patientName: string; close: () => void; viewChart: () => void; doctors:Doctor[]; defaultDoctorId:string;dispositions:ReferenceOption[];
}) {
  const [state, action, pending] = useActionState(dischargePatient, initialState);
  return <div className="modal-backdrop">
    <section className="modal adt-modal discharge-modal" role="dialog" aria-modal="true">
      <DialogHead eyebrow="Discharge planning" title="Prepare patient discharge" close={close}/>
      <div className="adt-patient-strip">
        <span><strong>{patientName}</strong><small>{admissionNumber}</small></span>
        <button type="button" className="btn adt-view-btn" onClick={viewChart}><Eye size={15}/>View patient chart</button>
      </div>
      <form action={action} className="adt-dialog-form discharge-form">
        <input type="hidden" name="admission_id" value={admissionId}/>
        <div className="wide"><SearchPicker kind="doctor" name="doctor_id" label="Discharging doctor" title="Select discharging doctor" placeholder="No doctor selected" searchPlaceholder="Search doctor name or specialty" required defaultValue={defaultDoctorId} initialOption={doctors.find(doctor=>doctor.id===defaultDoctorId)?{value:defaultDoctorId,label:doctorLabel(doctors.find(doctor=>doctor.id===defaultDoctorId)),meta:doctors.find(doctor=>doctor.id===defaultDoctorId)?.specialty||""}:undefined}/></div>
        <label>Discharge disposition<select required name="disposition" defaultValue=""><option value="" disabled>Select outcome or destination</option>{dispositions.map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
        <label>Condition at discharge<input required minLength={2} maxLength={250} name="condition" placeholder="Stable, improved, guarded, or other condition"/></label>
        <label className="wide">Final diagnosis<textarea required minLength={2} maxLength={2000} name="final_diagnosis" rows={5} placeholder="Enter the confirmed diagnosis or diagnoses at discharge"/></label>
        <label className="wide">Discharge instructions<textarea required minLength={10} maxLength={4000} name="instructions" rows={8} placeholder="Care instructions, restrictions, warning signs, and when to seek urgent care"/></label>
        <label>Follow-up or referral<textarea minLength={2} maxLength={2000} name="follow_up" rows={6} placeholder="Clinic, provider, date, or referral details"/></label>
        <label>Discharge medications<textarea minLength={2} maxLength={2000} name="medications" rows={6} placeholder="Medicine, dose, route, frequency, and duration"/></label>
        <label className="wide attachment-field"><span><FileUp size={16}/>Optional supporting document</span><input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/><small>PDF, JPG, or PNG. Maximum 3 MB. Do not upload a duplicate of the patient chart.</small></label>
        {state.message && <div className={state.ok ? "form-success wide" : "form-error wide"}>{state.message}</div>}
        <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok ? "Close" : "Cancel"}</button>{!state.ok && <button disabled={pending} className="btn adt-discharge-btn"><DoorOpen size={15}/>{pending ? "Completing discharge…" : "Complete discharge"}</button>}</div>
      </form>
    </section>
  </div>;
}

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="chart-section"><h4>{title}</h4>{children}</section>;
}

function EmptyRecord({ text = "No records documented." }: { text?: string }) {
  return <p className="chart-empty">{text}</p>;
}

function PatientChartDialog({ admissionId, close }: { admissionId: string; close: () => void }) {
  const [chart, setChart] = useState<PatientChart | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [documentAction, setDocumentAction] = useState<{
    mode: "add" | "edit" | "remove";
    attachment?: PatientChart["attachments"][number];
  } | null>(null);
  useEffect(() => {
    let active = true;
    loadPatientChart(admissionId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setChart(result.chart);
        setError("");
      } else setError(result.message);
    });
    return () => { active = false; };
  }, [admissionId, refreshKey]);
  return <><div className="modal-backdrop chart-backdrop">
    <section className="modal chart-modal" role="dialog" aria-modal="true">
      <DialogHead eyebrow="Read-only clinical record" title={chart ? `${chart.patient.name} · ${chart.patient.mrn}` : "Patient chart"} close={close}/>
      {!chart && !error && <div className="chart-loading">Loading the secure patient chart…</div>}
      {error && <div className="form-error chart-error">{error}</div>}
      {chart && <div className="chart-body">
        <div className="chart-identity-grid">
          <div><span>Admission</span><strong>{chart.admission.number}</strong></div><div><span>Status</span><strong>{chart.admission.status}</strong></div>
          <div><span>Birth date</span><strong>{chart.patient.birthDate || "Not recorded"}</strong></div><div><span>Sex at birth</span><strong>{chart.patient.sexAtBirth || "Not recorded"}</strong></div>
        </div>
        <ChartSection title="Care team"><div className="chart-summary"><p><b>Admitting doctor:</b> {chart.careTeam.admittingDoctor}</p><p><b>Attending doctor:</b> {chart.careTeam.attendingDoctor}</p>{chart.dischargeSummary&&<p><b>Discharging doctor:</b> {chart.careTeam.dischargingDoctor}</p>}</div></ChartSection>
        <ChartSection title="Allergy warning">{chart.allergies.length ? <div className="chart-alerts">{chart.allergies.map((item, index) => <span key={index}>{item.substance}{item.reaction ? ` — ${item.reaction}` : ""}</span>)}</div> : <EmptyRecord text="No active allergies documented. Confirm with the patient."/>}</ChartSection>
        <ChartSection title="Latest vital signs">{chart.vitals.length ? <div className="chart-vitals">{chart.vitals.map((item, index) => <div key={index}><strong>{item.value} {item.unit}</strong><span>{item.code}</span></div>)}</div> : <EmptyRecord/>}</ChartSection>
        <ChartSection title="Diagnoses">{chart.diagnoses.length ? <ul>{chart.diagnoses.map((item, index) => <li key={index}><strong>{item.description}</strong><span>{item.type}</span></li>)}</ul> : <EmptyRecord/>}</ChartSection>
        <ChartSection title="Clinical notes">{chart.notes.length ? chart.notes.map((note, index) => <article className="chart-note" key={index}><header><strong>{note.encounterNumber}</strong><span>{note.serviceDate}</span></header><p><b>Chief complaint:</b> {note.chiefComplaint}</p><p><b>Clinical / SOAP note:</b> {note.soapNote}</p></article>) : <EmptyRecord/>}</ChartSection>
        <div className="chart-two-column">
          <ChartSection title="Orders and results">{chart.orders.length ? <ul>{chart.orders.map((order, index) => <li key={index}><strong>{order.number} · {order.type}</strong><span>{order.status}</span><p>{order.items.join(", ") || "No items"}{order.results.length ? ` — Results: ${order.results.join(", ")}` : ""}</p></li>)}</ul> : <EmptyRecord/>}</ChartSection>
          <ChartSection title="Medications">{chart.medications.length ? <ul>{chart.medications.map((medication, index) => <li key={index}><strong>{medication.number}</strong><span>{medication.status}</span><p>{medication.items.join("; ") || "No medicine items"}</p></li>)}</ul> : <EmptyRecord/>}</ChartSection>
        </div>
        <ChartSection title="Bed movement history">{chart.movements.length ? <ul>{chart.movements.map((movement, index) => <li key={index}><strong>{movement.location}</strong><span>{new Date(movement.startedAt).toLocaleString()} to {movement.endedAt ? new Date(movement.endedAt).toLocaleString() : "present"}</span>{movement.reason && <p>{movement.reason}</p>}</li>)}</ul> : <EmptyRecord/>}</ChartSection>
        {chart.dischargeSummary && <>
          <ChartSection title="Discharge summary"><div className="chart-summary"><p><b>Final diagnosis:</b> {chart.dischargeSummary.finalDiagnosis}</p><p><b>Condition:</b> {chart.dischargeSummary.condition}</p><p><b>Instructions:</b> {chart.dischargeSummary.instructions}</p><p><b>Follow-up:</b> {chart.dischargeSummary.followUp || "Not recorded"}</p><p><b>Medications:</b> {chart.dischargeSummary.medications || "Not recorded"}</p></div></ChartSection>
          <ChartSection title="Supporting documents">
            <div className="attachment-toolbar"><p>Private discharge attachments with an audited history.</p><button className="btn btn-primary" onClick={() => setDocumentAction({ mode: "add" })}><FilePlus2 size={15}/>Add attachment</button></div>
            {chart.attachments.length ? <div className="attachment-list">{chart.attachments.map((file) => <article key={file.id} className="attachment-card">
              <div><strong>{file.name}</strong><span>{file.description || "No description"} · {(file.sizeBytes / 1024).toFixed(0)} KB · {new Date(file.uploadedAt).toLocaleString()}</span></div>
              <div className="attachment-actions">
                <a className="btn adt-view-btn" href={file.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>View</a>
                <button className="btn adt-view-btn" onClick={() => setDocumentAction({ mode: "edit", attachment: file })}><Pencil size={14}/>Edit</button>
                <button className="btn attachment-remove-btn" onClick={() => setDocumentAction({ mode: "remove", attachment: file })}><Trash2 size={14}/>Remove</button>
              </div>
            </article>)}</div> : <EmptyRecord text="No supporting documents attached."/>}
          </ChartSection>
        </>}
      </div>}
    </section>
  </div>
  {documentAction && <AttachmentManagerDialog
    mode={documentAction.mode}
    admissionId={admissionId}
    attachment={documentAction.attachment}
    close={() => setDocumentAction(null)}
    saved={() => {
      setDocumentAction(null);
      setRefreshKey((current) => current + 1);
    }}
  />}</>;
}

function AttachmentManagerDialog({
  mode, admissionId, attachment, close, saved,
}: {
  mode: "add" | "edit" | "remove";
  admissionId: string;
  attachment?: PatientChart["attachments"][number];
  close: () => void;
  saved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<AdtState>(initialState);
  const title = mode === "add" ? "Add supporting document" : mode === "edit" ? "Edit attachment details" : "Remove attachment";
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = mode === "add"
      ? await addDischargeAttachment(form)
      : mode === "edit"
        ? await updateDischargeAttachment(form)
        : await removeDischargeAttachment(form);
    setPending(false);
    setState(result);
    if (result.ok) saved();
  };
  return <div className="modal-backdrop attachment-backdrop">
    <section className="modal attachment-modal" role="dialog" aria-modal="true">
      <DialogHead eyebrow="Discharge attachment" title={title} close={close}/>
      <form onSubmit={submit} className="adt-dialog-form attachment-form">
        <input type="hidden" name="admission_id" value={admissionId}/>
        {attachment && <input type="hidden" name="document_id" value={attachment.id}/>}
        {mode === "add" && <label>Document file<input required type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/><small>PDF, JPG, or PNG. Maximum 3 MB.</small></label>}
        {mode !== "remove" && <>
          <label>Document title<input required minLength={2} maxLength={120} name="display_name" defaultValue={attachment?.name || ""} placeholder="Example: Referral letter"/></label>
          <label>Description<textarea minLength={2} maxLength={1000} rows={6} name="description" defaultValue={attachment?.description || ""} placeholder="Describe what this document contains"/></label>
        </>}
        {mode === "edit" && <label>Reason for modification<textarea required minLength={5} maxLength={500} rows={5} name="reason" placeholder="Explain why the attachment details are being changed"/></label>}
        {mode === "remove" && <>
          <div className="attachment-warning"><strong>{attachment?.name}</strong><p>This removes the document from the active chart. The audit history is retained.</p></div>
          <label>Reason for removal<textarea required minLength={5} maxLength={500} rows={6} name="reason" placeholder="Explain why this attachment should be removed"/></label>
        </>}
        {state.message && <div className={state.ok ? "form-success" : "form-error"}>{state.message}</div>}
        <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button disabled={pending} className={`btn ${mode === "remove" ? "attachment-remove-btn" : "btn-primary"}`}>{pending ? "Saving…" : mode === "add" ? "Upload attachment" : mode === "edit" ? "Save changes" : "Remove attachment"}</button></div>
      </form>
    </section>
  </div>;
}

function AdmissionDialog({
  availableBeds, facilityId, bedLabel, close,
}: {
  availableBeds: Bed[]; facilityId: string; bedLabel: (bedId: string) => string; close: () => void;
}) {
  const [state, action, pending] = useActionState(admitPatient, initialState);
  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true">
      <DialogHead eyebrow="Patient movement" title="New admission" close={close}/>
      <form action={action} className="patient-form">
        <input type="hidden" name="facility_id" value={facilityId}/>
        <div className="wide"><SearchPicker kind="patient" name="patient_id" label="Patient" title="Select patient for admission" placeholder="No patient selected" searchPlaceholder="Search patient name or MRN" required/></div>
        <label className="wide">Available bed<select required name="bed_id" defaultValue=""><option value="" disabled>Select ward and bed</option>{availableBeds.map((bed) => <option key={bed.id} value={bed.id}>{bedLabel(bed.id)}</option>)}</select></label>
        <div className="wide"><SearchPicker kind="doctor" name="doctor_id" label="Admitting / attending doctor" title="Select admitting doctor" placeholder="No doctor selected" searchPlaceholder="Search doctor name or specialty" required/></div>
        {state.message && <div className={state.ok ? "form-success wide" : "form-error wide"}>{state.message}</div>}
        <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button disabled={pending} className="btn btn-primary">{pending ? "Admitting…" : "Admit patient"}</button></div>
      </form>
    </section>
  </div>;
}
