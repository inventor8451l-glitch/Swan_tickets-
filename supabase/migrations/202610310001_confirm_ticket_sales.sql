-- Deduct ticket inventory only after an authorised organiser approves a verified payment.
-- Apply this migration in the Supabase SQL editor before deploying the matching frontend.
create or replace function public.confirm_ticket_sales(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_ticket_id uuid;
  v_quantity integer;
  v_updated integer;
begin
  if auth.uid() is null
     or not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'Only an authenticated SWAN TICKETS admin can confirm sales';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one ticket item is required';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    v_ticket_id := (item->>'ticket_type_id')::uuid;
    v_quantity := (item->>'quantity')::integer;

    if v_quantity is null or v_quantity < 1 then
      raise exception 'Ticket quantity must be a positive whole number';
    end if;

    update public.ticket_types
       set sold_quantity = coalesce(sold_quantity, 0) + v_quantity
     where id = v_ticket_id
       and is_active = true
       and coalesce(total_quantity, 0)
           - coalesce(sold_quantity, 0)
           - coalesce(reserved_quantity, 0) >= v_quantity;

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Not enough remaining tickets for ticket type %', v_ticket_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.confirm_ticket_sales(jsonb) from public;
grant execute on function public.confirm_ticket_sales(jsonb) to authenticated;
