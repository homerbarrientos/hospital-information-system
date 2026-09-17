"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PharmacyState = { ok: boolean; message: string };
const initialError = (message: string): PharmacyState => ({ ok: false, message });
const value = (form: FormData, key: string) => String(form.get(key) || "").trim();

async function rpc(name: string, args: Record<string, unknown>, success: string): Promise<PharmacyState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return initialError(error.message);
  revalidatePath("/pharmacy");
  return { ok: true, message: success };
}

function prescriptionItems(form: FormData) {
  try {
    const items = JSON.parse(value(form, "items"));
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) return null;
    return items;
  } catch {
    return null;
  }
}

export async function createPrescription(_: PharmacyState, form: FormData): Promise<PharmacyState> {
  const items = prescriptionItems(form);
  if (!value(form, "encounter_id") || !value(form, "doctor_id") || !items) return initialError("Select the patient encounter, doctor, and at least one medicine.");
  return rpc("create_prescription_with_doctor", {
    target_encounter: value(form, "encounter_id"), target_doctor: value(form, "doctor_id"),
    prescription_notes: value(form, "notes"), prescription_items_json: items,
  }, "Prescription created successfully.");
}

export async function amendPrescription(_: PharmacyState, form: FormData): Promise<PharmacyState> {
  const items = prescriptionItems(form);
  if (!items || value(form, "reason").length < 5) return initialError("Add at least one medicine and enter a modification reason of at least 5 characters.");
  return rpc("amend_prescription", {
    target_prescription: value(form, "prescription_id"), target_doctor: value(form, "doctor_id"),
    prescription_notes: value(form, "notes"), prescription_items_json: items,
    expected_version: Number(value(form, "version")), modification_reason: value(form, "reason"),
  }, "Prescription amendment saved.");
}

export async function validatePrescription(form: FormData): Promise<PharmacyState> {
  return rpc("validate_prescription", { target_prescription: value(form, "prescription_id") }, "Prescription validated and ready to dispense.");
}

export async function cancelPrescription(_: PharmacyState, form: FormData): Promise<PharmacyState> {
  if (value(form, "reason").length < 5) return initialError("Cancellation reason must contain at least 5 characters.");
  return rpc("cancel_prescription", { target_prescription: value(form, "prescription_id"), cancel_reason: value(form, "reason") }, "Prescription cancelled.");
}

export async function dispenseMedication(_: PharmacyState, form: FormData): Promise<PharmacyState> {
  const quantity = Number(value(form, "quantity"));
  if (!value(form, "lot_id") || !Number.isFinite(quantity) || quantity <= 0) return initialError("Select a stock lot and enter a positive quantity.");
  return rpc("dispense_medication", {
    target_item: value(form, "item_id"), target_lot: value(form, "lot_id"),
    dispense_quantity: quantity, request_key: randomUUID(),
  }, "Medication dispensed and stock updated.");
}

export async function addPrescriptionAttachment(form: FormData): Promise<PharmacyState> {
  const supabase = await createClient();
  const prescriptionId = value(form, "prescription_id");
  const title = value(form, "display_name");
  if (title.length < 2) return initialError("Document title must contain at least 2 characters.");
  const file = form.get("attachment");
  if (!(file instanceof File) || file.size < 1) return initialError("Choose a document to upload.");
  const allowed = new Map([["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"]]);
  const extension = allowed.get(file.type);
  if (!extension) return initialError("Attachment must be a PDF, JPG, or PNG file.");
  if (file.size > 3 * 1024 * 1024) return initialError("Attachment must be 3 MB or smaller.");
  const { data: prescription } = await supabase.from("prescriptions").select("encounter_id").eq("id", prescriptionId).single();
  if (!prescription) return initialError("Prescription not found.");
  const { data: encounter } = await supabase.from("encounters").select("facility_id").eq("id", prescription.encounter_id).single();
  if (!encounter) return initialError("Encounter not found.");
  const storagePath = `${encounter.facility_id}/${prescriptionId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("pharmacy-documents").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) return initialError(uploadError.message);
  const { error } = await supabase.rpc("add_prescription_document", {
    target_prescription: prescriptionId, file_path: storagePath, original_file_name: file.name,
    document_title: title, document_description: value(form, "description"), file_type: file.type, file_size: file.size,
  });
  if (error) {
    await supabase.storage.from("pharmacy-documents").remove([storagePath]);
    return initialError(error.message);
  }
  revalidatePath("/pharmacy");
  return { ok: true, message: "Attachment uploaded." };
}

export async function updatePrescriptionAttachment(form: FormData): Promise<PharmacyState> {
  if (value(form, "display_name").length < 2 || value(form, "reason").length < 5) return initialError("Document title and modification reason are required.");
  return rpc("update_prescription_document", {
    target_document: value(form, "document_id"), document_title: value(form, "display_name"),
    document_description: value(form, "description"), modification_reason: value(form, "reason"),
  }, "Attachment details updated.");
}

export async function removePrescriptionAttachment(form: FormData): Promise<PharmacyState> {
  if (value(form, "reason").length < 5) return initialError("Removal reason must contain at least 5 characters.");
  return rpc("remove_prescription_document", { target_document: value(form, "document_id"), removal_reason: value(form, "reason") }, "Attachment removed from the active record.");
}
