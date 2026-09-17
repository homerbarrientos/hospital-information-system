"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, ChevronRight, FilePenLine, FilePlus2, Paperclip, Pill, Plus, Trash2, X } from "lucide-react";
import {
  addPrescriptionAttachment, amendPrescription, cancelPrescription, createPrescription,
  dispenseMedication, removePrescriptionAttachment, updatePrescriptionAttachment,
  validatePrescription, type PharmacyState,
} from "@/app/pharmacy/actions";
import { ListControls, type ListState } from "@/components/list-controls";
import { SearchPicker, } from "@/components/search-picker";

type Prescription = { id:string;encounter_id:string;prescription_no:string;status:string;prescribed_at:string;prescribing_doctor_id:string|null;notes:string|null;cancellation_reason:string|null;version:number };
type Encounter = { id:string;encounter_no:string;patient_id:string;encounter_type:string;service_date:string };
type Patient = { id:string;mrn:string;first_name:string;last_name:string };
type Item = { id:string;prescription_id:string;product_id:string;dose:string;route:string|null;frequency:string|null;duration:string|null;quantity:number;instructions:string|null };
type Product = { id:string;code:string;name:string;unit:string };
type Dispense = { id:string;prescription_item_id:string;stock_lot_id:string;quantity:number;status:string;dispensed_at:string };
type Lot = { id:string;product_id:string;lot_no:string;expiry_date:string|null;quantity_on_hand:number;store_id:string;stores:{facility_id:string;name:string}|Array<{facility_id:string;name:string}> };
type Doctor = { id:string;first_name:string;last_name:string;suffix:string|null;specialty:string };
type Reference = { code:string;label:string;reference_groups:{code:string}|Array<{code:string}> };
type Document = { id:string;prescription_id:string;display_name:string;description:string|null;mime_type:string;size_bytes:number;uploaded_at:string;url:string };
type DraftItem = { product_id:string;product_label:string;product_meta:string;dose:string;route:string;frequency:string;duration:string;quantity:string;instructions:string };
const initial: PharmacyState = { ok:false,message:"" };
const blankItem = ():DraftItem => ({product_id:"",product_label:"",product_meta:"",dose:"",route:"oral",frequency:"once_daily",duration:"",quantity:"1",instructions:""});
const doctorLabel=(doctor?:Doctor)=>doctor?`Dr. ${doctor.last_name}, ${doctor.first_name}${doctor.suffix?` ${doctor.suffix}`:""}`:"Not assigned";
const refOptions=(references:Reference[],group:string)=>references.filter(option=>{const relation=Array.isArray(option.reference_groups)?option.reference_groups[0]:option.reference_groups;return relation?.code===group;});

