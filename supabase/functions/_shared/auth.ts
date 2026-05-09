// Shared HS256 JWT helpers for edge functions.
// Mirrors the createJwt/verifyJwt logic in supabase/functions/auth/index.ts.

export async function createJwt(payload: Record<string, unknown>): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("JWT signing secret is not configured");

  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + 86400 };
  const body = btoa(JSON.stringify(claims))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${body}.${signature}`;
}

export async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  try {
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !token) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const enc = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const sigStr = signature.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sigStr + "=".repeat((4 - (sigStr.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      enc.encode(`${header}.${body}`),
    );
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

export async function authenticate(req: Request): Promise<Record<string, unknown> | null> {
  // Prefer x-app-jwt because supabase-js's functions.invoke overrides the
  // Authorization header with the project anon key, clobbering any token
  // the caller tries to attach. Fall back to Authorization for direct fetch
  // callers and internal server-to-server calls.
  const appJwt = req.headers.get("x-app-jwt");
  if (appJwt) {
    const claims = await verifyJwt(appJwt);
    if (claims) return claims;
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return verifyJwt(authHeader.replace("Bearer ", ""));
}

export function unauthorizedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function forbiddenResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
