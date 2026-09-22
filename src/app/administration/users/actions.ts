"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StaffState = { ok: boolean; message: string; temporaryPassword?: string; loginIdentifier?: string };

const text = (form: FormData, key: string) => String(form.get(key) || "").trim();
const roleIds = (form: FormData) => form.getAll("role_ids").map(String).filter(Boolean);
const staffSchema = z.object({
  loginMethod: z.enum(["email", "employee_id"]),
  email: z.string().trim().max(254),
  fullName: z.string().trim().min(2, "Staff name must contain at least 2 characters.").max(160),
  employeeNo: z.string().trim().max(80),
  roles: z.array(z.string().uuid()).min(1, "Select at least one role."),
  departmentId: z.union([z.string().uuid(), z.literal("")]),
});

function generateTemporaryPassword() {
  return `${randomBytes(12).toString("base64url")}aA7!`;
}

async function removeIncompleteUser(admin: ReturnType<typeof createAdminClient>, userId: string) {
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}

function refreshAdministration() {
  revalidatePath("/administration");
  revalidatePath("/administration/users");
  revalidatePath("/administration/roles");
}

export async function inviteStaff(_: StaffState, form: FormData): Promise<StaffState> {
  const parsed = staffSchema.safeParse({
    loginMethod: text(form, "login_method"),
    email: text(form, "email"),
    fullName: text(form, "full_name"),
    employeeNo: text(form, "employee_no"),
    roles: roleIds(form),
    departmentId: text(form, "department_id"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message || "Invalid staff details." };
  if (parsed.data.loginMethod === "email" && !z.email().safeParse(parsed.data.email).success) {
    return { ok: false, message: "Enter a valid staff email address." };
  }
  if (parsed.data.loginMethod === "employee_id" && parsed.data.employeeNo.length < 2) {
    return { ok: false, message: "Employee number is required for Employee ID login." };
  }
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
  const temporaryPassword = parsed.data.loginMethod === "employee_id" ? generateTemporaryPassword() : undefined;
  const authEmail = parsed.data.loginMethod === "employee_id"
    ? `staff+${randomUUID()}@auth.hospital-one.invalid`
    : parsed.data.email;
  const metadata = {
    full_name: parsed.data.fullName,
    employee_no: parsed.data.employeeNo || null,
    login_method: parsed.data.loginMethod,
  };
  const { data, error } = parsed.data.loginMethod === "employee_id"
    ? await admin.auth.admin.createUser({ email: authEmail, password: temporaryPassword, email_confirm: true, user_metadata: metadata, app_metadata: { login_method: "employee_id", must_change_password: true } })
    : await admin.auth.admin.inviteUserByEmail(authEmail, { data: metadata });
  if (error || !data.user) return { ok: false, message: error?.message || "The invitation did not create a user account." };

  const { error: assignmentError } = await supabase.rpc("configure_new_staff_identity", {
    target_facility: facilityId,
    target_user: data.user.id,
    staff_full_name: parsed.data.fullName,
    staff_employee_no: parsed.data.employeeNo,
    selected_roles: parsed.data.roles,
    target_department: parsed.data.departmentId || null,
    staff_login_method: parsed.data.loginMethod,
  });
  if (assignmentError) {
    await removeIncompleteUser(admin, data.user.id);
    return { ok: false, message: `Staff account was not created: ${assignmentError.message}` };
  }
  refreshAdministration();
  if (parsed.data.loginMethod === "employee_id") {
    return {
      ok: true,
      message: "Employee ID account created. Give the temporary password directly to the staff member; it is shown only once.",
      temporaryPassword,
      loginIdentifier: parsed.data.employeeNo,
    };
  }
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
  const { error } = await supabase.rpc("update_staff_identity_and_access", {
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

export async function resetStaffPassword(_: StaffState, form: FormData): Promise<StaffState> {
  const facilityId = text(form, "facility_id");
  const userId = text(form, "user_id");
  const reason = text(form, "reason");
  if (reason.length < 5) return { ok: false, message: "Reset reason must contain at least 5 characters." };
  const supabase = await createClient();
  const { error: authorizationError } = await supabase.rpc("authorize_staff_credential_reset", {
    target_facility: facilityId,
    target_user: userId,
  });
  if (authorizationError) return { ok: false, message: authorizationError.message };
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Credential reset service is unavailable." };
  }
  const temporaryPassword = generateTemporaryPassword();
  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
    app_metadata: { must_change_password: true },
  });
  if (passwordError) return { ok: false, message: passwordError.message };
  const { error: auditError } = await supabase.rpc("record_staff_temporary_password", {
    target_facility: facilityId,
    target_user: userId,
    change_reason: reason,
  });
  if (auditError) {
    await admin.from("profiles").update({ must_change_password: true, credential_updated_at: new Date().toISOString() }).eq("id", userId);
    return {
      ok: true,
      message: `Temporary password issued and first-login change enforced, but audit recording needs attention: ${auditError.message}`,
      temporaryPassword,
      loginIdentifier: text(form, "employee_no"),
    };
  }
  refreshAdministration();
  return {
    ok: true,
    message: "Temporary password issued. The staff member must change it at the next login.",
    temporaryPassword,
    loginIdentifier: text(form, "employee_no"),
  };
}
