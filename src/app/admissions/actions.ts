"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AdtState = { ok: boolean; message: string };

const value = (form: FormData, key: string) => String(form.get(key) || "").trim();

async function call(name: string, args: Record<string, string>): Promise<AdtState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admissions");
  return { ok: true, message: "Saved successfully." };
}

export async function admitPatient(
  _: AdtState,
  form: FormData,
): Promise<AdtState> {
  const result = await call("admit_patient", {
    target_facility: value(form, "facility_id"),
    target_patient: value(form, "patient_id"),
    target_bed: value(form, "bed_id"),
  });
  return result.ok ? { ...result, message: "Patient admitted successfully." } : result;
}

export async function transferPatient(
  _: AdtState,
  form: FormData,
): Promise<AdtState> {
  const result = await call("transfer_patient", {
    target_admission: value(form, "admission_id"),
    target_bed: value(form, "bed_id"),
    transfer_reason: value(form, "reason"),
  });
  return result.ok ? { ...result, message: "Patient transferred successfully." } : result;
}

export async function dischargePatient(
  _: AdtState,
  form: FormData,
): Promise<AdtState> {
  const result = await call("discharge_patient", {
    target_admission: value(form, "admission_id"),
    disposition: value(form, "disposition"),
  });
  return result.ok ? { ...result, message: "Patient discharged successfully." } : result;
}
