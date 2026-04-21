import { getR2PresignedUrl } from "./r2-utils.ts";

export interface PdfAttachment {
  filename: string;
  mime_type: "application/pdf";
  base64: string;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
  }
  return btoa(binary);
}

export async function fetchPdfBase64FromR2(objectKey: string | null): Promise<{
  base64: string | null;
  error: string | null;
}> {
  if (!objectKey) return { base64: null, error: null };

  try {
    const presigned = await getR2PresignedUrl(objectKey, 300);
    const res = await fetch(presigned);
    if (!res.ok) {
      return { base64: null, error: `Failed to download PDF (status ${res.status})` };
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    return { base64: encodeBase64(bytes), error: null };
  } catch (e) {
    return { base64: null, error: (e as Error).message || "Unknown PDF fetch error" };
  }
}

export function buildPdfAttachment(filename: string, base64: string | null): PdfAttachment | null {
  if (!base64) return null;
  return {
    filename,
    mime_type: "application/pdf",
    base64,
  };
}
