import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normaliseKenyanPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (/^254[17][0-9]{8}$/.test(digits)) return digits;
  if (/^0[17][0-9]{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^[17][0-9]{8}$/.test(digits)) return "254" + digits;
  return null;
}

function darajaTimestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return date.getFullYear() + p(date.getMonth() + 1) + p(date.getDate()) +
    p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const consumerKey = Deno.env.get("DARAJA_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("DARAJA_CONSUMER_SECRET");
    const passkey = Deno.env.get("DARAJA_PASSKEY");
    const shortcode = Deno.env.get("DARAJA_SHORTCODE");
    const environment = Deno.env.get("DARAJA_ENVIRONMENT") ?? "sandbox";

    if (!supabaseUrl || !serviceRoleKey || !consumerKey || !consumerSecret ||
        !passkey || !shortcode) {
      console.error("Payment function is missing required server secrets.");
      return json({ error: "Payment service is not configured." }, 503);
    }
    if (environment !== "sandbox" && environment !== "production") {
      return json({ error: "Invalid Daraja environment configuration." }, 503);
    }

    const body = await req.json();
    const customerName = String(body.customer_name ?? "").trim();
    const customerEmail = String(body.customer_email ?? "").trim();
    const phone = normaliseKenyanPhone(body.customer_phone);
    const items = body.items;

    if (customerName.length < 2 || customerName.length > 120 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
        customerEmail.length > 254 || !phone ||
        !Array.isArray(items) || items.length < 1 || items.length > 20) {
      return json({ error: "Enter a valid name, email, Kenyan phone number and ticket selection." }, 400);
    }

    const cleanItems = [];
    for (const item of items) {
      const ticketTypeId = String(item?.ticket_type_id ?? "");
      const quantity = Number(item?.quantity);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketTypeId) ||
          !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return json({ error: "One or more ticket selections are invalid." }, 400);
      }
      cleanItems.push({ ticket_type_id: ticketTypeId, quantity });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Prices and stock are taken from the database, never from browser-supplied values.
    const { data: orderResult, error: orderError } = await supabase.rpc("create_ticket_order", {
      p_customer_name: customerName,
      p_customer_email: customerEmail,
      p_customer_phone: phone,
      p_items: cleanItems,
    });

    if (orderError) {
      console.error("create_ticket_order failed:", orderError.message);
      return json({ error: "We could not reserve those tickets. Please refresh and try again." }, 409);
    }

    const order = Array.isArray(orderResult) ? orderResult[0] : orderResult;
    if (!order?.success || !order?.order_id || !order?.booking_reference) {
      return json({ error: order?.message ?? "Ticket reservation could not be created." }, 409);
    }

    if (String(order.currency ?? "KES").toUpperCase() !== "KES") {
      return json({ error: "M-Pesa checkout currently supports KES orders only." }, 400);
    }

    const amount = Math.ceil(Number(order.total_amount));
    if (!Number.isSafeInteger(amount) || amount < 1) {
      return json({ error: "The order amount is invalid." }, 400);
    }

    const baseUrl = environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
    const timestamp = darajaTimestamp();
    const password = btoa(shortcode + passkey + timestamp);

    const authResponse = await fetch(
      baseUrl + "/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: "Basic " + btoa(consumerKey + ":" + consumerSecret),
        },
      },
    );
    const authData = await authResponse.json();
    if (!authResponse.ok || !authData.access_token) {
      console.error("Daraja OAuth failed:", authData.errorMessage ?? authResponse.status);
      return json({
        error: "M-Pesa could not be reached. Your ticket reservation will expire automatically if payment is not started.",
        order_reference: order.booking_reference,
      }, 502);
    }

    const callbackUrl = supabaseUrl.replace(/\/$/, "") +
      "/functions/v1/daraja-callback";
    const stkResponse = await fetch(baseUrl + "/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + authData.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: Number(phone),
        PartyB: shortcode,
        PhoneNumber: Number(phone),
        CallBackURL: callbackUrl,
        AccountReference: String(order.booking_reference).slice(0, 12),
        TransactionDesc: "Swan Tickets",
      }),
    });

    const stkData = await stkResponse.json();
    if (!stkResponse.ok || Number(stkData.ResponseCode) !== 0 ||
        !stkData.CheckoutRequestID || !stkData.MerchantRequestID) {
      console.error("Daraja STK request failed:", stkData.errorMessage ?? stkData.ResponseDescription ?? stkResponse.status);
      return json({
        error: "M-Pesa did not accept the payment request. Your reservation will expire automatically if not paid.",
        order_reference: order.booking_reference,
      }, 502);
    }

    const { error: updateError } = await supabase.from("orders").update({
      payment_provider: "mpesa",
      payment_phone: phone,
      daraja_checkout_request_id: stkData.CheckoutRequestID,
      daraja_merchant_request_id: stkData.MerchantRequestID,
    }).eq("id", order.order_id);

    if (updateError) {
      // Do not report success if the callback cannot be correlated safely.
      console.error("Could not save Daraja request identifiers:", updateError.message);
      return json({
        error: "The payment prompt was sent, but the order needs support verification. Do not retry payment yet.",
        order_reference: order.booking_reference,
      }, 503);
    }

    return json({
      success: true,
      order_id: order.order_id,
      booking_reference: order.booking_reference,
      amount,
      currency: "KES",
      message: "Check your phone and enter your M-Pesa PIN to complete payment.",
    });
  } catch (error) {
    console.error("Unexpected create-payment error:", error);
    return json({ error: "An unexpected payment error occurred. Please try again later." }, 500);
  }
});