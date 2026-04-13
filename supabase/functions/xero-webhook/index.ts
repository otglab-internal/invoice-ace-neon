import { neon } from "npm:@neondatabase/serverless";
import { uploadToR2 } from "../_shared/r2-utils.ts";
import { getSmtpConfig, getSandboxTestEmail, sendEmailViaSMTP, resolveSystemIdsToEmails } from "../_shared/email-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id",
};

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function getDb(orgId: string, environment: string) {
  const isProd = environment === "production";
  const mapping = ORG_DB_MAP[orgId];
  let url: string | undefined;
  if (mapping) {
    url = Deno.env.get(isProd ? mapping.prod : mapping.sb);
  }
  if (!url) {
    url = isProd ? Deno.env.get("DATABASE_URL_PROD") : Deno.env.get("DATABASE_URL_DEV");
  }
  if (!url) {
    throw new Error(`No database configured for org="${orgId}" env="${environment}"`);
  }
  return neon(url);
}

interface ConfigMap {
  [key: string]: string;
}

async function getConfigMap(sql: ReturnType<typeof neon>, keys: string[]): Promise<ConfigMap> {
  if (keys.length === 0) return {};
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await sql.query(`SELECT key, value FROM global_config WHERE key IN (${placeholders})`, keys);
  const map: ConfigMap = {};
  for (const r of rows) {
    map[r.key as string] = typeof r.value === "string" ? (r.value as string).trim() : String(r.value ?? "");
  }
  return map;
}

