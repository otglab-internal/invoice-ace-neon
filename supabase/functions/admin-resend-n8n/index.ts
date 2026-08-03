// One-off admin tool: re-pushes the latest invoice matching a given contact
// name in a specific org/environment directly to Xero.
// Also supports action="status" to inspect recent invoices/logs,
// and action="check_key" to verify a Xero webhook signing key matches our stored secret.
import { neon } from "npm:@neondatabase/serverless";
import { pushInvoiceToXero } from "../_shared/xero-invoice.ts";

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

    if (action === "check_key") {
      const orgUpper = orgId === "stridekidz" ? "SK" : "OTG";
      const envSuffix = env === "sandbox" ? "SB" : "PROD";
      const secretName = `XERO_WEBHOOK_KEY_${orgUpper}_${envSuffix}`;
      const stored = Deno.env.get(secretName) || "";
      const provided = (body.key || "") as string;
      return new Response(JSON.stringify({
        secretName,
        stored_present: !!stored,
        stored_length: stored.length,
        stored_first6: stored.slice(0, 6),
        stored_last6: stored.slice(-6),
        provided_length: provided.length,
        provided_first6: provided.slice(0, 6),
        provided_last6: provided.slice(-6),
        match: stored === provided,
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (action === "api_submissions") {
      const rows = await sql.query(
        `SELECT id, invoice_number, contact_name, submitted_by_system_id, submitted_by_name, submitted_by_email, callback_url, status, total, created_at
         FROM invoices
         WHERE submitted_by_system_id IS NOT NULL AND submitted_by_system_id <> ''
         ORDER BY created_at DESC LIMIT 25`,
        [],
      );
      return new Response(JSON.stringify({ count: rows.length, rows }, null, 2), {
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

    const result = await pushInvoiceToXero({
      sql,
      invoiceId: invoice.id as string,
      orgId,
      environment: env,
      mode: invoice.xero_invoice_id ? "amend" : "create",
    });

    return new Response(JSON.stringify({
      success: result.ok,
      error: result.ok ? null : result.error,
      detail: result.detail ?? null,
      xero_correlation_id: result.correlationId ?? null,
      invoice_id: invoice.id,
      invoice_number: result.invoiceNumber ?? invoice.invoice_number,
      xero_invoice_id: result.xeroInvoiceId ?? null,
      tenant_id: result.tenantId ?? null,
      tenant_name: result.tenantName ?? null,
      contact_name: invoice.contact_name,
      total: invoice.total,
      created_at: invoice.created_at,
    }), {
      status: result.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
