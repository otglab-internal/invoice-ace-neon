// Federated Gateway auth helpers.
//
// Two credential types are accepted on inbound requests:
//   1. `x-api-key: <prod_... | sb_...>` — system integration key. Validated
//      against the upstream clients-api and carries an `allowedSystemIds`
//      list (which systems the key may act on behalf of).
//   2. `Authorization: Bearer <ses_...>` OR `x-app-jwt: <ses_...>` — user
//      browser session token. Validated against the upstream auth `verify`
//      action. We keep `x-app-jwt` as a fallback header because
//      supabase-js's functions.invoke overrides the Authorization header
//      with the project anon key, clobbering any Bearer token the browser
//      wants to attach.
//
// There is no locally-minted JWT anymore. All identity + allowlist decisions
// come from the Federated Gateway.

const GATEWAY_BASE = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1";
const CLIENTS_API_URL = `${GATEWAY_BASE}/clients-api`;
const AUTH_URL = `${GATEWAY_BASE}/auth`;
const EXTERNAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; principal: Principal }>();

export type PrincipalKind = "api_key" | "session";

export interface Principal {
  kind: PrincipalKind;
  /** Stable identifier for the actor (user id, or api key system id). */
  id: string;
  email: string;
  role: string;
  name: string;
  /** Systems this credential may act on. `["*"]` for full-access session users. */
  allowedSystems: string[];
  /** Raw upstream response, for callers that need extra fields. */
  raw: Record<string, unknown>;
}

function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function verifyApiKey(
  apiKey: string,
  orgId: string,
  environment: string,
): Promise<Principal | null> {
  try {
    // Use a lightweight describe ping — clients-api runs verifyApiKey on every
    // action, so any successful call proves the key is valid and echoes back
    // the allowedSystemIds for that key.
    const res = await fetch(CLIENTS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EXTERNAL_ANON_KEY,
        "x-api-key": apiKey,
        "x-org-id": orgId,
        "x-environment": environment,
      },
      body: JSON.stringify({ action: "describe", entity: "clients" }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const allowed = Array.isArray(data?.allowedSystemIds)
      ? data.allowedSystemIds.map((s: unknown) => String(s))
      : Array.isArray(data?.allowed_systems)
      ? data.allowed_systems.map((s: unknown) => String(s))
      : [];
    const systemId = pickString(data?.systemId, data?.system_id, "api-key");
    return {
      kind: "api_key",
      id: systemId,
      email: pickString(data?.systemName, data?.system_name),
      role: "system",
      name: pickString(data?.systemName, data?.system_name, "System"),
      allowedSystems: allowed,
      raw: data ?? {},
    };
  } catch (e) {
    console.error("verifyApiKey error:", e);
    return null;
  }
}

async function verifySession(
  token: string,
  orgId: string,
): Promise<Principal | null> {
  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EXTERNAL_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "x-org-id": orgId,
      },
      body: JSON.stringify({ action: "verify" }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (data?.valid === false) return null;
    const user = (data?.user ?? data) as Record<string, unknown>;
    const id = pickString(user?.id, (user as any)?.user_id, (user as any)?.system_id);
    if (!id) return null;
    return {
      kind: "session",
      id,
      email: pickString(user?.email),
      role: pickString(user?.role, "user"),
      name: pickString(
        `${pickString((user as any)?.first_name)} ${pickString((user as any)?.last_name)}`.trim(),
        user?.email,
      ),
      allowedSystems: ["*"],
      raw: data ?? {},
    };
  } catch (e) {
    console.error("verifySession error:", e);
    return null;
  }
}

/**
 * Verify credentials on an inbound request.
 *
 * @param req The inbound request.
 * @param opts.targetSystem The system the caller is trying to act on. If the
 *   principal is an api key, its `allowedSystems` must include this value.
 *   Session users are treated as fully-scoped (`allowedSystems: ["*"]`).
 */
export async function authenticate(
  req: Request,
  opts: { targetSystem?: string } = {},
): Promise<Principal | null> {
  const orgId = req.headers.get("x-org-id") || "";
  const environment = req.headers.get("x-environment") || "production";

  const apiKey = req.headers.get("x-api-key")?.trim();
  const sessionHeader =
    req.headers.get("x-app-jwt")?.trim() ||
    req.headers.get("x-session-token")?.trim() ||
    "";
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const candidate = apiKey
    ? { kind: "api_key" as const, value: apiKey }
    : sessionHeader
    ? { kind: "session" as const, value: sessionHeader }
    : bearer && bearer !== EXTERNAL_ANON_KEY
    ? { kind: "session" as const, value: bearer }
    : null;

  if (!candidate) return null;

  const cacheKey = `${candidate.kind}:${candidate.value}:${orgId}:${environment}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    if (!checkAllowed(hit.principal, opts.targetSystem)) return null;
    return hit.principal;
  }

  const principal = candidate.kind === "api_key"
    ? await verifyApiKey(candidate.value, orgId, environment)
    : await verifySession(candidate.value, orgId);

  if (!principal) return null;
  cache.set(cacheKey, { at: Date.now(), principal });

  if (!checkAllowed(principal, opts.targetSystem)) return null;
  return principal;
}

function checkAllowed(p: Principal, targetSystem?: string): boolean {
  if (!targetSystem) return true;
  if (p.allowedSystems.includes("*")) return true;
  if (p.allowedSystems.includes(targetSystem)) return true;
  // Owning system is always implicitly allowed.
  if (p.id && p.id === targetSystem) return true;
  return false;
}

export function unauthorizedResponse(
  corsHeaders: Record<string, string>,
  message = "Missing or invalid x-api-key / session token",
): Response {
  return new Response(JSON.stringify({ error: message, code: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function forbiddenResponse(
  corsHeaders: Record<string, string>,
  message = "API key is not allowed to access this system",
): Response {
  return new Response(JSON.stringify({ error: message, code: "system_not_allowed" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deprecated — kept only so any straggling imports don't break compilation.
// New code should call `authenticate()`. These stubs always fail closed.
export async function createJwt(_payload: Record<string, unknown>): Promise<string> {
  throw new Error("createJwt has been removed. Federated Gateway now issues session tokens.");
}
export async function verifyJwt(_token: string): Promise<Record<string, unknown> | null> {
  return null;
}
