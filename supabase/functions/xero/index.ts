import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_URL = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function getDb(req: Request) {
  const env = req.headers.get("x-environment") || "production";
  const isProd = env === "production";
  const org = req.headers.get("x-org-id") || "";
  const mapping = ORG_DB_MAP[org];

  let url: string | undefined;
  if (mapping) {
    url = Deno.env.get(isProd ? mapping.prod : mapping.sb);
  }
  if (!url) {
    url = isProd
      ? Deno.env.get("DATABASE_URL_PROD")
      : Deno.env.get("DATABASE_URL_DEV");
  }
  if (!url) {
    throw new Error(`No database connection configured for org="${org}" env="${env}"`);
  }
  return neon(url);
}

interface ConfigMap {
  [key: string]: string;
}

async function getConfigMap(sql: ReturnType<typeof neon>, keys: string[]): Promise<ConfigMap> {
  const rows = await sql`SELECT key, value FROM global_config WHERE key = ANY(${keys})`;
  const map: ConfigMap = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

async function upsertConfig(sql: ReturnType<typeof neon>, key: string, value: string) {
  await sql`
    INSERT INTO global_config (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `;
}

async function refreshAccessToken(sql: ReturnType<typeof neon>, config: ConfigMap): Promise<{ access_token: string; refresh_token: string } | null> {
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

  await upsertConfig(sql, "xero_access_token", data.access_token);
  await upsertConfig(sql, "xero_refresh_token", data.refresh_token);

  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...body } = await req.json();
    const sql = getDb(req);

    // ACTION: get-auth-url
    if (action === "get-auth-url") {
      const { redirectUri } = body;
      const config = await getConfigMap(sql, ["xero_client_id"]);
      const clientId = config.xero_client_id;

      if (!clientId) {
        return jsonRes({ error: "Xero Client ID not configured" }, 400);
      }

      const state = crypto.randomUUID();
      const scopes = "openid profile email accounting.contacts.read accounting.transactions offline_access";
      const url = `${XERO_AUTH_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;

      return jsonRes({ url, state });
    }

    // ACTION: callback
    if (action === "callback") {
      const { code, redirectUri } = body;
      const config = await getConfigMap(sql, ["xero_client_id", "xero_client_secret"]);

      if (!config.xero_client_id || !config.xero_client_secret) {
        return jsonRes({ error: "Xero credentials not configured" }, 400);
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
        console.error("Token exchange failed:", await tokenRes.text());
        return jsonRes({ error: "Token exchange failed" }, 400);
      }

      const tokenData = await tokenRes.json();

      await upsertConfig(sql, "xero_access_token", tokenData.access_token);
      await upsertConfig(sql, "xero_refresh_token", tokenData.refresh_token);

      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const connections = await connRes.json();
      if (connections.length > 0) {
        await upsertConfig(sql, "xero_tenant_id", connections[0].tenantId);
      }

      return jsonRes({ success: true, tenant: connections[0]?.tenantName || "Connected" });
    }

    // ACTION: status
    if (action === "status") {
      const config = await getConfigMap(sql, ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_tenant_id"]);
      const connected = !!(config.xero_access_token && config.xero_tenant_id);

      return jsonRes({
        connected,
        hasCredentials: !!(config.xero_client_id && config.xero_client_secret),
        tenantId: config.xero_tenant_id || null,
      });
    }

    // ACTION: disconnect
    if (action === "disconnect") {
      await upsertConfig(sql, "xero_access_token", "");
      await upsertConfig(sql, "xero_refresh_token", "");
      await upsertConfig(sql, "xero_tenant_id", "");

      return jsonRes({ success: true });
    }

    // ACTION: contacts
    if (action === "contacts") {
      const config = await getConfigMap(sql, ["xero_client_id", "xero_client_secret", "xero_access_token", "xero_refresh_token", "xero_tenant_id"]);

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return jsonRes({ error: "Xero not connected", contacts: [] }, 400);
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
          return jsonRes({ error: "Xero token expired. Please reconnect.", contacts: [] }, 401);
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
        console.error("Xero contacts fetch failed:", await contactsRes.text());
        return jsonRes({ error: "Failed to fetch contacts", contacts: [] }, 500);
      }

      const data = await contactsRes.json();
      const contacts = (data.Contacts || []).map((c: any) => ({
        id: c.ContactID,
        name: c.Name,
      }));

      return jsonRes({ contacts });
    }

    return jsonRes({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("Xero function error:", err);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
