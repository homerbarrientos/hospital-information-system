"use server";

import { createClient } from "@/lib/supabase/server";

export type PickerKind = "patient" | "doctor" | "encounter" | "service";
export type PickerRecord = { value: string; label: string; meta: string; type?: string; status?: string };
export type PickerResult = { records: PickerRecord[]; total: number; error: string };
const PAGE_SIZE = 20;

export async function searchPickerRecords(kind: PickerKind, query: string, page: number, typeFilter: string, includeCompleted: boolean): Promise<PickerResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return { records: [], total: 0, error: "Sign in is required." };
  const { data: roles } = await supabase.from("user_roles").select("facility_id").eq("user_id", userId).eq("active", true).limit(1);
  const facilityId = roles?.[0]?.facility_id;
  if (!facilityId) return { records: [], total: 0, error: "No active facility assignment." };
  const from = Math.max(0, page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const term = query.trim().replaceAll(",", " ");

  if (kind === "patient") {
    let request = supabase.from("patients").select("id,mrn,first_name,last_name", { count: "exact" }).eq("status", "active").order("last_name").range(from, to);
    if (term) request = request.or(`mrn.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    const { data, count, error } = await request;
    return { records: (data || []).map(row => ({ value: row.id, label: `${row.last_name}, ${row.first_name}`, meta: row.mrn })), total: count || 0, error: error?.message || "" };
  }

  if (kind === "doctor") {
    const { data: assignments, error: assignmentError } = await supabase.from("doctor_facility_assignments").select("doctor_id").eq("facility_id", facilityId).eq("active", true);
    if (assignmentError) return { records: [], total: 0, error: assignmentError.message };
    const doctorIds = (assignments || []).map(row => row.doctor_id);
    if (!doctorIds.length) return { records: [], total: 0, error: "" };
    let request = supabase.from("doctors").select("id,first_name,last_name,suffix,specialty", { count: "exact" }).in("id", doctorIds).eq("status", "active").order("last_name").range(from, to);
    if (term) request = request.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,specialty.ilike.%${term}%`);
    const { data, count, error } = await request;
    return { records: (data || []).map(row => ({ value: row.id, label: `Dr. ${row.last_name}, ${row.first_name}${row.suffix ? ` ${row.suffix}` : ""}`, meta: row.specialty })), total: count || 0, error: error?.message || "" };
  }

  if (kind === "service") {
    const { data: facility } = await supabase.from("facilities").select("organization_id").eq("id",facilityId).single();
    let request = supabase.from("service_catalog").select("id,code,name,category,billable",{count:"exact"}).eq("organization_id",facility?.organization_id).eq("status","active").order("name").range(from,to);
    if(term)request=request.or(`code.ilike.%${term}%,name.ilike.%${term}%,category.ilike.%${term}%`);
    const{data,count,error}=await request;
    return{records:(data||[]).map(row=>({value:row.id,label:row.name,meta:`${row.code} · ${row.category} · ${row.billable?"Billable":"Non-billable"}`,type:row.category})),total:count||0,error:error?.message||""};
  }

  let patientIds: string[] = [];
  if (term) {
    const { data: matchingPatients } = await supabase.from("patients").select("id").or(`mrn.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`).limit(100);
    patientIds = (matchingPatients || []).map(row => row.id);
  }
  let request = supabase.from("encounters").select("id,encounter_no,encounter_type,status,service_date,patient_id,patients!inner(mrn,first_name,last_name)", { count: "exact" }).eq("facility_id", facilityId).order("created_at", { ascending: false }).range(from, to);
  request = includeCompleted ? request.neq("status", "cancelled") : request.in("status", ["in_consultation", "awaiting_service"]);
  if (typeFilter !== "All") request = request.eq("encounter_type", typeFilter);
  if (term) request = patientIds.length ? request.or(`encounter_no.ilike.%${term}%,patient_id.in.(${patientIds.join(",")})`) : request.ilike("encounter_no", `%${term}%`);
  const { data, count, error } = await request;
  return { records: (data || []).map(row => { const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients; return { value: row.id, label: `${patient?.last_name || "Patient"}, ${patient?.first_name || ""} · ${patient?.mrn || ""}`, meta: `${row.encounter_no} · ${row.encounter_type} · ${row.service_date} · ${row.status.replaceAll("_", " ")}`, type: row.encounter_type, status: row.status }; }), total: count || 0, error: error?.message || "" };
}
