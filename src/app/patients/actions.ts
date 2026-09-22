"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string };
const value = (form: FormData, key: string) => String(form.get(key) || "").trim();
const optionalDate = (form: FormData, key: string) => value(form, key) || null;

function profileFields(form: FormData) {
  return {
    first_name: value(form, "first_name"), middle_name: value(form, "middle_name"), last_name: value(form, "last_name"),
    birth_date: optionalDate(form, "birth_date"), sex_at_birth: value(form, "sex_at_birth"), phone: value(form, "phone"), email: value(form, "email") || null,
    civil_status: value(form, "civil_status"), nationality: value(form, "nationality"), religion: value(form, "religion"), blood_type: value(form, "blood_type"), occupation: value(form, "occupation"),
    philhealth_no: value(form, "philhealth_no"), philhealth_membership_type: value(form, "philhealth_membership_type"), philhealth_relationship: value(form, "philhealth_relationship"), philhealth_status: value(form, "philhealth_status"), philhealth_valid_until: optionalDate(form, "philhealth_valid_until"),
    government_id_type: value(form, "government_id_type"), government_id_no: value(form, "government_id_no"),
    emergency_contact_name: value(form, "emergency_contact_name"), emergency_contact_relationship: value(form, "emergency_contact_relationship"), emergency_contact_phone: value(form, "emergency_contact_phone"),
    address_line1: value(form, "address_line1"), barangay: value(form, "barangay"), city_municipality: value(form, "city_municipality"), province: value(form, "province"), postal_code: value(form, "postal_code"),
  };
}

export async function registerPatient(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient(); const fields = profileFields(form);
  if (!fields.first_name || !fields.last_name) return { ok: false, message: "First and last name are required." };
  const { error } = await supabase.rpc("register_patient_extended", { target_facility: value(form, "facility_id"), ...fields });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/patients"); return { ok: true, message: "Patient registered with identity, contact, and PhilHealth information." };
}

export async function updatePatient(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient(); const fields = profileFields(form);
  const renamed = Object.fromEntries(Object.entries(fields).map(([key, fieldValue]) => [`new_${key}`, fieldValue]));
  const { error } = await supabase.rpc("update_patient_extended", { target_patient: value(form, "patient_id"), expected_version: Number(value(form, "version")), modification_reason: value(form, "reason"), ...renamed });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/patients"); revalidatePath("/clinical"); revalidatePath("/admissions");
  return { ok: true, message: "Patient profile updated with a complete audit entry." };
}

export async function setPatientStatus(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_patient_status", { target_patient: value(form, "patient_id"), new_status: value(form, "status"), change_reason: value(form, "reason") });
  if (error) throw new Error(error.message); revalidatePath("/patients");
}

export async function updatePatientPhoto(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const facilityId = value(form, "facility_id");
  const patientId = value(form, "patient_id");
  const reason = value(form, "reason");
  const removePhoto = value(form, "remove_photo") === "true";
  const photo = form.get("profile_photo");
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (!facilityId || !patientId || reason.length < 5) return { ok:false, message:"A reason of at least five characters is required." };
  if (removePhoto && hasPhoto) return { ok:false, message:"Choose either a replacement photo or remove the current photo." };
  if (!removePhoto && !hasPhoto) return { ok:false, message:"Choose a JPG or PNG profile photo." };

  let newPath: string | null = null;
  let fileName: string | null = null;
  let fileType: string | null = null;
  let fileSize: number | null = null;
  if (hasPhoto) {
    const extensions = new Map([["image/jpeg","jpg"],["image/png","png"]]);
    const extension = extensions.get(photo.type);
    if (!extension) return { ok:false, message:"Profile photo must be a JPG or PNG image." };
    if (photo.size > 3 * 1024 * 1024) return { ok:false, message:"Profile photo must be 3 MB or smaller." };
    newPath = `${facilityId}/patients/${patientId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("profile-photos").upload(newPath, photo, { contentType:photo.type, upsert:false });
    if (uploadError) return { ok:false, message:uploadError.message };
    fileName = photo.name; fileType = photo.type; fileSize = photo.size;
  }

  const { data: oldPath, error } = await supabase.rpc("set_patient_profile_photo", {
    target_patient:patientId, target_facility:facilityId, new_path:newPath,
    original_file_name:fileName, file_type:fileType, file_size:fileSize, change_reason:reason,
  });
  if (error) {
    if (newPath) await supabase.storage.from("profile-photos").remove([newPath]);
    return { ok:false, message:error.message };
  }
  if (oldPath && oldPath !== newPath) await supabase.storage.from("profile-photos").remove([String(oldPath)]);
  revalidatePath("/patients"); revalidatePath("/clinical"); revalidatePath("/admissions");
  return { ok:true, message:removePhoto ? "Patient profile photo removed with an audit entry." : "Patient profile photo updated with an audit entry." };
}
