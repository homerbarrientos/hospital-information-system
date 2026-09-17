"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type InventoryState={ok:boolean;message:string;movementId?:string};
const value=(form:FormData,key:string)=>String(form.get(key)||"").trim();
const error=(message:string):InventoryState=>({ok:false,message});

async function rpc(name:string,args:Record<string,unknown>,success:string):Promise<InventoryState>{
 const supabase=await createClient();const{data,error:rpcError}=await supabase.rpc(name,args);
 if(rpcError)return error(rpcError.message);revalidatePath("/inventory");return{ok:true,message:success,movementId:typeof data==="string"?data:undefined};
}

export async function postInventoryStock(_:InventoryState,form:FormData):Promise<InventoryState>{
 const quantity=Number(value(form,"quantity")),cost=Number(value(form,"unit_cost"));
 if(!value(form,"store_id")||!value(form,"product_id")||!value(form,"lot_no")||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(cost)||cost<0)return error("Location, medicine, lot number, positive quantity, and valid cost are required.");
 return rpc("post_inventory_stock",{target_facility:value(form,"facility_id"),target_store:value(form,"store_id"),target_product:value(form,"product_id"),target_supplier:value(form,"supplier_id")||null,lot_number:value(form,"lot_no"),expiry:value(form,"expiry_date")||null,stock_quantity:quantity,cost,source_kind:value(form,"source_kind"),external_reference:value(form,"reference_no"),entry_remarks:value(form,"remarks")},value(form,"source_kind")==="beginning_balance"?"Beginning balance posted.":"Stock receipt posted.");
}

export async function adjustInventory(_:InventoryState,form:FormData):Promise<InventoryState>{
 const actual=Number(value(form,"actual_quantity"));if(!value(form,"lot_id")||!Number.isFinite(actual)||actual<0||!value(form,"reason_code")||value(form,"remarks").length<5)return error("Select a lot and reason, enter the actual quantity, and provide detailed remarks.");
 return rpc("adjust_inventory",{target_facility:value(form,"facility_id"),target_lot:value(form,"lot_id"),actual_quantity:actual,reason_code:value(form,"reason_code"),adjustment_remarks:value(form,"remarks")},"Inventory adjustment posted.");
}

export async function transferInventory(_:InventoryState,form:FormData):Promise<InventoryState>{
 const quantity=Number(value(form,"quantity"));if(!value(form,"lot_id")||!value(form,"destination_store")||!Number.isFinite(quantity)||quantity<=0||value(form,"remarks").length<5)return error("Select the source lot and destination, enter a positive quantity, and provide a transfer reason.");
 return rpc("transfer_inventory",{target_facility:value(form,"facility_id"),target_lot:value(form,"lot_id"),destination_store:value(form,"destination_store"),transfer_quantity:quantity,transfer_remarks:value(form,"remarks")},"Stock transfer posted.");
}

export async function createSupplier(_:InventoryState,form:FormData):Promise<InventoryState>{
 if(value(form,"code").length<2||value(form,"name").length<2)return error("Supplier code and name are required.");
 return rpc("create_inventory_supplier",{target_facility:value(form,"facility_id"),supplier_code:value(form,"code"),supplier_name:value(form,"name"),contact_name:value(form,"contact_person"),contact_phone:value(form,"phone"),contact_email:value(form,"email"),supplier_address:value(form,"address")},"Supplier added.");
}

export async function updateSupplier(_:InventoryState,form:FormData):Promise<InventoryState>{
 if(value(form,"name").length<2||value(form,"reason").length<5)return error("Supplier name and modification reason are required.");
 return rpc("update_inventory_supplier",{target_facility:value(form,"facility_id"),target_supplier:value(form,"supplier_id"),supplier_name:value(form,"name"),contact_name:value(form,"contact_person"),contact_phone:value(form,"phone"),contact_email:value(form,"email"),supplier_address:value(form,"address"),expected_version:Number(value(form,"version")),modification_reason:value(form,"reason")},"Supplier updated.");
}

export async function setSupplierStatus(form:FormData):Promise<void>{
 if(value(form,"reason").length<5)throw new Error("Status reason must contain at least 5 characters.");
 const result=await rpc("set_inventory_supplier_status",{target_facility:value(form,"facility_id"),target_supplier:value(form,"supplier_id"),next_status:value(form,"status"),change_reason:value(form,"reason")},"Supplier status updated.");
 if(!result.ok)throw new Error(result.message);
}

export async function addInventoryAttachment(form:FormData):Promise<InventoryState>{
 const supabase=await createClient(),movementId=value(form,"movement_id"),facilityId=value(form,"facility_id"),title=value(form,"display_name"),file=form.get("attachment");
 if(!movementId||title.length<2)return error("Movement and document title are required.");
 if(!(file instanceof File)||file.size<1)return error("Choose a document to upload.");
 const allowed=new Map([["application/pdf","pdf"],["image/jpeg","jpg"],["image/png","png"]]);const extension=allowed.get(file.type);
 if(!extension)return error("Attachment must be PDF, JPG, or PNG.");if(file.size>5*1024*1024)return error("Attachment must be 5 MB or smaller.");
 const path=`${facilityId}/${movementId}/${randomUUID()}.${extension}`;const{error:uploadError}=await supabase.storage.from("inventory-documents").upload(path,file,{contentType:file.type,upsert:false});if(uploadError)return error(uploadError.message);
 const{error:rpcError}=await supabase.rpc("add_inventory_document",{target_movement:movementId,file_path:path,original_file_name:file.name,document_title:title,document_description:value(form,"description"),file_type:file.type,file_size:file.size});
 if(rpcError){await supabase.storage.from("inventory-documents").remove([path]);return error(rpcError.message);}revalidatePath("/inventory");return{ok:true,message:"Attachment uploaded."};
}
