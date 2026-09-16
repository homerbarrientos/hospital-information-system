"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ClinicalState = { ok: boolean; message: string };
const text = (form: FormData, key: string) => String(form.get(key) || "").trim();
const numberOrNull = (form: FormData, key: string) => {
  const value = text(form, key);
  return value === "" ? null : Number(value);
};

function vitalError(form: FormData) {
  const systolic = numberOrNull(form, "systolic");
  const diastolic = numberOrNull(form, "diastolic");
  const temperature = numberOrNull(form, "temperature");
  const spo2 = numberOrNull(form, "spo2");
  if ((systolic === null) !== (diastolic === null)) return "Enter both systolic and diastolic blood pressure.";
  if (systolic !== null && (systolic < 40 || systolic > 300)) return "Systolic BP must be between 40 and 300 mmHg.";
  if (diastolic !== null && (diastolic < 20 || diastolic > 200)) return "Diastolic BP must be between 20 and 200 mmHg.";
  if (systolic !== null && diastolic !== null && systolic <= diastolic) return "Systolic BP must be higher than diastolic BP.";
  if (temperature !== null && (temperature < 25 || temperature > 45)) return "Temperature must be between 25 and 45 °C.";
  if (spo2 !== null && (spo2 < 40 || spo2 > 100)) return "SpO₂ must be between 40 and 100%.";
  return "";
}

export async function createConsultation(_: ClinicalState, form: FormData): Promise<ClinicalState> {
  const validation = vitalError(form);
  if (validation) return { ok: false, message: validation };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_consultation_with_doctor", {
    target_facility: text(form, "facility_id"), target_patient: text(form, "patient_id"), target_doctor: text(form, "doctor_id"),
    chief_complaint: text(form, "chief_complaint"), soap_note: text(form, "soap_note"), diagnosis: text(form, "diagnosis"),
    allergy_substance: text(form, "allergy_substance"), allergy_reaction: text(form, "allergy_reaction"),
    systolic: numberOrNull(form, "systolic"), diastolic: numberOrNull(form, "diastolic"), temperature: numberOrNull(form, "temperature"), spo2: numberOrNull(form, "spo2"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clinical");
  return { ok: true, message: "Consultation recorded with the responsible doctor and audit event." };
}

export async function cancelEncounter(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_encounter", { target_encounter: text(form, "encounter_id"), cancel_reason: text(form, "reason") });
  if (error) throw new Error(error.message);
  revalidatePath("/clinical");
}

export async function amendConsultation(_: ClinicalState, form: FormData): Promise<ClinicalState> {
  const validation = vitalError(form);
  if (validation) return { ok: false, message: validation };
  const allergySubstance = text(form, "allergy_substance");
  const allergies = allergySubstance ? [{ substance: allergySubstance, reaction: text(form, "allergy_reaction") || null }] : [];
  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_consultation_details", {
    target_encounter: text(form, "encounter_id"), new_chief_complaint: text(form, "chief_complaint"), new_soap_note: text(form, "soap_note"),
    new_diagnosis: text(form, "diagnosis"), new_allergies: allergies, systolic: numberOrNull(form, "systolic"),
    diastolic: numberOrNull(form, "diastolic"), temperature: numberOrNull(form, "temperature"), spo2: numberOrNull(form, "spo2"), amendment_reason: text(form, "reason"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clinical");
  return { ok: true, message: "Amendment saved. The previous version was retained." };
}

export async function updateAllergy(_: ClinicalState, form: FormData): Promise<ClinicalState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_patient_allergy", {
    target_allergy: text(form, "allergy_id"), new_substance: text(form, "substance"), new_reaction: text(form, "reaction"),
    new_severity: text(form, "severity"), expected_version: Number(text(form, "version")), modification_reason: text(form, "reason"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clinical");
  return { ok: true, message: "Allergy updated with an audit record." };
}

export async function changeAllergyStatus(_: ClinicalState, form: FormData): Promise<ClinicalState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_patient_allergy_status", {
    target_allergy: text(form, "allergy_id"), next_status: text(form, "next_status"), status_reason: text(form, "reason"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clinical");
  return { ok: true, message: "Allergy status updated with an audit record." };
}