export function PharmacyWorkspace({ prescriptions, encounters, patients, items, products, dispenses, lots, doctors, references, documents, listState }:{
  prescriptions:Prescription[];encounters:Encounter[];patients:Patient[];items:Item[];products:Product[];dispenses:Dispense[];lots:Lot[];doctors:Doctor[];references:Reference[];documents:Document[];listState:ListState;
}) {
  const [creating,setCreating]=useState(false);
  const [selected,setSelected]=useState<Prescription|null>(null);
  const encounterFor=(prescription:Prescription)=>encounters.find(encounter=>encounter.id===prescription.encounter_id);
  const patientFor=(prescription:Prescription)=>patients.find(patient=>patient.id===encounterFor(prescription)?.patient_id);
  return <>
    <div className="toolbar"><button className="btn btn-primary" onClick={()=>setCreating(true)}><Plus size={15}/>Add prescription</button></div>
    <section className="card">
      <div className="card-header"><h3>Prescription and dispensing worklist</h3><span className="badge blue">Live data</span></div>
      <ListControls basePath="/pharmacy" state={listState} statusOptions={[
        {value:"active",label:"Active prescriptions"},{value:"ordered",label:"Ordered"},{value:"validated",label:"Validated"},
        {value:"partially_dispensed",label:"Partially dispensed"},{value:"dispensed",label:"Dispensed"},{value:"cancelled",label:"Cancelled"},{value:"all",label:"All statuses"},
      ]} searchPlaceholder="Patient name or MRN" dateLabel="Prescription date"/>
      <div className="table-wrap list-table-scroll"><table className="data-table pharmacy-table"><thead><tr><th>Prescription</th><th>Patient / Encounter</th><th>Prescribing doctor</th><th>Medicines</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{prescriptions.map(prescription=>{const encounter=encounterFor(prescription);const patient=patientFor(prescription);const prescriptionItems=items.filter(item=>item.prescription_id===prescription.id);return <tr key={prescription.id}>
          <td className="name-cell"><strong>{prescription.prescription_no}</strong><span>{new Date(prescription.prescribed_at).toLocaleString()} · v{prescription.version}</span></td>
          <td className="name-cell"><strong>{patient?`${patient.last_name}, ${patient.first_name}`:"Patient"}</strong><span>{patient?.mrn} · {encounter?.encounter_no}</span></td>
          <td>{doctorLabel(doctors.find(doctor=>doctor.id===prescription.prescribing_doctor_id))}</td>
          <td>{prescriptionItems.map(item=>products.find(product=>product.id===item.product_id)?.name||"Medicine").join(", ")||"No medicines"}</td>
          <td><span className={`badge ${prescription.status==="dispensed"?"green":prescription.status==="cancelled"?"red":prescription.status==="validated"?"blue":"amber"}`}>{prescription.status.replaceAll("_"," ")}</span></td>
          <td><button className="btn btn-secondary" onClick={()=>setSelected(prescription)}>View / manage <ChevronRight size={14}/></button></td>
        </tr>})}{!prescriptions.length?<tr><td className="empty-state" colSpan={6}>No prescriptions match the selected filters.</td></tr>:null}</tbody>
      </table></div>
    </section>
    {creating?<PrescriptionForm mode="create" doctors={doctors} references={references} close={()=>setCreating(false)}/>:null}
    {selected?<PrescriptionDetail prescription={selected} encounter={encounterFor(selected)} patient={patientFor(selected)} items={items.filter(item=>item.prescription_id===selected.id)} products={products} dispenses={dispenses} lots={lots} doctors={doctors} references={references} documents={documents.filter(document=>document.prescription_id===selected.id)} close={()=>setSelected(null)}/>:null}
  </>;
}

function ModalHead({title,close}:{title:string;close:()=>void}){return <div className="modal-head"><div><p className="eyebrow">Medication workflow</p><h3>{title}</h3></div><button className="icon-btn" type="button" onClick={close} aria-label="Close"><X size={17}/></button></div>}

