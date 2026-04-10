/**
 * Input sanitisation utilities.
 *
 * All user-supplied text that will be persisted or rendered should pass
 * through these helpers before being sent to the backend.
 */

/** Strip HTML/script tags and trim whitespace from a string value. */
export function sanitizeString(value: string): string {
  return value
    .replace(/<[^>]*>/g, "") // strip HTML tags
    .replace(/javascript:/gi, "") // strip JS protocol
    .replace(/on\w+\s*=/gi, "") // strip inline event handlers
    .replace(/\r\n/g, "\\n")  // convert CRLF to literal \n
    .replace(/\r/g, "\\n")    // convert CR to literal \n
    .replace(/\n/g, "\\n")    // convert LF to literal \n
    .trim();
}

/** Recursively sanitise all string values in an object or array. */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeString(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(sanitizeObject) as unknown as T;
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = sanitizeObject(v);
    }
    return out as T;
  }
  return obj;
}
