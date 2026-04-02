import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id",
};

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function getDbFromParams(orgId: string, environment: string) {
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
    throw new Error(`No database connection for org="${orgId}" env="${environment}"`);
  }
  return neon(url);
}

function getDb(req: Request, bodyOrgId?: string) {
  const env = req.headers.get("x-environment") || "development";
  const org = bodyOrgId || req.headers.get("x-org-id") || "";
  return getDbFromParams(org, env);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Format invoice into the outbound agent payload ──
function buildAgentPayload(invoice: Record<string, any>, eventType = "invoice_created") {
  const ts = invoice.created_at || new Date().toISOString();
  const total = Number(invoice.total || 0).toFixed(2);

  const lineItemsText = (invoice.line_items || [])
    .map((li: any, i: number) => {
      const lines = [`${i + 1}. ${li.description?.replace(/\n/g, "\n   ") || "N/A"}`];
      lines.push(`   Quantity: ${li.quantity}`);
      lines.push(`   Cost per unit: $${Number(li.cost || 0).toFixed(2)}`);
      lines.push(`   Account: ${li.account || "N/A"}`);
      lines.push(`   Center: ${li.center || "N/A"}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const description = [
    `EVENT: ${eventType}`,
    "",
    "INVOICE DETAILS:",
    `- ID: ${invoice.id}`,
    `- Organization: ${invoice.org_id || "N/A"}`,
    `- Environment: ${invoice.environment || "N/A"}`,
    `- Contact: ${invoice.contact_name}`,
    `- Invoice Date: ${invoice.invoice_date}`,
    `- Reference: ${invoice.reference || "N/A"}`,
    `- Status: ${invoice.status}`,
    `- Requires Approval: ${invoice.requires_approval}`,
    `- Total Amount: $${total}`,
    "",
    "SUBMITTED BY:",
    `- Name: ${invoice.submitted_by_name || "N/A"}`,
    `- System ID: ${invoice.submitted_by_system_id || "N/A"}`,
    "",
    "LINE ITEMS:",
    lineItemsText,
    "",
    "TIMESTAMP:",
    ts,
    "",
    "INSTRUCTION:",
    "Review this invoice and determine whether it should be approved or rejected based on financial policies.",
  ].join("\n");

  return {
    title: `Invoice Approval Required — ${invoice.contact_name} ($${total})`,
    description,
    agent: "Chief Finance Officer",
  };
}

function buildSamplePayload() {
  return buildAgentPayload({
    id: "uuid-of-invoice",
    org_id: "otg_lab",
    environment: "production",
    contact_name: "Lee Music Academy",
    invoice_date: "22/03/2026",
    reference: "PO-12345",
    status: "pending_approval",
    requires_approval: true,
    total: 650.0,
    submitted_by_system_id: "user-abc-123",
    submitted_by_name: "John Doe",
    created_at: new Date().toISOString(),
    line_items: [
      { description: "Piano Lesson — Grade 3\nStudent: John\nPackage: Monthly", quantity: 4, cost: 150.0, account: "400", center: "KL Center" },
      { description: "Registration Fee", quantity: 1, cost: 50.0, account: "200", center: "KL Center" },
    ],
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...body } = await req.json();

    // ── TEST-PAYLOAD ──
    if (action === "test-payload") {
      return json(buildSamplePayload());
    }

    // ── GET-INVOICE-JSON: Fetch from NeonDB ──
    if (action === "get-invoice-json") {
      const { invoice_id, org_id, environment } = body;
      if (!invoice_id) {
        return json({ error: "Missing invoice_id" }, 400);
      }

      const sql = getDbFromParams(org_id || req.headers.get("x-org-id") || "", environment || req.headers.get("x-environment") || "development");
      const rows = await sql`SELECT * FROM invoices WHERE id = ${invoice_id} LIMIT 1`;

      if (!rows || rows.length === 0) {
        return json({ error: "Invoice not found" }, 404);
      }

      return json(buildAgentPayload(rows[0]));
    }

    // ── WEBHOOK-OUT ──
    if (action === "webhook-out") {
      const { event_type, invoice, agent_url } = body;
      if (!agent_url) {
        return json({ error: "agent_url is required" }, 400);
      }

      const payload = buildAgentPayload(invoice, event_type || "invoice_created");

      try {
        const agentRes = await fetch(agent_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const agentStatus = agentRes.status;
        const agentBody = await agentRes.text();

        if (!agentRes.ok) {
          console.error("AI agent webhook failed", { agentStatus, agentBody });
          return json({ error: `Agent returned ${agentStatus}`, body: agentBody }, 502);
        }

        let agentResponse;
        try {
          agentResponse = JSON.parse(agentBody);
        } catch {
          agentResponse = { raw: agentBody };
        }

        return json({ success: true, agent_status: agentStatus, agent_response: agentResponse });
      } catch (err) {
        console.error("AI agent webhook call error:", err);
        return json({ error: "Failed to reach AI agent" }, 502);
      }
    }

    // ── AGENT-ACTION: Receive decision from AI agent, write to NeonDB ──
    if (action === "agent-action") {
      const { agent_action, invoice_id, reason, amendment_data: amendData, org_id, environment } = body;

      if (!invoice_id || !agent_action) {
        return json({ error: "Missing invoice_id or agent_action" }, 400);
      }

      const validActions = ["approve", "reject", "flag", "request-amendment"];
      if (!validActions.includes(agent_action)) {
        return json({ error: `Invalid agent_action. Must be one of: ${validActions.join(", ")}` }, 400);
      }

      const sql = getDbFromParams(
        org_id || req.headers.get("x-org-id") || "",
        environment || req.headers.get("x-environment") || "production"
      );

      switch (agent_action) {
        case "approve":
          await sql`UPDATE invoices SET status = 'approved', approved_by = 'ai-agent', approved_at = NOW(), approval_note = ${reason || 'Auto-approved by AI agent'} WHERE id = ${invoice_id}`;
          break;
        case "reject":
          await sql`UPDATE invoices SET status = 'rejected', approved_by = 'ai-agent', approved_at = NOW(), approval_note = ${reason || 'Rejected by AI agent'} WHERE id = ${invoice_id}`;
          break;
        case "flag":
          // No update, just log
          break;
        case "request-amendment":
          await sql`UPDATE invoices SET amendment_status = 'pending', amendment_data = ${JSON.stringify(amendData || null)}::jsonb, amendment_requested_by = 'ai-agent', amendment_requested_by_name = 'AI Agent', amendment_requested_at = NOW(), amendment_note = ${reason || 'Amendment requested by AI agent'} WHERE id = ${invoice_id}`;
          break;
      }

      // Log the action
      const logAction = `ai_agent_${agent_action === "request-amendment" ? "amendment_requested" : agent_action + (agent_action === "approve" ? "d" : "ed")}`;
      await sql`INSERT INTO invoice_logs (invoice_id, action_type, source, performed_by, performed_by_name, details) VALUES (${invoice_id}, ${logAction}, 'ai-agent', 'ai-agent', 'AI Agent', ${JSON.stringify({ agent_action, reason, amendment_data: amendData || null })}::jsonb)`;

      return json({ success: true, action_applied: agent_action, invoice_id });
    }

    return json({ error: "Unknown action. Valid: test-payload, get-invoice-json, webhook-out, agent-action" }, 400);
  } catch (err) {
    console.error("AI agent function error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
