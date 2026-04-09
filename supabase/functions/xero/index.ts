const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-environment, x-org-id",
};

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_URL = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

interface ConfigMap {
  [key: string]: string;
}

async function getConfigMap(keys: string[], orgId: string): Promise<ConfigMap> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const res = await fetch(`${supabaseUrl}/rest/v1/global_config?key=in.(${keys.join(",")})&org_id=eq.${encodeURIComponent(orgId)}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  const rows = await res.json();
  const map: ConfigMap = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

async function upsertConfig(key: string, value: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const headers = {
    "Content-Type": "application/json",
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Prefer: "resolution=merge-duplicates",
  };

  // Try update first
  const updateRes = await fetch(`${supabaseUrl}/rest/v1/global_config?key=eq.${key}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ value, updated_at: new Date().toISOString() }),
  });

  // If no rows updated, insert
  if (updateRes.status === 200) {
    const text = await updateRes.text();
    // Check if it was empty (no match)
    if (!text || text === "[]") {
      await fetch(`${supabaseUrl}/rest/v1/global_config`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key, value }),
      });
    }
  }
}

async function refreshAccessToken(config: ConfigMap): Promise<{ access_token: string; refresh_token: string } | null> {
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
  await upsertConfig("xero_access_token", data.access_token);
  await upsertConfig("xero_refresh_token", data.refresh_token);

  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...body } = await req.json();

    // ACTION: get-auth-url — Generate OAuth2 authorization URL
    if (action === "get-auth-url") {
      const { redirectUri } = body;
      const config = await getConfigMap(["xero_client_id"]);
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
      ].join(" ");
      const url = `${XERO_AUTH_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;

      return new Response(JSON.stringify({ url, state }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: callback — Exchange auth code for tokens
    if (action === "callback") {
      const { code, redirectUri } = body;
      const config = await getConfigMap(["xero_client_id", "xero_client_secret"]);

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

      // Save tokens
      await upsertConfig("xero_access_token", tokenData.access_token);
      await upsertConfig("xero_refresh_token", tokenData.refresh_token);

      // Get tenant ID
      const connRes = await fetch(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const connections = await connRes.json();
      if (connections.length > 0) {
        await upsertConfig("xero_tenant_id", connections[0].tenantId);
      }

      return new Response(JSON.stringify({ success: true, tenant: connections[0]?.tenantName || "Connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: status — Check if Xero is connected
    if (action === "status") {
      const config = await getConfigMap([
        "xero_client_id",
        "xero_client_secret",
        "xero_access_token",
        "xero_tenant_id",
      ]);
      const connected = !!(config.xero_access_token && config.xero_tenant_id);

      return new Response(
        JSON.stringify({
          connected,
          hasCredentials: !!(config.xero_client_id && config.xero_client_secret),
          tenantId: config.xero_tenant_id || null,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ACTION: disconnect — Clear Xero tokens
    if (action === "disconnect") {
      await upsertConfig("xero_access_token", "");
      await upsertConfig("xero_refresh_token", "");
      await upsertConfig("xero_tenant_id", "");

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: contacts — Fetch contacts from Xero
    if (action === "contacts") {
      const config = await getConfigMap([
        "xero_client_id",
        "xero_client_secret",
        "xero_access_token",
        "xero_refresh_token",
        "xero_tenant_id",
      ]);

      if (!config.xero_access_token || !config.xero_tenant_id) {
        return new Response(JSON.stringify({ error: "Xero not connected", contacts: [] }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let accessToken = config.xero_access_token;

      // Try fetching contacts
      let contactsRes = await fetch(`${XERO_API_URL}/Contacts?where=ContactStatus=="ACTIVE"&order=Name`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": config.xero_tenant_id,
          Accept: "application/json",
        },
      });

      // If 401, try refreshing token
      if (contactsRes.status === 401) {
        const refreshed = await refreshAccessToken(config);
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
