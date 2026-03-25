import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";


const getEnvironment = (): string => {
  return import.meta.env.MODE === "production" ? "production" : "development";
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
    const token = localStorage.getItem("auth_token");

    const headers: Record<string, string> = {
      "X-Environment": getEnvironment(),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { action, ...body },
      headers,
    });

    if (error) {
      throw new Error(error.message || "Request failed");
    }

    // Handle edge function returning error in body
    if (data?.error) {
      throw new Error(data.error);
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
