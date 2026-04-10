// Temporary test function: simulates a Xero webhook "INVOICE PAID" event
// with a valid HMAC signature, hitting xero-webhook to verify end-to-end email flow.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { org_id = "otg_lab", environment = "production", invoice_number } = await req.json();

    // Resolve the webhook key
    const orgUpper = org_id === "stridekidz" ? "SK" : "OTG";
    const envSuffix = environment === "sandbox" ? "SB" : "PROD";
    const webhookKey = Deno.env.get(`XERO_WEBHOOK_KEY_${orgUpper}_${envSuffix}`);

    if (!webhookKey) {
      return new Response(JSON.stringify({ error: `No webhook key for ${orgUpper}_${envSuffix}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a fake Xero webhook payload
    const fakeXeroInvoiceId = "TEST-" + crypto.randomUUID().slice(0, 8);
    const payload = JSON.stringify({
      events: [
        {
          resourceUrl: `https://api.xero.com/api.xro/2.0/Invoices/${fakeXeroInvoiceId}`,
          resourceId: fakeXeroInvoiceId,
          eventCategory: "INVOICE",
          eventType: "UPDATE",
          tenantId: "test-tenant",
        },
      ],
    });

    // Compute valid HMAC-SHA256 signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(webhookKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

    // Call the actual xero-webhook function
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const targetUrl = `${supabaseUrl}/functions/v1/xero-webhook?org_id=${org_id}&environment=${environment}`;

    console.log(`test-xero-webhook: Calling ${targetUrl} with signature`);
    console.log(`test-xero-webhook: Payload: ${payload}`);
    console.log(`test-xero-webhook: Fake Xero Invoice ID: ${fakeXeroInvoiceId}`);
    if (invoice_number) {
      console.log(`test-xero-webhook: Expected to match invoice_number: ${invoice_number}`);
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-xero-signature": signature,
      },
      body: payload,
    });

    const responseStatus = res.status;
    const responseBody = await res.text();

    console.log(`test-xero-webhook: Response ${responseStatus}: ${responseBody}`);

    return new Response(
      JSON.stringify({
        success: responseStatus === 200,
        webhook_status: responseStatus,
        webhook_response: responseBody,
        fake_xero_invoice_id: fakeXeroInvoiceId,
        note: "The webhook signature was valid. The xero-webhook function will try to fetch invoice details from Xero API using this fake ID, which will fail. Check logs for the flow.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("test-xero-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
