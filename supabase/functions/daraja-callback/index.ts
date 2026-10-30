import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const consumerKey = Deno.env.get("DARAJA_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("DARAJA_CONSUMER_SECRET");
    const passkey = Deno.env.get("DARAJA_PASSKEY");
    const shortcode = Deno.env.get("DARAJA_SHORTCODE");
    const environment = Deno.env.get("DARAJA_ENVIRONMENT") ?? "sandbox";

    if (!supabaseUrl || !serviceRoleKey || !consumerKey || !consumerSecret || !passkey || !shortcode) {
      console.error("Callback function is missing required server configuration.");
      return json({ ResultCode: 1, ResultDesc: "Callback configuration error" }, 503);
    }
    if (environment !== "sandbox" && environment !== "production") {
      return json({ ResultCode: 1, ResultDesc: "Invalid Daraja environment" }, 503);
    }

    const body = await req.json();
    const callback = body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID || !callback?.MerchantRequestID) {
      console.error("Received malformed Daraja callback.");
      return json({ ResultCode: 1, ResultDesc: "Malformed callback" }, 400);
    }

    const resultCode = Number(callback.ResultCode);
    if (!Number.isInteger(resultCode)) {
      return json({ ResultCode: 1, ResultDesc: "Invalid callback result code" }, 400);
    }

    const metadata = callback.CallbackMetadata?.Item ?? [];
    const value = (name: string) =>
      metadata.find((item: { Name?: string }) => item?.Name === name)?.Value;

    const receipt = value("MpesaReceiptNumber");
    const amount = value("Amount");
    const phone = value("PhoneNumber");

    // A successful callback is not accepted on its own. Confirm the checkout
    // request directly with Daraja before changing inventory or issuing tickets.
    if (resultCode === 0) {
      const baseUrl = environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
      const ts = timestamp();
      const password = btoa(shortcode + passkey + ts);

      const authResponse = await fetch(
        baseUrl + "/oauth/v1/generate?grant_type=client_credentials",
        { headers: { Authorization: "Basic " + btoa(consumerKey + ":" + consumerSecret) } },
      );
      const authData = await authResponse.json();
      if (!authResponse.ok || !authData.access_token) {
        console.error("Daraja verification OAuth failed:", authData.errorMessage ?? authResponse.status);
        return json({ ResultCode: 1, ResultDesc: "Could not verify payment with Daraja" }, 503);
      }

      const queryResponse = await fetch(baseUrl + "/mpesa/stkpushquery/v1/query", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + authData.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: ts,
          CheckoutRequestID: String(callback.CheckoutRequestID),
        }),
      });
      const queryData = await queryResponse.json();

      // If Safaricom has not confirmed completion, leave the order pending.
      if (!queryResponse.ok || Number(queryData.ResponseCode) !== 0 ||
          Number(queryData.ResultCode) !== 0) {
        console.error("Daraja STK query did not confirm success:", queryData);
        return json({ ResultCode: 1, ResultDesc: "Payment is not yet verified; retry callback processing" }, 503);
      }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("process_daraja_callback", {
      p_checkout_request_id: String(callback.CheckoutRequestID),
      p_merchant_request_id: String(callback.MerchantRequestID),
      p_result_code: resultCode,
      p_result_description: String(callback.ResultDesc ?? ""),
      p_mpesa_receipt_number: receipt == null ? null : String(receipt),
      p_amount: amount == null ? null : Number(amount),
      p_phone_number: phone == null ? null : String(phone),
      p_callback_payload: body,
    });

    if (error) {
      console.error("Callback settlement RPC failed:", error.message);
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