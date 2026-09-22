"use client";

import { useActionState, useMemo, useState } from "react";
import { ImagePlus, Pencil, Plus, Search, X } from "lucide-react";
import { formatDate } from "@/lib/format";
import { registerPatient, setPatientStatus, updatePatient, updatePatientPhoto, type ActionState } from "@/app/patients/actions";
import { ProfilePhoto } from "@/components/profile-photo";
import { ProfilePhotoDialog } from "@/components/profile-photo-dialog";

type Address = { line1?: string; barangay?: string; city_municipality?: string; province?: string; postal_code?: string };
export type Patient = {
  id:string; mrn:string; first_name:string; middle_name:string|null; last_name:string; birth_date:string|null;
  sex_at_birth:string|null; phone:string|null; email:string|null; address:Address|null; created_at:string; version:number; status:string;
  civil_status:string|null; nationality:string|null; religion:string|null; blood_type:string|null; occupation:string|null;
  philhealth_no:string|null; philhealth_membership_type:string|null; philhealth_relationship:string|null; philhealth_status:string|null; philhealth_valid_until:string|null;
  government_id_type:string|null; government_id_no:string|null; emergency_contact_name:string|null; emergency_contact_relationship:string|null; emergency_contact_phone:string|null;
  profile_photo_path:string|null; profile_photo_url:string|null;
};
type Option = { code:string; label:string; group?:string };
const initial:ActionState = { ok:false, message:"" };

export function PatientWorkspace({ patients, facilityId, referenceOptions }:{ patients:Patient[]; facilityId:string; referenceOptions:Option[] }) {
  const [query,setQuery] = useState(""); const [editing,setEditing] = useState<Patient|null>(null); const [registering,setRegistering] = useState(false); const [photoPatient,setPhotoPatient] = useState<Patient|null>(null);
  const options = (group:string) => referenceOptions.filter(option => option.group === group);
  const label = (group:string, code:string|null) => options(group).find(option => option.code === code)?.label || code || "—";
  const shown = useMemo(() => { const q=query.toLowerCase(); return patients.filter(p => `${p.mrn} ${p.first_name} ${p.middle_name||""} ${p.last_name} ${p.phone||""} ${p.philhealth_no||""} ${p.government_id_no||""}`.toLowerCase().includes(q)); }, [patients,query]);
  return <>
    <div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search MRN, name, phone, PhilHealth, or government ID"/></div><button className="btn btn-primary" onClick={()=>setRegistering(true)}><Plus size={15}/>Register patient</button></div>
    <section className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>MRN</th><th>Patient</th><th>Birth date</th><th>Sex / Blood</th><th>Contact</th><th>PhilHealth</th><th>Action</th></tr></thead><tbody>
      {shown.map(p=><tr key={p.id}><td><strong>{p.mrn}</strong></td><td><div className="entity-identity"><ProfilePhoto url={p.profile_photo_url} firstName={p.first_name} lastName={p.last_name}/><span className="name-cell"><strong>{p.last_name}, {p.first_name} {p.middle_name||""}</strong><span>Created {formatDate(p.created_at)}</span></span></div></td><td>{p.birth_date||"—"}</td><td className="name-cell"><span>{label("sex_at_birth",p.sex_at_birth)}</span><span>{label("blood_type",p.blood_type)}</span></td><td>{p.phone||p.email||"—"}</td><td className="name-cell"><span>{p.philhealth_no||"Not recorded"}</span><span>{label("philhealth_status",p.philhealth_status)}</span></td><td><div className="record-actions"><button className="table-action" onClick={()=>setEditing(p)}><Pencil size={14}/> Edit</button><button className="table-action" onClick={()=>setPhotoPatient(p)}><ImagePlus size={14}/> Photo</button><form action={setPatientStatus}><input type="hidden" name="patient_id" value={p.id}/><input type="hidden" name="status" value={p.status==="active"?"inactive":"active"}/><input required name="reason" aria-label="Reason" placeholder="Reason"/><button className="table-action">{p.status==="active"?"Archive":"Restore"}</button></form></div></td></tr>)}
      {shown.length===0&&<tr><td colSpan={7} className="empty-state">No matching patients. Search first, then register a new record.</td></tr>}
    </tbody></table></div></section>
    {registering&&<PatientDialog title="Register patient" facilityId={facilityId} referenceOptions={referenceOptions} action={registerPatient} close={()=>setRegistering(false)}/>} 
    {editing&&<PatientDialog title="Edit patient" patient={editing} referenceOptions={referenceOptions} action={updatePatient} close={()=>setEditing(null)}/>} 
    {photoPatient&&<ProfilePhotoDialog kind="patient" recordId={photoPatient.id} facilityId={facilityId} firstName={photoPatient.first_name} lastName={photoPatient.last_name} photoUrl={photoPatient.profile_photo_url} action={updatePatientPhoto} close={()=>setPhotoPatient(null)}/>}
  </>;
}

