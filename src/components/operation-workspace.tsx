"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { SearchPicker } from "@/components/search-picker";
import { InventoryModuleNav } from "@/components/inventory-module-nav";
import { saveOperation, type OperationState } from "@/app/operations/[section]/actions";

type Section = "or" | "dr" | "dietary" | "materials" | "purchasing" | "philhealth";
export type OperationRow = {
  id: string; encounter_id?: string; item_id?: string; supplier_id?: string; lead_doctor_id?: string;
  procedure_name?: string; room_name?: string; scheduled_at?: string; clinical_note?: string;
  diet_type?: string; meal?: string; meal_date?: string; allergy_precautions?: string;
  code?: string; name?: string; category?: string; unit?: string; quantity_on_hand?: number; reorder_level?: number;
  kind?: string; quantity?: number; quantity_received?: number; balance_after?: number; unit_cost?: number;
  reason?: string; reference_no?: string; created_at?: string; status?: string;
  diagnosis_code?: string; membership_no?: string; external_claim_no?: string; external_status_note?: string;
};
export type EncounterOption = { id: string; label: string; status: string; philhealth_no: string | null };
export type MaterialOption = { id: string; code: string; name: string; unit: string; quantity_on_hand: number };
export type SupplierOption = { id: string; code: string; name: string };
export type DoctorOption = { id: string; name: string };
export type ServiceOption = { id: string; code: string; name: string };
export type ProcedureRoomOption = { id: string; code: string; name: string; room_kind: string };

const initial: OperationState = { ok: false, message: "" };
const modules: [Section, string][] = [["or", "Operating Room"], ["dr", "Delivery Room"], ["dietary", "Dietary"], ["materials", "Materials"], ["purchasing", "Purchasing"], ["philhealth", "PhilHealth Claims"]];
const localTime = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });

function Feedback({ state }: { state: OperationState }) {
  return state.message ? <p role="status" className={state.ok ? "form-success" : "form-error"}>{state.message}</p> : null;
}

function Fields({ facilityId, section, command }: { facilityId: string; section: Section; command: string }) {
  return <><input type="hidden" name="facility_id" value={facilityId}/><input type="hidden" name="section" value={section}/><input type="hidden" name="command" value={command}/></>;
}

function EncounterField({ encounters }: { encounters: EncounterOption[] }) {
  return <><SearchPicker kind="encounter" name="encounter_id" label="Patient encounter" title="Select patient encounter" placeholder="Select an active encounter" searchPlaceholder="Search patient, MRN, or encounter" required/><small>{encounters.filter(e => e.status !== "completed" && e.status !== "cancelled").length} recent active encounters available.</small></>;
}

