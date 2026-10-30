import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Callback function is missing Supabase server configuration.");
      return json({ ResultCode: 1, ResultDesc: "Callback configuration error" }, 503);
    }

    const body = await req.json();
    const callback = body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) {
      console.error("Received malformed Daraja callback.");
      // Acknowledge malformed requests to avoid endless provider retries.
      return json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const metadata = callback.CallbackMetadata?.Item ?? [];
    const value = (name: string) =>
      metadata.find((item: { Name?: string }) => item?.Name === name)?.Value;

    const receipt = value("MpesaReceiptNumber");
    const amount = value("Amount");
    const phone = value("PhoneNumber");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("process_daraja_callback", {
      p_checkout_request_id: String(callback.CheckoutRequestID),
      p_merchant_request_id: callback.MerchantRequestID
        ? String(callback.MerchantRequestID)
        : null,
      p_result_code: Number.isInteger(Number(callback.ResultCode))
        ? Number(callback.ResultCode)
        : null,
      p_result_description: String(callback.ResultDesc ?? ""),
      p_mpesa_receipt_number: receipt == null ? null : String(receipt),
      p_amount: amount == null ? null : Number(amount),
      p_phone_number: phone == null ? null : String(phone),
      p_callback_payload: body,
    });

    if (error) {
      console.error("Callback settlement RPC failed:", error.message);
      // Return an error so provider/support logs can identify processing failure.
      return json({ ResultCode: 1, ResultDesc: "Payment callback processing failed" }, 500);
    }

    if (data?.state === "payment_mismatch" || data?.state === "reservation_expired" ||
        data?.state === "unmatched" || data?.state === "not_pending") {
      console.error("Callback requires reconciliation:", data);
    }

    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("Unexpected callback error:", error);
    return json({ ResultCode: 1, ResultDesc: "Callback processing error" }, 500);
  }
});