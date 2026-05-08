// Shared HS256 JWT verification for edge functions.
// Mirrors the createJwt/verifyJwt logic in supabase/functions/auth/index.ts.

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
