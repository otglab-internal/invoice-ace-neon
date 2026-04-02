const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id",
};

/**
 * AI Agent Integration Edge Function
 * 
 * Provides two integration patterns:
 * 1. OUTBOUND: Posts invoice events to a configured AI agent URL
 * 2. INBOUND: Receives decisions/actions from the AI agent
 * 
 * Actions:
 *   - "webhook-out"     → Forward an invoice event to the AI agent platform
 *   - "agent-action"    → Receive a decision from the AI agent (approve, reject, flag, etc.)
 *   - "get-invoice-json" → Return the full JSON shape for a given invoice (for manual testing)
 *   - "test-payload"    → Return a sample invoice payload without querying any DB
 */

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Sample payload shape (used for manual testing & documentation) ──
function buildSamplePayload() {
  return {
    event: "invoice_created",
    timestamp: new Date().toISOString(),
    invoice: {
      id: "uuid-of-invoice",
      org_id: "otg_lab",
      environment: "production",
      invoice_number: null,
      contact_name: "Lee Music Academy",
      contact_id: null,
      invoice_date: "22/03/2026",
      reference: "PO-12345",
      status: "pending_approval",
      requires_approval: true,
      total: 650.0,
      submitted_by_system_id: "user-abc-123",
      submitted_by_name: "John Doe",
      created_at: new Date().toISOString(),
      line_items: [
        {
          description: "Piano Lesson — Grade 3\nStudent: John\nPackage: Monthly",
          quantity: 4,
          cost: 150.0,
          account: "400",
          center: "KL Center",
        },
        {
          description: "Registration Fee",
          quantity: 1,
          cost: 50.0,
          account: "200",
          center: "KL Center",
        },
      ],
      amendment_status: null,
      amendment_data: null,
    },
    // The AI agent should respond with one of these action types:
    expected_response_format: {
      action: "approve | reject | flag | request-amendment",
      invoice_id: "uuid-of-invoice",
      reason: "Optional explanation for the decision",
      amendment_data: {
        _note: "Only required when action is 'request-amendment'",
        contact_name: "Updated name",
        reference: "Updated ref",
        line_items: [],
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...body } = await req.json();

    // ── TEST-PAYLOAD: Return the sample JSON shape ──
    if (action === "test-payload") {
      return json(buildSamplePayload());
    }

    // ── GET-INVOICE-JSON: Fetch a real invoice and return it in the agent format ──
    if (action === "get-invoice-json") {
      const { invoice_id, org_id } = body;
      if (!invoice_id) {
        return json({ error: "Missing invoice_id" }, 400);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

      const res = await fetch(
        `${supabaseUrl}/rest/v1/invoices?id=eq.${invoice_id}&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );

      const rows = await res.json();
      if (!rows || rows.length === 0) {
        return json({ error: "Invoice not found" }, 404);
      }

      const invoice = rows[0];
      return json({
        event: "invoice_created",
        timestamp: invoice.created_at,
        invoice,
        expected_response_format: {
          action: "approve | reject | flag | request-amendment",
          invoice_id: invoice.id,
          reason: "Optional explanation",
          amendment_data: null,
        },
      });
    }

    // ── WEBHOOK-OUT: Forward an invoice event to the AI agent platform ──
    if (action === "webhook-out") {
      const { event_type, invoice, agent_url } = body;

      // For now, agent_url is passed in the request (hardcoded by caller)
      // Later this will come from global_config per tenant
      if (!agent_url) {
        return json({ error: "agent_url is required (will be config-driven later)" }, 400);
      }

      const payload = {
        event: event_type || "invoice_created",
        timestamp: new Date().toISOString(),
        invoice,
        expected_response_format: {
          action: "approve | reject | flag | request-amendment",
          invoice_id: invoice?.id,
          reason: "Optional explanation",
          amendment_data: null,
        },
      };

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

        // Try to parse the agent's response as JSON
        let agentResponse;
        try {
          agentResponse = JSON.parse(agentBody);
        } catch {
          agentResponse = { raw: agentBody };
        }

        return json({
          success: true,
          agent_status: agentStatus,
          agent_response: agentResponse,
        });
      } catch (err) {
        console.error("AI agent webhook call error:", err);
        return json({ error: "Failed to reach AI agent" }, 502);
      }
    }

    // ── AGENT-ACTION: Receive a decision from the AI agent ──
    if (action === "agent-action") {
      const { agent_action, invoice_id, reason, amendment_data: amendData, org_id } = body;

      if (!invoice_id || !agent_action) {
        return json({ error: "Missing invoice_id or agent_action" }, 400);
      }

      const validActions = ["approve", "reject", "flag", "request-amendment"];
      if (!validActions.includes(agent_action)) {
        return json({ error: `Invalid agent_action. Must be one of: ${validActions.join(", ")}` }, 400);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const headers = {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=representation",
      };

      // Build the update based on agent_action
      let updateBody: Record<string, unknown> = {};
      let logAction = "";

      switch (agent_action) {
        case "approve":
          updateBody = {
            status: "approved",
            approved_by: "ai-agent",
            approved_at: new Date().toISOString(),
            approval_note: reason || "Auto-approved by AI agent",
          };
          logAction = "ai_agent_approved";
          break;

        case "reject":
          updateBody = {
            status: "rejected",
            approved_by: "ai-agent",
            approved_at: new Date().toISOString(),
            approval_note: reason || "Rejected by AI agent",
          };
          logAction = "ai_agent_rejected";
          break;

        case "flag":
          // Flag keeps the invoice pending but logs the concern
          updateBody = {};
          logAction = "ai_agent_flagged";
          break;

        case "request-amendment":
          updateBody = {
            amendment_status: "pending",
            amendment_data: amendData || null,
            amendment_requested_by: "ai-agent",
            amendment_requested_by_name: "AI Agent",
            amendment_requested_at: new Date().toISOString(),
            amendment_note: reason || "Amendment requested by AI agent",
          };
          logAction = "ai_agent_amendment_requested";
          break;
      }

      // Apply the update (skip if flag — no fields to update)
      if (Object.keys(updateBody).length > 0) {
        const updateRes = await fetch(
          `${supabaseUrl}/rest/v1/invoices?id=eq.${invoice_id}`,
          { method: "PATCH", headers, body: JSON.stringify(updateBody) }
        );

        if (!updateRes.ok) {
          const errText = await updateRes.text();
          console.error("Agent action update failed:", errText);
          return json({ error: "Failed to apply agent action" }, 500);
        }
      }

      // Log the action
      await fetch(`${supabaseUrl}/rest/v1/invoice_logs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          invoice_id,
          action_type: logAction,
          source: "ai-agent",
          performed_by: "ai-agent",
          performed_by_name: "AI Agent",
          org_id: org_id || "",
          details: { agent_action, reason, amendment_data: amendData || null },
        }),
      });

      return json({
        success: true,
        action_applied: agent_action,
        invoice_id,
      });
    }

    return json({ error: "Unknown action. Valid: test-payload, get-invoice-json, webhook-out, agent-action" }, 400);
  } catch (err) {
    console.error("AI agent function error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
