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

interface ConfigMap {
  [key: string]: string;
}


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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
        "accounting.contacts.read",
        "accounting.invoices",
        "accounting.payments",
        "accounting.attachments",
        "accounting.settings.read",
      ].join(" ");
      const url = `${XERO_AUTH_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;

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
      const contacts = (data.Contacts || []).map((c: any) => ({
        id: c.ContactID,
        name: c.Name,
      }));

      return new Response(JSON.stringify({ contacts }), {
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
