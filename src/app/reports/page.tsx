import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { ReportsWorkspace } from "@/components/reports-workspace";
import { createClient } from "@/lib/supabase/server";

const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const daysAgo=(days:number)=>{const date=new Date();date.setUTCDate(date.getUTCDate()-days);return date.toISOString().slice(0,10)};

export default async function ReportsPage({searchParams}:{searchParams:Promise<{from?:string;to?:string}>}){
 const params=await searchParams,from=isoDate.test(params.from||"")?String(params.from):daysAgo(29),to=isoDate.test(params.to||"")?String(params.to):new Date().toISOString().slice(0,10);
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const[{data:operations,error:operationsError},{data:revenue,error:revenueError},{data:balances,error:balancesError},{data:beds,error:bedsError},{data:diseases,error:diseaseError},{data:inventory,error:inventoryError},{data:audit,error:auditError}]=await Promise.all([
  supabase.from("report_daily_operations").select("business_date,encounters,opd_visits,admissions,discharges,orders,prescriptions,charges,collections").eq("facility_id",facilityId).gte("business_date",from).lte("business_date",to).order("business_date"),
  supabase.from("report_revenue_by_source").select("business_date,source_type,gross_charges,deductions,transaction_count").eq("facility_id",facilityId).gte("business_date",from).lte("business_date",to).order("business_date",{ascending:false}).limit(1000),
  supabase.from("report_patient_balances").select("billing_case_id,status,admission_no,mrn,last_name,first_name,gross_charges,approved_deductions,payments,final_balance,pending_deductions,ageing_band").eq("facility_id",facilityId).order("final_balance",{ascending:false}).limit(1000),
  supabase.from("report_bed_occupancy").select("ward_code,ward_name,total_beds,occupied_beds,available_beds,unavailable_beds,occupancy_percent").eq("facility_id",facilityId).order("ward_name"),
  supabase.from("disease_census").select("census_month,encounter_type,code,description,chapter,category,disease_class,reportable,classification,encounter_count,patient_count,male_patients,female_patients").eq("facility_id",facilityId).gte("census_month",from.slice(0,7)+"-01").lte("census_month",to).order("encounter_count",{ascending:false}).limit(1000),
  supabase.from("report_inventory_risk").select("store_name,product_code,product_name,unit,quantity_on_hand,reorder_level,nearest_expiry,stock_value,risk_status").eq("facility_id",facilityId).order("risk_status").order("product_name").limit(1000),
  supabase.from("audit_events").select("id,actor_id,created_at,event_type,object_type,result,reason").eq("facility_id",facilityId).gte("created_at",`${from}T00:00:00Z`).lte("created_at",`${to}T23:59:59Z`).order("created_at",{ascending:false}).limit(1000),
 ]);
 const loadError=operationsError||revenueError||balancesError||bedsError||diseaseError||inventoryError||auditError;
 return <><PageHeading eyebrow="Operational intelligence" title="Reports" description="Facility-scoped clinical, operational, financial, inventory, and compliance reporting."/>{loadError?<div className="form-error">Unable to load reports: {loadError.message}</div>:null}<ReportsWorkspace from={from} to={to} operations={operations||[]} revenue={revenue||[]} balances={balances||[]} beds={beds||[]} diseases={diseases||[]} inventory={inventory||[]} audit={audit||[]}/></>;
}