async function upsertConfig(sql: ReturnType<typeof neon>, key: string, value: string) {
  await sql.query(
    `INSERT INTO global_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

async function refreshAccessToken(
  sql: ReturnType<typeof neon>,
  config: ConfigMap,
): Promise<{ access_token: string; refresh_token: string } | null> {
  const clientId = config.xero_client_id;
  const clientSecret = config.xero_client_secret;
  const refreshToken = config.xero_refresh_token;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok) {
    console.error("Token refresh failed:", await res.text());
    return null;
  }

  const data = await res.json();
  await upsertConfig(sql, "xero_access_token", data.access_token);
  await upsertConfig(sql, "xero_refresh_token", data.refresh_token);
  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

async function verifyXeroSignature(payload: string, signature: string, webhookKey: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(webhookKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

async function fetchXeroInvoice(
  invoiceId: string,
  accessToken: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${XERO_API_URL}/Invoices/${invoiceId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.Invoices?.[0] || null;
}

async function fetchXeroInvoicePdf(
  invoiceId: string,
  accessToken: string,
  tenantId: string,
): Promise<Uint8Array | null> {
  const res = await fetch(`${XERO_API_URL}/Invoices/${invoiceId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/pdf",
    },
  });
  if (!res.ok) {
    console.error(`xero-webhook: Failed to fetch PDF for ${invoiceId}: ${res.status}`);
    return null;
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

async function uploadPdfToStorage(
  localInvoiceId: string,
  pdfBytes: Uint8Array,
  invoiceNumber: string,
): Promise<string | null> {
  const storagePath = `${localInvoiceId}/invoice.pdf`;

  try {
    await uploadToR2(storagePath, pdfBytes, "application/pdf");
    return storagePath;
  } catch (err) {
    console.error(`xero-webhook: Failed to upload PDF for ${invoiceNumber}:`, err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Xero sends a GET for intent-to-receive validation during webhook setup
  if (req.method === "GET") {
    return new Response("OK", { status: 200 });
  }

  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id") || "";
    const environment = url.searchParams.get("environment") || "production";

    if (!orgId) {
      console.error("xero-webhook: Missing org_id query param");
      return new Response("Missing org_id", { status: 400 });
    }

    const rawBody = await req.text();
    const xeroSignature = req.headers.get("x-xero-signature") || "";

    const sql = getDb(orgId, environment);

    // Resolve webhook key from environment secrets per org + environment
    const orgUpper = orgId === "stridekidz" ? "SK" : "OTG";
    const envSuffix = environment === "sandbox" ? "SB" : "PROD";
    const webhookKey = Deno.env.get(`XERO_WEBHOOK_KEY_${orgUpper}_${envSuffix}`) || "";

    if (!webhookKey) {
      console.error("xero-webhook: No xero_webhook_key configured");
      return new Response("", { status: 401 });
    }

    // Validate signature - Xero requires 200 for valid, non-200 for invalid
    const valid = await verifyXeroSignature(rawBody, xeroSignature, webhookKey);
    if (!valid) {
      console.warn("xero-webhook: Invalid signature");
      return new Response("", { status: 401 });
    }

    // Parse events
    let payload: { events?: Array<{ resourceUrl?: string; resourceId?: string; eventCategory?: string; eventType?: string; tenantId?: string }> };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("", { status: 200 });
    }

    const events = payload.events || [];
    if (events.length === 0) {
      // Xero validation ping - just return 200
      return new Response("", { status: 200 });
    }

    // Get Xero credentials for API calls
    const config = await getConfigMap(sql, [
      "xero_client_id",
      "xero_client_secret",
      "xero_access_token",
      "xero_refresh_token",
      "xero_tenant_id",
    ]);

    if (!config.xero_access_token || !config.xero_tenant_id) {
      console.error("xero-webhook: Xero not connected, skipping events");
      return new Response("", { status: 200 });
    }

    let accessToken = config.xero_access_token;

    for (const event of events) {
      if (event.eventCategory !== "INVOICE" || event.eventType !== "UPDATE") {
        continue;
      }

      const xeroInvoiceId = event.resourceId;
      if (!xeroInvoiceId) continue;

      console.log(`xero-webhook: Processing invoice update for Xero ID ${xeroInvoiceId}`);

      let xeroInvoice = await fetchXeroInvoice(xeroInvoiceId, accessToken, config.xero_tenant_id);

      if (!xeroInvoice) {
        const refreshed = await refreshAccessToken(sql, config);
        if (refreshed) {
          accessToken = refreshed.access_token;
          xeroInvoice = await fetchXeroInvoice(xeroInvoiceId, accessToken, config.xero_tenant_id);
        }
      }

      if (!xeroInvoice) {
        console.error(`xero-webhook: Could not fetch Xero invoice ${xeroInvoiceId}`);
        continue;
      }

      const xeroStatus = (xeroInvoice.Status as string || "").toUpperCase();
      const xeroInvoiceNumber = xeroInvoice.InvoiceNumber as string || "";
      const amountPaid = Number(xeroInvoice.AmountPaid ?? 0);
      const amountDue = Number(xeroInvoice.AmountDue ?? 0);

      console.log(`xero-webhook: Xero invoice ${xeroInvoiceNumber} status: ${xeroStatus}, amountPaid: ${amountPaid}, amountDue: ${amountDue}`);

      // Determine local status: paid, partially_paid, or skip
      let newLocalStatus: string | null = null;
      if (xeroStatus === "PAID") {
        newLocalStatus = "paid";
      } else if (amountPaid > 0 && amountDue > 0) {
        newLocalStatus = "partially_paid";
      } else {
        continue;
      }

      if (!xeroInvoiceNumber) {
        console.warn(`xero-webhook: Xero invoice ${xeroInvoiceId} has no InvoiceNumber, cannot match`);
        continue;
      }

      const matchingInvoices = await sql.query(
        `SELECT id, status, amendment_status FROM invoices WHERE invoice_number = $1 LIMIT 1`,
        [xeroInvoiceNumber],
      );

      if (matchingInvoices.length === 0) {
        console.warn(`xero-webhook: No local invoice found with invoice_number=${xeroInvoiceNumber}`);
        continue;
      }

      const localInvoice = matchingInvoices[0];

      if (localInvoice.status === "paid") {
        console.log(`xero-webhook: Invoice ${xeroInvoiceNumber} already marked as paid, skipping`);
        continue;
      }

      // Fetch latest PDF from Xero and replace in storage
      let newPdfPath: string | null = null;
      try {
        const pdfBytes = await fetchXeroInvoicePdf(xeroInvoiceId!, accessToken, config.xero_tenant_id);
        if (pdfBytes) {
          newPdfPath = await uploadPdfToStorage(localInvoice.id as string, pdfBytes, xeroInvoiceNumber);
          if (newPdfPath) {
            console.log(`xero-webhook: Updated PDF for ${xeroInvoiceNumber} -> ${newPdfPath}`);
          }
        } else {
          console.warn(`xero-webhook: Could not fetch PDF from Xero for ${xeroInvoiceNumber}`);
        }
      } catch (pdfErr) {
        console.error(`xero-webhook: PDF fetch/upload error for ${xeroInvoiceNumber}:`, pdfErr);
      }

      const updateFields = newPdfPath
        ? `status = 'paid',
           amendment_status = NULL,
           amendment_data = NULL,
           amendment_note = NULL,
           amendment_requested_by = NULL,
           amendment_requested_by_name = NULL,
           amendment_requested_at = NULL,
           invoice_pdf_url = $2`
        : `status = 'paid',
           amendment_status = NULL,
           amendment_data = NULL,
           amendment_note = NULL,
           amendment_requested_by = NULL,
           amendment_requested_by_name = NULL,
           amendment_requested_at = NULL`;

      if (newPdfPath) {
        await sql.query(
          `UPDATE invoices SET ${updateFields} WHERE id = $1`,
          [localInvoice.id, newPdfPath],
        );
      } else {
        await sql.query(
          `UPDATE invoices SET ${updateFields} WHERE id = $1`,
          [localInvoice.id],
        );
      }

      console.log(`xero-webhook: Invoice ${xeroInvoiceNumber} (${localInvoice.id}) marked as paid${newPdfPath ? " + PDF updated" : ""}`);

      try {
        await sql.query(
          `INSERT INTO invoice_logs (invoice_id, action_type, performed_by, performed_by_name, source, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            localInvoice.id,
            "status_changed_to_paid",
            "xero-webhook",
            "Xero Webhook",
            "webhook",
            JSON.stringify({ xero_invoice_id: xeroInvoiceId, xero_invoice_number: xeroInvoiceNumber, pdf_updated: !!newPdfPath }),
          ],
        );
      } catch (logErr) {
        console.error("xero-webhook: Failed to log status change:", logErr);
      }

      // Send payment notification email to the invoice requester
      try {
        const invoiceRows = await sql.query(
          `SELECT submitted_by_system_id, submitted_by_name, contact_name, total, invoice_date, reference FROM invoices WHERE id = $1 LIMIT 1`,
          [localInvoice.id],
        );
        if (invoiceRows.length > 0) {
          const inv = invoiceRows[0];
          const systemId = inv.submitted_by_system_id as string;
          const smtpConfig = await getSmtpConfig(sql);

          if (smtpConfig && systemId) {
            let requesterEmail: string | null = null;

            const emailMap = await resolveSystemIdsToEmails([systemId], orgId, environment);
            requesterEmail = emailMap[systemId] || null;

            if (!requesterEmail) {
              console.warn(`xero-webhook: Cannot determine email for requester system_id=${systemId}, name=${inv.submitted_by_name}. Skipping email.`);
            } else {
              // Check sandbox override
              const sandboxEmail = environment === "sandbox" ? await getSandboxTestEmail(sql) : null;
              const toEmail = sandboxEmail || requesterEmail;

              const htmlBody = `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                  <h2 style="color:#16a34a;">Payment Received</h2>
                  <p style="color:#6b7280;">Great news! A payment has been recorded for an invoice you submitted.</p>
                  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                    <tr><td style="padding:4px 0;color:#6b7280;">Invoice #:</td><td style="padding:4px 0;font-weight:600;">${xeroInvoiceNumber}</td></tr>
                    <tr><td style="padding:4px 0;color:#6b7280;">Contact:</td><td style="padding:4px 0;">${inv.contact_name || "N/A"}</td></tr>
                    <tr><td style="padding:4px 0;color:#6b7280;">Date:</td><td style="padding:4px 0;">${inv.invoice_date || "N/A"}</td></tr>
                    <tr><td style="padding:4px 0;color:#6b7280;">Reference:</td><td style="padding:4px 0;">${inv.reference || "—"}</td></tr>
                    <tr><td style="padding:4px 0;color:#6b7280;">Total:</td><td style="padding:4px 0;font-weight:600;font-size:18px;">RM ${Number(inv.total).toFixed(2)}</td></tr>
                    <tr><td style="padding:4px 0;color:#6b7280;">Status:</td><td style="padding:4px 0;"><span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">PAID</span></td></tr>
                  </table>
                  <p style="color:#6b7280;font-size:12px;">You can now download the payment receipt from the Invoice Center.</p>
                </div>
              `;

              await sendEmailViaSMTP(smtpConfig, [toEmail], `Payment Received – Invoice ${xeroInvoiceNumber}`, htmlBody);

              try {
                await sql.query(
                  `INSERT INTO activity_logs (action_type, category, performed_by, performed_by_name, details, environment)
                   VALUES ($1, $2, $3, $4, $5, $6)`,
                  [
                    "email_sent",
                    "email",
                    "xero-webhook",
                    "Xero Webhook",
                    JSON.stringify({
                      type: "payment_received",
                      recipients: [toEmail],
                      invoice_id: localInvoice.id,
                      xero_invoice_id: xeroInvoiceId,
                      xero_invoice_number: xeroInvoiceNumber,
                    }),
                    environment,
                  ],
                );
              } catch (logErr) {
                console.error(`xero-webhook: Failed to log payment email for ${xeroInvoiceNumber}:`, logErr);
              }

              console.log(`xero-webhook: Payment notification email sent to ${toEmail} for ${xeroInvoiceNumber}`);
            }
          }
        }
      } catch (emailErr) {
        console.error(`xero-webhook: Failed to send payment email for ${xeroInvoiceNumber}:`, emailErr);
      }
    }

    return new Response("", { status: 200 });
  } catch (err) {
    console.error("xero-webhook error:", err);
    return new Response("", { status: 200 });
  }
});
