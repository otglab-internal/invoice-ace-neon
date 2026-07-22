import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";
import { parseEdgeError } from "@/lib/edge-error";


const getEnvironment = (): string => {
  return localStorage.getItem("auth_environment") || "production";
};

export const apiClient = {
  /**
   * Call an edge function with action-routing pattern.
   * Automatically injects Authorization + X-Environment headers.
   */
  async invoke<T = unknown>(
    functionName: string,
    action: string,
    body: Record<string, unknown> = {}
  ): Promise<T> {
    const rawToken = localStorage.getItem("auth_token");
    const token = rawToken
      && !["undefined", "null"].includes(rawToken.trim().toLowerCase())
      && !/^[^.]+\.[^.]+\.[^.]+$/.test(rawToken.trim())
      ? rawToken.trim()
      : "";

    const headers: Record<string, string> = {
      "X-Environment": getEnvironment(),
      "x-org-id": getOrgId(),
    };
    if (token) {
      // supabase-js owns Authorization for functions.invoke, so pass the
      // browser session in a custom header that edge auth explicitly accepts.
      headers["x-app-jwt"] = token;
    }

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { action, org_id: getOrgId(), ...body },
      headers,
    });

    if (error) {
      const msg = await parseEdgeError(error, data, `${functionName}:${action} failed`);
      throw new Error(msg);
    }

    // Handle edge function returning error in body (2xx)
    if (data && typeof data === "object" && (data as any).error) {
      const msg = await parseEdgeError(null, data, `${functionName}:${action} failed`);
      throw new Error(msg);
    }

    return data as T;
  },

  /** Shorthand for auth edge function */
  auth<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    return apiClient.invoke<T>("auth", action, body);
  },

  /** Shorthand for invoices edge function */
  invoices<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    return apiClient.invoke<T>("invoices", action, body);
  },
};
