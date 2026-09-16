"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, Stethoscope, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { changeDoctorStatus, saveDoctor, type DoctorState } from "@/app/administration/doctors/actions";

export type Doctor = { id:string; first_name:string; middle_name:string|null; last_name:string; suffix:string|null; license_number:string; specialty:string; phone:string|null; email:string|null; status:string; version:number; department_id:string|null };
type Department = { id:string; name:string };
type ReferenceOption={code:string;label:string};
const initial: DoctorState = { ok:false, message:"" };

export function DoctorsWorkspace({ doctors, departments, facilityId, specialties }: { doctors:Doctor[]; departments:Department[]; facilityId:string;specialties:ReferenceOption[] }) {
  const [editing,setEditing]=useState<Doctor|null|"new">(null);
  const [statusDoctor,setStatusDoctor]=useState<Doctor|null>(null);
  return <>
    <div className="toolbar"><button className="btn btn-primary" onClick={()=>setEditing("new")}><Plus size={15}/>Add doctor</button></div>
    <section className="card"><div className="card-header"><h3>Facility doctors</h3><span className="badge blue">{doctors.filter(d=>d.status==="active").length} active</span></div>
      <div className="table-wrap"><table className="data-table doctor-table"><thead><tr><th>Doctor</th><th>License</th><th>Specialty</th><th>Department</th><th>Contact</th><th>Status / Actions</th></tr></thead><tbody>
        {doctors.map(doctor=><tr key={doctor.id}><td className="name-cell"><strong>Dr. {doctor.last_name}, {doctor.first_name} {doctor.suffix||""}</strong><span>Version {doctor.version}</span></td><td>{doctor.license_number}</td><td>{doctor.specialty}</td><td>{departments.find(d=>d.id===doctor.department_id)?.name||"All departments"}</td><td className="name-cell"><span>{doctor.phone||"No phone"}</span><span>{doctor.email||"No email"}</span></td><td><div className="doctor-actions"><span className={`badge ${doctor.status==="active"?"green":"red"}`}>{doctor.status}</span><button className="btn btn-secondary" onClick={()=>setEditing(doctor)}><Pencil size={14}/>Edit</button><button className="btn btn-secondary" onClick={()=>setStatusDoctor(doctor)}>{doctor.status==="active"?<UserRoundX size={14}/>:<UserRoundCheck size={14}/>} {doctor.status==="active"?"Deactivate":"Activate"}</button></div></td></tr>)}
        {!doctors.length&&<tr><td colSpan={6} className="empty-state">No doctors registered yet.</td></tr>}
      </tbody></table></div>
    </section>
    {editing&&<DoctorDialog doctor={editing==="new"?undefined:editing} departments={departments} facilityId={facilityId} specialties={specialties} close={()=>setEditing(null)}/>} 
    {statusDoctor&&<StatusDialog doctor={statusDoctor} facilityId={facilityId} close={()=>setStatusDoctor(null)}/>} 
  </>;
}

function Head({title,close}:{title:string;close:()=>void}){return <div className="modal-head"><div><p className="eyebrow">Doctor Master List</p><h3>{title}</h3></div><button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>}
function DoctorDialog({doctor,departments,facilityId,close,specialties}:{doctor?:Doctor;departments:Department[];facilityId:string;close:()=>void;specialties:ReferenceOption[]}){
  const [state,action,pending]=useActionState(saveDoctor,initial);
  return <div className="modal-backdrop"><section className="modal doctor-modal" role="dialog" aria-modal="true"><Head title={doctor?"Edit doctor":"Add doctor"} close={close}/><form action={action} className="patient-form">
    <input type="hidden" name="facility_id" value={facilityId}/>{doctor&&<><input type="hidden" name="doctor_id" value={doctor.id}/><input type="hidden" name="version" value={doctor.version}/></>}
    <label>First name<input required minLength={2} maxLength={100} name="first_name" defaultValue={doctor?.first_name}/></label><label>Middle name<input maxLength={100} name="middle_name" defaultValue={doctor?.middle_name||""}/></label><label>Last name<input required minLength={2} maxLength={100} name="last_name" defaultValue={doctor?.last_name}/></label><label>Suffix<input maxLength={20} name="suffix" defaultValue={doctor?.suffix||""} placeholder="Jr., III"/></label>
    <label>License / PRC number<input required minLength={3} maxLength={80} name="license_number" defaultValue={doctor?.license_number}/></label><label>Specialty<select required name="specialty" defaultValue={doctor?.specialty||""}><option value="" disabled>Select specialty</option>{specialties.map(option=><option key={option.code} value={option.label}>{option.label}</option>)}</select></label>
    <label>Department<select name="department_id" defaultValue={doctor?.department_id||""}><option value="">All departments</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Phone<input maxLength={40} name="phone" defaultValue={doctor?.phone||""}/></label><label className="wide">Email<input type="email" maxLength={200} name="email" defaultValue={doctor?.email||""}/></label>
    {doctor&&<label className="wide">Reason for modification<textarea required minLength={5} maxLength={500} rows={4} name="reason" placeholder="Explain why the doctor record is being changed"/></label>}
    {state.message&&<div className={state.ok?"form-success wide":"form-error wide"}>{state.message}</div>}<div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok&&<button disabled={pending} className="btn btn-primary"><Stethoscope size={15}/>{pending?"Saving…":"Save doctor"}</button>}</div>
  </form></section></div>;
}
function StatusDialog({doctor,facilityId,close}:{doctor:Doctor;facilityId:string;close:()=>void}){
  const [state,action,pending]=useActionState(changeDoctorStatus,initial);const next=doctor.status==="active"?"inactive":"active";
  return <div className="modal-backdrop"><section className="modal doctor-status-modal" role="dialog" aria-modal="true"><Head title={`${next==="active"?"Activate":"Deactivate"} Dr. ${doctor.last_name}`} close={close}/><form action={action} className="adt-dialog-form"><input type="hidden" name="doctor_id" value={doctor.id}/><input type="hidden" name="facility_id" value={facilityId}/><input type="hidden" name="status" value={next}/><p>Historical records will retain this doctor. Inactive doctors will no longer appear in new clinical dropdowns.</p><label>Reason<textarea required minLength={5} maxLength={500} rows={5} name="reason"/></label>{state.message&&<div className={state.ok?"form-success":"form-error"}>{state.message}</div>}<div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button><button disabled={pending} className="btn btn-primary">{pending?"Saving…":"Confirm status"}</button></div></form></section></div>;
}
