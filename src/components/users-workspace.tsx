"use client";

import { useActionState, useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, UserRoundCheck, UserRoundX, UsersRound, X } from "lucide-react";
import { changeStaffStatus, inviteStaff, resetStaffPassword, updateStaff, type StaffState } from "@/app/administration/users/actions";

type Assignment = { role_id: string; department_id: string | null; active: boolean };
export type StaffMember = { id:string;full_name:string;employee_no:string|null;email:string|null;login_method:"email"|"employee_id";must_change_password:boolean;status:string;version:number;created_at:string;assignments:Assignment[] };
type Role = { id:string;name:string;description:string|null;status:string };
type Department = { id:string;code:string;name:string;status:string };
const initial: StaffState = { ok:false, message:"" };

export function UsersWorkspace({ currentUserId, facilityId, members, roles, departments }: { currentUserId:string;facilityId:string;members:StaffMember[];roles:Role[];departments:Department[] }) {
  const [creating,setCreating]=useState(false);
  const [editing,setEditing]=useState<StaffMember|null>(null);
  const [statusMember,setStatusMember]=useState<StaffMember|null>(null);
  const [resetMember,setResetMember]=useState<StaffMember|null>(null);
  const roleMap=useMemo(()=>new Map(roles.map(role=>[role.id,role.name])),[roles]);
  const departmentMap=useMemo(()=>new Map(departments.map(department=>[department.id,department.name])),[departments]);
  const activeRoles=roles.filter(role=>role.status==="active");
  return <>
    <section className="admin-summary-grid">
      <article className="metric"><div className="metric-head"><span>Facility staff</span><UsersRound size={18}/></div><strong>{members.length}</strong><small>Named accounts with facility assignments</small></article>
      <article className="metric"><div className="metric-head"><span>Active accounts</span><UserRoundCheck size={18}/></div><strong>{members.filter(member=>member.status==="active").length}</strong><small>Eligible to sign in when a role is active</small></article>
      <article className="metric"><div className="metric-head"><span>Available roles</span><UsersRound size={18}/></div><strong>{activeRoles.length}</strong><small>Deny-by-default facility roles</small></article>
    </section>
    <div className="toolbar"><button className="btn btn-primary" onClick={()=>setCreating(true)}><Plus size={15}/>Add staff member</button></div>
    <section className="card"><div className="card-header"><div><h3>Facility users and assignments</h3><p>Deactivation blocks access while preserving audit and transaction history.</p></div><span className="badge blue">{members.length} accounts</span></div>
      <div className="table-wrap"><table className="data-table admin-users-table"><thead><tr><th>Staff member</th><th>Employee no.</th><th>Department</th><th>Roles</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {members.map(member=>{const activeAssignments=member.assignments.filter(assignment=>assignment.active);const department=departmentMap.get(activeAssignments.find(assignment=>assignment.department_id)?.department_id||"");const isSelf=member.id===currentUserId;return <tr key={member.id}><td className="name-cell"><strong>{member.full_name}{isSelf?" (you)":""}</strong><span>{member.login_method==="employee_id"?`Employee ID: ${member.employee_no||"Unavailable"}`:member.email||"Email unavailable"}</span></td><td>{member.employee_no||"—"}</td><td>{department||"All departments"}</td><td><div className="role-chip-list">{activeAssignments.map(assignment=><span className="badge blue" key={assignment.role_id}>{roleMap.get(assignment.role_id)||"Unknown role"}</span>)}{!activeAssignments.length?<span className="badge red">No active role</span>:null}</div></td><td><div className="role-chip-list"><span className={`badge ${member.status==="active"?"green":"red"}`}>{member.status}</span>{member.must_change_password?<span className="badge amber">password change required</span>:null}</div></td><td><div className="admin-row-actions"><button className="btn btn-secondary" disabled={isSelf} title={isSelf?"Another administrator must change your access":"Edit staff assignment"} onClick={()=>setEditing(member)}><Pencil size={14}/>Edit</button>{member.login_method==="employee_id"?<button className="btn btn-secondary" disabled={isSelf} title="Issue a new one-time temporary password" onClick={()=>setResetMember(member)}><KeyRound size={14}/>Reset password</button>:null}<button className="btn btn-secondary" disabled={isSelf} title={isSelf?"You cannot change your own status":"Change account status"} onClick={()=>setStatusMember(member)}>{member.status==="active"?<UserRoundX size={14}/>:<UserRoundCheck size={14}/>} {member.status==="active"?"Deactivate":"Activate"}</button></div></td></tr>})}
        {!members.length?<tr><td colSpan={6} className="empty-state">No staff accounts are assigned to this facility.</td></tr>:null}
      </tbody></table></div>
    </section>
    {creating?<StaffDialog title="Add staff member" facilityId={facilityId} roles={activeRoles} departments={departments} action={inviteStaff} close={()=>setCreating(false)}/>:null}
    {editing?<StaffDialog title={`Edit ${editing.full_name}`} facilityId={facilityId} member={editing} roles={activeRoles} departments={departments} action={updateStaff} close={()=>setEditing(null)}/>:null}
    {statusMember?<StatusDialog facilityId={facilityId} member={statusMember} close={()=>setStatusMember(null)}/>:null}
    {resetMember?<ResetPasswordDialog facilityId={facilityId} member={resetMember} close={()=>setResetMember(null)}/>:null}
  </>;
}

function ModalHead({title,close}:{title:string;close:()=>void}){return <div className="modal-head"><div><p className="eyebrow">User administration</p><h3>{title}</h3></div><button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>}