function PrescriptionForm({mode,prescription,savedItems,products,doctors,references,close}:{mode:"create"|"edit";prescription?:Prescription;savedItems?:Item[];products?:Product[];doctors:Doctor[];references:Reference[];close:()=>void}){
  const [state,action,pending]=useActionState(mode==="create"?createPrescription:amendPrescription,initial);
  const [draftItems,setDraftItems]=useState<DraftItem[]>(()=>savedItems?.map(item=>{const product=products?.find(entry=>entry.id===item.product_id);return{product_id:item.product_id,product_label:product?.name||"Medicine",product_meta:product?`${product.code} · ${product.unit}`:"",dose:item.dose,route:item.route||"oral",frequency:item.frequency||"once_daily",duration:item.duration||"",quantity:String(item.quantity),instructions:item.instructions||""}})||[blankItem()]);
  const update=(index:number,key:keyof DraftItem,value:string)=>setDraftItems(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,[key]:value}:item));
  return <div className="modal-backdrop pharmacy-backdrop"><section className="modal pharmacy-modal" role="dialog" aria-modal="true"><ModalHead title={mode==="create"?"Add prescription":`Modify ${prescription?.prescription_no}`} close={close}/>
    <form action={action} className="pharmacy-form">
      {prescription?<><input type="hidden" name="prescription_id" value={prescription.id}/><input type="hidden" name="version" value={prescription.version}/></>:null}
      <input type="hidden" name="items" value={JSON.stringify(draftItems.map(item=>({product_id:item.product_id,dose:item.dose,route:item.route,frequency:item.frequency,duration:item.duration,quantity:item.quantity,instructions:item.instructions})))}/>
      {mode==="create"?<SearchPicker kind="encounter" name="encounter_id" label="Active patient encounter" title="Select patient encounter" placeholder="No encounter selected" searchPlaceholder="Search patient, MRN, encounter, or date" required/>:<div className="order-readonly wide">Patient and encounter cannot be changed after the prescription is created.</div>}
      <SearchPicker kind="doctor" name="doctor_id" label="Prescribing doctor" title="Select prescribing doctor" placeholder="No doctor selected" searchPlaceholder="Search doctor or specialty" required defaultValue={prescription?.prescribing_doctor_id||""} initialOption={prescription?.prescribing_doctor_id?{value:prescription.prescribing_doctor_id,label:doctorLabel(doctors.find(doctor=>doctor.id===prescription.prescribing_doctor_id)),meta:doctors.find(doctor=>doctor.id===prescription.prescribing_doctor_id)?.specialty||""}:undefined}/>
      <label className="wide">Prescription notes<textarea name="notes" rows={4} maxLength={2000} defaultValue={prescription?.notes||""} placeholder="Clinical notes, precautions, or special dispensing instructions"/></label>
      <fieldset className="pharmacy-item-builder wide"><legend>Prescribed medicines</legend>{draftItems.map((item,index)=><div className="pharmacy-item-card" key={index}>
        <SearchPicker kind="medicine" name={`medicine_${index}`} label={`Medicine ${index+1}`} title="Select medicine" placeholder="No medicine selected" searchPlaceholder="Search medicine code, name, or unit" required value={item.product_id} initialOption={item.product_id?{value:item.product_id,label:item.product_label,meta:item.product_meta}:undefined} onSelect={record=>setDraftItems(current=>current.map((entry,itemIndex)=>itemIndex===index?{...entry,product_id:record.value,product_label:record.label,product_meta:record.meta}:entry))}/>
        <label>Dose<input required value={item.dose} onChange={event=>update(index,"dose",event.target.value)} placeholder="Example: 500 mg"/></label>
        <label>Route<select required value={item.route} onChange={event=>update(index,"route",event.target.value)}>{refOptions(references,"medication_route").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
        <label>Frequency<select required value={item.frequency} onChange={event=>update(index,"frequency",event.target.value)}>{refOptions(references,"medication_frequency").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
        <label>Duration<input value={item.duration} onChange={event=>update(index,"duration",event.target.value)} placeholder="Example: 7 days"/></label>
        <label>Quantity<input required min="0.001" step="0.001" type="number" value={item.quantity} onChange={event=>update(index,"quantity",event.target.value)}/></label>
        <label className="item-instructions">Instructions<input value={item.instructions} onChange={event=>update(index,"instructions",event.target.value)} placeholder="Take after meals"/></label>
        <button type="button" className="icon-btn" disabled={draftItems.length===1} onClick={()=>setDraftItems(current=>current.filter((_,itemIndex)=>itemIndex!==index))} aria-label="Remove medicine"><Trash2 size={15}/></button>
      </div>)}<button type="button" className="btn btn-secondary" disabled={draftItems.length>=20} onClick={()=>setDraftItems(current=>[...current,blankItem()])}><Plus size={14}/>Add another medicine</button></fieldset>
      {mode==="edit"?<label className="wide">Reason for modification<textarea required minLength={5} maxLength={500} rows={4} name="reason" placeholder="Explain why the prescription is being changed"/></label>:null}
      {state.message?<div className={state.ok?"form-success wide":"form-error wide"}>{state.message}</div>:null}
      <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok?"Close":"Cancel"}</button>{!state.ok?<button disabled={pending} className="btn btn-primary"><Pill size={15}/>{pending?"Saving…":mode==="create"?"Save prescription":"Save amendment"}</button>:null}</div>
    </form>
  </section></div>;
}

