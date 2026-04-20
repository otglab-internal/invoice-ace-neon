/**
 * Extracts a human-readable error message from a supabase.functions.invoke() error.
 *
 * `supabase.functions.invoke` wraps non-2xx responses as a `FunctionsHttpError`
 * with a generic message ("Edge Function returned a non-2xx status code") and
 * attaches the actual `Response` on `error.context`. We read the body to surface
 * the real error code/message returned by the edge function.
 */
export async function parseEdgeError(
  error: unknown,
  data?: unknown,
  fallback = "Request failed"
): Promise<string> {
  // 1. Edge function returned an error in the body (2xx with { error })
  if (data && typeof data === "object" && "error" in (data as any)) {
    const d = data as any;
    return formatError(d.error, d.code, d.message) || fallback;
  }

  if (!error) return fallback;
  const err = error as any;

  // 2. Try to read the underlying Response body (FunctionsHttpError)
  const response: Response | undefined = err?.context?.response ?? err?.context;
  if (response && typeof response.text === "function") {
    try {
      const text = await response.clone().text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          const msg = formatError(parsed.error, parsed.code, parsed.message);
          if (msg) return `[${response.status}] ${msg}`;
        } catch {
          // not JSON — return raw text trimmed
          return `[${response.status}] ${text.slice(0, 300)}`;
        }
      }
      return `[${response.status}] ${response.statusText || fallback}`;
    } catch {
      /* fall through */
    }
  }

  // 3. Plain Error
  if (err?.message && err.message !== "Edge Function returned a non-2xx status code") {
    return err.message;
  }

  return fallback;
}

function formatError(error?: unknown, code?: unknown, message?: unknown): string {
  const parts: string[] = [];
  if (code) parts.push(`[${String(code)}]`);
  const main = (typeof error === "string" && error) || (typeof message === "string" && message) || "";
  if (main) parts.push(main);
  else if (error && typeof error === "object") parts.push(JSON.stringify(error));
  return parts.join(" ").trim();
}
