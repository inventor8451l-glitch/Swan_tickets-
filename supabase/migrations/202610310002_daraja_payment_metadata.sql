-- Daraja payment metadata and callback audit trail.
-- Apply in Supabase SQL Editor before deploying the Daraja Edge Functions.

alter table public.orders
  add column if not exists daraja_checkout_request_id text,
  add column if not exists daraja_merchant_request_id text,
  add column if not exists mpesa_receipt_number text,
  add column if not exists payment_phone text,
  add column if not exists payment_callback_received_at timestamptz,
  add column if not exists ticket_email_sent_at timestamptz;

create unique index if not exists orders_daraja_checkout_request_id_uidx
  on public.orders (daraja_checkout_request_id)
  where daraja_checkout_request_id is not null;

create unique index if not exists orders_mpesa_receipt_number_uidx
  on public.orders (mpesa_receipt_number)
  where mpesa_receipt_number is not null;

create table if not exists public.daraja_payment_callbacks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  checkout_request_id text,
  merchant_request_id text,
  result_code integer,
  result_description text,
  mpesa_receipt_number text,
  amount numeric,
  phone_number text,
  callback_payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists daraja_payment_callbacks_checkout_idx
  on public.daraja_payment_callbacks (checkout_request_id);

create index if not exists daraja_payment_callbacks_order_idx
  on public.daraja_payment_callbacks (order_id);

alter table public.daraja_payment_callbacks enable row level security;

-- No client-facing policies: only trusted server-side code using the
-- Supabase service-role key may read or write callback audit records.