function StaffDialog({title,facilityId,member,roles,departments,action,close}:{title:string;facilityId:string;member?:StaffMember;roles:Role[];departments:Department[];action:(state:StaffState,form:FormData)=>Promise<StaffState>;close:()=>void}){
  const [state,formAction,pending]=useActionState(action,initial);
  const [loginMethod,setLoginMethod]=useState<"email"|"employee_id">("email");
  const assigned=new Set(member?.assignments.filter(assignment=>assignment.active).map(assignment=>assignment.role_id)||[]);
  const departmentId=member?.assignments.find(assignment=>assignment.active&&assignment.department_id)?.department_id||"";
  return <div className="modal-backdrop"><section className="modal admin-user-modal" role="dialog" aria-modal="true"><ModalHead title={title} close={close}/><form action={formAction} className="patient-form">
    <input type="hidden" name="facility_id" value={facilityId}/>{member?<input type="hidden" name="user_id" value={member.id}/>:null}
    {!member?<><label className="wide">Login method<select name="login_method" value={loginMethod} onChange={event=>setLoginMethod(event.target.value as "email"|"employee_id")}><option value="email">Email invitation</option><option value="employee_id">Employee ID and temporary password</option></select></label>{loginMethod==="email"?<label className="wide">Email address<input required type="email" maxLength={254} name="email" placeholder="staff@hospital.example"/></label>:<input type="hidden" name="email" value=""/>}</>:<div className="admin-readonly wide"><span>Sign-in method</span><strong>{member.login_method==="employee_id"?`Employee ID · ${member.employee_no}`:member.email||"Email unavailable"}</strong></div>}
    <label>Full name<input required minLength={2} maxLength={160} name="full_name" defaultValue={member?.full_name||""}/></label>
    <label>Employee number<input required={!member&&loginMethod==="employee_id"} maxLength={80} name="employee_no" defaultValue={member?.employee_no||""} placeholder="EMP-00015"/></label>
    <label className="wide">Department<select name="department_id" defaultValue={departmentId}><option value="">All departments</option>{departments.filter(department=>department.status==="active").map(department=><option key={department.id} value={department.id}>{department.name} ({department.code})</option>)}</select></label>
    <fieldset className="admin-role-picker wide"><legend>Facility roles</legend>{roles.map(role=><label key={role.id}><input type="checkbox" name="role_ids" value={role.id} defaultChecked={assigned.has(role.id)}/><span><strong>{role.name}</strong><small>{role.description||"No description"}</small></span></label>)}</fieldset>
    {member?<label className="wide">Reason for modification<textarea required minLength={5} maxLength={500} rows={4} name="reason" placeholder="Explain the access or profile change"/></label>:null}
    {state.message?<div className={state.ok?"form-success wide":"form-error wide"} aria-live="polite">{state.message}</div>:null}
    {state.ok&&state.temporaryPassword?<div className="temporary-credential wide"><span>Give these credentials directly to the staff member. This password will not be shown again.</span><strong>Employee ID: {state.loginIdentifier}</strong><code>{state.temporaryPassword}</code></div>:null}
    <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok?<button disabled={pending} className="btn btn-primary">{pending?"Saving…":member?"Save staff access":loginMethod==="employee_id"?"Create staff account":"Send invitation"}</button>:null}</div>
  </form></section></div>;
}

function ResetPasswordDialog({facilityId,member,close}:{facilityId:string;member:StaffMember;close:()=>void}){
  const [state,action,pending]=useActionState(resetStaffPassword,initial);
  return <div className="modal-backdrop"><section className="modal admin-status-modal" role="dialog" aria-modal="true"><ModalHead title={`Reset password for ${member.full_name}`} close={close}/><form action={action} className="adt-dialog-form"><input type="hidden" name="facility_id" value={facilityId}/><input type="hidden" name="user_id" value={member.id}/><input type="hidden" name="employee_no" value={member.employee_no||""}/><p>A new temporary password will replace the current password. The staff member must change it at the next login.</p><label>Reset reason<textarea required minLength={5} maxLength={500} rows={5} name="reason"/></label>{state.message?<div className={state.ok?"form-success":"form-error"}>{state.message}</div>:null}{state.ok&&state.temporaryPassword?<div className="temporary-credential"><span>Shown once—deliver it directly to the staff member.</span><strong>Employee ID: {state.loginIdentifier}</strong><code>{state.temporaryPassword}</code></div>:null}<div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok?<button disabled={pending} className="btn btn-primary">{pending?"Resetting…":"Issue temporary password"}</button>:null}</div></form></section></div>;
}

function StatusDialog({facilityId,member,close}:{facilityId:string;member:StaffMember;close:()=>void}){
  const [state,action,pending]=useActionState(changeStaffStatus,initial);const next=member.status==="active"?"inactive":"active";
  return <div className="modal-backdrop"><section className="modal admin-status-modal" role="dialog" aria-modal="true"><ModalHead title={`${next==="active"?"Activate":"Deactivate"} ${member.full_name}`} close={close}/><form action={action} className="adt-dialog-form"><input type="hidden" name="facility_id" value={facilityId}/><input type="hidden" name="user_id" value={member.id}/><input type="hidden" name="status" value={next}/><p>{next==="inactive"?"The user will lose access immediately. Historical records and audit attribution remain unchanged.":"The account will regain access through its active facility role assignments."}</p><label>Reason<textarea required minLength={5} maxLength={500} rows={5} name="reason"/></label>{state.message?<div className={state.ok?"form-success":"form-error"}>{state.message}</div>:null}<div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>{!state.ok?<button disabled={pending} className="btn btn-primary">{pending?"Saving…":"Confirm status"}</button>:null}</div></form></section></div>;
}
