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
  const [{ data: assignments }, { data: departments }, {data:referenceOptions}] = await Promise.all([
    supabase.from("doctor_facility_assignments").select("doctor_id,department_id,active,doctors(id,first_name,middle_name,last_name,suffix,license_number,specialty,phone,email,status,version,prc_issued_on,prc_expires_on,credential_status,philhealth_accreditation_no,philhealth_valid_from,philhealth_valid_until,subspecialty,doctor_type,clinic_schedule,professional_fee)").eq("facility_id", facilityId),
    supabase.from("departments").select("id,name").eq("facility_id", facilityId).order("name"),
    supabase.from("reference_options").select("code,label,reference_groups!inner(code)").in("reference_groups.code",["doctor_specialty","doctor_type","credential_status"]).eq("active",true).order("sort_order"),
  ]);
  const doctors = (assignments || []).flatMap((row) => {
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return doctor ? [{ ...doctor, department_id: row.department_id }] : [];
  });
  return <>
    <PageHeading eyebrow="Clinical administration" title="Doctor Master List" description="Maintain one audited doctor registry used by consultations, admissions, orders, pharmacy, discharge, and reporting."/>
    <DoctorsWorkspace doctors={doctors} departments={departments || []} facilityId={facilityId} referenceOptions={(referenceOptions||[]).map(option=>({code:option.code,label:option.label,group:option.reference_groups[0]?.code}))}/>
  </>;
}