function PrescriptionDetail({prescription,encounter,patient,items,products,dispenses,lots,doctors,references,documents,close}:{prescription:Prescription;encounter?:Encounter;patient?:Patient;items:Item[];products:Product[];dispenses:Dispense[];lots:Lot[];doctors:Doctor[];references:Reference[];documents:Document[];close:()=>void}){
  const [editing,setEditing]=useState(false);const [documentMode,setDocumentMode]=useState<{mode:"add"|"edit"|"remove";document?:Document}|null>(null);
  const [cancelState,cancelAction,cancelPending]=useActionState(cancelPrescription,initial);
  if(editing)return <PrescriptionForm mode="edit" prescription={prescription} savedItems={items} products={products} doctors={doctors} references={references} close={()=>setEditing(false)}/>;
  return <><div className="modal-backdrop pharmacy-backdrop"><section className="modal pharmacy-detail-modal" role="dialog" aria-modal="true"><ModalHead title={prescription.prescription_no} close={close}/><div className="pharmacy-detail-body">
    <div className="order-summary-grid"><Info label="Patient" value={patient?`${patient.last_name}, ${patient.first_name} · ${patient.mrn}`:"Patient"}/><Info label="Encounter" value={encounter?.encounter_no||"—"}/><Info label="Prescribing doctor" value={doctorLabel(doctors.find(doctor=>doctor.id===prescription.prescribing_doctor_id))}/><Info label="Status" value={prescription.status.replaceAll("_"," ")}/></div>
    <div className="order-instructions"><span>Prescription notes</span><p>{prescription.notes||"No notes recorded."}</p></div>
    <section className="pharmacy-items"><h4>Medicines and dispensing</h4>{items.map(item=><MedicationCard key={item.id} item={item} product={products.find(product=>product.id===item.product_id)} dispenses={dispenses.filter(dispense=>dispense.prescription_item_id===item.id)} lots={lots.filter(lot=>lot.product_id===item.product_id)} prescriptionStatus={prescription.status}/>)}</section>
    <section className="pharmacy-documents"><header><div><h4>Attachments</h4><p>Private supporting prescription documents with audited history.</p></div><button className="btn btn-secondary" onClick={()=>setDocumentMode({mode:"add"})}><FilePlus2 size={15}/>Add attachment</button></header>{documents.length?<div className="attachment-list">{documents.map(document=><article className="attachment-card" key={document.id}><div><strong>{document.display_name}</strong><span>{document.description||"No description"} · {(document.size_bytes/1024).toFixed(0)} KB</span></div><div className="attachment-actions"><a className="btn btn-secondary" href={document.url} target="_blank" rel="noreferrer"><Paperclip size={14}/>View</a><button className="btn btn-secondary" onClick={()=>setDocumentMode({mode:"edit",document})}><FilePenLine size={14}/>Edit</button><button className="btn attachment-remove-btn" onClick={()=>setDocumentMode({mode:"remove",document})}><Trash2 size={14}/>Remove</button></div></article>)}</div>:<p className="chart-empty">No supporting documents attached.</p>}</section>
    {prescription.cancellation_reason?<div className="form-error">Cancellation reason: {prescription.cancellation_reason}</div>:null}
    <div className="order-detail-actions">{prescription.status==="ordered"?<><button className="btn btn-secondary" onClick={()=>setEditing(true)}><FilePenLine size={15}/>Modify prescription</button><form action={async form=>{await validatePrescription(form)}}><input type="hidden" name="prescription_id" value={prescription.id}/><button className="btn btn-primary"><CheckCircle2 size={15}/>Validate prescription</button></form></>:null}</div>
    {["ordered","validated"].includes(prescription.status)?<form action={cancelAction} className="order-cancel-form"><input type="hidden" name="prescription_id" value={prescription.id}/><label>Cancellation reason<textarea required minLength={5} maxLength={500} name="reason" rows={4} placeholder="Explain why this prescription must be cancelled"/></label><button disabled={cancelPending} className="btn order-cancel-btn">{cancelPending?"Cancelling…":"Cancel prescription"}</button>{cancelState.message?<div className={cancelState.ok?"form-success":"form-error"}>{cancelState.message}</div>:null}</form>:null}
  </div></section></div>{documentMode?<AttachmentDialog prescriptionId={prescription.id} mode={documentMode.mode} document={documentMode.document} close={()=>setDocumentMode(null)}/>:null}</>;
}

