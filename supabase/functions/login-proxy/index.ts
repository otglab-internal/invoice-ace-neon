// Login proxy — forwards login + verify-2fa to the Federated Gateway auth-app.
// If upstream doesn't return a session token on 2FA success we mint a locally
// signed `ses_local_...` token so the browser has a credential to send back
// on subsequent calls. `_shared/auth.ts` verifies these locally.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, x-app-jwt, x-session-token, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOGIN_URL = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1/login-user";
const EXTERNAL_API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function mintLocalSession(payload: Record<string, unknown>): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const body = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const bodyB64 = b64url(new TextEncoder().encode(JSON.stringify(body)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyB64)),
  );
  return `ses_local_${bodyB64}.${b64url(sig)}`;
}

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });


const normalizeAuthFailure = (data: any, fallback: string) => {
  const raw = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : fallback;
  const lower = raw.toLowerCase();

  if (lower.includes("invalid or expired challenge")) {
    return {
      success: false,
      error: "Invalid or expired challenge token",
      code: "challenge_expired",
    };
  }

  if (lower.includes("invalid") && (lower.includes("totp") || lower.includes("2fa") || lower.includes("code"))) {
    return {
      success: false,
      error: "Invalid verification code",
      code: "invalid_2fa_code",
    };
  }

  if (lower.includes("invalid login") || lower.includes("invalid credentials") || lower.includes("password")) {
    return {
      success: false,
      error: "Incorrect email or password",
      code: "invalid_credentials",
    };
  }

  return {
    success: false,
    error: raw,
    code: data?.code || "auth_failed",
  };
};

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

      // 2FA validation failures are expected user-correctable states. Return
      // 200 with a structured body so the React login form can show a message
      // instead of the preview/runtime treating the 401 as a fatal error.
      if (!response.ok && response.status === 401) {
        return jsonResponse(normalizeAuthFailure(data, "Verification failed"));
      }

      return jsonResponse(data, response.status);
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
    if (!response.ok && response.status === 401) {
      return jsonResponse(normalizeAuthFailure(data, "Login failed"));
    }

    return jsonResponse(data, response.status);
  } catch (err) {
    console.error("Login proxy error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
