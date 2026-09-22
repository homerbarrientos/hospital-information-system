"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StaffState = { ok: boolean; message: string };

const text = (form: FormData, key: string) => String(form.get(key) || "").trim();
const roleIds = (form: FormData) => form.getAll("role_ids").map(String).filter(Boolean);
const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid staff email address."),
  fullName: z.string().trim().min(2, "Staff name must contain at least 2 characters.").max(160),
  employeeNo: z.string().trim().max(80),
  roles: z.array(z.string().uuid()).min(1, "Select at least one role."),
  departmentId: z.union([z.string().uuid(), z.literal("")]),
});

function refreshAdministration() {
  revalidatePath("/administration");
  revalidatePath("/administration/users");
  revalidatePath("/administration/roles");
}

export async function inviteStaff(_: StaffState, form: FormData): Promise<StaffState> {
  const parsed = inviteSchema.safeParse({
    email: text(form, "email"),
    fullName: text(form, "full_name"),
    employeeNo: text(form, "employee_no"),
    roles: roleIds(form),
    departmentId: text(form, "department_id"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message || "Invalid staff details." };
  const facilityId = text(form, "facility_id");
  const supabase = await createClient();
  const { error: authorizationError } = await supabase.rpc("authorize_staff_invite", {
    target_facility: facilityId,
    selected_roles: parsed.data.roles,
    target_department: parsed.data.departmentId || null,
  });
  if (authorizationError) return { ok: false, message: authorizationError.message };

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Staff invitation service is unavailable." };
  }
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.fullName, employee_no: parsed.data.employeeNo || null },
  });
  if (error || !data.user) return { ok: false, message: error?.message || "The invitation did not create a user account." };

  const { error: assignmentError } = await supabase.rpc("configure_staff_member", {
    target_facility: facilityId,
    target_user: data.user.id,
    staff_full_name: parsed.data.fullName,
    staff_employee_no: parsed.data.employeeNo,
    selected_roles: parsed.data.roles,
    target_department: parsed.data.departmentId || null,
    change_reason: "Initial facility staff invitation",
  });
  if (assignmentError) {
    return { ok: false, message: `Invitation created, but role assignment failed: ${assignmentError.message}` };
  }
  refreshAdministration();
  return { ok: true, message: "Staff invitation sent and facility roles assigned." };
}

export async function updateStaff(_: StaffState, form: FormData): Promise<StaffState> {
  const roles = roleIds(form);
  const fullName = text(form, "full_name");
  const reason = text(form, "reason");
  if (fullName.length < 2 || fullName.length > 160) return { ok: false, message: "Staff name must contain 2 to 160 characters." };
  if (!roles.length) return { ok: false, message: "Select at least one role." };
  if (reason.length < 5) return { ok: false, message: "Change reason must contain at least 5 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("configure_staff_member", {
    target_facility: text(form, "facility_id"),
    target_user: text(form, "user_id"),
    staff_full_name: fullName,
    staff_employee_no: text(form, "employee_no"),
    selected_roles: roles,
    target_department: text(form, "department_id") || null,
    change_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  refreshAdministration();
  return { ok: true, message: "Staff profile and role assignments updated." };
}

export async function changeStaffStatus(_: StaffState, form: FormData): Promise<StaffState> {
  const reason = text(form, "reason");
  if (reason.length < 5) return { ok: false, message: "Status reason must contain at least 5 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_status", {
    target_facility: text(form, "facility_id"),
    target_user: text(form, "user_id"),
    next_status: text(form, "status"),
    change_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  refreshAdministration();
  return { ok: true, message: "Staff account status updated." };
}