function SelectField({ name, label, group, patient, options, required=false }:{ name:string; label:string; group:string; patient?:Patient; options:(group:string)=>Option[]; required?:boolean }) {
  const current = patient?.[name as keyof Patient] as string|null|undefined;
  return <label>{label}<select name={name} defaultValue={current||""} required={required}><option value="">Not recorded</option>{options(group).map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>;
}

function SectionTitle({ children }:{ children:React.ReactNode }) { return <h4 className="patient-form-section wide">{children}</h4>; }

function PatientDialog({ title, facilityId, patient, referenceOptions, action, close }:{ title:string; facilityId?:string; patient?:Patient; referenceOptions:Option[]; action:(s:ActionState,f:FormData)=>Promise<ActionState>; close:()=>void }) {
  const [state,formAction,pending] = useActionState(action,initial); const options=(group:string)=>referenceOptions.filter(option=>option.group===group); const address=patient?.address||{};
  return <div className="modal-backdrop"><section className="modal patient-profile-modal" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
    <div className="modal-head"><div><p className="eyebrow">Master patient index</p><h3 id="patient-dialog-title">{title}</h3></div><button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>
    <form action={formAction} className="patient-form expanded-patient-form">
      {facilityId&&<input type="hidden" name="facility_id" value={facilityId}/>} {patient&&<><input type="hidden" name="patient_id" value={patient.id}/><input type="hidden" name="version" value={patient.version}/></>}
      <SectionTitle>Identity and demographics</SectionTitle>
      <label>First name<input required minLength={2} maxLength={100} name="first_name" defaultValue={patient?.first_name}/></label><label>Middle name<input maxLength={100} name="middle_name" defaultValue={patient?.middle_name||""}/></label><label>Last name<input required minLength={2} maxLength={100} name="last_name" defaultValue={patient?.last_name}/></label><label>Birth date<input type="date" max={new Date().toISOString().slice(0,10)} name="birth_date" defaultValue={patient?.birth_date||""}/></label>
      <SelectField name="sex_at_birth" label="Sex at birth" group="sex_at_birth" patient={patient} options={options}/><SelectField name="civil_status" label="Civil status" group="civil_status" patient={patient} options={options}/><SelectField name="blood_type" label="Blood type" group="blood_type" patient={patient} options={options}/>
      <label>Nationality<input maxLength={80} name="nationality" defaultValue={patient?.nationality||"Filipino"}/></label><label>Religion<input maxLength={100} name="religion" defaultValue={patient?.religion||""}/></label><label>Occupation<input maxLength={120} name="occupation" defaultValue={patient?.occupation||""}/></label>
      <SectionTitle>Contact and address</SectionTitle>
      <label>Phone<input maxLength={40} name="phone" defaultValue={patient?.phone||""}/></label><label>Email<input type="email" maxLength={200} name="email" defaultValue={patient?.email||""}/></label><label className="wide">House number and street<input maxLength={250} name="address_line1" defaultValue={address.line1||""}/></label><label>Barangay<input maxLength={120} name="barangay" defaultValue={address.barangay||""}/></label><label>City / Municipality<input maxLength={120} name="city_municipality" defaultValue={address.city_municipality||""}/></label><label>Province<input maxLength={120} name="province" defaultValue={address.province||""}/></label><label>Postal code<input maxLength={12} name="postal_code" defaultValue={address.postal_code||""}/></label>
      <SectionTitle>PhilHealth and government identification</SectionTitle>
      <label>PhilHealth number<input inputMode="numeric" pattern="[0-9-]{12,14}" maxLength={14} name="philhealth_no" defaultValue={patient?.philhealth_no||""} placeholder="12-digit PIN"/></label><SelectField name="philhealth_membership_type" label="Membership type" group="philhealth_membership_type" patient={patient} options={options}/><SelectField name="philhealth_relationship" label="Member relationship" group="philhealth_relationship" patient={patient} options={options}/><SelectField name="philhealth_status" label="Eligibility status" group="philhealth_status" patient={patient} options={options}/><label>Eligibility valid until<input type="date" name="philhealth_valid_until" defaultValue={patient?.philhealth_valid_until||""}/></label><SelectField name="government_id_type" label="Government ID type" group="government_id_type" patient={patient} options={options}/><label>Government ID number<input maxLength={100} name="government_id_no" defaultValue={patient?.government_id_no||""}/></label>
      <SectionTitle>Emergency contact</SectionTitle>
      <label>Contact name<input maxLength={200} name="emergency_contact_name" defaultValue={patient?.emergency_contact_name||""}/></label><label>Relationship<input maxLength={80} name="emergency_contact_relationship" defaultValue={patient?.emergency_contact_relationship||""}/></label><label>Contact phone<input maxLength={40} name="emergency_contact_phone" defaultValue={patient?.emergency_contact_phone||""}/></label>
      {patient&&<><SectionTitle>Change control</SectionTitle><label className="wide">Reason for modification<textarea required minLength={5} maxLength={500} rows={4} name="reason" placeholder="Explain why the patient record is being changed"/></label></>}
      {state.message&&<div className={state.ok?"form-success wide":"form-error wide"}>{state.message}</div>}
      <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok&&<button disabled={pending} className="btn btn-primary">{pending?"Saving…":"Save patient"}</button>}</div>
    </form>
  </section></div>;
}
