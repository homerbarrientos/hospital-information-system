import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { ReportsWorkspace } from "@/components/reports-workspace";
import { philippineDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const daysAgo=(days:number)=>philippineDateKey(new Date(Date.now()-days*24*60*60*1000));
const periodStart=(date:string)=>new Date(`${date}T00:00:00+08:00`).toISOString();
const periodEnd=(date:string)=>new Date(`${date}T23:59:59.999+08:00`).toISOString();
type DailyOperation={business_date:string;encounters:number;opd_visits:number;admissions:number;discharges:number;orders:number;prescriptions:number;charges:number;collections:number};
type DailyRevenue={business_date:string;source_type:string;gross_charges:number;deductions:number;transaction_count:number};

export default async function ReportsPage({searchParams}:{searchParams:Promise<{from?:string;to?:string}>}){
 const params=await searchParams,from=isoDate.test(params.from||"")?String(params.from):daysAgo(29),to=isoDate.test(params.to||"")?String(params.to):philippineDateKey(),start=periodStart(from),end=periodEnd(to);
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id").eq("user_id",userId).eq("active",true).limit(1);const facilityId=roles?.[0]?.facility_id;if(!facilityId)return <div className="form-error">No active facility assignment.</div>;
 const[{data:encounters,error:encounterError},{data:admissions,error:admissionError},{data:discharges,error:dischargeError},{data:orders,error:orderError},{data:prescriptions,error:prescriptionError},{data:ledger,error:ledgerError},{data:payments,error:paymentError},{data:balances,error:balancesError},{data:beds,error:bedsError},{data:diseases,error:diseaseError},{data:inventory,error:inventoryError},{data:audit,error:auditError}]=await Promise.all([
  supabase.from("encounters").select("service_date,encounter_type").eq("facility_id",facilityId).gte("service_date",from).lte("service_date",to).limit(5000),
  supabase.from("admissions").select("admitted_at,encounters!inner(facility_id)").eq("encounters.facility_id",facilityId).gte("admitted_at",start).lte("admitted_at",end).limit(5000),
  supabase.from("admissions").select("discharged_at,encounters!inner(facility_id)").eq("encounters.facility_id",facilityId).not("discharged_at","is",null).gte("discharged_at",start).lte("discharged_at",end).limit(5000),
  supabase.from("clinical_orders").select("ordered_at,encounters!inner(facility_id)").eq("encounters.facility_id",facilityId).gte("ordered_at",start).lte("ordered_at",end).limit(5000),
  supabase.from("prescriptions").select("prescribed_at,encounters!inner(facility_id)").eq("encounters.facility_id",facilityId).gte("prescribed_at",start).lte("prescribed_at",end).limit(5000),
  supabase.from("ledger_entries").select("posted_at,amount,kind,source_type,patient_accounts!inner(facility_id)").eq("patient_accounts.facility_id",facilityId).gte("posted_at",start).lte("posted_at",end).limit(5000),
  supabase.from("payments").select("posted_at,amount,status,patient_accounts!inner(facility_id)").eq("patient_accounts.facility_id",facilityId).gte("posted_at",start).lte("posted_at",end).limit(5000),
  supabase.from("report_patient_balances").select("billing_case_id,status,admission_no,mrn,last_name,first_name,gross_charges,approved_deductions,payments,final_balance,pending_deductions,ageing_band").eq("facility_id",facilityId).order("final_balance",{ascending:false}).limit(1000),
  supabase.from("report_bed_occupancy").select("ward_code,ward_name,total_beds,occupied_beds,available_beds,unavailable_beds,occupancy_percent").eq("facility_id",facilityId).order("ward_name"),
  supabase.from("disease_census").select("census_month,encounter_type,code,description,chapter,category,disease_class,reportable,classification,encounter_count,patient_count,male_patients,female_patients").eq("facility_id",facilityId).gte("census_month",from.slice(0,7)+"-01").lte("census_month",to).order("encounter_count",{ascending:false}).limit(1000),
  supabase.from("report_inventory_risk").select("store_name,product_code,product_name,unit,quantity_on_hand,reorder_level,nearest_expiry,stock_value,risk_status").eq("facility_id",facilityId).order("risk_status").order("product_name").limit(1000),
  supabase.from("audit_events").select("id,actor_id,created_at,event_type,object_type,result,reason").eq("facility_id",facilityId).gte("created_at",start).lte("created_at",end).order("created_at",{ascending:false}).limit(1000),
 ]);
 const daily=new Map<string,DailyOperation>(),revenueDaily=new Map<string,DailyRevenue>();
 const operation=(date:string)=>{let row=daily.get(date);if(!row){row={business_date:date,encounters:0,opd_visits:0,admissions:0,discharges:0,orders:0,prescriptions:0,charges:0,collections:0};daily.set(date,row)}return row};
 for(const item of encounters||[]){const row=operation(item.service_date);row.encounters+=1;if(item.encounter_type.toUpperCase()==="OPD")row.opd_visits+=1}
 for(const item of admissions||[])operation(philippineDateKey(item.admitted_at)).admissions+=1;
 for(const item of discharges||[])if(item.discharged_at)operation(philippineDateKey(item.discharged_at)).discharges+=1;
 for(const item of orders||[])operation(philippineDateKey(item.ordered_at)).orders+=1;
 for(const item of prescriptions||[])operation(philippineDateKey(item.prescribed_at)).prescriptions+=1;
 for(const item of ledger||[]){const date=philippineDateKey(item.posted_at),amount=Number(item.amount),row=operation(date);if(amount>0)row.charges+=amount;const key=`${date}\u0000${item.source_type}`;let revenueRow=revenueDaily.get(key);if(!revenueRow){revenueRow={business_date:date,source_type:item.source_type,gross_charges:0,deductions:0,transaction_count:0};revenueDaily.set(key,revenueRow)}if(amount>0)revenueRow.gross_charges+=amount;else if(item.kind!=="payment")revenueRow.deductions+=Math.abs(amount);revenueRow.transaction_count+=1}
 for(const item of payments||[])if(item.status==="posted")operation(philippineDateKey(item.posted_at)).collections+=Number(item.amount);
 const operations=[...daily.values()].sort((a,b)=>a.business_date.localeCompare(b.business_date)),revenue=[...revenueDaily.values()].sort((a,b)=>b.business_date.localeCompare(a.business_date));
 const loadError=encounterError||admissionError||dischargeError||orderError||prescriptionError||ledgerError||paymentError||balancesError||bedsError||diseaseError||inventoryError||auditError;
 return <><PageHeading eyebrow="Operational intelligence" title="Reports" description="Facility-scoped clinical, operational, financial, inventory, and compliance reporting."/>{loadError?<div className="form-error">Unable to load reports: {loadError.message}</div>:null}<ReportsWorkspace from={from} to={to} operations={operations||[]} revenue={revenue||[]} balances={balances||[]} beds={beds||[]} diseases={diseases||[]} inventory={inventory||[]} audit={audit||[]}/></>;
}
