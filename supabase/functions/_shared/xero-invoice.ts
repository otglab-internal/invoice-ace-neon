/**
 * Direct Xero invoice pipeline.
 *
 * Replaces the previous n8n hop: when an invoice is approved (in-app or via
 * the external API) or an approved amendment lands, this module talks to Xero
 * itself using the OAuth2 connection stored in the *tenant slice's own*
 * `global_config` table.
 *
 * Environment isolation is absolute: every function here operates on the
 * `sql` client handed to it, which is already resolved from org_id +
 * environment. Xero credentials, tenant id and tenant name are read from that
 * database only, so StrideKidz/OTG Lab and production/sandbox can never touch
 * each other's Xero organisation.
 */

import { uploadToR2 } from "./r2-utils.ts";
import { stripPdfProtection } from "./pdf-strip.ts";
import { dispatchApiPush } from "./api-push.ts";

const XERO_API_URL = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

// deno-lint-ignore no-explicit-any
type AnySql = any;

export interface XeroPushResult {
  ok: boolean;
  xeroInvoiceId?: string;
  invoiceNumber?: string;
  tenantId?: string;
  tenantName?: string | null;
  pdfPath?: string | null;
  emailed?: boolean;
  error?: string;
  code?: string;
  detail?: string;
  correlationId?: string | null;
}

interface XeroContext {
  accessToken: string;
  tenantId: string;
  tenantName: string | null;
  config: Record<string, string>;
  sql: AnySql;
}

const CONFIG_KEYS = [
  "xero_access_token",
  "xero_refresh_token",
  "xero_client_id",
  "xero_client_secret",
  "xero_tenant_id",
  "xero_tenant_name",
];

async function getConfigMap(sql: AnySql, keys: string[]): Promise<Record<string, string>> {
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await sql.query(`SELECT key, value FROM global_config WHERE key IN (${placeholders})`, keys);
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key as string] = typeof r.value === "string" ? (r.value as string).trim() : String(r.value ?? "");
  }
  return map;
}

