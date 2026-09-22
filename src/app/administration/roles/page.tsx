import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { RolesWorkspace } from "@/components/roles-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function RolesPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");
  const { data: currentAssignments } = await supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = currentAssignments?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;
  const { data: facility } = await supabase.from("facilities").select("organization_id").eq("id", facilityId).single();
  const [{ data: roles, error: roleError }, { data: privileges, error: privilegeError }, { data: grants, error: grantError }, { data: assignments, error: assignmentError }] = await Promise.all([
    supabase.from("roles").select("id,name,description,status,version").eq("organization_id", facility?.organization_id).order("name"),
    supabase.from("privileges").select("code,description,risk_level").order("code"),
    supabase.from("role_privileges").select("role_id,privilege_code"),
    supabase.from("user_roles").select("role_id,user_id,active").eq("facility_id", facilityId),
  ]);
  const rows = (roles || []).map((role) => ({
    ...role,
    privilege_codes: (grants || []).filter((grant) => grant.role_id === role.id).map((grant) => grant.privilege_code),
    active_users: new Set((assignments || []).filter((assignment) => assignment.role_id === role.id && assignment.active).map((assignment) => assignment.user_id)).size,
  }));
  const loadError = roleError || privilegeError || grantError || assignmentError;
  return <>
    <PageHeading eyebrow="Access governance" title="Roles and privileges" description="Build deny-by-default roles, review risk levels, and audit every privilege change."/>
    {loadError ? <div className="form-error">Unable to load role administration: {loadError.message}</div> : null}
    <RolesWorkspace facilityId={facilityId} roles={rows} privileges={privileges || []}/>
  </>;
}