function MedicationCard({item,product,dispenses,lots,prescriptionStatus}:{item:Item;product?:Product;dispenses:Dispense[];lots:Lot[];prescriptionStatus:string}){
  const [state,action,pending]=useActionState(dispenseMedication,initial);const dispensed=dispenses.filter(record=>record.status==="posted").reduce((sum,record)=>sum+Number(record.quantity),0);const remaining=Math.max(0,Number(item.quantity)-dispensed);
  return <article className="medication-card"><header><div><strong>{product?.name||"Medicine"}</strong><span>{item.dose} · {item.route} · {item.frequency}{item.duration?` · ${item.duration}`:""}</span></div><span className="badge blue">{dispensed} / {item.quantity} {product?.unit||"units"}</span></header>{item.instructions?<p>{item.instructions}</p>:null}
    {["validated","partially_dispensed"].includes(prescriptionStatus)&&remaining>0?<form action={action} className="dispense-form"><input type="hidden" name="item_id" value={item.id}/><label>Stock lot<select required name="lot_id" defaultValue=""><option value="" disabled>Select available lot</option>{lots.map(lot=>{const store=Array.isArray(lot.stores)?lot.stores[0]:lot.stores;return <option key={lot.id} value={lot.id}>{lot.lot_no} · {lot.quantity_on_hand} available · {lot.expiry_date||"No expiry"} · {store?.name}</option>})}</select></label><label>Quantity<input required name="quantity" type="number" min="0.001" max={remaining} step="0.001" defaultValue={remaining}/></label><button disabled={pending||!lots.length} className="btn btn-primary">{pending?"Dispensing…":"Dispense"}</button>{!lots.length?<span className="stock-warning">No available stock lot. Add stock in Inventory.</span>:null}{state.message?<div className={state.ok?"form-success":"form-error"}>{state.message}</div>:null}</form>:null}
  </article>;
}

function AttachmentDialog({prescriptionId,mode,document,close}:{prescriptionId:string;mode:"add"|"edit"|"remove";document?:Document;close:()=>void}){
  const [state,setState]=useState<PharmacyState>(initial);const [pending,setPending]=useState(false);const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();setPending(true);const form=new FormData(event.currentTarget);const result=mode==="add"?await addPrescriptionAttachment(form):mode==="edit"?await updatePrescriptionAttachment(form):await removePrescriptionAttachment(form);setState(result);setPending(false)};
  return <div className="modal-backdrop nested-modal"><section className="modal attachment-modal" role="dialog" aria-modal="true"><ModalHead title={mode==="add"?"Add prescription attachment":mode==="edit"?"Edit attachment":"Remove attachment"} close={close}/><form onSubmit={submit} className="adt-dialog-form"><input type="hidden" name="prescription_id" value={prescriptionId}/>{document?<input type="hidden" name="document_id" value={document.id}/>:null}{mode==="add"?<label>Document file<input required type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/><small>PDF, JPG, or PNG. Maximum 3 MB.</small></label>:null}{mode!=="remove"?<><label>Document title<input required minLength={2} maxLength={120} name="display_name" defaultValue={document?.display_name||""}/></label><label>Description<textarea name="description" rows={5} maxLength={1000} defaultValue={document?.description||""}/></label></>:null}{mode==="edit"?<label>Reason for modification<textarea required minLength={5} maxLength={500} name="reason" rows={4}/></label>:null}{mode==="remove"?<label>Reason for removal<textarea required minLength={5} maxLength={500} name="reason" rows={5}/></label>:null}{state.message?<div className={state.ok?"form-success":"form-error"}>{state.message}</div>:null}<div className="form-actions"><button type="button" className="btn btn-secondary" onClick={close}>Close</button>{!state.ok?<button disabled={pending} className={`btn ${mode==="remove"?"attachment-remove-btn":"btn-primary"}`}>{pending?"Saving…":mode==="remove"?"Remove attachment":"Save attachment"}</button>:null}</div></form></section></div>;
}

function Info({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>}
