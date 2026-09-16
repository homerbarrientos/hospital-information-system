"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AdtState = { ok: boolean; message: string };
export type PatientChart = {
  patient: { mrn: string; name: string; birthDate: string | null; sexAtBirth: string | null };
  admission: { number: string; admittedAt: string; dischargedAt: string | null; status: string; disposition: string | null };
  careTeam: { attendingDoctor: string; admittingDoctor: string; dischargingDoctor: string };
  allergies: Array<{ substance: string; reaction: string | null; severity: string | null }>;
  vitals: Array<{ code: string; value: number; unit: string; observedAt: string }>;
  diagnoses: Array<{ description: string; type: string; createdAt: string }>;
  notes: Array<{ encounterNumber: string; serviceDate: string; chiefComplaint: string; soapNote: string }>;
  orders: Array<{ number: string; type: string; status: string; orderedAt: string; items: string[]; results: string[] }>;
  medications: Array<{ number: string; status: string; prescribedAt: string; items: string[] }>;
  movements: Array<{ location: string; startedAt: string; endedAt: string | null; reason: string | null }>;
  dischargeSummary: null | { finalDiagnosis: string; condition: string; instructions: string; followUp: string | null; medications: string | null };
  attachments: Array<{
    id: string;
    name: string;
    description: string | null;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
    url: string;
  }>;
};
export type PatientChartResult =
  | { ok: true; chart: PatientChart }
  | { ok: false; message: string };

const value = (form: FormData, key: string) => String(form.get(key) || "").trim();
const empty = Promise.resolve({ data: [] as Array<Record<string, unknown>> });
const textError = (label: string, text: string, minimum: number, maximum: number) => {
  if (text.length < minimum) return `${label} must contain at least ${minimum} characters.`;
  if (text.length > maximum) return `${label} cannot exceed ${maximum} characters.`;
  return "";
};

async function call(name: string, args: Record<string, string>): Promise<AdtState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admissions");
  return { ok: true, message: "Saved successfully." };
}

export async function admitPatient(_: AdtState, form: FormData): Promise<AdtState> {
  const result = await call("admit_patient_with_doctor", {
    target_facility: value(form, "facility_id"),
    target_patient: value(form, "patient_id"),
    target_bed: value(form, "bed_id"),
    target_doctor: value(form, "doctor_id"),
  });
  return result.ok ? { ...result, message: "Patient admitted successfully." } : result;
}

export async function transferPatient(_: AdtState, form: FormData): Promise<AdtState> {
  const result = await call("transfer_patient", {
    target_admission: value(form, "admission_id"),
    target_bed: value(form, "bed_id"),
    transfer_reason: value(form, "reason"),
  });
  return result.ok ? { ...result, message: "Patient transferred successfully." } : result;
}

