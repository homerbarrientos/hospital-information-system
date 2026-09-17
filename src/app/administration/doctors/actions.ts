"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type DoctorState = { ok: boolean; message: string };
const value = (form: FormData, key: string) => String(form.get(key) || "").trim();

export async function saveDoctor(_: DoctorState, form: FormData): Promise<DoctorState> {
  const supabase = await createClient();
  const doctorId = value(form, "doctor_id");
  const common = {
    target_facility: value(form, "facility_id"),
    first_name: value(form, "first_name"),
    middle_name: value(form, "middle_name"),
    last_name: value(form, "last_name"),
    suffix: value(form, "suffix"),
    license_number: value(form, "license_number"),
    specialty: value(form, "specialty"),
    phone: value(form, "phone"),
    email: value(form, "email"),
    target_department: value(form, "department_id") || null,
    prc_issued_on: value(form, "prc_issued_on") || null,
    prc_expires_on: value(form, "prc_expires_on") || null,
    credential_status: value(form, "credential_status") || "unverified",
    philhealth_accreditation_no: value(form, "philhealth_accreditation_no"),
    philhealth_valid_from: value(form, "philhealth_valid_from") || null,
    philhealth_valid_until: value(form, "philhealth_valid_until") || null,
    subspecialty: value(form, "subspecialty"),
    doctor_type: value(form, "doctor_type"),
    clinic_schedule: value(form, "clinic_schedule"),
    professional_fee: value(form, "professional_fee") ? Number(value(form, "professional_fee")) : null,
  };
  if (!common.first_name || !common.last_name || !common.license_number || !common.specialty) {
    return { ok: false, message: "First name, last name, license number, and specialty are required." };
  }
  const { error } = doctorId
    ? await supabase.rpc("update_doctor_extended", { ...common, target_doctor: doctorId, expected_version: Number(value(form, "version")), modification_reason: value(form, "reason") })
    : await supabase.rpc("create_doctor_extended", common);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/administration/doctors");
  revalidatePath("/clinical");
  revalidatePath("/admissions");
  revalidatePath("/orders");
  return { ok: true, message: doctorId ? "Doctor record updated with an audit entry." : "Doctor added to the master list." };
}

export async function changeDoctorStatus(_: DoctorState, form: FormData): Promise<DoctorState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_doctor_status", {
    target_doctor: value(form, "doctor_id"),
    target_facility: value(form, "facility_id"),
    next_status: value(form, "status"),
    change_reason: value(form, "reason"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/administration/doctors");
  return { ok: true, message: "Doctor status updated." };
}
