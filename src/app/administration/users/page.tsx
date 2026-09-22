import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { UsersWorkspace } from "@/components/users-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");
  const { data: currentAssignments } = await supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = currentAssignments?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;
  const { data: facility } = await supabase.from("facilities").select("organization_id").eq("id", facilityId).single();
  const [{ data: assignments, error: assignmentError }, { data: roles, error: roleError }, { data: departments, error: departmentError }] = await Promise.all([
    supabase.from("user_roles").select("user_id,role_id,department_id,active").eq("facility_id", facilityId),
    supabase.from("roles").select("id,name,description,status").eq("organization_id", facility?.organization_id).order("name"),
    supabase.from("departments").select("id,code,name,status").eq("facility_id", facilityId).order("name"),
  ]);
  const staffIds = [...new Set((assignments || []).map((row) => row.user_id))];
  const { data: profiles, error: profileError } = staffIds.length
    ? await supabase.from("profiles").select("id,full_name,employee_no,email,status,version,created_at").in("id", staffIds).order("full_name")
    : { data: [], error: null };
  const members = (profiles || []).map((profile) => ({
    ...profile,
    assignments: (assignments || []).filter((assignment) => assignment.user_id === profile.id),
  }));
  const loadError = assignmentError || roleError || departmentError || profileError;
  return <>
    <PageHeading eyebrow="Identity administration" title="Users and staff" description="Invite named accounts, assign facility roles and departments, and deactivate access without deleting history."/>
    {loadError ? <div className="form-error">Unable to load staff administration: {loadError.message}</div> : null}
    <UsersWorkspace currentUserId={userId} facilityId={facilityId} members={members} roles={roles || []} departments={departments || []}/>
  </>;
}
