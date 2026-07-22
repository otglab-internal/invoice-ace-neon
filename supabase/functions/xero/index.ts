import { neon } from "npm:@neondatabase/serverless";
import { authenticate, unauthorizedResponse } from "../_shared/auth.ts";
import { uploadToR2 } from "../_shared/r2-utils.ts";
import { createReceiptPdfBytes } from "../_shared/receipt-pdf.ts";
import { reconcileInvoicePayments, listInvoicePayments } from "../_shared/invoice-payments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_URL = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

interface ConfigMap {
  [key: string]: string;
}

type DbClient = ReturnType<typeof neon>;


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
    throw new Error(`No database connection configured for org="${orgId}" env="${environment}"`);
  }

  return neon(url);
}

async function getConfigMap(sql: DbClient, keys: string[]): Promise<ConfigMap> {
  if (keys.length === 0) return {};

  const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query(`SELECT key, value FROM global_config WHERE key IN (${placeholders})`, keys);
  const map: ConfigMap = {};
  for (const r of rows) {
    map[r.key] = typeof r.value === "string" ? r.value.trim() : String(r.value ?? "");
  }
  return map;
}

async function upsertConfig(sql: DbClient, key: string, value: string) {
  await sql.query(
    `INSERT INTO global_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

async function refreshAccessToken(sql: DbClient, config: ConfigMap): Promise<{ access_token: string; refresh_token: string } | null> {
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
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    console.error("Token refresh failed:", await res.text());
    return null;
  }

  const data = await res.json();

  // Save new tokens
  await upsertConfig(sql, "xero_access_token", data.access_token);
  await upsertConfig(sql, "xero_refresh_token", data.refresh_token);

  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

async function uploadReceiptPdfToStorage(localInvoiceId: string, pdfBytes: Uint8Array): Promise<string> {
  const storagePath = `receipts/${localInvoiceId}.pdf`;
  await uploadToR2(storagePath, pdfBytes, "application/pdf");
  return storagePath;
}

async function fetchXeroInvoiceByNumber(invoiceNumber: string, accessToken: string, tenantId: string) {
  const safeInvoiceNumber = invoiceNumber.replace(/"/g, '\\"');
  const where = `InvoiceNumber=="${safeInvoiceNumber}"`;
  const res = await fetch(`${XERO_API_URL}/Invoices?where=${encodeURIComponent(where)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) return { invoice: null, status: res.status };

  const data = await res.json();
  return { invoice: data.Invoices?.[0] || null, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // All Xero actions require an authenticated app user.
  const claims = await authenticate(req);
  if (!claims) return unauthorizedResponse(corsHeaders);

  try {
    const orgId = req.headers.get("x-org-id") || "";
    const environment = req.headers.get("x-environment") || "production";
    const { action, ...body } = await req.json();

    if (!orgId) {
      return new Response(JSON.stringify({ error: "Missing x-org-id header" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sql = getDb(orgId, environment);

    // ACTION: get-auth-url
    if (action === "get-auth-url") {
      const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";
      if (!redirectUri) {
        return new Response(JSON.stringify({ error: "Missing redirectUri" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const config = await getConfigMap(sql, ["xero_client_id"]);
      const clientId = config.xero_client_id;

      if (!clientId) {
        return new Response(JSON.stringify({ error: "Xero Client ID not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const state = crypto.randomUUID();
      const scopes = [
        "openid",
        "profile",
        "email",
        "offline_access",
        "accounting.contacts",
        "accounting.invoices",
        "accounting.payments",
        "accounting.attachments",
        "accounting.settings.read",
      ].join(" ");
      // prompt=consent forces Xero to re-display the permission screen so newly
      // added scopes (e.g. accounting.contacts write) are actually granted on
      // reconnect instead of Xero silently reusing the prior grant.
      const url = `${XERO_AUTH_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&prompt=consent`;

      return new Response(JSON.stringify({ url, state }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: callback
    if (action === "callback") {
      const code = typeof body.code === "string" ? body.code : "";
      const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";

      if (!code || !redirectUri) {
        return new Response(JSON.stringify({ error: "Missing code or redirectUri" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const config = await getConfigMap(sql, ["xero_client_id", "xero_client_secret"]);

      if (!config.xero_client_id || !config.xero_client_secret) {
        return new Response(JSON.stringify({ error: "Xero credentials not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenRes = await fetch(XERO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${config.xero_client_id}:${config.xero_client_secret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("Token exchange failed:", errText);
        return new Response(JSON.stringify({ error: "Token exchange failed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenData = await tokenRes.json();

      await upsertConfig(sql, "xero_access_token", tokenData.access_token);
      await upsertConfig(sql, "xero_refresh_token", tokenData.refresh_token);

      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!connRes.ok) {
        const errText = await connRes.text();
        console.error("Connections fetch failed:", errText);
        return new Response(JSON.stringify({ error: "Failed to fetch Xero connections" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const connections = await connRes.json();
      if (connections.length > 0) {
        await upsertConfig(sql, "xero_tenant_id", connections[0].tenantId);
      }

      return new Response(JSON.stringify({ success: true, tenant: connections[0]?.tenantName || "Connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: status
    if (action === "status") {
      const config = await getConfigMap(
        sql,
        ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_tenant_id"],
      );
      const connected = !!(config.xero_access_token && config.xero_tenant_id);

      return new Response(
        JSON.stringify({
          connected,
          hasCredentials: !!(config.xero_client_id && config.xero_client_secret),
          tenantId: config.xero_tenant_id || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "sync-invoice-receipt" || action === "list-invoice-receipts") {
      const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
      if (!invoiceId) {
        return new Response(JSON.stringify({ error: "Missing invoice_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const invoiceRows = await sql.query(
        `SELECT id, invoice_number, contact_name, invoice_date, reference, total, line_items, submitted_by_name, currency, receipt_pdf_url, status
         FROM invoices
         WHERE id = $1
         LIMIT 1`,
        [invoiceId],
      );
      const invoiceRecord = invoiceRows[0];
      if (!invoiceRecord) {
        return new Response(JSON.stringify({ error: "Invoice not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const invoiceNumber = (invoiceRecord.invoice_number as string | null) || "";

      // For pure list action, just return existing rows without hitting Xero
      // (unless there are none yet — then fall through to sync).
      if (action === "list-invoice-receipts") {
        const existing = await listInvoicePayments(sql, invoiceId);
        if (existing.length > 0) {
          return new Response(JSON.stringify({
            success: true,
            receipts: existing,
            status: invoiceRecord.status,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // else fall through to sync
      }

      if (!invoiceNumber) {
        return new Response(JSON.stringify({ error: "Invoice number is missing" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const config = await getConfigMap(
        sql,
        [
          "xero_client_id",
          "xero_client_secret",
          "xero_access_token",
          "xero_refresh_token",
          "xero_tenant_id",
          "logo_url",
          "company_name",
          "company_ssm",
          "company_address",
        ],
      );

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;
      let lookup = await fetchXeroInvoiceByNumber(invoiceNumber, accessToken, config.xero_tenant_id);
      if (lookup.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect." }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;
        lookup = await fetchXeroInvoiceByNumber(invoiceNumber, accessToken, config.xero_tenant_id);
      }

      if (!lookup.invoice) {
        return new Response(JSON.stringify({ error: "Invoice not found in Xero" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const xeroInvoice = lookup.invoice as Record<string, unknown>;
      const xeroStatus = ((xeroInvoice.Status as string) || "").toUpperCase();
      const amountPaid = Number(xeroInvoice.AmountPaid ?? 0);
      const amountDue = Number(xeroInvoice.AmountDue ?? 0);
      const isPartial = amountPaid > 0 && amountDue > 0;
      const isPaid = xeroStatus === "PAID" || (amountPaid > 0 && amountDue <= 0);

      if (!isPartial && !isPaid) {
        return new Response(JSON.stringify({ error: "No payment has been recorded for this invoice yet" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await reconcileInvoicePayments({
        sql,
        invoiceId,
        invoiceRecord: {
          id: invoiceId,
          invoice_number: invoiceNumber,
          contact_name: (invoiceRecord.contact_name as string) || "—",
          invoice_date: (invoiceRecord.invoice_date as string) || "—",
          reference: (invoiceRecord.reference as string | null) || null,
          total: Number(invoiceRecord.total || 0),
          line_items: Array.isArray(invoiceRecord.line_items) ? invoiceRecord.line_items : [],
          submitted_by_name: (invoiceRecord.submitted_by_name as string) || "—",
          currency: (invoiceRecord.currency as string | null) || "RM",
        },
        xeroInvoice,
        branding: {
          logoUrl: config.logo_url || null,
          companyName: config.company_name || null,
          companySsm: config.company_ssm || null,
          companyAddress: config.company_address || null,
        },
      });

      const newStatus = result.isFullyPaid ? "paid" : "partially_paid";
      if (newStatus === "paid") {
        await sql.query(
          `UPDATE invoices
           SET status = $2,
               receipt_pdf_url = COALESCE($3, receipt_pdf_url),
               amendment_status = NULL,
               amendment_data = NULL,
               amendment_note = NULL,
               amendment_requested_by = NULL,
               amendment_requested_by_name = NULL,
               amendment_requested_at = NULL
           WHERE id = $1`,
          [invoiceId, newStatus, result.latestReceiptPath],
        );
      } else {
        await sql.query(
          `UPDATE invoices SET status = $2, receipt_pdf_url = COALESCE($3, receipt_pdf_url) WHERE id = $1`,
          [invoiceId, newStatus, result.latestReceiptPath],
        );
      }

      return new Response(JSON.stringify({
        success: true,
        receipts: result.rows,
        receipt_pdf_url: result.latestReceiptPath,
        status: newStatus,
        amount_paid: amountPaid,
        amount_due: amountDue,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // ACTION: disconnect
    if (action === "disconnect") {
      await upsertConfig(sql, "xero_access_token", "");
      await upsertConfig(sql, "xero_refresh_token", "");
      await upsertConfig(sql, "xero_tenant_id", "");

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: contacts
    if (action === "contacts") {
      const config = await getConfigMap(
        sql,
        ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_refresh_token", "xero_tenant_id"],
      );

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected", contacts: [] }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;

      let contactsRes = await fetch(`${XERO_API_URL}/Contacts?where=ContactStatus=="ACTIVE"&order=Name`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": config.xero_tenant_id,
          Accept: "application/json",
        },
      });

      if (contactsRes.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect.", contacts: [] }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;

        contactsRes = await fetch(`${XERO_API_URL}/Contacts?where=ContactStatus=="ACTIVE"&order=Name`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-Tenant-Id": config.xero_tenant_id,
            Accept: "application/json",
          },
        });
      }

      if (!contactsRes.ok) {
        const errText = await contactsRes.text();
        console.error("Xero contacts fetch failed:", errText);
        return new Response(JSON.stringify({ error: "Failed to fetch contacts", contacts: [] }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await contactsRes.json();
      const contacts = (data.Contacts || []).map((c: any) => {
        const emails: string[] = [];
        const seen = new Set<string>();
        const pushEmail = (e: unknown) => {
          if (typeof e !== "string") return;
          const trimmed = e.trim();
          if (!trimmed) return;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          emails.push(trimmed);
        };
        pushEmail(c.EmailAddress);
        if (Array.isArray(c.ContactPersons)) {
          for (const p of c.ContactPersons) pushEmail(p?.EmailAddress);
        }
        return {
          id: c.ContactID,
          name: c.Name,
          emails,
        };
      });

      return new Response(JSON.stringify({ contacts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: invoice-reminders (GET /InvoiceReminders/Settings)
    if (action === "invoice-reminders") {
      const config = await getConfigMap(
        sql,
        ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_refresh_token", "xero_tenant_id"],
      );

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected", enabled: null }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;
      const doFetch = (token: string) => fetch(`${XERO_API_URL}/InvoiceReminders/Settings`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Xero-Tenant-Id": config.xero_tenant_id,
          Accept: "application/json",
        },
      });

      let res = await doFetch(accessToken);
      if (res.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect.", enabled: null }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;
        res = await doFetch(accessToken);
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error("Xero invoice reminders fetch failed:", errText);
        return new Response(JSON.stringify({ error: "Failed to fetch invoice reminders settings", enabled: null }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await res.json();
      const settings = Array.isArray(data?.InvoiceReminders) ? data.InvoiceReminders[0] : null;
      const enabled = settings ? !!settings.Enabled : null;

      return new Response(JSON.stringify({ enabled, settings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: tracking-categories
    if (action === "tracking-categories") {
      const config = await getConfigMap(
        sql,
        ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_refresh_token", "xero_tenant_id"],
      );

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected", categories: [] }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;

      let res = await fetch(`${XERO_API_URL}/TrackingCategories`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": config.xero_tenant_id,
          Accept: "application/json",
        },
      });

      if (res.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect.", categories: [] }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;
        res = await fetch(`${XERO_API_URL}/TrackingCategories`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-Tenant-Id": config.xero_tenant_id,
            Accept: "application/json",
          },
        });
      }

      if (!res.ok) {
        console.error("Xero tracking categories fetch failed:", await res.text());
        return new Response(JSON.stringify({ error: "Failed to fetch tracking categories", categories: [] }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await res.json();
      const categories = (data.TrackingCategories || []).map((tc: any) => ({
        id: tc.TrackingCategoryID,
        name: tc.Name,
        options: (tc.Options || []).map((o: any) => ({
          id: o.TrackingOptionID,
          name: o.Name,
          status: o.Status,
        })),
      }));

      return new Response(JSON.stringify({ categories }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: accounts (chart of accounts)
    if (action === "accounts") {
      const config = await getConfigMap(
        sql,
        ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_refresh_token", "xero_tenant_id"],
      );

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected", accounts: [] }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;

      let res = await fetch(`${XERO_API_URL}/Accounts?where=Status=="ACTIVE"&order=Code`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": config.xero_tenant_id,
          Accept: "application/json",
        },
      });

      if (res.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect.", accounts: [] }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;
        res = await fetch(`${XERO_API_URL}/Accounts?where=Status=="ACTIVE"&order=Code`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-Tenant-Id": config.xero_tenant_id,
            Accept: "application/json",
          },
        });
      }

      if (!res.ok) {
        console.error("Xero accounts fetch failed:", await res.text());
        return new Response(JSON.stringify({ error: "Failed to fetch accounts", accounts: [] }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await res.json();
      const accounts = (data.Accounts || []).map((a: any) => ({
        code: a.Code,
        name: a.Name,
        type: a.Type,
      }));

      return new Response(JSON.stringify({ accounts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: list-xero-contacts — paginated/searchable contacts list (external API friendly)
    if (action === "list-xero-contacts") {
      const config = await getConfigMap(
        sql,
        ["xero_access_token", "xero_refresh_token", "xero_client_id", "xero_client_secret", "xero_tenant_id"],
      );
      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected", contacts: [] }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const search = typeof body.search === "string" ? body.search.trim() : "";
      const page = Number(body.page) > 0 ? Number(body.page) : 1;

      let where = `ContactStatus=="ACTIVE"`;
      if (search) {
        const safe = search.replace(/"/g, '\\"');
        where += ` AND Name!=null AND Name.Contains("${safe}")`;
      }
      const url = `${XERO_API_URL}/Contacts?where=${encodeURIComponent(where)}&order=Name&page=${page}`;

      let accessToken = config.xero_access_token;
      let res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, "Xero-Tenant-Id": config.xero_tenant_id, Accept: "application/json" },
      });
      if (res.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect.", contacts: [] }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, "Xero-Tenant-Id": config.xero_tenant_id, Accept: "application/json" },
        });
      }
      if (!res.ok) {
        console.error("Xero list-xero-contacts failed:", await res.text());
        return new Response(JSON.stringify({ error: "Failed to fetch contacts", contacts: [] }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await res.json();
      const contacts = (data.Contacts || []).map((c: any) => ({
        id: c.ContactID,
        name: c.Name,
        email: c.EmailAddress || null,
        status: c.ContactStatus,
      }));
      return new Response(JSON.stringify({ contacts, page }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: create-xero-contact — find-or-create a Xero contact by name
    if (action === "create-xero-contact") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing contact name" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
      const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";

      const config = await getConfigMap(
        sql,
        ["xero_access_token", "xero_refresh_token", "xero_client_id", "xero_client_secret", "xero_tenant_id"],
      );
      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;

      const safeName = name.replace(/"/g, '\\"');
      const lookupUrl = `${XERO_API_URL}/Contacts?where=${encodeURIComponent(`Name=="${safeName}"`)}`;
      const doFetch = (u: string, init?: RequestInit) => fetch(u, {
        ...(init || {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": config.xero_tenant_id,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });

      let lookup = await doFetch(lookupUrl);
      if (lookup.status === 401) {
        const refreshed = await refreshAccessToken(sql, config);
        if (!refreshed) {
          return new Response(JSON.stringify({ error: "Xero token expired. Please reconnect." }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = refreshed.access_token;
        lookup = await doFetch(lookupUrl);
      }
      if (lookup.ok) {
        const lj = await lookup.json();
        const existing = (lj.Contacts || [])[0];
        if (existing) {
          return new Response(JSON.stringify({
            contact: { id: existing.ContactID, name: existing.Name, email: existing.EmailAddress || null },
            created: false,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      const payload: Record<string, unknown> = { Name: name };
      if (email) payload.EmailAddress = email;
      if (firstName) payload.FirstName = firstName;
      if (lastName) payload.LastName = lastName;

      const createRes = await doFetch(`${XERO_API_URL}/Contacts`, {
        method: "POST",
        body: JSON.stringify({ Contacts: [payload] }),
      });
      if (createRes.status === 401 || createRes.status === 403) {
        const errText = await createRes.text();
        console.error("Xero create-xero-contact unauthorized:", errText);
        const refreshed = await refreshAccessToken(sql, config);
        if (refreshed) {
          accessToken = refreshed.access_token;
          const retryRes = await doFetch(`${XERO_API_URL}/Contacts`, {
            method: "POST",
            body: JSON.stringify({ Contacts: [payload] }),
          });
          if (retryRes.ok) {
            const cj = await retryRes.json();
            const created = (cj.Contacts || [])[0];
            return new Response(JSON.stringify({
              contact: created ? { id: created.ContactID, name: created.Name, email: created.EmailAddress || null } : null,
              created: true,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          const retryErrText = await retryRes.text();
          console.error("Xero create-xero-contact retry failed:", retryErrText);
        }
        return new Response(JSON.stringify({
          error: "Xero connection is missing contact write permission. Please reconnect Xero from Global Config, then try again.",
          code: "xero_contact_write_permission_missing",
          detail: errText,
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error("Xero create-xero-contact failed:", errText);
        return new Response(JSON.stringify({ error: "Failed to create contact", detail: errText }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cj = await createRes.json();
      const created = (cj.Contacts || [])[0];
      return new Response(JSON.stringify({
        contact: created ? { id: created.ContactID, name: created.Name, email: created.EmailAddress || null } : null,
        created: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Xero function error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
