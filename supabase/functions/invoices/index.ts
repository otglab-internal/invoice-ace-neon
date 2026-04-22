import { neon } from "npm:@neondatabase/serverless";
import { getSmtpConfig, getSandboxTestEmail, sendEmailViaSMTP, buildApprovalEmailHtml, buildApprovedEmailHtml } from "../_shared/email-utils.ts";
import { buildPdfAttachment, fetchPdfBase64FromR2 } from "../_shared/pdf-artifacts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function getDb(req: Request, orgId?: string) {
  const env = req.headers.get("x-environment") || "development";
  const isProd = env === "production";
  const org = orgId || req.headers.get("x-org-id") || "";
  const mapping = ORG_DB_MAP[org];

  let url: string | undefined;
  if (mapping) {
    url = Deno.env.get(isProd ? mapping.prod : mapping.sb);
  }
  if (!url) {
    url = isProd ? Deno.env.get("DATABASE_URL_PROD") : Deno.env.get("DATABASE_URL_DEV");
  }
  if (!url) {
    throw new Error(`No database connection configured for org="${org}" env="${env}"`);
  }
  return neon(url);
}

// Verify JWT from auth function
async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  try {
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const enc = new TextEncoder();
    const [header, body, signature] = token.split(".");

    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const sigStr = signature.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sigStr + "=".repeat((4 - (sigStr.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(`${header}.${body}`));
    if (!valid) return null;

    const bodyStr = body.replace(/-/g, "+").replace(/_/g, "/");
    const bodyPadded = bodyStr + "=".repeat((4 - (bodyStr.length % 4)) % 4);
    const payload = JSON.parse(atob(bodyPadded));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function authenticate(req: Request): Promise<Record<string, unknown> | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return verifyJwt(authHeader.replace("Bearer ", ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, org_id: bodyOrgId, ...body } = await req.json();

    // api-submit — external system invoice push (no auth required)
    if (action === "api-submit") {
      const { system_id, user_id, user_name, user_email, contact_id, contact_name, invoice_date, reference, line_items, source_system, source_system_name, callback_url, currency: bodyCurrency } = body;
      // External API submissions are always treated as free-text — templates are a UI-only concept.
      const template_id = null;

      // Currency: accept SGD or MYR (case-insensitive). Normalize to canonical storage form
      // matching the global setting style ("SGD$" or "RM"). If omitted, fall back to global_config.
      let resolvedCurrency: string | null = null;
      if (bodyCurrency !== undefined && bodyCurrency !== null && bodyCurrency !== "") {
        const raw = String(bodyCurrency).trim().toUpperCase().replace(/[^A-Z]/g, "");
        if (raw === "SGD") resolvedCurrency = "SGD$";
        else if (raw === "MYR" || raw === "RM") resolvedCurrency = "RM";
        else {
          return new Response(JSON.stringify({ error: "currency must be 'SGD' or 'MYR'" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Validate callback_url if provided — must be http(s)
      const callbackUrlClean = typeof callback_url === "string" ? callback_url.trim() : "";
      if (callbackUrlClean && !/^https?:\/\//i.test(callbackUrlClean)) {
        return new Response(JSON.stringify({ error: "callback_url must start with http:// or https://" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Normalise source identifiers (external system that pushed this invoice, e.g. "OPENTEXT-001" / "Open Text")
      const sourceSystemId = typeof source_system === "string" ? source_system.trim() : "";
      const sourceSystemName = typeof source_system_name === "string" ? source_system_name.trim() : "";
      const sourceLabel = sourceSystemName || sourceSystemId || "";

      const missing: string[] = [];
      if (!system_id) missing.push("system_id");
      if (!user_id) missing.push("user_id");
      if (!contact_name) missing.push("contact_name");
      if (!invoice_date) missing.push("invoice_date");
      if (!line_items || !Array.isArray(line_items) || line_items.length === 0) missing.push("line_items");

      if (missing.length > 0) {
        return new Response(JSON.stringify({ error: `Missing required fields: ${missing.join(", ")}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Normalize line items to match in-app invoice JSON shape: in-app uses `account`
      // (the Xero account code) while external API callers historically send `account_code`
      // or `accountCode`. Standardize on `account` and drop the alternates so downstream
      // payloads (n8n -> Xero) are identical to in-app invoices.
      for (const li of line_items) {
        if (li && typeof li === "object") {
          const acct = li.account ?? li.account_code ?? li.accountCode ?? "";
          li.account = typeof acct === "string" ? acct : String(acct ?? "");
          delete li.account_code;
          delete li.accountCode;
        }
      }

      const total = line_items.reduce((sum: number, li: any) => sum + (Number(li.quantity) || 0) * (Number(li.cost) || 0), 0);
      const orgIdResolved = bodyOrgId || req.headers.get("x-org-id") || "";
      const envResolved = req.headers.get("x-environment") || "production";

      // Validate org explicitly so external callers get a clear 400 instead of a generic 500
      if (!orgIdResolved || !ORG_DB_MAP[orgIdResolved]) {
        return new Response(JSON.stringify({
          error: `Missing or unknown org. Pass "org_id" in the body (or "x-org-id" header). Allowed values: ${Object.keys(ORG_DB_MAP).join(", ")}.`,
          received_org_id: orgIdResolved || null,
          received_environment: envResolved,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let dbSql;
      try {
        dbSql = getDb(req, orgIdResolved);
      } catch (dbErr) {
        console.error("api-submit: getDb failed:", dbErr);
        return new Response(JSON.stringify({
          error: `Database not configured for org="${orgIdResolved}" env="${envResolved}".`,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // --- Resolve submitter email ---
      // Priority: explicit user_email in payload → live get-users-proxy lookup by system_id.
      // Never insert with empty email — payment notifications depend on it.
      let resolvedEmail = (typeof user_email === "string" ? user_email.trim() : "");
      const baseName = (typeof user_name === "string" ? user_name.trim() : "") || `API:${user_id}`;
      let resolvedName = baseName;

      if (!resolvedEmail || !user_name) {
        try {
          const proxyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/get-users-proxy?environment=${encodeURIComponent(envResolved)}&org_id=${encodeURIComponent(orgIdResolved)}`;
          const proxyRes = await fetch(proxyUrl, {
            headers: {
              apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
              "x-org-id": orgIdResolved,
              "x-environment": envResolved,
            },
          });
          if (proxyRes.ok) {
            const json = await proxyRes.json();
            const users = Array.isArray(json?.data) ? json.data : [];
            const match = users.find((u: any) => u?.id === system_id);
            if (match) {
              if (!resolvedEmail && typeof match.email === "string") resolvedEmail = match.email.trim();
              if (!user_name && typeof match.name === "string" && match.name.trim()) resolvedName = match.name.trim();
            }
          } else {
            console.warn(`api-submit: get-users-proxy returned ${proxyRes.status}`);
          }
        } catch (lookupErr) {
          console.error("api-submit: user lookup failed:", lookupErr);
        }
      }

      if (!resolvedEmail) {
        return new Response(JSON.stringify({
          error: "Could not resolve submitter email. Pass user_email in the payload or ensure system_id has a registered email in the auth system.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // --- Determine requires_approval (honor user flags + template) ---
      let requiresApproval = false;
      try {
        const flagRows = await dbSql`SELECT requires_approval FROM user_approval_flags WHERE system_id = ${system_id} LIMIT 1`;
        if (flagRows[0]?.requires_approval === true) requiresApproval = true;
      } catch (e) {
        console.warn("api-submit: user_approval_flags lookup failed:", e);
      }
      if (!requiresApproval && template_id) {
        try {
          const tplRows = await dbSql`SELECT requires_approval FROM invoice_templates WHERE id = ${template_id} LIMIT 1`;
          if (tplRows[0]?.requires_approval === true) requiresApproval = true;
        } catch (e) {
          console.warn("api-submit: invoice_templates lookup failed:", e);
        }
      }
      const initialStatus = requiresApproval ? "pending_approval" : "approved";

      // Append source-system suffix to submitter name so it's visible everywhere the name shows up
      const finalSubmitterName = sourceLabel ? `${resolvedName} (via ${sourceLabel})` : resolvedName;

      // Make sure the callback_url + currency columns exist (older tenant DBs may predate them).
      try { await dbSql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS callback_url TEXT`; } catch (e) { console.warn("api-submit: ensure callback_url column failed:", e); }
      try { await dbSql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT`; } catch (e) { console.warn("api-submit: ensure currency column failed:", e); }

      // If caller did not specify currency, fall back to org's global_config.currency (or "RM")
      if (!resolvedCurrency) {
        try {
          const cfgRows = await dbSql`SELECT value FROM global_config WHERE key = 'currency' LIMIT 1`;
          const cfgVal = (cfgRows[0]?.value || "").toString().trim();
          resolvedCurrency = cfgVal || "RM";
        } catch (e) {
          console.warn("api-submit: currency global_config lookup failed:", e);
          resolvedCurrency = "RM";
        }
      }

      const result = await dbSql`
        INSERT INTO invoices (contact_id, contact_name, invoice_date, reference, line_items, total, submitted_by_system_id, submitted_by_name, submitted_by_email, template_id, requires_approval, status, callback_url, currency)
        VALUES (${contact_id || '__new__'}, ${contact_name}, ${invoice_date}, ${reference || ''}, ${JSON.stringify(line_items)}::jsonb, ${total}, ${system_id}, ${finalSubmitterName}, ${resolvedEmail}, ${template_id || null}, ${requiresApproval}, ${initialStatus}, ${callbackUrlClean || null}, ${resolvedCurrency})
        RETURNING *
      `;
      const created = result[0];

      // Log — include source system info in details so audit trail captures origin
      const logDetails = {
        ...created,
        source_system: sourceSystemId || null,
        source_system_name: sourceSystemName || null,
      };
      await dbSql`
        INSERT INTO invoice_logs (invoice_id, action_type, source, performed_by, performed_by_name, details)
        VALUES (${created.id}, ${'request'}, ${sourceLabel ? `api:${sourceSystemId || sourceSystemName}` : 'api'}, ${user_id}, ${'API:' + user_id}, ${JSON.stringify(logDetails)}::jsonb)
      `;

      // If auto-approved (no approval required), fire n8n webhook immediately so Xero
      // gets the invoice with the correct currency. Without this, api-submit auto-approved
      // invoices never reach Xero through the n8n flow.
      if (!created.requires_approval && created.status === "approved") {
        const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL");
        if (n8nWebhookUrl) {
          try {
            const rawCurrency = (created.currency ?? "RM").toString();
            const currencyCode = rawCurrency.replace(/[^A-Za-z]/g, "").toUpperCase() || "RM";
            const enriched = {
              ...created,
              currency: currencyCode,
              line_items: (created.line_items || []).map((li: any) => ({
                ...li,
                line_amount: (Number(li.quantity) || 0) * (Number(li.cost) || 0),
              })),
            };
            await fetch(n8nWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: "invoice_approved",
                invoice: enriched,
                approved_by: "api",
                approved_at: created.created_at,
                org_id: orgIdResolved,
                environment: envResolved,
                supabase_anon_key: Deno.env.get("SUPABASE_ANON_KEY"),
                supabase_url: Deno.env.get("SUPABASE_URL"),
              }),
            });
            console.log(`api-submit: n8n webhook fired for auto-approved invoice ${created.id} (currency=${currencyCode})`);
          } catch (webhookErr) {
            console.error("api-submit: n8n webhook call failed:", webhookErr);
          }
        }
      }

      // Send approval notice emails to configured addresses
      if (created.requires_approval) {
        try {
          const approvalNoticeRows = await dbSql`SELECT value FROM global_config WHERE key = 'approval_notice_emails' LIMIT 1`;
          const approvalNoticeEmails = (approvalNoticeRows[0]?.value || "").split(",").map((e: string) => e.trim()).filter(Boolean);
          
          if (approvalNoticeEmails.length > 0) {
            const smtpConfig = await getSmtpConfig(dbSql);
            if (smtpConfig) {
              // Sandbox override
              const environment = req.headers.get("x-environment") || "production";
              const sandboxEmail = environment === "sandbox" ? await getSandboxTestEmail(dbSql) : null;
              const recipients = sandboxEmail ? [sandboxEmail] : approvalNoticeEmails;
              
              const htmlBody = buildApprovalEmailHtml(created);
              await sendEmailViaSMTP(smtpConfig, recipients, `Invoice Requires Approval – ${created.contact_name}`, htmlBody);
              
              // Log email sent
              await dbSql`
                INSERT INTO activity_logs (action_type, category, performed_by, performed_by_name, details)
                VALUES ('email_sent', 'email', 'system', 'System', ${JSON.stringify({
                  type: 'approval_notice',
                  recipients,
                  invoice_id: created.id,
                  contact_name: created.contact_name,
                  total: created.total,
                })}::jsonb)
              `;
              console.log(`invoices: Approval notice email sent to ${recipients.join(", ")} for invoice ${created.id}`);
            }
          }
        } catch (emailErr) {
          console.error("invoices: Failed to send approval notice email:", emailErr);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        invoice_id: created.id,
        status: created.status,
        requires_approval: created.requires_approval,
        total: created.total,
      }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // api-get — external system invoice fetch (no auth required, mirrors api-submit)
    // Returns invoice metadata + INV PDF as base64 inline.
    // Receipt PDFs are generated client-side only and never persisted, so they are not returned.
    if (action === "api-get") {
      const { invoice_id } = body;

      if (!invoice_id || typeof invoice_id !== "string") {
        return new Response(JSON.stringify({
          error: "Missing required field: invoice_id (the UUID returned by api-submit)",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const orgIdResolved = bodyOrgId || req.headers.get("x-org-id") || "";
      const envResolved = req.headers.get("x-environment") || "production";

      if (!orgIdResolved || !ORG_DB_MAP[orgIdResolved]) {
        return new Response(JSON.stringify({
          error: `Missing or unknown org. Pass "org_id" in the body (or "x-org-id" header). Allowed values: ${Object.keys(ORG_DB_MAP).join(", ")}.`,
          received_org_id: orgIdResolved || null,
          received_environment: envResolved,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let dbSql;
      try {
        dbSql = getDb(req, orgIdResolved);
      } catch (dbErr) {
        console.error("api-get: getDb failed:", dbErr);
        return new Response(JSON.stringify({
          error: `Database not configured for org="${orgIdResolved}" env="${envResolved}".`,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = await dbSql`SELECT * FROM invoices WHERE id = ${invoice_id} LIMIT 1`;
      if (!rows[0]) {
        return new Response(JSON.stringify({ error: `Invoice not found: ${invoice_id}` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const invoice = rows[0];

      const invoicePdfResult = await fetchPdfBase64FromR2(invoice.invoice_pdf_url || null);
      const receiptPdfResult = await fetchPdfBase64FromR2(invoice.receipt_pdf_url || null);

      return new Response(JSON.stringify({
        success: true,
        invoice: {
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
        },
        invoice_pdf: buildPdfAttachment(`${invoice.invoice_number || invoice.id}.pdf`, invoicePdfResult.base64),
        invoice_pdf_error: invoicePdfResult.error,
        receipt_pdf: buildPdfAttachment(`Receipt_${invoice.invoice_number || invoice.id}.pdf`, receiptPdfResult.base64),
        receipt_pdf_error: receiptPdfResult.error,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // notify-approval — webhook proxy
    if (action === "notify-approval") {
      const { invoice } = body;
      const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL");

      if (!n8nWebhookUrl) {
        return new Response(JSON.stringify({ error: "N8N_WEBHOOK_URL not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        // Strip non-letter symbols from currency code for n8n/Xero (e.g. "SGD$" -> "SGD", "RM" -> "RM").
        const rawCurrency = (invoice?.currency ?? "RM").toString();
        const currencyCode = rawCurrency.replace(/[^A-Za-z]/g, "").toUpperCase() || "RM";

        // Enrich line items with line_amount
        const enrichedInvoice = {
          ...invoice,
          currency: currencyCode,
          line_items: (invoice?.line_items || []).map((li: any) => ({
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
            approved_by: invoice?.approved_by,
            approved_at: invoice?.approved_at,
            org_id: req.headers.get("x-org-id") || body.org_id || "",
            environment: req.headers.get("x-environment") || "production",
          }),
        });

        const responseStatus = webhookResponse.status;
        const responseBody = await webhookResponse.text();

        if (!webhookResponse.ok) {
          console.error("n8n webhook returned non-2xx", { responseStatus, responseBody });
          return new Response(JSON.stringify({
            error: `n8n webhook returned ${responseStatus}`,
            webhookStatus: responseStatus,
            webhookBody: responseBody,
          }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true, webhookStatus: responseStatus }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (webhookErr) {
        console.error("n8n webhook call failed:", webhookErr);
        return new Response(JSON.stringify({ error: "Webhook call failed" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // send-approval-email — re-enabled, sends to configured approval_notice_emails
    if (action === "send-approval-email") {
      const { invoice } = body;
      const orgId = bodyOrgId || req.headers.get("x-org-id") || "";
      const environment = req.headers.get("x-environment") || "production";
      const dbSql = getDb(req, orgId);

      try {
        const approvalNoticeRows = await dbSql`SELECT value FROM global_config WHERE key = 'approval_notice_emails' LIMIT 1`;
        const approvalNoticeEmails = (approvalNoticeRows[0]?.value || "").split(",").map((e: string) => e.trim()).filter(Boolean);

        if (approvalNoticeEmails.length === 0) {
          return new Response(JSON.stringify({ success: true, message: "No approval notice emails configured" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const smtpConfig = await getSmtpConfig(dbSql);
        if (!smtpConfig) {
          return new Response(JSON.stringify({ success: true, message: "SMTP not configured" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const sandboxEmail = environment === "sandbox" ? await getSandboxTestEmail(dbSql) : null;
        const recipients = sandboxEmail ? [sandboxEmail] : approvalNoticeEmails;

        const htmlBody = buildApprovalEmailHtml(invoice);
        await sendEmailViaSMTP(smtpConfig, recipients, `Invoice Requires Approval – ${invoice.contact_name || "N/A"}`, htmlBody);

        await dbSql`
          INSERT INTO activity_logs (action_type, category, performed_by, performed_by_name, details)
          VALUES ('email_sent', 'email', 'system', 'System', ${JSON.stringify({
            type: 'approval_notice',
            recipients,
            invoice_id: invoice.id,
            contact_name: invoice.contact_name,
          })}::jsonb)
        `;

        return new Response(JSON.stringify({ success: true, sent_to: recipients }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (emailErr) {
        console.error("invoices: send-approval-email error:", emailErr);
        return new Response(JSON.stringify({ error: String(emailErr) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // send-approved-email — sends to configured approved_invoice_emails after approval
    if (action === "send-approved-email") {
      const { invoice } = body;
      const orgId = bodyOrgId || req.headers.get("x-org-id") || "";
      const environment = req.headers.get("x-environment") || "production";
      const dbSql = getDb(req, orgId);

      console.log(`invoices: [SEND-APPROVED-EMAIL] Starting for invoice ${invoice?.id}, org=${orgId}, env=${environment}`);

      try {
        const approvedEmailRows = await dbSql`SELECT value FROM global_config WHERE key = 'approved_invoice_emails' LIMIT 1`;
        console.log(`invoices: [SEND-APPROVED-EMAIL] approved_invoice_emails config:`, JSON.stringify(approvedEmailRows));
        const approvedEmails = (approvedEmailRows[0]?.value || "").split(",").map((e: string) => e.trim()).filter(Boolean);

        if (approvedEmails.length === 0) {
          console.warn(`invoices: [SEND-APPROVED-EMAIL] No approved_invoice_emails configured`);
          return new Response(JSON.stringify({ success: true, message: "No approved invoice emails configured" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const smtpConfig = await getSmtpConfig(dbSql);
        console.log(`invoices: [SEND-APPROVED-EMAIL] SMTP config found: ${smtpConfig ? 'YES' : 'NO'}`);
        if (!smtpConfig) {
          return new Response(JSON.stringify({ success: true, message: "SMTP not configured" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const sandboxEmail = environment === "sandbox" ? await getSandboxTestEmail(dbSql) : null;
        const recipients = sandboxEmail ? [sandboxEmail] : approvedEmails;
        console.log(`invoices: [SEND-APPROVED-EMAIL] Sending to:`, recipients);

        const htmlBody = buildApprovedEmailHtml(invoice);
        await sendEmailViaSMTP(smtpConfig, recipients, `Invoice Approved – ${invoice.contact_name || "N/A"}`, htmlBody);
        console.log(`invoices: [SEND-APPROVED-EMAIL] Email sent successfully`);

        await dbSql`
          INSERT INTO activity_logs (action_type, category, performed_by, performed_by_name, details, org_id, environment)
          VALUES ('email_sent', 'email', 'system', 'System', ${JSON.stringify({
            type: 'approved_invoice',
            recipients,
            invoice_id: invoice.id,
            contact_name: invoice.contact_name,
            total: invoice.total,
          })}::jsonb, ${orgId}, ${environment})
        `;

        return new Response(JSON.stringify({ success: true, sent_to: recipients }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (emailErr) {
        console.error("invoices: [SEND-APPROVED-EMAIL] error:", emailErr);
        return new Response(JSON.stringify({ error: String(emailErr) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // All other actions require authentication
    const claims = await authenticate(req);
    if (!claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sql = getDb(req, bodyOrgId);
    const userId = claims.sub as string;

    // ACTION: create
    if (action === "create") {
      const { contactId, contactName, contactMode, description, quantity, cost, accountCode, centerId, descriptionMode, studentName, age, packageName, firstLesson } = body;

      let finalContactId = contactId;
      if (contactMode === "new" && contactName) {
        const result = await sql`INSERT INTO contacts (name, created_by) VALUES (${contactName}, ${userId}) RETURNING id`;
        finalContactId = result[0].id;
      }

      const result = await sql`
        INSERT INTO invoices (contact_id, contact_name, invoice_date, reference, line_items, total, submitted_by_system_id, submitted_by_name, status, requires_approval)
        VALUES (${finalContactId}, ${contactName || ''}, ${body.invoice_date || new Date().toISOString().split('T')[0]}, ${body.reference || ''}, ${JSON.stringify(body.line_items || [])}::jsonb, ${body.total || 0}, ${userId}, ${body.submitted_by_name || ''}, ${'pending_approval'}, ${true})
        RETURNING *
      `;

      return new Response(JSON.stringify({ invoice: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: list
    if (action === "list") {
      const { status, limit = 50, offset = 0 } = body;
      let invoices;
      if (status) {
        invoices = await sql`SELECT * FROM invoices WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      } else {
        invoices = await sql`SELECT * FROM invoices ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      }
      return new Response(JSON.stringify({ invoices }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: get
    if (action === "get") {
      const { invoiceId } = body;
      const result = await sql`SELECT * FROM invoices WHERE id = ${invoiceId} LIMIT 1`;
      if (result.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ invoice: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: approve
    if (action === "approve") {
      const { invoiceId, notes } = body;
      const role = claims.role as string;
      if (role !== "accountant" && role !== "admin") {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await sql`
        UPDATE invoices SET status = 'approved', approval_note = ${notes || null}, approved_by = ${userId}, approved_at = NOW()
        WHERE id = ${invoiceId} AND status = 'pending_approval' RETURNING *
      `;
      if (result.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found or already processed" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const approvedInvoice = result[0];
      const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL");
      if (n8nWebhookUrl) {
        try {
          // Strip non-letter symbols from currency code for n8n/Xero (e.g. "SGD$" -> "SGD").
          const rawApprovedCurrency = (approvedInvoice.currency ?? "RM").toString();
          const approvedCurrencyCode = rawApprovedCurrency.replace(/[^A-Za-z]/g, "").toUpperCase() || "RM";
          const enrichedApproved = {
            ...approvedInvoice,
            currency: approvedCurrencyCode,
            line_items: (approvedInvoice.line_items || []).map((li: any) => ({
              ...li,
              line_amount: (Number(li.quantity) || 0) * (Number(li.cost) || 0),
            })),
          };
          await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "invoice_approved", invoice: enrichedApproved, approved_by: userId, approved_at: approvedInvoice.approved_at, org_id: req.headers.get("x-org-id") || body.org_id || "", environment: req.headers.get("x-environment") || "production", supabase_anon_key: Deno.env.get("SUPABASE_ANON_KEY"), supabase_url: Deno.env.get("SUPABASE_URL") }),
          });
        } catch (webhookErr) {
          console.error("n8n webhook call failed:", webhookErr);
        }
      }

      // Send approved invoice notification email
      console.log(`invoices: [APPROVE] Starting email notification flow for invoice ${approvedInvoice.id}`);
      try {
        const approvedEmailRows = await sql`SELECT value FROM global_config WHERE key = 'approved_invoice_emails' LIMIT 1`;
        console.log(`invoices: [APPROVE] approved_invoice_emails config row:`, JSON.stringify(approvedEmailRows));
        const approvedEmails = (approvedEmailRows[0]?.value || "").split(",").map((e: string) => e.trim()).filter(Boolean);
        console.log(`invoices: [APPROVE] Parsed email recipients:`, approvedEmails);

        if (approvedEmails.length > 0) {
          const smtpConfig = await getSmtpConfig(sql);
          console.log(`invoices: [APPROVE] SMTP config found: ${smtpConfig ? 'YES' : 'NO'}`, smtpConfig ? { host: smtpConfig.host, port: smtpConfig.port, from: smtpConfig.from_email } : null);
          if (smtpConfig) {
            const environment = req.headers.get("x-environment") || "production";
            const sandboxEmail = environment === "sandbox" ? await getSandboxTestEmail(sql) : null;
            const recipients = sandboxEmail ? [sandboxEmail] : approvedEmails;
            console.log(`invoices: [APPROVE] Sending to recipients:`, recipients, `(env: ${environment}, sandbox override: ${sandboxEmail})`);

            const htmlBody = buildApprovedEmailHtml(approvedInvoice);
            await sendEmailViaSMTP(smtpConfig, recipients, `Invoice Approved – ${approvedInvoice.contact_name || "N/A"}`, htmlBody);
            console.log(`invoices: [APPROVE] sendEmailViaSMTP completed successfully`);

            await sql`
              INSERT INTO activity_logs (action_type, category, performed_by, performed_by_name, details)
              VALUES ('email_sent', 'email', 'system', 'System', ${JSON.stringify({
                type: 'approved_invoice',
                recipients,
                invoice_id: approvedInvoice.id,
                contact_name: approvedInvoice.contact_name,
                total: approvedInvoice.total,
                approved_by: userId,
              })}::jsonb)
            `;
            console.log(`invoices: [APPROVE] Email activity logged for invoice ${approvedInvoice.id}`);
          } else {
            console.warn(`invoices: [APPROVE] SMTP not configured — skipping email`);
          }
        } else {
          console.warn(`invoices: [APPROVE] No approved_invoice_emails configured — skipping email`);
        }
      } catch (emailErr) {
        console.error("invoices: [APPROVE] Failed to send approved invoice email:", emailErr);
      }

      return new Response(JSON.stringify({ invoice: approvedInvoice }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: reject
    if (action === "reject") {
      const { invoiceId, reason } = body;
      const role = claims.role as string;
      if (role !== "accountant" && role !== "admin") {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await sql`
        UPDATE invoices SET status = 'rejected', approval_note = ${reason || null}, approved_by = ${userId}, approved_at = NOW()
        WHERE id = ${invoiceId} AND status = 'pending_approval' RETURNING *
      `;
      if (result.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found or already processed" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ invoice: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: stats
    if (action === "stats") {
      const result = await sql`
        SELECT COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'pending_approval')::int as pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int as approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected
        FROM invoices
      `;
      return new Response(JSON.stringify({ stats: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: contacts
    if (action === "contacts") {
      const contacts = await sql`SELECT id, name FROM contacts ORDER BY name`;
      return new Response(JSON.stringify({ contacts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Invoices error:", msg, err instanceof Error ? err.stack : "");
    return new Response(JSON.stringify({ error: "Internal server error", detail: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
