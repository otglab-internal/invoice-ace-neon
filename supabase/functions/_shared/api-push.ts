/**
 * API push notifications for externally-submitted invoices.
 *
 * When an invoice that was created via api-submit has a `callback_url`, we
 * POST a signed payload to that URL whenever a new artifact becomes available
 * (Xero-generated INV PDF, paid INV PDF, receipt PDF, etc.).
 *
 * Payload shape mirrors `api-get` so receivers can reuse the same parsing
 * code regardless of whether they polled or were pushed.
 *
 * Security: every push includes an `X-Signature` header containing
 * `sha256=<hex>` where `<hex>` is HMAC-SHA256(secret, raw_body). The secret
 * is per-org (API_PUSH_SIGNING_SECRET_OTG / API_PUSH_SIGNING_SECRET_SK).
 *
 * Reliability: each push is retried up to 3 times with exponential backoff
 * (1s, 3s, 9s). Outcomes are logged to `activity_logs` so admins can audit
 * what was sent and whether the receiver acknowledged it.
 */

import { buildPdfAttachment, fetchPdfBase64FromR2 } from "./pdf-artifacts.ts";

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type PushEvent =
  | "invoice_pdf_ready"
  | "paid_invoice_pdf_ready"
  | "receipt_pdf_ready";

const ORG_SECRET_MAP: Record<string, string> = {
  otg_lab: "API_PUSH_SIGNING_SECRET_OTG",
  stridekidz: "API_PUSH_SIGNING_SECRET_SK",
};

function getSigningSecret(orgId: string): string {
  const envName = ORG_SECRET_MAP[orgId];
  if (!envName) return "";
  return Deno.env.get(envName) || "";
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildInvoicePayload(invoice: any) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    contact_id: invoice.contact_id,
    contact_name: invoice.contact_name,
    invoice_date: invoice.invoice_date,
    reference: invoice.reference,
    line_items: invoice.line_items,
    total: invoice.total,
    requires_approval: invoice.requires_approval,
    submitted_by_system_id: invoice.submitted_by_system_id,
    submitted_by_name: invoice.submitted_by_name,
    submitted_by_email: invoice.submitted_by_email,
    approved_by: invoice.approved_by,
    approved_at: invoice.approved_at,
    approval_note: invoice.approval_note,
    created_at: invoice.created_at,
  };
}

interface DispatchOptions {
  sql: SqlClient;
  invoiceId: string;
  orgId: string;
  environment: string;
  event: PushEvent;
}

export async function dispatchApiPush({
  sql,
  invoiceId,
  orgId,
  environment,
  event,
}: DispatchOptions): Promise<void> {
  let invoice: any;
  try {
    const rows = await sql`SELECT * FROM invoices WHERE id = ${invoiceId} LIMIT 1` as any[];
    invoice = rows[0];
  } catch (e) {
    console.error("api-push: failed to load invoice:", e);
    return;
  }

  if (!invoice) return;
  if (!invoice.callback_url || typeof invoice.callback_url !== "string") return;

  const callbackUrl = invoice.callback_url.trim();
  if (!callbackUrl) return;

  const secret = getSigningSecret(orgId);
  if (!secret) {
    console.warn(`api-push: no signing secret configured for org=${orgId}; skipping push for invoice=${invoiceId}`);
    await safeLog(sql, {
      action: "api_push_skipped",
      details: { invoice_id: invoiceId, event, reason: "missing_signing_secret", org_id: orgId },
    });
    return;
  }

  const [invoicePdf, receiptPdf] = await Promise.all([
    fetchPdfBase64FromR2(invoice.invoice_pdf_url),
    fetchPdfBase64FromR2(invoice.receipt_pdf_url || null),
  ]);

  const payload = {
    event,
    sent_at: new Date().toISOString(),
    invoice: buildInvoicePayload(invoice),
    invoice_pdf: buildPdfAttachment(`${invoice.invoice_number || invoice.id}.pdf`, invoicePdf.base64),
    invoice_pdf_error: invoicePdf.error,
    receipt_pdf: buildPdfAttachment(`Receipt_${invoice.invoice_number || invoice.id}.pdf`, receiptPdf.base64),
    receipt_pdf_error: receiptPdf.error,
  };

  const rawBody = JSON.stringify(payload);
  const signature = await hmacSha256Hex(secret, rawBody);

  const maxAttempts = 3;
  let lastStatus = 0;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `sha256=${signature}`,
          "X-Event": event,
          "X-Invoice-Id": invoiceId,
        },
        body: rawBody,
      });
      lastStatus = res.status;
      try { await res.text(); } catch { /* ignore */ }
      if (res.ok) {
        await safeLog(sql, {
          action: "api_push_delivered",
          details: { invoice_id: invoiceId, event, callback_url: callbackUrl, status: res.status, attempts: attempt },
        });
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = (e as Error).message || "fetch failed";
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(3, attempt - 1)));
    }
  }

  console.error(`api-push: all ${maxAttempts} attempts failed for invoice=${invoiceId} -> ${callbackUrl} (${lastError})`);
  await safeLog(sql, {
    action: "api_push_failed",
    details: { invoice_id: invoiceId, event, callback_url: callbackUrl, last_status: lastStatus, last_error: lastError, attempts: maxAttempts },
  });
}

async function safeLog(
  sql: SqlClient,
  entry: { action: string; details: Record<string, unknown> },
): Promise<void> {
  try {
    await sql`
      INSERT INTO activity_logs (action_type, category, performed_by, performed_by_name, details)
      VALUES (${entry.action}, ${"api_push"}, ${"system"}, ${"System"}, ${JSON.stringify(entry.details)}::jsonb)
    `;
  } catch (e) {
    console.error("api-push: failed to write activity log:", e);
  }
}
