import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getDb(req: Request) {
  const env = req.headers.get("x-environment") || "development";
  const url =
    env === "production"
      ? Deno.env.get("DATABASE_URL_PROD")!
      : Deno.env.get("DATABASE_URL_DEV")!;
  return neon(url);
}

// Verify JWT from auth function
async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  try {
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const enc = new TextEncoder();
    const [header, body, signature] = token.split(".");

    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
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
    const { action, ...body } = await req.json();

    // api-submit — external system invoice push (no auth required)
    if (action === "api-submit") {
      const { system_id, user_id, contact_name, invoice_date, reference, line_items } = body;

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

      // Use Supabase client to insert (respects RLS with anon)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

      const insertRes = await fetch(`${supabaseUrl}/rest/v1/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          contact_name,
          invoice_date,
          reference: reference || "",
          line_items,
          total,
          submitted_by_system_id: system_id,
          submitted_by_name: `API:${user_id}`,
          requires_approval: true,
          status: "pending_approval",
          template_id: null,
        }),
      });

      if (!insertRes.ok) {
        const errBody = await insertRes.text();
        console.error("API submit insert failed:", errBody);
        return new Response(JSON.stringify({ error: "Failed to create invoice" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [created] = await insertRes.json();

      // Log this action
      await fetch(`${supabaseUrl}/rest/v1/invoice_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          invoice_id: created.id,
          action_type: "request",
          source: "api",
          performed_by: user_id,
          performed_by_name: `API:${user_id}`,
          details: created,
        }),
      });

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

    // notify-approval is a webhook proxy — skip auth but fail loudly on delivery errors
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
        const webhookResponse = await fetch(n8nWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "invoice_approved",
            invoice,
            approved_by: invoice?.approved_by,
            approved_at: invoice?.approved_at,
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

    // All other actions require authentication
    const claims = await authenticate(req);
    if (!claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sql = getDb(req);
    const userId = claims.sub as string;

    // ACTION: create - Create a new invoice
    if (action === "create") {
      const {
        contactId, contactName, contactMode,
        description, quantity, cost,
        accountCode, centerId, descriptionMode,
        studentName, age, packageName, firstLesson,
      } = body;

      // If creating new contact, insert first
      let finalContactId = contactId;
      if (contactMode === "new" && contactName) {
        const result = await sql`
          INSERT INTO contacts (name, created_by)
          VALUES (${contactName}, ${userId})
          RETURNING id
        `;
        finalContactId = result[0].id;
      }

      const result = await sql`
        INSERT INTO invoices (
          contact_id, description, description_mode,
          student_name, age, package_name, first_lesson,
          quantity, unit_cost, account_code, center_id,
          status, created_by, invoice_date
        ) VALUES (
          ${finalContactId}, ${description}, ${descriptionMode || "structured"},
          ${studentName || null}, ${age || null}, ${packageName || null}, ${firstLesson || null},
          ${quantity}, ${cost}, ${accountCode}, ${centerId},
          'pending', ${userId}, CURRENT_DATE
        )
        RETURNING *
      `;

      return new Response(JSON.stringify({ invoice: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: list - List invoices
    if (action === "list") {
      const { status, limit = 50, offset = 0 } = body;
      let invoices;

      if (status) {
        invoices = await sql`
          SELECT i.*, c.name as contact_name
          FROM invoices i
          LEFT JOIN contacts c ON c.id = i.contact_id
          WHERE i.status = ${status}
          ORDER BY i.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        invoices = await sql`
          SELECT i.*, c.name as contact_name
          FROM invoices i
          LEFT JOIN contacts c ON c.id = i.contact_id
          ORDER BY i.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      return new Response(JSON.stringify({ invoices }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: get - Get single invoice
    if (action === "get") {
      const { invoiceId } = body;
      const result = await sql`
        SELECT i.*, c.name as contact_name
        FROM invoices i
        LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = ${invoiceId}
        LIMIT 1
      `;

      if (result.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ invoice: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: approve - Approve invoice (accountant only)
    if (action === "approve") {
      const { invoiceId, notes } = body;
      const role = claims.role as string;

      if (role !== "accountant" && role !== "admin") {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await sql`
        UPDATE invoices
        SET status = 'approved', approval_notes = ${notes || null}, approved_by = ${userId}, approved_at = NOW()
        WHERE id = ${invoiceId} AND status = 'pending'
        RETURNING *
      `;

      if (result.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found or already processed" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const approvedInvoice = result[0];

      // Send approved invoice data to n8n webhook (fire-and-forget)
      const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL");
      if (n8nWebhookUrl) {
        try {
          // Fetch contact name for the webhook payload
          const contactRows = await sql`
            SELECT c.name as contact_name
            FROM contacts c WHERE c.id = ${approvedInvoice.contact_id}
            LIMIT 1
          `;
          const contactName = contactRows.length > 0 ? contactRows[0].contact_name : null;

          await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "invoice_approved",
              invoice: { ...approvedInvoice, contact_name: contactName },
              approved_by: userId,
              approved_at: approvedInvoice.approved_at,
            }),
          });
        } catch (webhookErr) {
          console.error("n8n webhook call failed:", webhookErr);
          // Don't fail the approval if webhook fails
        }
      }

      return new Response(JSON.stringify({ invoice: approvedInvoice }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: reject - Reject invoice
    if (action === "reject") {
      const { invoiceId, reason } = body;
      const role = claims.role as string;

      if (role !== "accountant" && role !== "admin") {
        return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await sql`
        UPDATE invoices
        SET status = 'rejected', rejection_reason = ${reason || null}, approved_by = ${userId}, approved_at = NOW()
        WHERE id = ${invoiceId} AND status = 'pending'
        RETURNING *
      `;

      if (result.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found or already processed" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ invoice: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: push-to-xero - Push approved invoice to Xero
    if (action === "push-to-xero") {
      const { invoiceId } = body;

      const invoices = await sql`
        SELECT i.*, c.name as contact_name
        FROM invoices i
        LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = ${invoiceId}
        LIMIT 1
      `;

      if (invoices.length === 0) {
        return new Response(JSON.stringify({ error: "Invoice not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const invoice = invoices[0];

      // TODO: Replace with actual Xero API integration
      // For now, simulate the Xero push and mark as pushed
      const xeroInvoiceId = `XERO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      await sql`
        UPDATE invoices
        SET status = 'pushed', xero_invoice_id = ${xeroInvoiceId}, pushed_at = NOW()
        WHERE id = ${invoiceId}
      `;

      return new Response(
        JSON.stringify({
          success: true,
          xeroInvoiceId,
          message: `Invoice pushed to Xero as ${xeroInvoiceId}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: stats - Dashboard statistics
    if (action === "stats") {
      const result = await sql`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
          COUNT(*) FILTER (WHERE status = 'pushed')::int as pushed,
          COUNT(*) FILTER (WHERE status = 'rejected')::int as failed
        FROM invoices
      `;

      return new Response(JSON.stringify({ stats: result[0] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: contacts - List contacts
    if (action === "contacts") {
      const contacts = await sql`SELECT id, name FROM contacts ORDER BY name`;
      return new Response(JSON.stringify({ contacts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: settings - Get/update settings
    if (action === "get-settings") {
      const settings = await sql`
        SELECT key, value FROM app_settings WHERE key IN ('invoice_mode')
      `;
      const map: Record<string, string> = {};
      for (const s of settings) map[s.key] = s.value;
      return new Response(JSON.stringify({ settings: map }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update-settings") {
      const { key, value } = body;
      await sql`
        INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
      `;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // notify-approval is handled before auth check above

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
