/**
 * Resolves the current user's email, with a live fallback to get-users-proxy
 * when the cached `auth_email` is missing or stale (e.g. sessions that
 * predate the email-capture logic).
 *
 * Strategy:
 *   1. Use the provided `cachedEmail` if non-empty.
 *   2. Otherwise call get-users-proxy with the current org/environment and
 *      look up the row whose `id` matches `systemId`.
 *   3. Persist the resolved value back to localStorage so subsequent calls
 *      hit the fast path.
 *
 * Throws if no email can be resolved — callers should surface this to the
 * user so the invoice is never written with an empty submitted_by_email.
 */
import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";

function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  return trimmed;
}

export async function resolveUserEmail(
  cachedEmail: string | null | undefined,
  systemId: string | null | undefined,
): Promise<string> {
  const cached = normalize(cachedEmail);
  if (cached) return cached;

  const sysId = normalize(systemId);
  if (!sysId) {
    throw new Error(
      "Could not determine your account email. Please log out and log back in.",
    );
  }

  const orgId = getOrgId();
  const environment = localStorage.getItem("auth_environment") || "production";

  const { data, error } = await supabase.functions.invoke("get-users-proxy", {
    method: "GET" as any,
    headers: { "x-org-id": orgId, "x-environment": environment },
    body: undefined,
    // supabase-js doesn't support GET query strings directly in invoke;
    // fall through to a direct fetch instead.
  } as any).catch(() => ({ data: null, error: { message: "invoke failed" } as any }));

  // Direct fetch fallback so we can pass query params reliably.
  let users: any[] | null = Array.isArray((data as any)?.data)
    ? (data as any).data
    : null;

  if (!users) {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-users-proxy?environment=${encodeURIComponent(environment)}&org_id=${encodeURIComponent(orgId)}`;
    const res = await fetch(url, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        "x-org-id": orgId,
        "x-environment": environment,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Could not look up your account email (status ${res.status}). Please log out and log back in.`,
      );
    }
    const json = await res.json();
    users = Array.isArray(json?.data) ? json.data : [];
  }

  // Match by id first, then fall back to alternate id shapes the external
  // auth API may return (system_id, user_id, prefixed `${env}_${id}` form).
  const match =
    (users || []).find((u: any) => u?.id === sysId) ||
    (users || []).find((u: any) => u?.system_id === sysId) ||
    (users || []).find((u: any) => u?.user_id === sysId) ||
    (users || []).find((u: any) => typeof u?.id === "string" && u.id.endsWith(sysId)) ||
    (users || []).find((u: any) => typeof u?.system_id === "string" && u.system_id.endsWith(sysId));

  const resolved = normalize(match?.email);
  if (!resolved) {
    // Last-ditch fallback: the email captured at login (stored separately so
    // we can always recover even if the user-list endpoint shape drifts).
    const loginEmail = normalize(localStorage.getItem("auth_login_email"));
    if (loginEmail) {
      try { localStorage.setItem("auth_email", loginEmail); } catch { /* ignore */ }
      return loginEmail;
    }
    throw new Error(
      "Your account does not have a registered email. Please contact an administrator.",
    );
  }

  try {
    localStorage.setItem("auth_email", resolved);
  } catch {
    /* ignore storage errors */
  }

  return resolved;
}
