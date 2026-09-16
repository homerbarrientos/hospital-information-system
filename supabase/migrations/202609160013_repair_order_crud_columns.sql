begin;

alter table public.clinical_orders
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles,
  add column if not exists ordering_doctor_id uuid references public.doctors;

-- Normalize existing records created before version tracking was installed.
update public.clinical_orders set version=1 where version is null;

grant select on public.clinical_orders, public.order_items, public.clinical_results to authenticated;

commit;
