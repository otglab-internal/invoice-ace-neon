import { neon } from "npm:@neondatabase/serverless";
import { getSmtpConfig, getSandboxTestEmail, getApproverEmails, sendEmailViaSMTP, buildApprovalEmailHtml } from "../_shared/email-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
      const { system_id, user_id, contact_id, contact_name, invoice_date, reference, line_items } = body;

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

      const total = line_items.reduce((sum: number, li: any) => sum + (Number(li.quantity) || 0) * (Number(li.cost) || 0), 0);
      const dbSql = getDb(req, bodyOrgId);

      const result = await dbSql`
        INSERT INTO invoices (contact_id, contact_name, invoice_date, reference, line_items, total, submitted_by_system_id, submitted_by_name, requires_approval, status)
        VALUES (${contact_id || '__new__'}, ${contact_name}, ${invoice_date}, ${reference || ''}, ${JSON.stringify(line_items)}::jsonb, ${total}, ${system_id}, ${'API:' + user_id}, ${true}, ${'pending_approval'})
        RETURNING *
      `;
      const created = result[0];

      // Log
      await dbSql`
        INSERT INTO invoice_logs (invoice_id, action_type, source, performed_by, performed_by_name, details)
        VALUES (${created.id}, ${'request'}, ${'api'}, ${user_id}, ${'API:' + user_id}, ${JSON.stringify(created)}::jsonb)
      `;

      // Approval emails disabled — only paid notifications are sent (via xero-webhook)

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
        // Enrich line items with line_amount
        const enrichedInvoice = {
          ...invoice,
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

    // send-approval-email — DISABLED (approval emails no longer sent)
    if (action === "send-approval-email") {
      return new Response(JSON.stringify({ success: true, message: "Approval emails are disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
          const enrichedApproved = {
            ...approvedInvoice,
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
    console.error("Invoices error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