async function upsertConfig(sql: AnySql, key: string, value: string) {
  await sql.query(
    `INSERT INTO global_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

async function refreshAccessToken(sql: AnySql, config: Record<string, string>): Promise<string | null> {
  const { xero_client_id: clientId, xero_client_secret: clientSecret, xero_refresh_token: refreshToken } = config;
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
    console.error("xero-invoice: token refresh failed:", await res.text());
    return null;
  }

  const data = await res.json();
  await upsertConfig(sql, "xero_access_token", data.access_token);
  await upsertConfig(sql, "xero_refresh_token", data.refresh_token);
  config.xero_access_token = data.access_token;
  config.xero_refresh_token = data.refresh_token;
  return data.access_token as string;
}

/** Loads the Xero connection bound to THIS tenant slice. */
export async function getXeroContext(sql: AnySql): Promise<{ ctx?: XeroContext; error?: string; code?: string }> {
  const config = await getConfigMap(sql, CONFIG_KEYS);
  if (!config.xero_access_token) {
    return { error: "Xero is not connected for this organisation/environment. Connect it in Global Config.", code: "xero_not_connected" };
  }
  if (!config.xero_tenant_id) {
    return {
      error: "No Xero organisation is bound for this environment. Open Global Config and choose the organisation.",
      code: "xero_tenant_unbound",
    };
  }
  return {
    ctx: {
      accessToken: config.xero_access_token,
      tenantId: config.xero_tenant_id,
      tenantName: config.xero_tenant_name || null,
      config,
      sql,
    },
  };
}

/** Xero request that refreshes the token once on 401 and retries. */
async function xeroFetch(ctx: XeroContext, path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const build = (): RequestInit => ({
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Xero-Tenant-Id": ctx.tenantId,
      Accept: init.accept || "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  let res = await fetch(`${XERO_API_URL}${path}`, build());
  if (res.status === 401) {
    const token = await refreshAccessToken(ctx.sql, ctx.config);
    if (token) {
      ctx.accessToken = token;
      res = await fetch(`${XERO_API_URL}${path}`, build());
    }
  }
  return res;
}

function correlationOf(res: Response): string | null {
  return res.headers.get("x-correlation-id") || res.headers.get("xero-correlation-id");
}

export interface ContactInput {
  name: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Finds a Xero contact by exact name, creating it when missing. */
export async function resolveXeroContact(
  ctx: XeroContext,
  input: ContactInput,
): Promise<{ contactId?: string; created?: boolean; error?: string; detail?: string; correlationId?: string | null }> {
  const name = (input.name || "").trim();
  if (!name) return { error: "Invoice has no contact name, so it cannot be created in Xero." };

  const where = encodeURIComponent(`Name=="${name.replace(/"/g, '\\"')}"`);
  const lookup = await xeroFetch(ctx, `/Contacts?where=${where}`);
  if (lookup.ok) {
    const data = await lookup.json();
    const existing = (data.Contacts || [])[0];
    if (existing?.ContactID) return { contactId: existing.ContactID, created: false };
  } else if (lookup.status === 401 || lookup.status === 403) {
    return {
      error: "Xero refused contact access. Reconnect Xero from Global Config and approve all requested permissions.",
      detail: await lookup.text(),
      correlationId: correlationOf(lookup),
    };
  }

  const payload: Record<string, unknown> = { Name: name };
  if (input.email) payload.EmailAddress = input.email;
  if (input.firstName) payload.FirstName = input.firstName;
  if (input.lastName) payload.LastName = input.lastName;

  const createRes = await xeroFetch(ctx, "/Contacts", { method: "POST", body: JSON.stringify({ Contacts: [payload] }) });
  if (!createRes.ok) {
    return {
      error: "Failed to create the contact in Xero.",
      detail: await createRes.text(),
      correlationId: correlationOf(createRes),
    };
  }
  const created = (await createRes.json()).Contacts?.[0];
  return { contactId: created?.ContactID, created: true };
}

function normalizeCurrency(raw: unknown): string {
  const code = String(raw ?? "RM").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!code || code === "RM") return "MYR";
  return code;
}

/**
 * Normalises a stored date into ISO yyyy-mm-dd.
 * The app stores dates as DD/MM/YYYY (GMT+8); Xero must never be handed an
 * ambiguous value or it parses 03/08/2026 as 8 March.
 */
function toIsoDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Turns literal "\n" sequences stored in text into real line breaks for Xero. */
function unescapeNewlines(value: unknown): string {
  return String(value ?? "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

// deno-lint-ignore no-explicit-any
function buildLineItems(invoice: any): { items: Record<string, unknown>[]; error?: string } {
  const raw = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  if (raw.length === 0) return { items: [], error: "Invoice has no line items." };

  const items: Record<string, unknown>[] = [];
  for (const li of raw) {
    const account = String(li.account ?? li.account_code ?? li.accountCode ?? "").trim();
    if (!account) {
      return { items: [], error: "Every line item needs a Xero account code before it can be sent to Xero." };
    }
    const item: Record<string, unknown> = {
      Description: unescapeNewlines(li.description) || "-",
      Quantity: Number(li.quantity) || 0,
      UnitAmount: Number(li.cost) || 0,
      AccountCode: account,
      TaxType: "NONE",
    };

    const tracking = Array.isArray(li.tracking)
      ? li.tracking
          .filter((t: Record<string, string>) => t && t.name && t.option)
          .map((t: Record<string, string>) => ({ Name: t.name, Option: t.option }))
      : [];
    if (tracking.length > 0) item.Tracking = tracking;
    items.push(item);
  }
  return { items };
}

// deno-lint-ignore no-explicit-any
function contactEmailFor(invoice: any): string | null {
  const persons = Array.isArray(invoice.contact_persons) ? invoice.contact_persons : [];
  for (const p of persons) {
    const email = (p?.email || p?.Email || "").toString().trim();
    if (email) return email;
  }
  const recipients = Array.isArray(invoice.recipient_emails) ? invoice.recipient_emails : [];
  const first = recipients.map((e: unknown) => String(e || "").trim()).find(Boolean);
  return first || null;
}

async function ensureColumns(sql: AnySql) {
  try {
    await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT`, []);
  } catch (e) {
    console.warn("xero-invoice: ensure xero_invoice_id column failed:", e);
  }
}

async function logInvoiceEvent(
  sql: AnySql,
  invoiceId: string,
  actionType: string,
  details: Record<string, unknown>,
) {
  try {
    await sql.query(
      `INSERT INTO invoice_logs (invoice_id, action_type, source, performed_by, performed_by_name, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [invoiceId, actionType, "xero", "system", "Xero Sync", JSON.stringify(details)],
    );
  } catch (e) {
    console.error("xero-invoice: failed to log event:", e);
  }
}

/** Pulls the invoice PDF from Xero, stores it in R2 and records the path. */
export async function syncXeroInvoicePdf(
  ctx: XeroContext,
  localInvoiceId: string,
  xeroInvoiceId: string,
): Promise<string | null> {
  try {
    const res = await xeroFetch(ctx, `/Invoices/${xeroInvoiceId}`, { accept: "application/pdf" });
    if (!res.ok) {
      console.error(`xero-invoice: PDF fetch failed (${res.status}) for ${xeroInvoiceId}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const clean = await stripPdfProtection(bytes);
    const path = `invoices/${localInvoiceId}.pdf`;
    await uploadToR2(path, clean, "application/pdf");
    await ctx.sql.query(`UPDATE invoices SET invoice_pdf_url = $2 WHERE id = $1`, [localInvoiceId, path]);
    return path;
  } catch (e) {
    console.error("xero-invoice: PDF sync failed:", e);
    return null;
  }
}

/** Asks Xero to email the invoice to the contact using the org's own template. */
async function emailXeroInvoice(ctx: XeroContext, xeroInvoiceId: string): Promise<boolean> {
  try {
    const res = await xeroFetch(ctx, `/Invoices/${xeroInvoiceId}/Email`, { method: "POST", body: "{}" });
    if (!res.ok && res.status !== 204) {
      console.error(`xero-invoice: email failed (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("xero-invoice: email threw:", e);
    return false;
  }
}

export interface PushOptions {
  sql: AnySql;
  invoiceId: string;
  orgId: string;
  environment: string;
  /** "create" for first approval, "amend" to update the existing Xero invoice. */
  mode?: "create" | "amend";
}

/**
 * Creates (or updates) the invoice in Xero as an AUTHORISED ACCREC invoice,
 * stores the Xero ids, optionally has Xero email the client, then syncs the
 * PDF and pushes it to any external system that submitted the invoice.
 */
export async function pushInvoiceToXero({
  sql,
  invoiceId,
  orgId,
  environment,
  mode = "create",
}: PushOptions): Promise<XeroPushResult> {
  await ensureColumns(sql);

  const rows = await sql.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
  const invoice = rows[0];
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const { ctx, error: ctxError, code } = await getXeroContext(sql);
  if (!ctx) {
    await logInvoiceEvent(sql, invoiceId, "xero_sync_error", { reason: code, message: ctxError, org_id: orgId, environment });
    return { ok: false, error: ctxError, code };
  }

  console.log(
    `xero-invoice: pushing invoice=${invoiceId} org=${orgId} env=${environment} tenant=${ctx.tenantId} (${ctx.tenantName || "unnamed"}) mode=${mode}`,
  );

  const { items, error: lineError } = buildLineItems(invoice);
  if (lineError) {
    await logInvoiceEvent(sql, invoiceId, "xero_sync_error", { reason: "invalid_line_items", message: lineError });
    return { ok: false, error: lineError, code: "invalid_line_items" };
  }

  const existingXeroId = (invoice.xero_invoice_id || "").toString().trim();

  // Resolve the contact — reuse by exact name, create when new.
  const contact = await resolveXeroContact(ctx, {
    name: invoice.contact_name,
    email: contactEmailFor(invoice),
  });
  if (!contact.contactId) {
    await logInvoiceEvent(sql, invoiceId, "xero_sync_error", {
      reason: "contact_failed",
      message: contact.error,
      detail: contact.detail,
      xero_correlation_id: contact.correlationId || null,
    });
    return {
      ok: false,
      error: contact.error || "Could not resolve the Xero contact.",
      code: "xero_contact_failed",
      detail: contact.detail,
      correlationId: contact.correlationId,
    };
  }

  const invoiceDate = toIsoDate(invoice.invoice_date);
  const dueDays = Number(invoice.due_days) || 7;

  const payload: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: { ContactID: contact.contactId },
    Date: invoiceDate,
    DueDate: addDays(invoiceDate, dueDays),
    Reference: unescapeNewlines(invoice.reference),

    CurrencyCode: normalizeCurrency(invoice.currency),
    LineAmountTypes: "NoTax",
    Status: "AUTHORISED",
    LineItems: items,
  };
  // Amendments upsert the same Xero invoice instead of creating a duplicate.
  if (existingXeroId) payload.InvoiceID = existingXeroId;

  const res = await xeroFetch(ctx, "/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [payload] }) });
  if (!res.ok) {
    const detail = await res.text();
    const correlationId = correlationOf(res);
    console.error(`xero-invoice: create/update failed (${res.status})`, { detail, correlationId });
    await logInvoiceEvent(sql, invoiceId, "xero_sync_error", {
      reason: "xero_rejected",
      status: res.status,
      detail,
      xero_correlation_id: correlationId,
      tenant_id: ctx.tenantId,
    });
    return {
      ok: false,
      error:
        res.status === 401 || res.status === 403
          ? "Xero refused the request. Reconnect Xero from Global Config and approve all requested permissions."
          : "Xero rejected the invoice.",
      code: "xero_rejected",
      detail,
      correlationId,
    };
  }

  const created = (await res.json()).Invoices?.[0];
  const xeroInvoiceId = created?.InvoiceID as string | undefined;
  const invoiceNumber = (created?.InvoiceNumber as string | undefined) || invoice.invoice_number || null;

  if (!xeroInvoiceId) {
    await logInvoiceEvent(sql, invoiceId, "xero_sync_error", { reason: "no_invoice_id_returned" });
    return { ok: false, error: "Xero accepted the request but returned no invoice.", code: "xero_no_invoice_returned" };
  }

  await sql.query(`UPDATE invoices SET xero_invoice_id = $2, invoice_number = $3 WHERE id = $1`, [
    invoiceId,
    xeroInvoiceId,
    invoiceNumber,
  ]);

  // Let Xero email the client using the organisation's own invoice template.
  let emailed = false;
  if (invoice.send_to_client === true) {
    emailed = await emailXeroInvoice(ctx, xeroInvoiceId);
  }

  const pdfPath = await syncXeroInvoicePdf(ctx, invoiceId, xeroInvoiceId);

  await logInvoiceEvent(sql, invoiceId, mode === "amend" ? "xero_invoice_updated" : "xero_invoice_created", {
    xero_invoice_id: xeroInvoiceId,
    invoice_number: invoiceNumber,
    tenant_id: ctx.tenantId,
    tenant_name: ctx.tenantName,
    emailed,
    pdf_stored: !!pdfPath,
    org_id: orgId,
    environment,
  });

  if (pdfPath) {
    try {
      await dispatchApiPush({ sql, invoiceId, orgId, environment, event: "invoice_pdf_ready" });
    } catch (e) {
      console.error("xero-invoice: api push failed:", e);
    }
  }

  return {
    ok: true,
    xeroInvoiceId,
    invoiceNumber: invoiceNumber || undefined,
    tenantId: ctx.tenantId,
    tenantName: ctx.tenantName,
    pdfPath,
    emailed,
  };
}
