/**
 * NeonDB client — all data operations go through the data-proxy edge function
 * which routes to the correct tenant NeonDB based on x-org-id + x-environment headers.
 *
 * Returns { data, error } shaped results for compatibility with existing code patterns.
 */
import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";
import { parseEdgeError } from "@/lib/edge-error";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try { headers["x-org-id"] = getOrgId(); } catch { /* noop */ }
  headers["x-environment"] = localStorage.getItem("auth_environment") || "production";
  const rawToken = localStorage.getItem("auth_token");
  const token = rawToken && !["undefined", "null"].includes(rawToken.trim().toLowerCase())
    ? rawToken.trim()
    : "";
  // Use x-app-jwt because supabase-js's functions.invoke overrides Authorization
  // with the project anon key, clobbering any token we put there.
  if (token) headers["x-app-jwt"] = token;
  return headers;
}

async function invoke(body: Record<string, unknown>) {
  const headers = getHeaders();
  if (!headers["x-app-jwt"] && !headers["x-api-key"]) {
    return {
      data: null,
      error: { message: "Please sign in to continue." },
    };
  }

  const { data, error } = await supabase.functions.invoke("data-proxy", {
    body,
    headers,
  });
  if (error) {
    const message = await parseEdgeError(error, data, "Database request failed");
    return { data: null, error: { message } };
  }
  if (data?.error) {
    const message = await parseEdgeError(null, data, "Database request failed");
    return { data: null, error: { message } };
  }
  return { data, error: null };
}

export async function neonQuery<T = any>(
  table: string,
  options?: {
    select?: string;
    filters?: Record<string, any>;
    orFilters?: Array<Record<string, any>>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    maybeSingle?: boolean;
  }
): Promise<{ data: T | T[] | null; error: any }> {
  const res = await invoke({ action: "query", table, ...options });
  if (res.error) return { data: null, error: res.error };
  if (options?.maybeSingle) {
    const rows = res.data?.rows;
    const single = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
    return { data: single, error: null };
  }
  return { data: res.data?.rows ?? [], error: null };
}

export async function neonInsert<T = any>(
  table: string,
  row: Record<string, any>
): Promise<{ data: T | null; error: any }> {
  const res = await invoke({ action: "insert", table, row });
  if (res.error) return { data: null, error: res.error };
  return { data: res.data?.row ?? null, error: null };
}

export async function neonUpdate(
  table: string,
  updates: Record<string, any>,
  filters: Record<string, any>
): Promise<{ data: any[] | null; error: any }> {
  const res = await invoke({ action: "update", table, updates, filters });
  if (res.error) return { data: null, error: res.error };
  return { data: res.data?.rows ?? [], error: null };
}

export async function neonDelete(
  table: string,
  filters: Record<string, any>
): Promise<{ error: any }> {
  const res = await invoke({ action: "delete", table, filters });
  return { error: res.error };
}

export async function neonUpsert<T = any>(
  table: string,
  row: Record<string, any>,
  conflictKey: string
): Promise<{ data: T | null; error: any }> {
  const res = await invoke({ action: "upsert", table, row, conflictKey });
  if (res.error) return { data: null, error: res.error };
  return { data: res.data?.row ?? null, error: null };
}
