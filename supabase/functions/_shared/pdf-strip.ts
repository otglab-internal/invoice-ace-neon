import { PDFDocument } from "npm:pdf-lib";

/**
 * Load a PDF and re-save it without any encryption, password, or
 * permission restrictions. If the input is unencrypted this is a no-op
 * (it just round-trips the bytes). If loading fails for any reason we
 * fall back to the original bytes so we never break the upload pipeline.
 *
 * Note: pdf-lib only loads encrypted PDFs when `ignoreEncryption: true`
 * is passed; the resulting saved document drops the security dictionary
 * entirely, producing an unprotected PDF.
 */
export async function stripPdfProtection(pdfBytes: Uint8Array): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
    return await doc.save({ useObjectStreams: false });
  } catch (err) {
    console.warn("stripPdfProtection: failed to re-save PDF, using original bytes:", err);
    return pdfBytes;
  }
}
