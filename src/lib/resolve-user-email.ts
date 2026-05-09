/**
 * Resolves the current user's email, with multiple live fallbacks so that
 * sessions which predate the email-capture logic (or whose org/environment
 * context drifts) can still recover an address without forcing a re-login.
 *
 * Resolution order:
 *   1. `cachedEmail` argument (usually `auth_email` from localStorage).
 *   2. `auth_login_email` (the address typed at login — guaranteed-set by
 *      the modern login flow, but missing on older sessions).
 *   3. `auth_user.email` if the stored auth_user JSON happens to carry one.
 *   4. Live `get-users-proxy` lookup, matching by:
 *        a) systemId (id / system_id / user_id, plus suffix variants), or
 *        b) first_name + last_name from the cached `auth_user` blob — this
 *           catches stale sessions whose stored systemId doesn't line up
 *           with the upstream id shape any more.
 *      The lookup is tried against the current environment first, then the
 *      opposite environment as a last-ditch attempt (covers cases where the
 *      stored `auth_environment` is stale).
 *
 * Any successful resolution is written back to `auth_email` so the fast
 * path is hit on every subsequent call.
 *
 * Throws a user-actionable error only when *every* avenue is exhausted.
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

function readStoredAuthUser(): { firstName: string; lastName: string; email: string } {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return { firstName: "", lastName: "", email: "" };
    const parsed = JSON.parse(raw);
    return {
      firstName: normalize(parsed?.firstName).toLowerCase(),
      lastName: normalize(parsed?.lastName).toLowerCase(),
      email: normalize(parsed?.email),
    };
  } catch {
    return { firstName: "", lastName: "", email: "" };
  }
}

function persist(email: string): string {
  try {
    localStorage.setItem("auth_email", email);
  } catch {
    /* ignore storage errors */
  }
  return email;
}

async function fetchUsers(orgId: string, environment: string): Promise<any[]> {
  // Use a direct fetch — supabase.functions.invoke doesn't pass query params
  // reliably and the proxy reads `environment`/`org_id` from the URL.
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-users-proxy?environment=${encodeURIComponent(environment)}&org_id=${encodeURIComponent(orgId)}`;
    const authToken = localStorage.getItem("auth_token") || "";
    const res = await fetch(url, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        Authorization: `Bearer ${authToken || (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)}`,
        "x-app-jwt": authToken,
        "x-org-id": orgId,
        "x-environment": environment,
      },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

function findMatchingUser(users: any[], sysId: string, firstName: string, lastName: string): any | null {
  if (!users.length) return null;

  if (sysId) {
    const byId =
      users.find((u: any) => u?.id === sysId) ||
      users.find((u: any) => u?.system_id === sysId) ||
      users.find((u: any) => u?.user_id === sysId) ||
      users.find((u: any) => typeof u?.id === "string" && u.id.endsWith(sysId)) ||
      users.find((u: any) => typeof u?.system_id === "string" && u.system_id.endsWith(sysId));
    if (byId) return byId;
  }

  if (firstName && lastName) {
    const byName = users.find((u: any) => {
      const fn = normalize(u?.first_name).toLowerCase();
      const ln = normalize(u?.last_name).toLowerCase();
      return fn === firstName && ln === lastName;
    });
    if (byName) return byName;
  }

  return null;
}

export async function resolveUserEmail(
  cachedEmail: string | null | undefined,
  systemId: string | null | undefined,
): Promise<string> {
  // 1. Cached auth_email (fast path)
  const cached = normalize(cachedEmail);
  if (cached) return cached;

  // 2. The address the user typed at login — set by the modern login flow.
  const loginEmail = normalize(localStorage.getItem("auth_login_email"));
  if (loginEmail) return persist(loginEmail);

  // 3. auth_user.email (some legacy sessions stored email here directly).
  const storedUser = readStoredAuthUser();
  if (storedUser.email) return persist(storedUser.email);

  // 4. Live lookup against get-users-proxy.
  let orgId = "";
  try {
    orgId = getOrgId();
  } catch {
    throw new Error(
      "Could not determine your organization. Please log out and log back in.",
    );
  }

  const sysId = normalize(systemId);
  const currentEnv = localStorage.getItem("auth_environment") || "production";
  const altEnv = currentEnv === "sandbox" ? "production" : "sandbox";

  // Try current environment first.
  let users = await fetchUsers(orgId, currentEnv);
  let match = findMatchingUser(users, sysId, storedUser.firstName, storedUser.lastName);

  // Fall back to the opposite environment if the current one returned nothing
  // useful — covers sessions where `auth_environment` drifted from reality.
  if (!match) {
    users = await fetchUsers(orgId, altEnv);
    match = findMatchingUser(users, sysId, storedUser.firstName, storedUser.lastName);
  }

  const resolved = normalize(match?.email);
  if (resolved) return persist(resolved);

  // Truly out of options — surface specific guidance based on what failed.
  if (!sysId && !storedUser.firstName) {
    throw new Error(
      "Could not determine your account email. Please log out and log back in.",
    );
  }
  if (!match) {
    throw new Error(
      "We couldn't find your account in the directory for this organization. Please log out and log back in, or contact an administrator.",
    );
  }
  throw new Error(
    "Your account does not have a registered email. Please contact an administrator.",
  );
}
