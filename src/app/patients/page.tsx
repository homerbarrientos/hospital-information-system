import { redirect } from "next/navigation";
import { AppShell, PageHeading } from "@/components/app-shell";
import { PatientWorkspace, type Patient } from "@/components/patient-workspace";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;
const patientStatuses = new Set(["active", "inactive", "all"]);
const cleanTerm = (value: string) => value.replace(/[,%()]/g, " ").trim().slice(0, 100);

export default async function Patients({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = cleanTerm(params.q || "");
  const status = patientStatuses.has(params.status || "") ? String(params.status) : "active";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? String(params.date) : "";
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");

  const { data: assignments } = await supabase
    .from("user_roles")
    .select("facility_id")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);
  const facilityId = assignments?.[0]?.facility_id;
  if (!facilityId) {
    return <AppShell>
      <PageHeading eyebrow="Access required" title="No facility assignment" description="Ask an administrator to assign your account to a facility and role."/>
      <div className="form-error">This user cannot access patient records yet.</div>
    </AppShell>;
  }

  let patientQuery = supabase
    .from("patients")
    .select("id,mrn,first_name,middle_name,last_name,birth_date,sex_at_birth,phone,email,created_at,version,status", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (status !== "all") patientQuery = patientQuery.eq("status", status);
  if (query) patientQuery = patientQuery.or(`mrn.ilike.%${query}%,first_name.ilike.%${query}%,middle_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`);
  if (date) patientQuery = patientQuery.gte("created_at", `${date}T00:00:00`).lt("created_at", `${date}T23:59:59.999`);

  const [{ data: patients, error, count }, { data: sexOptions }] = await Promise.all([
    patientQuery,
    supabase.from("reference_options").select("code,label,reference_groups!inner(code)").eq("reference_groups.code", "sex_at_birth").eq("active", true).order("sort_order"),
  ]);

  return <AppShell>
    <PageHeading eyebrow="Master patient index" title="Patients" description="Search first to prevent duplicate patient records."/>
    {error && <div className="form-error">{error.message}</div>}
    <PatientWorkspace
      patients={(patients || []) as Patient[]}
      facilityId={facilityId}
      sexOptions={sexOptions || []}
      listState={{ query, status, date, page, total: count || 0, pageSize: PAGE_SIZE }}
    />
  </AppShell>;
}
