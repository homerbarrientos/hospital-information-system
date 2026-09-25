"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type OperationState = { ok: boolean; message: string };
const val = (form: FormData, key: string) => String(form.get(key) || "").trim();
const optional = (form: FormData, key: string) => val(form, key) || null;
const numeric = (form: FormData, key: string) => Number(val(form, key));
const failure = (message: string): OperationState => ({ ok: false, message });

export async function saveOperation(_: OperationState, form: FormData): Promise<OperationState> {
  const facility = val(form, "facility_id");
  const section = val(form, "section");
  const command = val(form, "command");
  if (!facility || !["or", "dr", "dietary", "materials", "purchasing", "philhealth"].includes(section)) return failure("Invalid facility or module.");

  let name = "";
  let args: Record<string, unknown> = {};
  switch (command) {
    case "case.create":
      if (!["or", "dr"].includes(section) || !val(form, "encounter_id") || !val(form, "procedure_name") || !val(form, "room_name") || !val(form, "scheduled_at")) return failure("Complete the encounter, procedure, room, and schedule.");
      name = "create_care_case";
      args = { target_facility: facility, target_encounter: val(form, "encounter_id"), kind: section.toUpperCase(), procedure_name: val(form, "procedure_name"), room_name: val(form, "room_name"), scheduled_at: val(form, "scheduled_at"), lead_doctor: optional(form, "doctor_id"), notes: val(form, "notes"), target_service: optional(form, "service_id") };
      break;
    case "case.advance":
      if (!["or", "dr"].includes(section)) return failure("Invalid case module.");
      name = "advance_care_case";
      args = { target_id: val(form, "record_id"), next_status: val(form, "status"), notes: val(form, "notes") };
      break;
    case "diet.create":
      if (section !== "dietary" || !val(form, "encounter_id") || !val(form, "diet_type") || !val(form, "meal_date")) return failure("Encounter, diet type, and meal date are required.");
      name = "create_diet_order";
      args = { target_facility: facility, target_encounter: val(form, "encounter_id"), diet_name: val(form, "diet_type"), diet_texture: val(form, "texture"), allergy_notes: val(form, "allergies"), other_instructions: val(form, "notes"), service_date: val(form, "meal_date"), service_meal: val(form, "meal") };
      break;
    case "diet.advance":
      if (section !== "dietary") return failure("Invalid dietary module.");
      name = "advance_diet_order";
      args = { target_id: val(form, "record_id"), next_status: val(form, "status"), reason: val(form, "notes") };
      break;
    case "material.create":
      if (section !== "materials" || !val(form, "code") || !val(form, "name")) return failure("Material code and name are required.");
      name = "create_material_item";
      args = { target_facility: facility, item_code: val(form, "code"), item_name: val(form, "name"), item_category: val(form, "category"), item_unit: val(form, "unit"), reorder_quantity: numeric(form, "reorder_level"), target_service: optional(form, "service_id") };
      break;
    case "material.move":
      if (section !== "materials" || !val(form, "item_id") || !Number.isFinite(numeric(form, "quantity")) || numeric(form, "quantity") <= 0) return failure("Select a material and positive quantity.");
      name = "move_material";
      args = { target_facility: facility, target_item: val(form, "item_id"), movement_kind: val(form, "kind"), movement_quantity: numeric(form, "quantity"), target_encounter: optional(form, "encounter_id"), reference_text: val(form, "reference"), movement_notes: val(form, "notes") };
      break;
    case "purchase.create":
      if (section !== "purchasing" || !val(form, "supplier_id") || !val(form, "item_id") || numeric(form, "quantity") <= 0 || numeric(form, "cost") < 0) return failure("Supplier, material, quantity, and unit cost are required.");
      name = "create_purchase_order";
      args = { target_facility: facility, target_supplier: val(form, "supplier_id"), target_item: val(form, "item_id"), order_quantity: numeric(form, "quantity"), price_per_unit: numeric(form, "cost"), order_reason: val(form, "notes") };
      break;
    case "purchase.decide":
      if (section !== "purchasing") return failure("Invalid purchase module.");
      name = "decide_purchase_order";
      args = { target_id: val(form, "record_id"), decision: val(form, "status"), decision_notes: val(form, "notes") };
      break;
    case "purchase.receive":
      if (section !== "purchasing" || numeric(form, "quantity") <= 0) return failure("A positive received quantity is required.");
      name = "receive_purchase_order";
      args = { target_id: val(form, "record_id"), received_quantity: numeric(form, "quantity"), delivery_reference: val(form, "reference") };
      break;
    case "claim.create":
      if (section !== "philhealth" || !val(form, "encounter_id") || !val(form, "diagnosis")) return failure("Encounter and diagnosis code are required.");
      name = "prepare_phic_claim";
      args = { target_facility: facility, target_encounter: val(form, "encounter_id"), diagnosis_text: val(form, "diagnosis"), rate_text: val(form, "case_rate") };
      break;
    case "claim.advance":
      if (section !== "philhealth") return failure("Invalid claims module.");
      name = "update_phic_claim";
      args = { target_id: val(form, "record_id"), next_status: val(form, "status"), external_reference: val(form, "reference"), status_notes: val(form, "notes") };
      break;
    default:
      return failure("Unknown operation.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return failure(error.message);
  revalidatePath(`/operations/${section}`);
  if (section === "materials" || section === "purchasing") {
    revalidatePath("/operations/materials");
    revalidatePath("/operations/purchasing");
  }
  return { ok: true, message: "Saved and recorded in the audit trail." };
}
