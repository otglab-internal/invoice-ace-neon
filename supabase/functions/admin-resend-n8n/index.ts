// One-off admin tool: re-fires the n8n approval webhook for the latest
// invoice matching a given contact name in a specific org/environment.
import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const orgId = body.org_id || "stridekidz";
    const env = body.environment || "production";
    const contactName = body.contact_name || null;
    const action = body.action || "resend";

    const mapping = ORG_DB_MAP[orgId];
    if (!mapping) throw new Error(`unknown org ${orgId}`);
    const url = Deno.env.get(env === "production" ? mapping.prod : mapping.sb);
    if (!url) throw new Error(`no db url for ${orgId} ${env}`);
    const sql = neon(url);

    if (action === "status") {
      const recent = await sql.query(
        `SELECT id, invoice_number, contact_name, status, amendment_status, total, created_at, approved_at, invoice_pdf_url, receipt_pdf_url
         FROM invoices ORDER BY created_at DESC LIMIT 5`,
        [],
      );
      const logs = await sql.query(
        `SELECT invoice_id, action_type, source, performed_by_name, created_at, details
         FROM invoice_logs ORDER BY created_at DESC LIMIT 10`,
        [],
      );
      return new Response(JSON.stringify({ recent, logs }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = await sql.query(
      contactName
        ? `SELECT * FROM invoices WHERE contact_name ILIKE $1 ORDER BY created_at DESC LIMIT 1`
        : `SELECT * FROM invoices ORDER BY created_at DESC LIMIT 1`,
      contactName ? [`%${contactName}%`] : [],
    ) as any[];
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: "no invoice found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const invoice = rows[0];

    const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL");
    if (!n8nWebhookUrl) throw new Error("N8N_WEBHOOK_URL not configured");

    const rawCurrency = (invoice.currency ?? "RM").toString();
    const currencyCode = rawCurrency.replace(/[^A-Za-z]/g, "").toUpperCase() || "RM";

    const enrichedInvoice = {
      ...invoice,
      currency: currencyCode,
      line_items: (invoice.line_items || []).map((li: any) => ({
        ...li,
        line_amount: (Number(li.quantity) || 0) * (Number(li.cost) || 0),
      })),
    };

    const webhookResponse = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "invoice_approved",
        invoice: enrichedInvoice,
        send_to_client: invoice.send_to_client === true,
        due_days: Number(invoice.due_days) || 7,
        recipient_emails: Array.isArray(invoice.recipient_emails) ? invoice.recipient_emails : [],
        contact_persons: Array.isArray(invoice.contact_persons) ? invoice.contact_persons : [],
        approved_by: invoice.approved_by,
        approved_at: invoice.approved_at,
        org_id: orgId,
        environment: env,
        resend: true,
      }),
    });

    const responseStatus = webhookResponse.status;
    const responseBody = await webhookResponse.text();

    return new Response(JSON.stringify({
      success: webhookResponse.ok,
      webhookStatus: responseStatus,
      webhookBody: responseBody,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      contact_name: invoice.contact_name,
      total: invoice.total,
      created_at: invoice.created_at,
    }), {
      status: webhookResponse.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
