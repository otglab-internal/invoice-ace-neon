/**
 * Monkey-patches supabase.functions.invoke so that ANY non-2xx response
 * surfaces a human-readable error message instead of the generic
 * "Edge Function returned a non-2xx status code".
 *
 * Behavior:
 * - On error: rewrites `error.message` using parseEdgeError (reads the response body).
 * - On success-with-error-body ({ error: ... } in 2xx data): also rewrites error.message
 *   so callers that only check `error` still get a readable string.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseEdgeError } from "@/lib/edge-error";

let patched = false;

export function patchFunctionsInvoke() {
  if (patched) return;
  patched = true;

  const fns = supabase.functions as any;
  const original = fns.invoke.bind(fns);

  fns.invoke = async (functionName: string, options?: any) => {
    const result = await original(functionName, options);
    const { data, error } = result || {};

    if (error) {
      let msg = `${functionName} failed`;
      try {
        const parsed = await parseEdgeError(error, data, msg);
        if (parsed) msg = parsed;
      } catch {
        /* ignore */
      }
      // Strip the generic Supabase wrapper text if it ever leaks through.
      if (/Edge Function returned a non-2xx status code/i.test(msg)) {
        msg = `${functionName} failed`;
      }
      // Always wrap into a fresh Error so frozen `message` getters can't leak the generic text.
      const wrapped = new Error(msg);
      (wrapped as any).context = (error as any).context;
      (wrapped as any).name = (error as any).name || "FunctionsHttpError";
      return { data, error: wrapped };
    }

    return result;
  };
}
