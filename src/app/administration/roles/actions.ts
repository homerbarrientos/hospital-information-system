"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RoleState = { ok: boolean; message: string };
const text = (form: FormData, key: string) => String(form.get(key) || "").trim();
const privileges = (form: FormData) => form.getAll("privilege_codes").map(String).filter(Boolean);

function refreshRoles() {
  revalidatePath("/administration");
  revalidatePath("/administration/users");
  revalidatePath("/administration/roles");
}

export async function createRole(_: RoleState, form: FormData): Promise<RoleState> {
  const name = text(form, "name");
  if (name.length < 3 || name.length > 100) return { ok: false, message: "Role name must contain 3 to 100 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_governed_role", {
    target_facility: text(form, "facility_id"),
    role_name: name,
    role_description: text(form, "description"),
    selected_privileges: privileges(form),
  });
  if (error) return { ok: false, message: error.message };
  refreshRoles();
  return { ok: true, message: "Role created with its initial privilege grants." };
}

export async function updateRole(_: RoleState, form: FormData): Promise<RoleState> {
  const reason = text(form, "reason");
  if (reason.length < 5) return { ok: false, message: "Change reason must contain at least 5 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_governed_role", {
    target_facility: text(form, "facility_id"),
    target_role: text(form, "role_id"),
    expected_version: Number(text(form, "version")),
    role_name: text(form, "name"),
    role_description: text(form, "description"),
    selected_privileges: privileges(form),
    change_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  refreshRoles();
  return { ok: true, message: "Role and privilege grants updated." };
}

export async function changeRoleStatus(_: RoleState, form: FormData): Promise<RoleState> {
  const reason = text(form, "reason");
  if (reason.length < 5) return { ok: false, message: "Status reason must contain at least 5 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_governed_role_status", {
    target_facility: text(form, "facility_id"),
    target_role: text(form, "role_id"),
    next_status: text(form, "status"),
    change_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  refreshRoles();
  return { ok: true, message: "Role status updated." };
}
