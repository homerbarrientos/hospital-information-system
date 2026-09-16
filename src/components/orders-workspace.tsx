"use client";

import { useActionState, useState } from "react";
import { Beaker, ChevronRight, ClipboardList, FilePenLine, Plus, Trash2, X } from "lucide-react";
import {
  advanceOrder,
  amendOrder,
  cancelOrder,
  createOrder,
  saveOrderResult,
  type OrderState,
} from "@/app/orders/actions";
import { SearchPicker } from "@/components/search-picker";

type Patient = { id: string; mrn: string; first_name: string; last_name: string };
type Encounter = { id: string; encounter_no: string; patient_id: string; status: string; service_date: string; encounter_type: string; responsible_doctor_id:string|null };
type Order = { id: string; encounter_id: string; order_no: string; order_type: string; priority: string; status: string; ordered_at: string; instructions: string | null; version: number; cancellation_reason: string | null; ordering_doctor_id:string|null };
type Doctor={id:string;first_name:string;last_name:string;suffix:string|null;specialty:string};
type ReferenceOption={code:string;label:string;reference_groups:{code:string}|Array<{code:string}>};
type Item = { id: string; order_id: string; description: string; status: string; charge_on: string };
type Result = { id: string; order_item_id: string; result_text: string | null; status: string; entered_at: string; validated_at: string | null; correction_reason: string | null };
type DraftItem = { description: string; charge_on: string };
const initial: OrderState = { ok: false, message: "" };
const doctorLabel=(doctor?:Doctor)=>doctor?`Dr. ${doctor.last_name}, ${doctor.first_name}${doctor.suffix?` ${doctor.suffix}`:""}`:"Not assigned";
const optionsFor=(options:ReferenceOption[],group:string)=>options.filter(option=>{const relation=Array.isArray(option.reference_groups)?option.reference_groups[0]:option.reference_groups;return relation?.code===group;});

export function OrdersWorkspace({ patients, encounters, orders, items, results, doctors, referenceOptions }: {
  patients: Patient[]; encounters: Encounter[]; orders: Order[]; items: Item[]; results: Result[]; doctors:Doctor[];referenceOptions:ReferenceOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const patientFor = (order: Order) => {
    const encounter = encounters.find((item) => item.id === order.encounter_id);
    return patients.find((item) => item.id === encounter?.patient_id);
  };
  return <>
    <div className="toolbar"><button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15}/>Create order</button></div>
    <section className="card">
      <div className="card-header"><h3>Clinical order worklist</h3><span className="badge blue">Live data</span></div>
      <div className="table-wrap"><table className="data-table orders-table">
        <thead><tr><th>Order</th><th>Patient / Encounter</th><th>Ordering doctor</th><th>Requested services</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {orders.map((order) => {
            const encounter = encounters.find((item) => item.id === order.encounter_id);
            const patient = patientFor(order);
            const orderItems = items.filter((item) => item.order_id === order.id);
            return <tr key={order.id}>
              <td className="name-cell"><strong>{order.order_no}</strong><span>{order.order_type} · v{order.version}</span></td>
              <td className="name-cell"><strong>{patient ? `${patient.last_name}, ${patient.first_name}` : "Patient"}</strong><span>{patient?.mrn} · {encounter?.encounter_no}</span></td>
              <td>{doctorLabel(doctors.find(doctor=>doctor.id===order.ordering_doctor_id))}</td>
              <td className="order-items-summary">{orderItems.map((item) => item.description).join(", ") || "No items"}</td>
              <td><span className={`badge ${order.priority === "stat" ? "red" : order.priority === "urgent" ? "amber" : "blue"}`}>{order.priority}</span></td>
              <td><span className={`badge ${order.status === "released" ? "green" : order.status === "cancelled" ? "red" : "amber"}`}>{order.status.replaceAll("_", " ")}</span></td>
              <td><button className="btn btn-secondary" onClick={() => setSelected(order)}>View / manage <ChevronRight size={14}/></button></td>
            </tr>;
          })}
          {!orders.length && <tr><td colSpan={7} className="empty-state">No clinical orders recorded yet.</td></tr>}
        </tbody>
      </table></div>
    </section>
    {creating && <OrderFormDialog mode="create" referenceOptions={referenceOptions} close={() => setCreating(false)}/>} 
    {selected && <OrderDetailDialog order={selected} encounter={encounters.find((item) => item.id === selected.encounter_id)} patient={patientFor(selected)} items={items.filter((item) => item.order_id === selected.id)} results={results} doctors={doctors} referenceOptions={referenceOptions} close={() => setSelected(null)}/>} 
  </>;
}

