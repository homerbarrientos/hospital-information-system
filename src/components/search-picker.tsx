"use client";

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { searchPickerRecords, type PickerKind, type PickerRecord } from "@/app/search/actions";

const PAGE_SIZE = 20;

export function SearchPicker({ name, label, title, placeholder, searchPlaceholder, kind, defaultValue = "", initialOption, value, onChange, onSelect, required = false, help }: {
  name: string; label: string; title: string; placeholder: string; searchPlaceholder: string; kind: PickerKind;
  defaultValue?: string; initialOption?: PickerRecord; value?: string; onChange?: (value: string) => void; onSelect?: (record:PickerRecord)=>void; required?: boolean; help?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const [selected, setSelected] = useState<PickerRecord | undefined>(initialOption);
  const [draft, setDraft] = useState<PickerRecord | undefined>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<PickerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchPickerRecords(kind, query, page, typeFilter, includeCompleted).then(result => {
        if (!active) return;
        setRecords(result.records); setTotal(result.total); setError(result.error); setLoading(false);
      });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [includeCompleted, kind, open, page, query, typeFilter]);

  const confirm = () => {
    if (!draft) return;
    if (value === undefined) setInternalValue(draft.value);
    setSelected(draft); onChange?.(draft.value); onSelect?.(draft); setOpen(false);
  };

  return <>
    <div className="search-picker-field">
      <label>{label}{help ? <span className="field-help">{help}</span> : null}</label>
      <input type="hidden" name={name} value={selectedValue}/>
      <div className="search-picker-control"><div className={selected ? "search-picker-selection" : "search-picker-selection placeholder"}><strong>{selected?.label || placeholder}</strong>{selected?.meta ? <span>{selected.meta}</span> : null}</div><button type="button" className="btn btn-secondary" onClick={() => { setDraft(selected); setOpen(true); }}><Search size={15}/>{selected ? "Change" : "Find"}</button></div>
      {required && !selectedValue ? <span className="picker-required">Selection required</span> : null}
    </div>
    {open ? <div className="modal-backdrop nested-modal"><section className="modal search-picker-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><p className="eyebrow">Search and select</p><h3>{title}</h3></div><button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={17}/></button></div>
      <div className="search-picker-body">
        <label className="search-picker-search"><Search size={17}/><input autoFocus value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder={searchPlaceholder}/></label>
        {kind === "encounter" ? <div className="search-picker-filter-row"><div className="search-picker-filters">{["All","OPD","IPD"].map(item => <button type="button" key={item} className={typeFilter === item ? "active" : ""} onClick={() => { setTypeFilter(item); setPage(1); }}>{item}</button>)}</div><label className="picker-check"><input type="checkbox" checked={includeCompleted} onChange={event => { setIncludeCompleted(event.target.checked); setPage(1); }}/>Include completed encounters</label></div> : null}
        {error ? <div className="form-error">{error}</div> : null}
        <div className="search-picker-grid" role="listbox"><div className="search-picker-grid-head"><span>Record</span><span>Details</span><span>Action</span></div>
          {loading ? <div className="empty-state">Searching secure facility records…</div> : records.map(option => <div className={`search-picker-row ${draft?.value === option.value ? "selected" : ""}`} key={option.value} role="option" aria-selected={draft?.value === option.value}><strong>{option.label}</strong><span>{option.meta}</span><button type="button" className="btn btn-secondary" onClick={() => setDraft(option)}>{draft?.value === option.value ? <Check size={14}/> : null}Select</button></div>)}
          {!loading && !records.length ? <div className="empty-state">No matching records.</div> : null}
        </div>
        <div className="search-picker-footer"><span>Showing {total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE,total)} of {total} {kind === "encounter" ? "encounters" : kind === "doctor" ? "doctors" : "patients"}</span><div><button type="button" className="icon-btn" disabled={page === 1} onClick={() => setPage(current => Math.max(1,current-1))} aria-label="Previous page"><ChevronLeft size={16}/></button><span>Page {page} of {pages}</span><button type="button" className="icon-btn" disabled={page === pages} onClick={() => setPage(current => Math.min(pages,current+1))} aria-label="Next page"><ChevronRight size={16}/></button></div></div>
        {draft ? <div className="picker-confirm-strip"><div><span>Selected record</span><strong>{draft.label}</strong><small>{draft.meta}</small></div><div><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirm}>Confirm selection</button></div></div> : null}
      </div>
    </section></div> : null}
  </>;
}
