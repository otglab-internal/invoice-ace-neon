// Login proxy — forwards login + verify-2fa to the Federated Gateway auth-app
// and returns whatever it responds with. No local JWT minting: the upstream
// `token` (an opaque `ses_...` session token) is the credential the frontend
// stores and sends on subsequent calls.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, x-app-jwt, x-session-token, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOGIN_URL = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1/login-user";
const EXTERNAL_API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, environment, org_id, ...body } = await req.json();
    const orgId = org_id || "";

    if (action === "verify-2fa") {
      const response = await fetch(LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EXTERNAL_API_KEY,
          "x-org-id": orgId,
        },
        body: JSON.stringify({
          action: "verify-2fa",
          challenge_token: body.challenge_token,
          totp_code: body.totp_code,
        }),
      });

      const data = await response.json();
      if (response.ok && data?.success && data?.user) {
        // Pass the upstream session token straight through. The frontend
        // stores it and sends it back as `x-app-jwt` on later calls; the
        // shared auth helper validates it against the upstream `auth verify`.
        if (!data.environment) data.environment = environment || "production";
      }
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Login action — resolve api_key from secrets per org + environment
    const orgUpper = orgId === "stridekidz" ? "SK" : "OTG";
    const envSuffix = environment === "sandbox" ? "SB" : "PROD";
    const apiKey =
      Deno.env.get(`AUTH_API_KEY_${orgUpper}_${envSuffix}`) ||
      Deno.env.get(environment === "sandbox" ? "AUTH_API_KEY_SANDBOX" : "AUTH_API_KEY_PROD") ||
      "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key not configured for this environment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EXTERNAL_API_KEY,
        "x-org-id": orgId,
      },
      body: JSON.stringify({
        email: body.email,
        password: body.password,
        api_key: apiKey,
      }),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Login proxy error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
