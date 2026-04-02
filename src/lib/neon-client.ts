/**
 * NeonDB client — all data operations go through the data-proxy edge function
 * which routes to the correct tenant NeonDB based on x-org-id + x-environment headers.
 *
 * Returns { data, error } shaped results for compatibility with existing code patterns.
 */
import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try { headers["x-org-id"] = getOrgId(); } catch { /* noop */ }
  headers["x-environment"] = localStorage.getItem("auth_environment") || "production";
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("data-proxy", {
    body,
    headers: getHeaders(),
  });
  if (error) return { data: null, error: { message: error.message } };
  if (data?.error) return { data: null, error: { message: data.error } };
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
    return { data: res.data?.rows ?? null, error: null };
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
