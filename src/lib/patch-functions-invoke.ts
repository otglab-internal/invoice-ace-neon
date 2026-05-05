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
      try {
        const msg = await parseEdgeError(error, data, `${functionName} failed`);
        if (msg) {
          try { (error as any).message = msg; } catch { /* readonly — ignore */ }
          // Some Supabase error objects have a frozen message; wrap into a new Error.
          if ((error as any).message !== msg) {
            const wrapped = new Error(msg);
            (wrapped as any).context = (error as any).context;
            (wrapped as any).name = (error as any).name || "FunctionsHttpError";
            return { data, error: wrapped };
          }
        }
      } catch {
        /* ignore */
      }
    }

    return result;
  };
}
