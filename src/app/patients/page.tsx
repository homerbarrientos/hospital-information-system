import { redirect } from "next/navigation";
import { AppShell, PageHeading } from "@/components/app-shell";
import { PatientWorkspace, type Patient } from "@/components/patient-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function Patients() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");
  const [{ data: assignments }, { data: patients, error }, { data: options }] = await Promise.all([
    supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1),
    supabase.from("patients").select("id,mrn,first_name,middle_name,last_name,birth_date,sex_at_birth,phone,email,address,created_at,version,status,civil_status,nationality,religion,blood_type,occupation,philhealth_no,philhealth_membership_type,philhealth_relationship,philhealth_status,philhealth_valid_until,government_id_type,government_id_no,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,profile_photo_path").order("created_at", { ascending: false }),
    supabase.from("reference_options").select("code,label,sort_order,reference_groups!inner(code)").in("reference_groups.code", ["sex_at_birth", "civil_status", "blood_type", "philhealth_membership_type", "philhealth_relationship", "philhealth_status", "government_id_type"]).eq("active", true).order("sort_order"),
  ]);
  const facilityId = assignments?.[0]?.facility_id;
  if (!facilityId) return <AppShell><PageHeading eyebrow="Access required" title="No facility assignment" description="Ask an administrator to assign your account to a facility and role."/><div className="form-error">This user cannot access patient records yet.</div></AppShell>;
  const referenceOptions = (options || []).map((option) => ({ code: option.code, label: option.label, group: option.reference_groups[0]?.code }));
  const photoPaths = (patients || []).flatMap(patient => patient.profile_photo_path ? [patient.profile_photo_path] : []);
  const { data: signedPhotos } = photoPaths.length
    ? await supabase.storage.from("profile-photos").createSignedUrls(photoPaths, 3600)
    : { data: [] };
  const photoUrls = new Map((signedPhotos || []).map(photo => [photo.path, photo.signedUrl]));
  const patientsWithPhotos = (patients || []).map(patient => ({ ...patient, profile_photo_url:patient.profile_photo_path ? photoUrls.get(patient.profile_photo_path) || null : null }));
  return <AppShell><PageHeading eyebrow="Master patient index" title="Patients" description="Search first to prevent duplicate patient records."/>{error && <div className="form-error">{error.message}</div>}<PatientWorkspace patients={patientsWithPhotos as Patient[]} facilityId={facilityId} referenceOptions={referenceOptions}/></AppShell>;
}