function CreateForm({ section, facilityId, encounters, materials, suppliers, doctors, services, rooms, prefillMaterial, prefillQuantity }: { section: Section; facilityId: string; encounters: EncounterOption[]; materials: MaterialOption[]; suppliers: SupplierOption[]; doctors: DoctorOption[]; services: ServiceOption[]; rooms: ProcedureRoomOption[]; prefillMaterial?: string; prefillQuantity?: number }) {
  const [state, action, pending] = useActionState(saveOperation, initial);
  const command = section === "or" || section === "dr" ? "case.create" : section === "dietary" ? "diet.create" : section === "materials" ? "material.create" : section === "purchasing" ? "purchase.create" : "claim.create";
  return <section className="card operation-panel"><div className="card-header"><h3>{section === "or" || section === "dr" ? "Schedule case" : section === "dietary" ? "Order a patient meal" : section === "materials" ? "Add material" : section === "purchasing" ? "Request purchase" : "Prepare claim draft"}</h3></div>
    <form action={action} className="operation-form"><Fields facilityId={facilityId} section={section} command={command}/>
      {(section === "or" || section === "dr") && <>
        <EncounterField encounters={encounters}/>
        <label>Procedure / delivery type<input required minLength={3} name="procedure_name" placeholder="Procedure or delivery description"/></label>
        <label>Room<select required name="room_name" defaultValue=""><option value="">Select {section.toUpperCase()} room</option>{rooms.map(room=><option key={room.id} value={room.code}>{room.code} · {room.name}</option>)}</select></label>
        {rooms.length===0?<p className="operation-wide notice">No active {section.toUpperCase()} rooms are configured. <Link href="/administration/facilities">Manage OR/DR rooms</Link> before scheduling.</p>:null}
        <label>Schedule<input required name="scheduled_at" type="datetime-local"/></label>
        <label>Lead doctor<select name="doctor_id" defaultValue=""><option value="">Select doctor (optional)</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Patient billing service (optional)<select name="service_id" defaultValue=""><option value="">No automatic charge</option>{services.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label className="operation-wide">Case notes<textarea name="notes" rows={2}/></label>
      </>}
      {section === "dietary" && <>
        <EncounterField encounters={encounters}/>
        <label>Diet type (clinician directed)<input required name="diet_type" placeholder="e.g. Regular, soft, prescribed diet"/></label>
        <label>Texture<input name="texture" placeholder="Optional"/></label>
        <label>Meal date<input required type="date" name="meal_date"/></label>
        <label>Meal<select name="meal"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></label>
        <label className="operation-wide">Allergy precautions<input name="allergies" placeholder="Confirm against the clinical record"/></label>
        <label className="operation-wide">Instructions<textarea name="notes" rows={2}/></label>
      </>}
      {section === "materials" && <>
        <p className="operation-wide notice">Inventory item type: Supply. Classify consumable stock below. Medicines use the Medicine stock tab; equipment and fixed assets need separate asset tracking.</p>
        <label>Material code<input required name="code" minLength={2}/></label>
        <label>Name<input required name="name" minLength={2}/></label>
        <label>Supply category<input required name="category" list="material-categories" placeholder="e.g. Medical consumable"/><datalist id="material-categories"><option value="Medical consumable"/><option value="Dietary supply"/><option value="Housekeeping supply"/><option value="Office supply"/><option value="Other consumable"/></datalist></label>
        <label>Unit<input required name="unit" placeholder="piece, box, pack"/></label>
        <label>Reorder level<input required type="number" min="0" step="0.001" name="reorder_level" defaultValue="0"/></label>
        <label>Patient billing service (optional)<select name="service_id" defaultValue=""><option value="">No automatic patient charge</option>{services.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
      </>}
      {section === "purchasing" && <>
        <label>Supplier<select required name="supplier_id" defaultValue=""><option value="">Choose supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label>Material<select required name="item_id" defaultValue={prefillMaterial || ""}><option value="">Choose material</option>{materials.map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></label>
        <label>Quantity<input required type="number" min="0.001" step="0.001" name="quantity" defaultValue={prefillQuantity}/></label>
        <label>Unit cost<input required type="number" min="0" step="0.01" name="cost"/></label>
        <label className="operation-wide">Purchase reason<textarea required name="notes" minLength={5} rows={2}/></label>
        <small className="operation-wide">Add materials in Materials Inventory and suppliers in Inventory before creating an order. Approval requires another authorized user.</small>
      </>}
      {section === "philhealth" && <>
        <EncounterField encounters={encounters}/>
        <label>Final diagnosis code<input required name="diagnosis" minLength={3} placeholder="ICD-10 code"/></label>
        <label>Case rate code<input name="case_rate" placeholder="If applicable"/></label>
        <p className="operation-wide notice">Save the 12-digit PhilHealth number on the patient and confirm the diagnosis in Clinical Registry. This draft does not submit a claim to PHIC.</p>
      </>}
      <div className="operation-wide"><Feedback state={state}/><button disabled={pending} className="btn btn-primary">{pending ? "Saving…" : "Save"}</button></div>
    </form>
  </section>;
}

function RowAction({ section, facilityId, row, status, label, command, quantity }: { section: Section; facilityId: string; row: OperationRow; status?: string; label: string; command: string; quantity?: boolean }) {
  const [state, action, pending] = useActionState(saveOperation, initial);
  return <form action={action} className="operation-inline"><Fields facilityId={facilityId} section={section} command={command}/><input type="hidden" name="record_id" value={row.id}/>{status && <input type="hidden" name="status" value={status}/>}
    {quantity && <label>Quantity<input required name="quantity" type="number" min="0.001" max={Number(row.quantity || 0) - Number(row.quantity_received || 0)} step="0.001"/></label>}
    {quantity && <label>Delivery reference<input required minLength={2} name="reference"/></label>}
    {section === "philhealth" && status !== "ready" && <label>External PHIC reference<input name="reference" defaultValue={row.external_claim_no || ""} required={status === "submitted_external" || status === "approved" || status === "paid"}/></label>}
    {!quantity && <label>{section === "philhealth" ? "PHIC response / notes" : "Notes / reason"}<input name="notes" required={status === "cancelled" || status === "completed" || status === "rejected" || status === "approved" || status === "returned" || status === "denied"} minLength={5} placeholder="Record the reason or outcome"/></label>}
    <button className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : label}</button><Feedback state={state}/>
  </form>;
}

function MaterialMovementForm({ facilityId, materials, encounters }: { facilityId: string; materials: MaterialOption[]; encounters: EncounterOption[] }) {
  const [state, action, pending] = useActionState(saveOperation, initial);
  const [itemId, setItemId] = useState("");
  const [kind, setKind] = useState("issue");
  const [quantity, setQuantity] = useState("");
  const selected = materials.find(m => m.id === itemId);
  const requested = Number(quantity);
  const shortage = kind === "issue" && selected && Number.isFinite(requested) && requested > Number(selected.quantity_on_hand) ? Math.round((requested - Number(selected.quantity_on_hand)) * 1000) / 1000 : 0;
  return <section className="card operation-panel"><div className="card-header"><h3>Check stock and issue material</h3></div><form action={action} className="operation-form"><Fields facilityId={facilityId} section="materials" command="material.move"/>
    <label>Material<select required name="item_id" value={itemId} onChange={event => setItemId(event.target.value)}><option value="">Choose material</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name} · {m.quantity_on_hand} {m.unit}</option>)}</select></label>
    <label>Movement<select name="kind" value={kind} onChange={event => setKind(event.target.value)}><option value="issue">Issue to patient encounter</option><option value="receipt">Direct receipt (outside PO)</option></select></label>
    <label>Quantity<input required type="number" min="0.001" step="0.001" name="quantity" value={quantity} onChange={event => setQuantity(event.target.value)}/></label>
    <label>Patient encounter (required for issue)<select name="encounter_id" required={kind === "issue"} defaultValue=""><option value="">None for direct receipt</option>{encounters.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
    <label>Reference<input name="reference" placeholder="Delivery or issue reference"/></label>
    <label>Notes<input name="notes"/></label>
    {kind === "issue" && selected && <p className="operation-wide notice">Available: {selected.quantity_on_hand} {selected.unit}. {shortage ? `Short by ${shortage} ${selected.unit}. Request the shortage through Purchasing, then issue after receiving the delivery.` : "Check the patient encounter, then issue from stock."}</p>}
    <div className="operation-wide"><Feedback state={state}/>{shortage ? <Link className="btn btn-primary" href={`/operations/purchasing?material=${encodeURIComponent(itemId)}&quantity=${shortage}`}>Request {shortage} {selected?.unit} from Purchasing</Link> : <button className="btn btn-primary" disabled={pending}>{pending ? "Posting…" : kind === "issue" ? "Issue from stock" : "Post direct receipt"}</button>}</div>
  </form></section>;
}

