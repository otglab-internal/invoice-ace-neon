import { neon } from "npm:@neondatabase/serverless";
import { uploadToR2 } from "../_shared/r2-utils.ts";
import { createReceiptPdfBytes } from "../_shared/receipt-pdf.ts";
import { stripPdfProtection } from "../_shared/pdf-strip.ts";
import { getSmtpConfig, getSandboxTestEmail, sendEmailViaSMTP } from "../_shared/email-utils.ts";
import { dispatchApiPush } from "../_shared/api-push.ts";

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
  const storagePath = `invoices/${localInvoiceId}.pdf`;

  try {
    const cleanBytes = await stripPdfProtection(pdfBytes);
    await uploadToR2(storagePath, cleanBytes, "application/pdf");
    return storagePath;
  } catch (err) {
    console.error(`xero-webhook: Failed to upload PDF for ${invoiceNumber}:`, err);
    return null;
  }
}

async function uploadReceiptPdfToStorage(
  localInvoiceId: string,
  pdfBytes: Uint8Array,
  invoiceNumber: string,
): Promise<string | null> {
  const storagePath = `receipts/${localInvoiceId}.pdf`;

  try {
    await uploadToR2(storagePath, pdfBytes, "application/pdf");
    return storagePath;
  } catch (err) {
    console.error(`xero-webhook: Failed to upload receipt PDF for ${invoiceNumber}:`, err);
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

    console.log(`xero-webhook: [INCOMING] org=${orgId} env=${environment} bodyLen=${rawBody.length} hasSig=${!!xeroSignature}`);

    const sql = getDb(orgId, environment);

    // Resolve webhook key from environment secrets per org + environment
    const orgUpper = orgId === "stridekidz" ? "SK" : "OTG";
    const envSuffix = environment === "sandbox" ? "SB" : "PROD";
    const webhookKey = Deno.env.get(`XERO_WEBHOOK_KEY_${orgUpper}_${envSuffix}`) || "";

    if (!webhookKey) {
      console.error(`xero-webhook: [NO-KEY] Missing XERO_WEBHOOK_KEY_${orgUpper}_${envSuffix}`);
      return new Response("", { status: 401 });
    }

    // Validate signature - Xero requires 200 for valid, non-200 for invalid
    const valid = await verifyXeroSignature(rawBody, xeroSignature, webhookKey);
    if (!valid) {
      console.warn(`xero-webhook: [BAD-SIG] org=${orgId} env=${environment} sig=${xeroSignature.slice(0, 12)}…`);
      return new Response("", { status: 401 });
    }

    // Parse events
    let payload: { events?: Array<{ resourceUrl?: string; resourceId?: string; eventCategory?: string; eventType?: string; tenantId?: string }> };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.warn(`xero-webhook: [BAD-JSON] org=${orgId} env=${environment} body=${rawBody.slice(0, 200)}`);
      return new Response("", { status: 200 });
    }

    const events = payload.events || [];
    console.log(`xero-webhook: [PARSED] org=${orgId} env=${environment} eventCount=${events.length} types=${events.map((e) => `${e.eventCategory}.${e.eventType}`).join(",")}`);
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
      "logo_url",
      "company_name",
      "company_ssm",
      "company_address",
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
        `SELECT id, status, amendment_status, receipt_pdf_url FROM invoices WHERE invoice_number = $1 LIMIT 1`,
        [xeroInvoiceNumber],
      );

      if (matchingInvoices.length === 0) {
        console.warn(`xero-webhook: No local invoice found with invoice_number=${xeroInvoiceNumber}`);
        continue;
      }

      const localInvoice = matchingInvoices[0];

      if (localInvoice.status === "paid" && localInvoice.receipt_pdf_url) {
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

      let receiptPdfPath: string | null = null;
      if (newLocalStatus === "paid" || newLocalStatus === "partially_paid") {
        try {
          const invoiceRows = await sql.query(
            `SELECT invoice_number, contact_name, invoice_date, reference, total, line_items, submitted_by_name, currency FROM invoices WHERE id = $1 LIMIT 1`,
            [localInvoice.id],
          );
          const invoiceRecord = invoiceRows[0];
          if (invoiceRecord) {
            const receiptPdfBytes = await createReceiptPdfBytes({
              invoiceNumber: (invoiceRecord.invoice_number as string | null) || xeroInvoiceNumber,
              contactName: (invoiceRecord.contact_name as string) || "—",
              invoiceDate: (invoiceRecord.invoice_date as string) || "—",
              reference: (invoiceRecord.reference as string | null) || null,
              total: Number(invoiceRecord.total || 0),
              lineItems: Array.isArray(invoiceRecord.line_items) ? invoiceRecord.line_items as Array<Record<string, unknown>> : [],
              submittedByName: (invoiceRecord.submitted_by_name as string) || "—",
              currency: (invoiceRecord.currency as string | null) || "RM",
              logoUrl: config.logo_url || null,
              companyName: config.company_name || null,
              companySsm: config.company_ssm || null,
              companyAddress: config.company_address || null,
              amountPaid,
              amountDue,
              isPartial: newLocalStatus === "partially_paid",
            });
            receiptPdfPath = await uploadReceiptPdfToStorage(localInvoice.id as string, receiptPdfBytes, xeroInvoiceNumber);
          }
        } catch (receiptErr) {
          console.error(`xero-webhook: Receipt generation/upload error for ${xeroInvoiceNumber}:`, receiptErr);
        }
      }

      // For fully paid, clear amendment fields; for partial, just update status
      const clearAmendments = newLocalStatus === "paid";
      const amendmentClause = clearAmendments
        ? `,
           amendment_status = NULL,
           amendment_data = NULL,
           amendment_note = NULL,
           amendment_requested_by = NULL,
           amendment_requested_by_name = NULL,
           amendment_requested_at = NULL`
        : "";

      if (newPdfPath && receiptPdfPath) {
        await sql.query(
          `UPDATE invoices SET status = $2, invoice_pdf_url = $3, receipt_pdf_url = $4${amendmentClause} WHERE id = $1`,
          [localInvoice.id, newLocalStatus, newPdfPath, receiptPdfPath],
        );
      } else if (newPdfPath) {
        await sql.query(
          `UPDATE invoices SET status = $2, invoice_pdf_url = $3${amendmentClause} WHERE id = $1`,
          [localInvoice.id, newLocalStatus, newPdfPath],
        );
      } else if (receiptPdfPath) {
        await sql.query(
          `UPDATE invoices SET status = $2, receipt_pdf_url = $3${amendmentClause} WHERE id = $1`,
          [localInvoice.id, newLocalStatus, receiptPdfPath],
        );
      } else {
        await sql.query(
          `UPDATE invoices SET status = $2${amendmentClause} WHERE id = $1`,
          [localInvoice.id, newLocalStatus],
        );
      }

      console.log(`xero-webhook: Invoice ${xeroInvoiceNumber} (${localInvoice.id}) marked as ${newLocalStatus}${newPdfPath ? " + PDF updated" : ""}${receiptPdfPath ? " + receipt generated" : ""}`);

      if (newLocalStatus === "paid") {
        try {
          if (newPdfPath) {
            await dispatchApiPush({
              sql: sql as any,
              invoiceId: localInvoice.id as string,
              orgId,
              environment,
              event: "paid_invoice_pdf_ready",
            });
          }
          if (receiptPdfPath) {
            await dispatchApiPush({
              sql: sql as any,
              invoiceId: localInvoice.id as string,
              orgId,
              environment,
              event: "receipt_pdf_ready",
            });
          }
        } catch (pushErr) {
          console.error("xero-webhook: api push failed:", pushErr);
        }
      }

      try {
        await sql.query(
          `INSERT INTO invoice_logs (invoice_id, action_type, performed_by, performed_by_name, source, details)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            localInvoice.id,
            `status_changed_to_${newLocalStatus}`,
            "xero-webhook",
            "Xero Webhook",
            "webhook",
            JSON.stringify({ xero_invoice_id: xeroInvoiceId, xero_invoice_number: xeroInvoiceNumber, pdf_updated: !!newPdfPath, receipt_generated: !!receiptPdfPath, new_status: newLocalStatus }),
          ],
        );
      } catch (logErr) {
        console.error("xero-webhook: Failed to log status change:", logErr);
      }

      // Send payment notification email only for fully paid invoices
      if (newLocalStatus === "paid") {
      try {
        const invoiceRows = await sql.query(
          `SELECT submitted_by_system_id, submitted_by_name, submitted_by_email, contact_name, total, invoice_date, reference, currency FROM invoices WHERE id = $1 LIMIT 1`,
          [localInvoice.id],
        );
        if (invoiceRows.length > 0) {
          const inv = invoiceRows[0];
          const requesterEmail = (inv.submitted_by_email as string) || null;
          const smtpConfig = await getSmtpConfig(sql);

          if (smtpConfig && requesterEmail) {
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
                    <tr><td style="padding:4px 0;color:#6b7280;">Total:</td><td style="padding:4px 0;font-weight:600;font-size:18px;">${inv.currency || "RM"} ${Number(inv.total).toFixed(2)}</td></tr>
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
          } else if (!requesterEmail) {
              console.warn(`xero-webhook: No submitted_by_email stored for invoice ${xeroInvoiceNumber}. Skipping payment email.`);
          }
        }
      } catch (emailErr) {
        console.error(`xero-webhook: Failed to send payment email for ${xeroInvoiceNumber}:`, emailErr);
      }
      } // end if newLocalStatus === "paid"
    }

    return new Response("", { status: 200 });
  } catch (err) {
    console.error("xero-webhook error:", err);
    return new Response("", { status: 200 });
  }
});
