/**
 * API push notifications for externally-submitted invoices.
 *
 * When an invoice that was created via api-submit has a `callback_url`, we
 * POST a signed payload to that URL whenever a new artifact becomes available
 * (Xero-generated INV PDF, paid INV PDF, etc.).
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

import { getR2PresignedUrl } from "./r2-utils.ts";

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type PushEvent =
  | "invoice_pdf_ready"        // Xero delivered the unpaid INV PDF
  | "paid_invoice_pdf_ready";  // Xero updated the PDF after payment

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

async function fetchInvoicePdfBase64(invoicePdfUrl: string | null): Promise<{
  base64: string | null;
  error: string | null;
}> {
  if (!invoicePdfUrl) return { base64: null, error: null };
  try {
    const presigned = await getR2PresignedUrl(invoicePdfUrl, 300);
    const res = await fetch(presigned);
    if (!res.ok) return { base64: null, error: `Failed to download PDF (status ${res.status})` };
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK) as unknown as number[]);
    }
    return { base64: btoa(binary), error: null };
  } catch (e) {
    return { base64: null, error: (e as Error).message || "Unknown PDF fetch error" };
  }
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

/**
 * Look up the invoice, build the payload, sign it, POST to callback_url,
 * retry on failure, and log the outcome.
 *
 * Safe to call for any invoice — no-op if the invoice has no callback_url.
 */
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

  const { base64, error: pdfError } = await fetchInvoicePdfBase64(invoice.invoice_pdf_url);

  const payload = {
    event,
    sent_at: new Date().toISOString(),
    invoice: buildInvoicePayload(invoice),
    invoice_pdf: base64
      ? {
          filename: `${invoice.invoice_number || invoice.id}.pdf`,
          mime_type: "application/pdf",
          base64,
        }
      : null,
    invoice_pdf_error: pdfError,
    receipt_pdf: null,
    receipt_pdf_note: "Receipt PDFs are generated on demand in the UI and not persisted; not pushed.",
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
      // Drain body to free the connection
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
      // 1s, 3s
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
