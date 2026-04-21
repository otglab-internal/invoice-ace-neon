import { neon } from "https://esm.sh/@neondatabase/serverless@0.9.0";
import { uploadToR2, getR2PresignedUrl } from "../_shared/r2-utils.ts";
import { dispatchApiPush } from "../_shared/api-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-environment, x-org-id",
};

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab:     { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz:  { prod: "DATABASE_URL_SK_PROD",  sb: "DATABASE_URL_SK_SB" },
};

function getDbUrl(orgId: string, environment: string): string {
  const isProd = environment === "production";
  const mapping = ORG_DB_MAP[orgId];
  if (mapping) {
    return Deno.env.get(isProd ? mapping.prod : mapping.sb) || "";
  }
  return Deno.env.get(isProd ? "DATABASE_URL_PROD" : "DATABASE_URL_DEV") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle GET requests for presigned URL generation
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const storagePath = url.searchParams.get("path");
      if (!storagePath) {
        return new Response(JSON.stringify({ error: "Missing 'path' query param" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const signedUrl = await getR2PresignedUrl(storagePath, 300);

      return new Response(JSON.stringify({ signedUrl }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    const url = new URL(req.url);

    let invoiceId: string | null = null;
    let pdfBlob: Blob | null = null;
    let pdfFilename = "invoice.pdf";
    let orgId = req.headers.get("x-org-id") || url.searchParams.get("org_id") || "";
    let environment = req.headers.get("x-environment") || url.searchParams.get("environment") || "production";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      invoiceId = formData.get("invoice_id") as string;
      orgId = orgId || (formData.get("org_id") as string) || "";
      environment = environment || (formData.get("environment") as string) || "production";
      const file = formData.get("pdf") as File | null;
      if (file) {
        pdfBlob = file;
        pdfFilename = file.name || "invoice.pdf";
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      invoiceId = body.invoice_id;
      orgId = orgId || body.org_id || "";
      environment = environment || body.environment || "production";
      if (body.pdf_base64) {
        const binaryStr = atob(body.pdf_base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        pdfBlob = new Blob([bytes], { type: "application/pdf" });
        pdfFilename = body.filename || "invoice.pdf";
      }
    } else if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
      invoiceId = req.headers.get("x-invoice-id") || url.searchParams.get("invoice_id");

      if (!invoiceId) {
        return new Response(JSON.stringify({ error: "Missing x-invoice-id header or invoice_id query param" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const buffer = await req.arrayBuffer();
      pdfBlob = new Blob([buffer], { type: "application/pdf" });
      pdfFilename = "invoice.pdf";
    } else {
      return new Response(JSON.stringify({ error: "Unsupported content type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "Missing invoice_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!orgId) {
      return new Response(JSON.stringify({ error: "Missing org_id (header x-org-id, query param, or body field)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pdfBlob) {
      return new Response(
        JSON.stringify({ error: "Missing PDF data (use 'pdf' field for multipart or 'pdf_base64' for JSON)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Resolve tenant DB
    const dbUrl = getDbUrl(orgId, environment);
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: `No database configured for org=${orgId} env=${environment}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload PDF to Cloudflare R2
    const storagePath = `${invoiceId}/${pdfFilename}`;
    try {
      await uploadToR2(storagePath, pdfBlob, "application/pdf");
    } catch (uploadErr) {
      console.error("R2 upload error:", uploadErr);
      return new Response(JSON.stringify({ error: "Failed to upload PDF", details: String(uploadErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Grab invoice number from header if provided
    const invoiceNumber = req.headers.get("x-invoice-number") || null;

    // Ensure columns exist, then update invoice in tenant-specific Neon DB
    const sql = neon(dbUrl);
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS callback_url TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_pdf_url TEXT`;

    if (invoiceNumber) {
      await sql`UPDATE invoices SET invoice_pdf_url = ${storagePath}, invoice_number = ${invoiceNumber} WHERE id = ${invoiceId}`;
    } else {
      await sql`UPDATE invoices SET invoice_pdf_url = ${storagePath} WHERE id = ${invoiceId}`;
    }

    console.log(`Updated invoice ${invoiceId} in ${orgId}/${environment} with R2 path: ${storagePath}`);

    // Push to external app if this invoice was submitted via api-submit with a callback_url.
    // Distinguish unpaid vs paid by reading the current status (Xero may re-deliver the PDF after payment).
    try {
      const statusRows = await sql`SELECT status FROM invoices WHERE id = ${invoiceId} LIMIT 1` as any[];
      const currentStatus = (statusRows[0]?.status || "").toString().toLowerCase();
      const event = currentStatus === "paid" ? "paid_invoice_pdf_ready" : "invoice_pdf_ready";
      await dispatchApiPush({ sql: sql as any, invoiceId, orgId, environment, event });
    } catch (pushErr) {
      console.error("invoice-pdf-webhook: api push failed:", pushErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoice_id: invoiceId,
        storage_path: storagePath,
        org_id: orgId,
        environment,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("invoice-pdf-webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal server error", details: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