export function OperationWorkspace({ section, facilityId, records, encounters, materials, suppliers, doctors, movements, services, rooms, prefillMaterial, prefillQuantity }: { section: Section; facilityId: string; records: OperationRow[]; encounters: EncounterOption[]; materials: MaterialOption[]; suppliers: SupplierOption[]; doctors: DoctorOption[]; movements: OperationRow[]; services: ServiceOption[]; rooms: ProcedureRoomOption[]; prefillMaterial?: string; prefillQuantity?: number }) {
  const encounterName = (id?: string) => encounters.find(e => e.id === id)?.label || "Encounter";
  const itemName = (id?: string) => materials.find(m => m.id === id)?.name || "Material";
  return <div className="operation-workspace">
    {section === "materials" || section === "purchasing" ? <InventoryModuleNav current={section === "materials" ? "/operations/materials" : "/operations/purchasing"}/> : <nav aria-label="Hospital operations modules" className="operation-tabs">{modules.filter(([key]) => key !== "materials" && key !== "purchasing").map(([key, title]) => <Link href={`/operations/${key}`} aria-current={key === section ? "page" : undefined} key={key}>{title}</Link>)}</nav>}
    {section === "materials" && <MaterialMovementForm facilityId={facilityId} materials={materials} encounters={encounters}/>}
    <CreateForm section={section} facilityId={facilityId} encounters={encounters} materials={materials} suppliers={suppliers} doctors={doctors} services={services} rooms={rooms} prefillMaterial={prefillMaterial} prefillQuantity={prefillQuantity}/>
    <section className="card operation-panel"><div className="card-header"><h3>{section === "materials" ? "Material balances" : section === "purchasing" ? "Purchase orders" : section === "philhealth" ? "Claim worklist" : "Active and completed records"}</h3><span className="badge blue">{records.length} records</span></div>
      {section === "philhealth" && <div className="notice">eClaims transmission is not yet connected. Enter “Submitted externally” only after submitting through an authorized eClaims 3.0 provider and receiving its reference.</div>}
      <div className="operation-list">{records.length === 0 && <p className="empty-state">No records yet.</p>}{records.map(row => <article key={row.id} className="operation-record"><div><strong>{section === "materials" ? `${row.code} · ${row.name}` : section === "purchasing" ? `${itemName(row.item_id)} · ${row.quantity} units` : section === "philhealth" ? `${encounterName(row.encounter_id)} · ${row.diagnosis_code}` : section === "dietary" ? `${encounterName(row.encounter_id)} · ${row.diet_type}` : `${encounterName(row.encounter_id)} · ${row.procedure_name}`}</strong>
        <p>{section === "materials" ? `${row.category} · ${row.quantity_on_hand} ${row.unit} on hand · reorder at ${row.reorder_level}` : section === "purchasing" ? `₱${row.unit_cost} per unit · received ${row.quantity_received || 0}/${row.quantity} · ${row.reason}` : section === "philhealth" ? `PIN ${row.membership_no} · external ref ${row.external_claim_no || "—"} · ${row.external_status_note || "No PHIC response recorded"}` : section === "dietary" ? `${row.meal_date} · ${row.meal} · precautions: ${row.allergy_precautions || "none recorded"}` : `${row.room_name} · ${row.scheduled_at ? localTime(row.scheduled_at) : ""} · ${row.clinical_note || "No outcome note"}`}</p></div>
        {row.status && <span className="badge blue">{row.status.replaceAll("_", " ")}</span>}
        {(section === "or" || section === "dr") && row.status === "scheduled" && <><RowAction section={section} facilityId={facilityId} row={row} command="case.advance" status="in_progress" label="Start case"/><RowAction section={section} facilityId={facilityId} row={row} command="case.advance" status="cancelled" label="Cancel"/></>}
        {(section === "or" || section === "dr") && row.status === "in_progress" && <RowAction section={section} facilityId={facilityId} row={row} command="case.advance" status="completed" label="Complete with summary"/>}
        {section === "dietary" && row.status === "ordered" && <RowAction section={section} facilityId={facilityId} row={row} command="diet.advance" status="prepared" label="Mark prepared"/>}
        {section === "dietary" && row.status === "prepared" && <RowAction section={section} facilityId={facilityId} row={row} command="diet.advance" status="served" label="Mark served"/>}
        {section === "purchasing" && row.status === "requested" && <><RowAction section={section} facilityId={facilityId} row={row} command="purchase.decide" status="approved" label="Approve"/><RowAction section={section} facilityId={facilityId} row={row} command="purchase.decide" status="rejected" label="Reject"/></>}
        {section === "purchasing" && ["approved", "partially_received"].includes(row.status || "") && <RowAction section={section} facilityId={facilityId} row={row} command="purchase.receive" label="Receive delivery" quantity/>}
        {section === "philhealth" && row.status === "draft" && <RowAction section={section} facilityId={facilityId} row={row} command="claim.advance" status="ready" label="Mark ready for external filing"/>}
        {section === "philhealth" && ["ready", "returned"].includes(row.status || "") && <RowAction section={section} facilityId={facilityId} row={row} command="claim.advance" status="submitted_external" label="Record external submission"/>}
        {section === "philhealth" && row.status === "submitted_external" && ["approved", "returned", "denied"].map(status => <RowAction key={status} section={section} facilityId={facilityId} row={row} command="claim.advance" status={status} label={`Record ${status}`}/>)}
        {section === "philhealth" && row.status === "approved" && <RowAction section={section} facilityId={facilityId} row={row} command="claim.advance" status="paid" label="Record external payment"/>}
      </article>)}</div>
    </section>
    {section === "materials" && <section className="card operation-panel"><div className="card-header"><h3>Recent material movements</h3></div><div className="operation-list">{movements.map(row => <p key={row.id}>{row.created_at ? localTime(row.created_at) : ""} · {itemName(row.item_id)} · {row.kind} {row.quantity} · balance {row.balance_after} · {row.reference_no || "No reference"}</p>)}{movements.length === 0 && <p className="empty-state">No material movements yet.</p>}</div></section>}
  </div>;
}
