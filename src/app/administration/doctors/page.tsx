import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { DoctorsWorkspace } from "@/components/doctors-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function DoctorsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return <div className="form-error">No active facility assignment.</div>;
  const [{ data: assignments }, { data: departments }] = await Promise.all([
    supabase.from("doctor_facility_assignments").select("doctor_id,department_id,active,doctors(id,first_name,middle_name,last_name,suffix,license_number,specialty,phone,email,status,version)").eq("facility_id", facilityId),
    supabase.from("departments").select("id,name").eq("facility_id", facilityId).order("name"),
  ]);
  const doctors = (assignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor ? [{ ...doctor, department_id: row.department_id }] : [];
  });
  return <>
    <PageHeading eyebrow="Clinical administration" title="Doctor Master List" description="Maintain one audited doctor registry used by consultations, admissions, orders, pharmacy, discharge, and reporting."/>
    <DoctorsWorkspace doctors={doctors} departments={departments || []} facilityId={facilityId}/>
  </>;
}