function ModalHead({ title, close }: { title: string; close: () => void }) {
  return <div className="modal-head"><div><p className="eyebrow">Orders and results</p><h3>{title}</h3></div><button className="icon-btn" onClick={close} aria-label="Close"><X size={17}/></button></div>;
}

function OrderFormDialog({ mode, order, savedItems, close, referenceOptions }: {
  mode: "create" | "edit"; order?: Order; savedItems?: Item[]; close: () => void; referenceOptions:ReferenceOption[];
}) {
  const [state, action, pending] = useActionState(mode === "create" ? createOrder : amendOrder, initial);
  const [draftItems, setDraftItems] = useState<DraftItem[]>(() => savedItems?.map((item) => ({ description: item.description, charge_on: item.charge_on })) || [{ description: "", charge_on: "none" }]);
  const updateItem = (index: number, key: keyof DraftItem, next: string) => setDraftItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: next } : item));
  return <div className="modal-backdrop orders-backdrop"><section className="modal order-modal" role="dialog" aria-modal="true">
    <ModalHead title={mode === "create" ? "Create clinical order" : `Modify ${order?.order_no}`} close={close}/>
    <form action={action} className="order-form">
      {order && <input type="hidden" name="order_id" value={order.id}/>}
      <input type="hidden" name="items" value={JSON.stringify(draftItems)}/>
      {mode === "create" ? <div className="wide"><SearchPicker kind="encounter" name="encounter_id" label="Active patient encounter" title="Select patient encounter" placeholder="No encounter selected" searchPlaceholder="Search patient, MRN, encounter number, or date" required help="One patient may have multiple visits; select the current visit."/></div> : <div className="order-readonly wide">Patient and encounter cannot be changed after the order is created.</div>}
      {mode==="create"&&<div className="wide"><SearchPicker kind="doctor" name="doctor_id" label="Ordering doctor" title="Select ordering doctor" placeholder="No doctor selected" searchPlaceholder="Search doctor name or specialty" required/></div>}
      <label>Order type<select required name="order_type" defaultValue={order?.order_type || "laboratory"}>{optionsFor(referenceOptions,"order_type").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      <label>Priority<select required name="priority" defaultValue={order?.priority || "routine"}>{optionsFor(referenceOptions,"order_priority").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      <label className="wide">Clinical instructions<textarea maxLength={2000} name="instructions" rows={5} defaultValue={order?.instructions || ""} placeholder="Preparation, specimen, clinical indication, or special instructions"/></label>
      <fieldset className="order-item-builder wide"><legend>Requested services or tests</legend>
        {draftItems.map((item, index) => <div className="order-item-row" key={index}>
          <label>Item {index + 1}<input required minLength={2} maxLength={250} value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} placeholder="Example: Complete blood count"/></label>
          <label>Charge trigger<select value={item.charge_on} onChange={(event) => updateItem(index, "charge_on", event.target.value)}>{optionsFor(referenceOptions,"order_charge_trigger").map(option=><option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
          <button type="button" className="icon-btn" disabled={draftItems.length === 1} onClick={() => setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove item"><Trash2 size={15}/></button>
        </div>)}
        <button type="button" className="btn btn-secondary add-order-item" disabled={draftItems.length >= 20} onClick={() => setDraftItems((current) => [...current, { description: "", charge_on: "none" }])}><Plus size={14}/>Add another item</button>
      </fieldset>
      {mode === "edit" && <label className="wide">Reason for modification<textarea required minLength={5} maxLength={500} rows={4} name="reason" placeholder="Explain why this order is being changed"/></label>}
      {state.message && <div className={state.ok ? "form-success wide" : "form-error wide"}>{state.message}</div>}
      <div className="form-actions wide"><button type="button" className="btn btn-secondary" onClick={close}>{state.ok ? "Close" : "Cancel"}</button>{!state.ok && <button disabled={pending} className="btn btn-primary"><ClipboardList size={15}/>{pending ? "Saving…" : mode === "create" ? "Create order" : "Save amendment"}</button>}</div>
    </form>
  </section></div>;
}

const nextStatus: Record<string, string | null> = {
  requested: "acknowledged", acknowledged: "in_progress", collected: "in_progress",
  in_progress: "completed", completed: "validated", validated: "released",
  released: null, cancelled: null,
};

function OrderDetailDialog({ order, encounter, patient, items, results, close, doctors, referenceOptions }: {
  order: Order; encounter?: Encounter; patient?: Patient; items: Item[]; results: Result[]; close: () => void; doctors:Doctor[];referenceOptions:ReferenceOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [advanceState, advanceAction, advancePending] = useActionState(advanceOrder, initial);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelOrder, initial);
  const next = nextStatus[order.status];
  if (editing) return <OrderFormDialog mode="edit" order={order} savedItems={items} referenceOptions={referenceOptions} close={() => setEditing(false)}/>;
  return <div className="modal-backdrop orders-backdrop"><section className="modal order-detail-modal" role="dialog" aria-modal="true">
    <ModalHead title={order.order_no} close={close}/>
    <div className="order-detail-body">
      <div className="order-summary-grid">
        <Info label="Patient" value={patient ? `${patient.last_name}, ${patient.first_name} · ${patient.mrn}` : "Patient"}/>
        <Info label="Ordering doctor" value={doctorLabel(doctors.find(doctor=>doctor.id===order.ordering_doctor_id))}/>
        <Info label="Encounter" value={encounter?.encounter_no || "—"}/><Info label="Type / Priority" value={`${order.order_type} · ${order.priority}`}/><Info label="Status" value={order.status.replaceAll("_", " ")}/>
      </div>
      <div className="order-instructions"><span>Clinical instructions</span><p>{order.instructions || "No instructions recorded."}</p></div>
      <section className="order-results-section"><h4>Items and results</h4>{items.map((item) => <OrderItemResult key={item.id} item={item} results={results.filter((result) => result.order_item_id === item.id)} orderStatus={order.status}/>)}</section>
      {order.cancellation_reason && <div className="form-error">Cancellation reason: {order.cancellation_reason}</div>}
      {advanceState.message && <div className={advanceState.ok ? "form-success" : "form-error"}>{advanceState.message}</div>}
      <div className="order-detail-actions">
        {["requested", "acknowledged"].includes(order.status) && <button className="btn btn-secondary" onClick={() => setEditing(true)}><FilePenLine size={15}/>Modify order</button>}
        {next && <form action={advanceAction}><input type="hidden" name="order_id" value={order.id}/><input type="hidden" name="next_status" value={next}/><button disabled={advancePending} className="btn btn-primary">{advancePending ? "Updating…" : next === "released" ? "Release results" : `Advance to ${next.replaceAll("_", " ")}`}</button></form>}
      </div>
      {!["released", "cancelled"].includes(order.status) && <form action={cancelAction} className="order-cancel-form"><input type="hidden" name="order_id" value={order.id}/><label>Cancellation reason<textarea required minLength={5} maxLength={500} name="reason" rows={4} placeholder="Required: explain why this order is being cancelled"/></label><button disabled={cancelPending} className="btn order-cancel-btn">{cancelPending ? "Cancelling…" : "Cancel order"}</button>{cancelState.message && <div className={cancelState.ok ? "form-success" : "form-error"}>{cancelState.message}</div>}</form>}
    </div>
  </section></div>;
}

function OrderItemResult({ item, results, orderStatus }: { item: Item; results: Result[]; orderStatus: string }) {
  const [state, action, pending] = useActionState(saveOrderResult, initial);
  const current = results.find((result) => result.status === "final") || results[0];
  const locked = ["released", "cancelled"].includes(orderStatus);
  return <article className="order-result-card">
    <header><div><strong>{item.description}</strong><span>{item.status.replaceAll("_", " ")}</span></div><span className="badge blue">{item.charge_on === "none" ? "No charge" : `Charge: ${item.charge_on}`}</span></header>
    {current && <div className="saved-result"><span>{current.status} result · {new Date(current.entered_at).toLocaleString()}</span><p>{current.result_text}</p>{current.correction_reason && <small>Correction: {current.correction_reason}</small>}</div>}
    {!locked && <form action={action} className="result-form">
      <input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="has_final" value={results.some((result) => result.status === "final") ? "true" : "false"}/>
      <label>Result / finding<textarea required minLength={2} maxLength={5000} rows={6} name="result_text" defaultValue={current?.result_text || ""} placeholder="Enter the clinical result or diagnostic finding"/></label>
      {results.some((result) => result.status === "final") && <label>Correction reason<textarea required minLength={5} maxLength={500} rows={3} name="correction_reason" placeholder="Required when correcting a final result"/></label>}
      <label className="result-validation"><input type="checkbox" name="validate_result"/>Validate as final result</label>
      {state.message && <div className={state.ok ? "form-success" : "form-error"}>{state.message}</div>}
      <button disabled={pending} className="btn btn-primary"><Beaker size={15}/>{pending ? "Saving…" : "Save result"}</button>
    </form>}
  </article>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
