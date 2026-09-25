import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app-shell";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import { createClient } from "@/lib/supabase/server";

export default async function Inventory({searchParams}:{searchParams:Promise<{tab?:string}>}){
 const requestedTab=(await searchParams).tab;
 const supabase=await createClient();const{data:claims}=await supabase.auth.getClaims();const userId=claims?.claims.sub;if(!userId)redirect("/login");
 const{data:roles}=await supabase.from("user_roles").select("facility_id,facilities(organization_id)").eq("user_id",userId).eq("active",true).limit(1);const role=roles?.[0],facilityId=role?.facility_id,facilityRelation=role?.facilities,organizationId=(Array.isArray(facilityRelation)?facilityRelation[0]:facilityRelation)?.organization_id;if(!facilityId||!organizationId)return <div className="form-error">No active facility assignment.</div>;
 const[{data:products},{data:stores},{data:suppliers},{data:references},{data:lots,error:lotError},{data:movements,error:movementError}]=await Promise.all([
  supabase.from("products").select("id,code,name,unit,reorder_level").eq("organization_id",organizationId).eq("product_type","medicine").eq("status","active").order("name"),
  supabase.from("stores").select("id,code,name,store_type,status").eq("facility_id",facilityId).order("name"),
  supabase.from("suppliers").select("id,code,name,contact_person,phone,email,address,status,version").eq("organization_id",organizationId).order("name"),
  supabase.from("reference_options").select("code,label,reference_groups!inner(code)").in("reference_groups.code",["inventory_adjustment_reason","inventory_location_type"]).eq("active",true).order("sort_order"),
  supabase.from("stock_lots").select("id,store_id,product_id,lot_no,expiry_date,quantity_on_hand,unit_cost,supplier_id,received_at,stores!inner(facility_id)").eq("stores.facility_id",facilityId).order("expiry_date"),
  supabase.from("stock_movements").select("id,store_id,product_id,lot_id,movement_type,quantity,source_type,source_id,reason,posted_at,reference_no,balance_after,unit_cost,supplier_id,remarks,stores!inner(facility_id)").eq("stores.facility_id",facilityId).order("posted_at",{ascending:false}).limit(1000),
 ]);
 const movementIds=(movements||[]).map(movement=>movement.id);const{data:documentRows}=movementIds.length?await supabase.from("inventory_documents").select("id,movement_id,storage_path,display_name,description,uploaded_at").in("movement_id",movementIds).eq("status","active").order("uploaded_at",{ascending:false}):{data:[]};
 const paths=(documentRows||[]).map(document=>document.storage_path),{data:signedRows}=paths.length?await supabase.storage.from("inventory-documents").createSignedUrls(paths,600):{data:[]};const signedMap=new Map((signedRows||[]).map(row=>[row.path,row.signedUrl]));const documents=(documentRows||[]).map(document=>({...document,url:signedMap.get(document.storage_path)||""}));
 return <><PageHeading eyebrow="Stock control" title="Inventory" description="Receive medicines by lot and expiry, monitor stock levels, and preserve a complete audited movement history."/>{lotError||movementError?<div className="form-error">Unable to load inventory: {(lotError||movementError)?.message}</div>:null}<InventoryWorkspace facilityId={facilityId} currentDate={new Date().toISOString().slice(0,10)} products={products||[]} stores={stores||[]} suppliers={suppliers||[]} lots={lots||[]} movements={movements||[]} references={references||[]} documents={documents} initialTab={requestedTab}/></>;
}
