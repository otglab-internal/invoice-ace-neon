// Test function: directly exercises the email-sending path
// Looks up requester email from the users table (same as xero-webhook)

import { neon } from "npm:@neondatabase/serverless";
import { getSmtpConfig, getSandboxTestEmail, sendEmailViaSMTP } from "../_shared/email-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { org_id = "otg_lab", environment = "production", invoice_id } = await req.json();

    const isProd = environment === "production";
    const mapping = ORG_DB_MAP[org_id];
    const dbUrl = mapping ? Deno.env.get(isProd ? mapping.prod : mapping.sb) : undefined;
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: "No DB configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sql = neon(dbUrl);

    // Get the invoice
    let invoiceRows;
    if (invoice_id) {
      invoiceRows = await sql.query(
        `SELECT id, invoice_number, submitted_by_system_id, submitted_by_name, contact_name, total, invoice_date, reference, status FROM invoices WHERE id = $1 LIMIT 1`,
        [invoice_id],
      );
    } else {
      invoiceRows = await sql.query(
        `SELECT id, invoice_number, submitted_by_system_id, submitted_by_name, contact_name, total, invoice_date, reference, status FROM invoices WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1`,
      );
    }

    if (invoiceRows.length === 0) {
      return new Response(JSON.stringify({ error: "No invoice found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inv = invoiceRows[0];
    const systemId = inv.submitted_by_system_id as string;
    console.log(`test-paid-email: Invoice ${inv.id}, systemId=${systemId}, name=${inv.submitted_by_name}`);

    // Get SMTP config
    const smtpConfig = await getSmtpConfig(sql);
    if (!smtpConfig) {
      return new Response(JSON.stringify({ error: "SMTP not configured", invoice: inv }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve email — same logic as xero-webhook
    let requesterEmail: string | null = null;
    if (systemId.includes("@")) {
      requesterEmail = systemId;
    } else {
      const userRows = await sql.query(
        `SELECT email FROM users WHERE id = $1 LIMIT 1`,
        [systemId],
      );
      if (userRows.length > 0 && userRows[0].email) {
        requesterEmail = userRows[0].email as string;
        console.log(`test-paid-email: Resolved email ${requesterEmail} from users table`);
      } else {
        console.warn(`test-paid-email: No user found for system_id=${systemId}`);
      }
    }

    if (!requesterEmail) {
      return new Response(JSON.stringify({
        error: "Could not resolve email for requester",
        submitted_by_system_id: systemId,
        submitted_by_name: inv.submitted_by_name,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sandbox override
    const sandboxEmail = environment === "sandbox" ? await getSandboxTestEmail(sql) : null;
    const toEmail = sandboxEmail || requesterEmail;

    const invoiceNumber = inv.invoice_number || inv.id?.toString().slice(0, 8).toUpperCase() || "N/A";

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#16a34a;">Payment Received</h2>
        <p style="color:#6b7280;">Great news! A payment has been recorded for an invoice you submitted.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:4px 0;color:#6b7280;">Invoice #:</td><td style="padding:4px 0;font-weight:600;">${invoiceNumber}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Contact:</td><td style="padding:4px 0;">${inv.contact_name || "N/A"}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Date:</td><td style="padding:4px 0;">${inv.invoice_date || "N/A"}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Reference:</td><td style="padding:4px 0;">${inv.reference || "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Total:</td><td style="padding:4px 0;font-weight:600;font-size:18px;">RM ${Number(inv.total).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Status:</td><td style="padding:4px 0;"><span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">PAID</span></td></tr>
        </table>
        <p style="color:#9ca3af;font-size:11px;">⚠️ This is a TEST email from the simulation function.</p>
      </div>
    `;

    await sendEmailViaSMTP(smtpConfig, [toEmail], `[TEST] Payment Received – Invoice ${invoiceNumber}`, htmlBody);
    console.log(`test-paid-email: Email sent to ${toEmail}`);

    return new Response(JSON.stringify({
      success: true,
      sent_to: toEmail,
      resolved_from: "users table",
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("test-paid-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
