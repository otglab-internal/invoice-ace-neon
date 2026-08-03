/**
 * Resolves the n8n webhook target for a specific app instance (org + environment).
 *
 * Each tenant DB (otg_lab prod/sandbox, stridekidz prod/sandbox) can store its own
 * `n8n_webhook_url` in global_config. The global N8N_WEBHOOK_URL secret is only a
 * legacy fallback — relying on it routes every instance's invoices through the same
 * n8n workflow (and therefore the same Xero organisation), which is what caused
 * invoices from one instance to land in another org's Xero.
 *
 * The routing payload also carries the instance's bound Xero tenant so n8n can pick
 * the correct Xero connection instead of using a single hard-wired credential.
 */

// deno-lint-ignore no-explicit-any
type AnySql = any;

export interface N8nTarget {
  url: string;
  source: "instance_config" | "global_secret" | "none";
  orgId: string;
  environment: string;
  xeroTenantId: string | null;
  xeroTenantName: string | null;
}

export async function getN8nTarget(sql: AnySql, orgId: string, environment: string): Promise<N8nTarget> {
  const map: Record<string, string> = {};
  try {
    const rows = await sql.query(
      `SELECT key, value FROM global_config WHERE key IN ($1, $2, $3)`,
      ["n8n_webhook_url", "xero_tenant_id", "xero_tenant_name"],
    );
    for (const row of rows || []) map[row.key] = row.value ?? "";
  } catch (err) {
    console.error("getN8nTarget: failed to read global_config", err);
  }

  const instanceUrl = (map.n8n_webhook_url || "").trim();
  const fallbackUrl = (Deno.env.get("N8N_WEBHOOK_URL") || "").trim();
  const url = instanceUrl || fallbackUrl;

  const target: N8nTarget = {
    url,
    source: instanceUrl ? "instance_config" : url ? "global_secret" : "none",
    orgId,
    environment,
    xeroTenantId: (map.xero_tenant_id || "").trim() || null,
    xeroTenantName: (map.xero_tenant_name || "").trim() || null,
  };

  if (target.source === "global_secret") {
    console.warn(
      `n8n: instance org="${orgId}" env="${environment}" has no n8n_webhook_url configured — falling back to the shared N8N_WEBHOOK_URL secret. Invoices may be created in the wrong Xero organisation.`,
    );
  }

  return target;
}

/** Instance-identifying fields that must accompany every n8n dispatch. */
export function n8nRouting(target: N8nTarget) {
  return {
    org_id: target.orgId,
    environment: target.environment,
    xero_tenant_id: target.xeroTenantId,
    xero_tenant_name: target.xeroTenantName,
  };
}
