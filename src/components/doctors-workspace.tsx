"use client";

import { useActionState, useState } from "react";
import { ImagePlus, Pencil, Plus, Stethoscope, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { changeDoctorStatus, saveDoctor, updateDoctorPhoto, type DoctorState } from "@/app/administration/doctors/actions";
import { ProfilePhoto } from "@/components/profile-photo";
import { ProfilePhotoDialog } from "@/components/profile-photo-dialog";

export type Doctor = { id:string; first_name:string; middle_name:string|null; last_name:string; suffix:string|null; license_number:string; specialty:string; phone:string|null; email:string|null; status:string; version:number; department_id:string|null; prc_issued_on:string|null; prc_expires_on:string|null; credential_status:string; philhealth_accreditation_no:string|null; philhealth_valid_from:string|null; philhealth_valid_until:string|null; subspecialty:string|null; doctor_type:string|null; clinic_schedule:string|null; professional_fee:number|null; profile_photo_path:string|null; profile_photo_url:string|null };
type Department = { id:string; name:string };
type ReferenceOption={code:string;label:string;group?:string};
const initial: DoctorState = { ok:false, message:"" };

export function DoctorsWorkspace({ doctors, departments, facilityId, referenceOptions }: { doctors:Doctor[]; departments:Department[]; facilityId:string;referenceOptions:ReferenceOption[] }) {
  const [editing,setEditing]=useState<Doctor|null|"new">(null);
  const [statusDoctor,setStatusDoctor]=useState<Doctor|null>(null);
  const [photoDoctor,setPhotoDoctor]=useState<Doctor|null>(null);
  return <>
    <div className="toolbar"><button className="btn btn-primary" onClick={()=>setEditing("new")}><Plus size={15}/>Add doctor</button></div>
    <section className="card"><div className="card-header"><h3>Facility doctors</h3><span className="badge blue">{doctors.filter(d=>d.status==="active").length} active</span></div>
      <div className="table-wrap"><table className="data-table doctor-table"><thead><tr><th>Doctor</th><th>License</th><th>Specialty</th><th>Department</th><th>Contact</th><th>Status / Actions</th></tr></thead><tbody>
        {doctors.map(doctor=><tr key={doctor.id}><td><div className="entity-identity"><ProfilePhoto url={doctor.profile_photo_url} firstName={doctor.first_name} lastName={doctor.last_name}/><span className="name-cell"><strong>Dr. {doctor.last_name}, {doctor.first_name} {doctor.suffix||""}</strong><span>{doctor.doctor_type||"Doctor"} · Version {doctor.version}</span></span></div></td><td className="name-cell"><span>{doctor.license_number}</span><span>{doctor.credential_status}{doctor.prc_expires_on?` · until ${doctor.prc_expires_on}`:""}</span></td><td className="name-cell"><span>{doctor.specialty}</span><span>{doctor.subspecialty||"No subspecialty"}</span></td><td>{departments.find(d=>d.id===doctor.department_id)?.name||"All departments"}</td><td className="name-cell"><span>{doctor.phone||"No phone"}</span><span>{doctor.email||"No email"}</span></td><td><div className="doctor-actions"><span className={`badge ${doctor.status==="active"?"green":"red"}`}>{doctor.status}</span><button className="btn btn-secondary" onClick={()=>setEditing(doctor)}><Pencil size={14}/>Edit</button><button className="btn btn-secondary" onClick={()=>setPhotoDoctor(doctor)}><ImagePlus size={14}/>Photo</button><button className="btn btn-secondary" onClick={()=>setStatusDoctor(doctor)}>{doctor.status==="active"?<UserRoundX size={14}/>:<UserRoundCheck size={14}/>} {doctor.status==="active"?"Deactivate":"Activate"}</button></div></td></tr>)}
        {!doctors.length&&<tr><td colSpan={6} className="empty-state">No doctors registered yet.</td></tr>}
      </tbody></table></div>
    </section>
    {editing&&<DoctorDialog doctor={editing==="new"?undefined:editing} departments={departments} facilityId={facilityId} referenceOptions={referenceOptions} close={()=>setEditing(null)}/>} 
    {statusDoctor&&<StatusDialog doctor={statusDoctor} facilityId={facilityId} close={()=>setStatusDoctor(null)}/>} 
    {photoDoctor&&<ProfilePhotoDialog kind="doctor" recordId={photoDoctor.id} facilityId={facilityId} firstName={photoDoctor.first_name} lastName={photoDoctor.last_name} photoUrl={photoDoctor.profile_photo_url} action={updateDoctorPhoto} close={()=>setPhotoDoctor(null)}/>}
  </>;
}

function Head({title,close}:{title:string;close:()=>void}){return <div className="modal-head"><div><p className="eyebrow">Doctor Master List</p><h3>{title}</h3></div><button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>}
function DoctorDialog({doctor,departments,facilityId,close,referenceOptions}:{doctor?:Doctor;departments:Department[];facilityId:string;close:()=>void;referenceOptions:ReferenceOption[]}){
  const [state,action,pending]=useActionState(saveDoctor,initial);
  const options=(group:string)=>referenceOptions.filter(option=>option.group===group);
  return <div className="modal-backdrop"><section className="modal doctor-modal" role="dialog" aria-modal="true"><Head title={doctor?"Edit doctor":"Add doctor"} close={close}/><form action={action} className="patient-form">
    <input type="hidden" name="facility_id" value={facilityId}/>{doctor&&<><input type="hidden" name="doctor_id" value={doctor.id}/><input type="hidden" name="version" value={doctor.version}/></>}
    <label>First name<input required minLength={2} maxLength={100} name="first_name" defaultValue={doctor?.first_name}/></label><label>Middle name<input maxLength={100} name="middle_name" defaultValue={doctor?.middle_name||""}/></label><label>Last name<input required minLength={2} maxLength={100} name="last_name" defaultValue={doctor?.last_name}/></label><label>Suffix<input maxLength={20} name="suffix" defaultValue={doctor?.suffix||""} placeholder="Jr., III"/></label>
    <h4 className="patient-form-section wide">PRC credentials and clinical role</h4>
    <label>License / PRC number<input required minLength={3} maxLength={80} name="license_number" defaultValue={doctor?.license_number}/></label><label>PRC issue date<input type="date" name="prc_issued_on" defaultValue={doctor?.prc_issued_on||""}/></label><label>PRC expiry date<input type="date" name="prc_expires_on" defaultValue={doctor?.prc_expires_on||""}/></label><label>Credential status<select required name="credential_status" defaultValue={doctor?.credential_status||"unverified"}>{options("credential_status").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
    <label>Specialty<select required name="specialty" defaultValue={doctor?.specialty||""}><option value="" disabled>Select specialty</option>{options("doctor_specialty").map(option=><option key={option.code} value={option.label}>{option.label}</option>)}</select></label><label>Subspecialty<input maxLength={120} name="subspecialty" defaultValue={doctor?.subspecialty||""}/></label><label>Doctor type<select name="doctor_type" defaultValue={doctor?.doctor_type||""}><option value="">Not recorded</option>{options("doctor_type").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
    <h4 className="patient-form-section wide">PhilHealth accreditation and facility assignment</h4>
    <label>PhilHealth accreditation no.<input maxLength={100} name="philhealth_accreditation_no" defaultValue={doctor?.philhealth_accreditation_no||""}/></label><label>Accreditation valid from<input type="date" name="philhealth_valid_from" defaultValue={doctor?.philhealth_valid_from||""}/></label><label>Accreditation valid until<input type="date" name="philhealth_valid_until" defaultValue={doctor?.philhealth_valid_until||""}/></label>
    <label>Department<select name="department_id" defaultValue={doctor?.department_id||""}><option value="">All departments</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Professional fee<input type="number" min="0" step="0.01" name="professional_fee" defaultValue={doctor?.professional_fee??""}/></label><label className="wide">Clinic schedule<textarea maxLength={1000} rows={3} name="clinic_schedule" defaultValue={doctor?.clinic_schedule||""} placeholder="Example: Monday to Friday, 9:00 AM to 12:00 PM"/></label>
    <h4 className="patient-form-section wide">Contact information</h4>
    <label>Phone<input maxLength={40} name="phone" defaultValue={doctor?.phone||""}/></label><label>Email<input type="email" maxLength={200} name="email" defaultValue={doctor?.email||""}/></label>
    {doctor&&<label className="wide">Reason for modification<textarea required minLength={5} maxLength={500} rows={4} name="reason" placeholder="Explain why the doctor record is being changed"/></label>}
    {state.message&&<div className={state.ok?"form-success wide":"form-error wide"}>{state.message}</div>}<div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok&&<button disabled={pending} className="btn btn-primary"><Stethoscope size={15}/>{pending?"Saving…":"Save doctor"}</button>}</div>
  </form></section></div>;
}
function StatusDialog({doctor,facilityId,close}:{doctor:Doctor;facilityId:string;close:()=>void}){
  const [state,action,pending]=useActionState(changeDoctorStatus,initial);const next=doctor.status==="active"?"inactive":"active";
  return <div className="modal-backdrop"><section className="modal doctor-status-modal" role="dialog" aria-modal="true"><Head title={`${next==="active"?"Activate":"Deactivate"} Dr. ${doctor.last_name}`} close={close}/><form action={action} className="adt-dialog-form"><input type="hidden" name="doctor_id" value={doctor.id}/><input type="hidden" name="facility_id" value={facilityId}/><input type="hidden" name="status" value={next}/><p>Historical records will retain this doctor. Inactive doctors will no longer appear in new clinical dropdowns.</p><label>Reason<textarea required minLength={5} maxLength={500} rows={5} name="reason"/></label>{state.message&&<div className={state.ok?"form-success":"form-error"}>{state.message}</div>}<div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button disabled={pending} className="btn btn-primary">{pending?"Saving…":"Confirm status"}</button></div></form></section></div>;
}
