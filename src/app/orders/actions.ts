"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type OrderState = { ok: boolean; message: string };
const text = (form: FormData, key: string) => String(form.get(key) || "").trim();
const initialError = (message: string): OrderState => ({ ok: false, message });

function parseItems(form: FormData) {
  try {
    const items = JSON.parse(text(form, "items")) as Array<{ description?: string; charge_on?: string }>;
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) return null;
    if (items.some((item) => String(item.description || "").trim().length < 2 || String(item.description || "").trim().length > 250)) return null;
    return items.map((item) => ({ description: String(item.description).trim(), charge_on: item.charge_on || "none" }));
  } catch {
    return null;
  }
}

export async function createOrder(_: OrderState, form: FormData): Promise<OrderState> {
  const items = parseItems(form);
  if (!items) return initialError("Add 1 to 20 valid order items. Each item needs 2 to 250 characters.");
  if (text(form, "instructions").length > 2000) return initialError("Instructions cannot exceed 2000 characters.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_order", {
    target_encounter: text(form, "encounter_id"),
    order_type: text(form, "order_type"),
    order_priority: text(form, "priority"),
    order_instructions: text(form, "instructions"),
    order_items_json: items,
  });
  if (error) return initialError(error.message);
  revalidatePath("/orders");
  return { ok: true, message: "Clinical order created successfully." };
}

export async function amendOrder(_: OrderState, form: FormData): Promise<OrderState> {
  const items = parseItems(form);
  if (!items) return initialError("Add 1 to 20 valid order items.");
  const reason = text(form, "reason");
  if (reason.length < 5 || reason.length > 500) return initialError("Modification reason must contain 5 to 500 characters.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_order", {
    target_order: text(form, "order_id"),
    order_type: text(form, "order_type"),
    order_priority: text(form, "priority"),
    order_instructions: text(form, "instructions"),
    order_items_json: items,
    modification_reason: reason,
  });
  if (error) return initialError(error.message);
  revalidatePath("/orders");
  return { ok: true, message: "Order amendment saved with an audit record." };
}

export async function advanceOrder(_: OrderState, form: FormData): Promise<OrderState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_order", {
    target_order: text(form, "order_id"),
    next_status: text(form, "next_status"),
  });
  if (error) return initialError(error.message);
  revalidatePath("/orders");
  return { ok: true, message: "Order status updated." };
}

export async function saveOrderResult(_: OrderState, form: FormData): Promise<OrderState> {
  const result = text(form, "result_text");
  if (result.length < 2 || result.length > 5000) return initialError("Result must contain 2 to 5000 characters.");
  const reason = text(form, "correction_reason");
  if (text(form, "has_final") === "true" && (reason.length < 5 || reason.length > 500)) {
    return initialError("A correction reason of 5 to 500 characters is required.");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_order_result", {
    target_item: text(form, "item_id"),
    result_text: result,
    validate_result: text(form, "validate_result") === "on",
    correction_reason: reason,
  });
  if (error) return initialError(error.message);
  revalidatePath("/orders");
  return { ok: true, message: "Result saved successfully." };
}

export async function cancelOrder(_: OrderState, form: FormData): Promise<OrderState> {
  const reason = text(form, "reason");
  if (reason.length < 5 || reason.length > 500) return initialError("Cancellation reason must contain 5 to 500 characters.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", {
    target_order: text(form, "order_id"),
    cancel_reason: reason,
  });
  if (error) return initialError(error.message);
  revalidatePath("/orders");
  return { ok: true, message: "Order cancelled with an audit record." };
}
