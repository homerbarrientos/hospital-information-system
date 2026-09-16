begin;

create sequence if not exists public.clinical_order_no_seq;

-- Keep the next generated number ahead of existing order numbers when this
-- repair is applied to a database that already contains orders.
select setval(
  'public.clinical_order_no_seq',
  greatest(
    coalesce((
      select max(
        case
          when split_part(order_no, '-', 3) ~ '^[0-9]+$'
            then split_part(order_no, '-', 3)::bigint
          else 0
        end
      )
      from public.clinical_orders
    ), 0),
    1
  ),
  exists(select 1 from public.clinical_orders)
);

commit;
