-- Atomically settle a Daraja callback against a reserved SWAN TICKETS order.
-- Apply this migration in the Supabase SQL Editor before deploying daraja-callback.

create or replace function public.process_daraja_callback(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_result_code integer,
  p_result_description text,
  p_mpesa_receipt_number text,
  p_amount numeric,
  p_phone_number text,
  p_callback_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_expected_amount numeric;
  v_expected_phone text;
  v_callback_id uuid;
  v_processed integer := 0;
begin
  if nullif(trim(p_checkout_request_id), '') is null then
    raise exception 'Checkout request ID is required';
  end if;

  select * into v_order
    from public.orders
   where daraja_checkout_request_id = p_checkout_request_id
   for update;

  insert into public.daraja_payment_callbacks (
    order_id, checkout_request_id, merchant_request_id, result_code,
    result_description, mpesa_receipt_number, amount, phone_number,
    callback_payload
  ) values (
    v_order.id, p_checkout_request_id, p_merchant_request_id, p_result_code,
    p_result_description, p_mpesa_receipt_number, p_amount, p_phone_number,
    coalesce(p_callback_payload, '{}'::jsonb)
  ) returning id into v_callback_id;

  if not found or v_order.id is null then
    update public.daraja_payment_callbacks
       set processed_at = now()
     where id = v_callback_id;
    return jsonb_build_object('success', false, 'state', 'unmatched');
  end if;

  if v_order.status = 'paid' then
    update public.daraja_payment_callbacks
       set processed_at = now()
     where id = v_callback_id;
    return jsonb_build_object('success', true, 'state', 'already_paid', 'order_id', v_order.id);
  end if;

  if v_order.status <> 'pending' then
    update public.daraja_payment_callbacks
       set processed_at = now()
     where id = v_callback_id;
    return jsonb_build_object('success', false, 'state', 'not_pending', 'order_id', v_order.id);
  end if;

  if p_result_code is distinct from 0 then
    for v_item in
      select ticket_type_id, sum(quantity)::integer as quantity
        from public.order_items
       where order_id = v_order.id
       group by ticket_type_id
       order by ticket_type_id
    loop
      update public.ticket_types
         set reserved_quantity = greatest(0, reserved_quantity - v_item.quantity)
       where id = v_item.ticket_type_id;
    end loop;

    update public.orders
       set status = 'failed', updated_at = now()
     where id = v_order.id;

    update public.daraja_payment_callbacks
       set processed_at = now()
     where id = v_callback_id;

    return jsonb_build_object('success', true, 'state', 'payment_failed', 'order_id', v_order.id);
  end if;

  select coalesce(sum(oi.quantity * oi.unit_price), 0)
    into v_expected_amount
    from public.order_items oi
   where oi.order_id = v_order.id;

  v_expected_phone := regexp_replace(coalesce(v_order.payment_phone, v_order.customer_phone, ''), '[^0-9]', '', 'g');

  if p_amount is null
     or p_amount <> ceil(v_expected_amount)
     or nullif(p_phone_number, '') is null
     or regexp_replace(p_phone_number, '[^0-9]', '', 'g') <> v_expected_phone
     or nullif(trim(p_mpesa_receipt_number), '') is null then
    update public.daraja_payment_callbacks
       set processed_at = now()
     where id = v_callback_id;
    return jsonb_build_object('success', false, 'state', 'payment_mismatch', 'order_id', v_order.id);
  end if;

  if v_order.reservation_expires_at is not null
     and v_order.reservation_expires_at < now() then
    update public.daraja_payment_callbacks
       set processed_at = now()
     where id = v_callback_id;
    return jsonb_build_object('success', false, 'state', 'reservation_expired', 'order_id', v_order.id);
  end if;

  for v_item in
    select ticket_type_id, sum(quantity)::integer as quantity
      from public.order_items
     where order_id = v_order.id
     group by ticket_type_id
     order by ticket_type_id
  loop
    update public.ticket_types
       set reserved_quantity = greatest(0, reserved_quantity - v_item.quantity),
           sold_quantity = sold_quantity + v_item.quantity
     where id = v_item.ticket_type_id
       and reserved_quantity >= v_item.quantity;

    get diagnostics v_processed = row_count;
    if v_processed <> 1 then
      raise exception 'Reserved inventory mismatch for ticket type %', v_item.ticket_type_id;
    end if;
  end loop;

  update public.orders
     set status = 'paid',
         payment_provider = 'mpesa',
         payment_reference = p_mpesa_receipt_number,
         mpesa_receipt_number = p_mpesa_receipt_number,
         paid_at = now(),
         payment_callback_received_at = now(),
         updated_at = now()
   where id = v_order.id;

  insert into public.tickets (order_item_id, event_id, ticket_type_id, attendee_name)
  select oi.id, tt.event_id, oi.ticket_type_id, v_order.customer_name
    from public.order_items oi
    join public.ticket_types tt on tt.id = oi.ticket_type_id
    cross join lateral generate_series(1, oi.quantity);

  update public.daraja_payment_callbacks
     set processed_at = now()
   where id = v_callback_id;

  return jsonb_build_object('success', true, 'state', 'paid', 'order_id', v_order.id);
end;
$$;

revoke all on function public.process_daraja_callback(text,text,integer,text,text,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_daraja_callback(text,text,integer,text,text,numeric,text,jsonb) to service_role;