export async function dischargePatient(_: AdtState, form: FormData): Promise<AdtState> {
  if (["disposition", "final_diagnosis", "condition", "instructions"].some((key) => !value(form, key))) {
    return { ok: false, message: "Complete all required discharge fields." };
  }
  const validationError =
    textError("Final diagnosis", value(form, "final_diagnosis"), 2, 2000) ||
    textError("Condition at discharge", value(form, "condition"), 2, 250) ||
    textError("Discharge instructions", value(form, "instructions"), 10, 4000) ||
    (value(form, "follow_up") ? textError("Follow-up plan", value(form, "follow_up"), 2, 2000) : "") ||
    (value(form, "medications") ? textError("Discharge medications", value(form, "medications"), 2, 2000) : "");
  if (validationError) return { ok: false, message: validationError };
  const supabase = await createClient();
  const admissionId = value(form, "admission_id");
  const { data: admission, error: admissionError } = await supabase
    .from("admissions").select("encounter_id").eq("id", admissionId).single();
  if (admissionError || !admission) return { ok: false, message: admissionError?.message || "Admission not found." };
  const { data: encounter, error: encounterError } = await supabase
    .from("encounters").select("facility_id").eq("id", admission.encounter_id).single();
  if (encounterError || !encounter) return { ok: false, message: encounterError?.message || "Encounter not found." };

  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;
  let attachmentType: string | null = null;
  let attachmentSize: number | null = null;
  const attachment = form.get("attachment");
  if (attachment instanceof File && attachment.size > 0) {
    const allowed = new Map([["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"]]);
    const extension = allowed.get(attachment.type);
    if (!extension) return { ok: false, message: "Attachment must be a PDF, JPG, or PNG file." };
    if (attachment.size > 3 * 1024 * 1024) return { ok: false, message: "Attachment must be 3 MB or smaller." };
    attachmentPath = `${encounter.facility_id}/${admissionId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("discharge-documents").upload(attachmentPath, attachment, { contentType: attachment.type, upsert: false });
    if (uploadError) return { ok: false, message: uploadError.message };
    attachmentName = attachment.name;
    attachmentType = attachment.type;
    attachmentSize = attachment.size;
  }

  const { error } = await supabase.rpc("complete_discharge_with_doctor", {
    target_admission: admissionId,
    target_doctor: value(form, "doctor_id"),
    discharge_disposition: value(form, "disposition"),
    final_diagnosis: value(form, "final_diagnosis"),
    condition_at_discharge: value(form, "condition"),
    discharge_instructions: value(form, "instructions"),
    follow_up_plan: value(form, "follow_up"),
    discharge_medications: value(form, "medications"),
    attachment_path: attachmentPath,
    attachment_name: attachmentName,
    attachment_type: attachmentType,
    attachment_size: attachmentSize,
  });
  if (error) {
    if (attachmentPath) await supabase.storage.from("discharge-documents").remove([attachmentPath]);
    return { ok: false, message: error.message };
  }
  revalidatePath("/admissions");
  return { ok: true, message: "Patient discharged and summary saved successfully." };
}

export async function addDischargeAttachment(form: FormData): Promise<AdtState> {
  const supabase = await createClient();
  const admissionId = value(form, "admission_id");
  const displayName = value(form, "display_name");
  const description = value(form, "description");
  const nameError = textError("Document title", displayName, 2, 120);
  const descriptionError = description ? textError("Description", description, 2, 1000) : "";
  if (nameError || descriptionError) return { ok: false, message: nameError || descriptionError };
  const attachment = form.get("attachment");
  if (!(attachment instanceof File) || attachment.size < 1) return { ok: false, message: "Choose a document to upload." };
  const allowed = new Map([["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"]]);
  const extension = allowed.get(attachment.type);
  if (!extension) return { ok: false, message: "Attachment must be a PDF, JPG, or PNG file." };
  if (attachment.size > 3 * 1024 * 1024) return { ok: false, message: "Attachment must be 3 MB or smaller." };

  const { data: admission, error: admissionError } = await supabase
    .from("admissions").select("encounter_id").eq("id", admissionId).single();
  if (admissionError || !admission) return { ok: false, message: admissionError?.message || "Admission not found." };
  const { data: encounter, error: encounterError } = await supabase
    .from("encounters").select("facility_id").eq("id", admission.encounter_id).single();
  if (encounterError || !encounter) return { ok: false, message: encounterError?.message || "Encounter not found." };

  const storagePath = `${encounter.facility_id}/${admissionId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("discharge-documents").upload(storagePath, attachment, { contentType: attachment.type, upsert: false });
  if (uploadError) return { ok: false, message: uploadError.message };
  const { error } = await supabase.rpc("add_discharge_document", {
    target_admission: admissionId,
    file_path: storagePath,
    original_file_name: attachment.name,
    document_title: displayName,
    document_description: description,
    file_type: attachment.type,
    file_size: attachment.size,
  });
  if (error) {
    await supabase.storage.from("discharge-documents").remove([storagePath]);
    return { ok: false, message: error.message };
  }
  revalidatePath("/admissions");
  return { ok: true, message: "Attachment uploaded successfully." };
}

export async function updateDischargeAttachment(form: FormData): Promise<AdtState> {
  const displayName = value(form, "display_name");
  const description = value(form, "description");
  const reason = value(form, "reason");
  const validationError =
    textError("Document title", displayName, 2, 120) ||
    (description ? textError("Description", description, 2, 1000) : "") ||
    textError("Modification reason", reason, 5, 500);
  if (validationError) return { ok: false, message: validationError };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_discharge_document", {
    target_document: value(form, "document_id"),
    document_title: displayName,
    document_description: description,
    modification_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admissions");
  return { ok: true, message: "Attachment details updated." };
}

export async function removeDischargeAttachment(form: FormData): Promise<AdtState> {
  const reason = value(form, "reason");
  const validationError = textError("Removal reason", reason, 5, 500);
  if (validationError) return { ok: false, message: validationError };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_discharge_document", {
    target_document: value(form, "document_id"),
    removal_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admissions");
  return { ok: true, message: "Attachment removed from the active record." };
}

export async function loadPatientChart(admissionId: string): Promise<PatientChartResult> {
  const supabase = await createClient();
  const { data: admission, error: admissionError } = await supabase
    .from("admissions")
    .select("id,encounter_id,admission_no,status,admitted_at,discharged_at,discharge_disposition,admitting_doctor_id,attending_doctor_id")
    .eq("id", admissionId).single();
  if (admissionError || !admission) return { ok: false, message: admissionError?.message || "Admission not found." };
  const { data: admissionEncounter, error: encounterError } = await supabase
    .from("encounters").select("patient_id,facility_id").eq("id", admission.encounter_id).single();
  if (encounterError || !admissionEncounter) return { ok: false, message: encounterError?.message || "Encounter not found." };

  const [{ data: patient }, { data: encounters }, { data: allergies }, { data: stays }, { data: summary }] =
    await Promise.all([
      supabase.from("patients").select("mrn,first_name,middle_name,last_name,birth_date,sex_at_birth").eq("id", admissionEncounter.patient_id).single(),
      supabase.from("encounters").select("id,encounter_no,service_date").eq("patient_id", admissionEncounter.patient_id).eq("facility_id", admissionEncounter.facility_id).order("service_date", { ascending: false }),
      supabase.from("allergies").select("substance,reaction,severity").eq("patient_id", admissionEncounter.patient_id).eq("status", "active").order("recorded_at", { ascending: false }),
      supabase.from("bed_stays").select("bed_id,started_at,ended_at,transfer_reason").eq("admission_id", admissionId).order("started_at"),
      supabase.from("discharge_summaries").select("id,final_diagnosis,condition_at_discharge,instructions,follow_up_plan,discharge_medications,discharging_doctor_id").eq("admission_id", admissionId).maybeSingle(),
    ]);
  if (!patient) return { ok: false, message: "Patient record is unavailable." };

  const encounterRows = encounters || [];
  const encounterIds = encounterRows.map((item) => item.id);
  const related = encounterIds.length
    ? await Promise.all([
        supabase.from("vital_observations").select("code,value,unit,observed_at").in("encounter_id", encounterIds).order("observed_at", { ascending: false }),
        supabase.from("diagnoses").select("encounter_id,description,diagnosis_type,created_at").in("encounter_id", encounterIds).order("created_at", { ascending: false }),
        supabase.from("clinical_notes").select("id,encounter_id,current_version").in("encounter_id", encounterIds).order("created_at", { ascending: false }),
        supabase.from("clinical_orders").select("id,order_no,order_type,status,ordered_at").in("encounter_id", encounterIds).order("ordered_at", { ascending: false }),
        supabase.from("prescriptions").select("id,prescription_no,status,prescribed_at").in("encounter_id", encounterIds).order("prescribed_at", { ascending: false }),
      ])
    : await Promise.all([empty, empty, empty, empty, empty]);
  const vitals = related[0].data || [];
  const diagnoses = related[1].data || [];
  const notes = related[2].data || [];
  const orders = related[3].data || [];
  const prescriptions = related[4].data || [];

  const [noteVersionsResponse, orderItemsResponse, prescriptionItemsResponse, bedsResponse] = await Promise.all([
    notes.length ? supabase.from("clinical_note_versions").select("note_id,version,content").in("note_id", notes.map((item) => item.id)) : empty,
    orders.length ? supabase.from("order_items").select("id,order_id,description").in("order_id", orders.map((item) => item.id)) : empty,
    prescriptions.length ? supabase.from("prescription_items").select("prescription_id,product_id,dose,route,frequency,duration,instructions").in("prescription_id", prescriptions.map((item) => item.id)) : empty,
    stays?.length ? supabase.from("beds").select("id,code,ward_id").in("id", stays.map((item) => item.bed_id)) : empty,
  ]);
  const noteVersions = noteVersionsResponse.data || [];
  const orderItems = orderItemsResponse.data || [];
  const prescriptionItems = prescriptionItemsResponse.data || [];
  const beds = bedsResponse.data || [];

  const [resultsResponse, productsResponse, wardsResponse, documentsResponse] = await Promise.all([
    orderItems.length ? supabase.from("clinical_results").select("order_item_id,result_text,status").in("order_item_id", orderItems.map((item) => item.id)) : empty,
    prescriptionItems.length ? supabase.from("products").select("id,name").in("id", prescriptionItems.map((item) => item.product_id)) : empty,
    beds.length ? supabase.from("wards").select("id,name").in("id", beds.map((item) => item.ward_id)) : empty,
    summary?.id ? supabase.from("discharge_documents").select("id,storage_path,original_name,display_name,description,mime_type,size_bytes,uploaded_at").eq("discharge_summary_id", summary.id).is("removed_at", null).order("uploaded_at", { ascending: false }) : empty,
  ]);
  const results = resultsResponse.data || [];
  const products = productsResponse.data || [];
  const wards = wardsResponse.data || [];
  const documents = documentsResponse.data || [];
  const doctorIds=[admission.admitting_doctor_id,admission.attending_doctor_id,summary?.discharging_doctor_id].filter(Boolean) as string[];
  const {data:doctorRows}=doctorIds.length?await supabase.from("doctors").select("id,first_name,last_name,suffix").in("id",doctorIds):{data:[]};
  const doctorName=(id:string|null|undefined)=>{const doctor=(doctorRows||[]).find(item=>item.id===id);return doctor?`Dr. ${doctor.last_name}, ${doctor.first_name}${doctor.suffix?` ${doctor.suffix}`:""}`:"Not assigned";};
  const attachments = await Promise.all(documents.map(async (document) => {
    const { data } = await supabase.storage.from("discharge-documents").createSignedUrl(String(document.storage_path), 300);
    return {
      id: String(document.id),
      name: String(document.display_name || document.original_name),
      description: document.description ? String(document.description) : null,
      mimeType: String(document.mime_type),
      sizeBytes: Number(document.size_bytes),
      uploadedAt: String(document.uploaded_at),
      url: data?.signedUrl || "",
    };
  }));

  const encounterMap = new Map(encounterRows.map((item) => [item.id, item]));
  const productMap = new Map(products.map((item) => [item.id, item.name]));
  const bedMap = new Map(beds.map((item) => [item.id, item]));
  const wardMap = new Map(wards.map((item) => [item.id, item.name]));

  return { ok: true, chart: {
    patient: { mrn: patient.mrn, name: [patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(" "), birthDate: patient.birth_date, sexAtBirth: patient.sex_at_birth },
    admission: { number: admission.admission_no, admittedAt: admission.admitted_at, dischargedAt: admission.discharged_at, status: admission.status, disposition: admission.discharge_disposition },
    careTeam:{attendingDoctor:doctorName(admission.attending_doctor_id),admittingDoctor:doctorName(admission.admitting_doctor_id),dischargingDoctor:doctorName(summary?.discharging_doctor_id)},
    allergies: allergies || [],
    vitals: vitals.slice(0, 12).map((item) => ({ code: item.code, value: item.value, unit: item.unit, observedAt: item.observed_at })),
    diagnoses: diagnoses.map((item) => ({ description: item.description, type: item.diagnosis_type, createdAt: item.created_at })),
    notes: notes.map((note) => {
      const version = noteVersions.find((item) => item.note_id === note.id && item.version === note.current_version);
      const encounter = encounterMap.get(note.encounter_id);
      return { encounterNumber: encounter?.encounter_no || "Encounter", serviceDate: encounter?.service_date || "", chiefComplaint: String(version?.content?.chief_complaint || "—"), soapNote: String(version?.content?.soap_note || "—") };
    }),
    orders: orders.map((order) => ({ number: order.order_no, type: order.order_type, status: order.status, orderedAt: order.ordered_at, items: orderItems.filter((item) => item.order_id === order.id).map((item) => item.description), results: results.filter((result) => orderItems.some((item) => item.order_id === order.id && item.id === result.order_item_id)).map((result) => result.result_text || result.status) })),
    medications: prescriptions.map((prescription) => ({ number: prescription.prescription_no, status: prescription.status, prescribedAt: prescription.prescribed_at, items: prescriptionItems.filter((item) => item.prescription_id === prescription.id).map((item) => [productMap.get(item.product_id) || "Medicine", item.dose, item.route, item.frequency, item.duration, item.instructions].filter(Boolean).join(" · ")) })),
    movements: (stays || []).map((stay) => { const bed = bedMap.get(stay.bed_id); return { location: bed ? `${wardMap.get(bed.ward_id) || "Ward"} · ${bed.code}` : "Unknown bed", startedAt: stay.started_at, endedAt: stay.ended_at, reason: stay.transfer_reason }; }),
    dischargeSummary: summary ? { finalDiagnosis: summary.final_diagnosis, condition: summary.condition_at_discharge, instructions: summary.instructions, followUp: summary.follow_up_plan, medications: summary.discharge_medications } : null,
    attachments: attachments.filter((item) => item.url),
  } };
}
