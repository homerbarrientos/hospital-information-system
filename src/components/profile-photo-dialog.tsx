"use client";

import { useActionState } from "react";
import { Camera, X } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";

type PhotoState = { ok:boolean; message:string };

export function ProfilePhotoDialog({
  kind,
  recordId,
  facilityId,
  firstName,
  lastName,
  photoUrl,
  action,
  close,
}: {
  kind:"patient"|"doctor";
  recordId:string;
  facilityId:string;
  firstName:string;
  lastName:string;
  photoUrl:string|null;
  action:(state:PhotoState, form:FormData)=>Promise<PhotoState>;
  close:()=>void;
}) {
  const [state,formAction,pending] = useActionState(action,{ ok:false, message:"" });
  const label = kind === "patient" ? "Patient" : "Doctor";
  return <div className="modal-backdrop">
    <section className="modal profile-photo-dialog" role="dialog" aria-modal="true" aria-labelledby={`${kind}-photo-title`}>
      <div className="modal-head"><div><p className="eyebrow">{label} profile</p><h3 id={`${kind}-photo-title`}>Manage profile photo</h3></div><button type="button" className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>
      <form action={formAction} className="profile-photo-form">
        <input type="hidden" name="facility_id" value={facilityId}/><input type="hidden" name={`${kind}_id`} value={recordId}/>
        <div className="profile-photo-preview"><ProfilePhoto url={photoUrl} firstName={firstName} lastName={lastName} size="large"/></div>
        <label>JPG or PNG photo<input type="file" name="profile_photo" accept="image/jpeg,image/png" required={!photoUrl}/></label>
        <p className="profile-photo-help">Maximum 3 MB. The photo is stored privately and shown only to authorized Hospital ONE users.</p>
        {photoUrl ? <label className="profile-photo-remove"><input type="checkbox" name="remove_photo" value="true"/> Remove the current photo instead</label> : null}
        <label>Reason for photo change<textarea name="reason" required minLength={5} maxLength={500} rows={3} placeholder="Required for the audit trail"/></label>
        {state.message ? <div className={state.ok?"form-success":"form-error"} role="status">{state.message}</div> : null}
        <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok ? <button className="btn btn-primary" disabled={pending}><Camera size={15}/>{pending?"Saving…":"Save photo"}</button> : null}</div>
      </form>
    </section>
  </div>;
}
