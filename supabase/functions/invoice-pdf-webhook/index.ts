import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-invoice-id, x-filename",
};

const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function getNeonDb(orgId: string, environment: string) {
  const isProd = environment === "production";
  const mapping = ORG_DB_MAP[orgId];

  let url: string | undefined;
  if (mapping) {
    url = Deno.env.get(isProd ? mapping.prod : mapping.sb);
  }
  if (!url) {
    url = isProd
      ? Deno.env.get("DATABASE_URL_PROD")
      : Deno.env.get("DATABASE_URL_DEV");
  }
  if (!url) {
    throw new Error(`No database connection configured for org="${orgId}" env="${environment}"`);
  }
  return neon(url);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    const url = new URL(req.url);

    // Resolve org and environment from headers or query params
    const orgId = req.headers.get("x-org-id") || url.searchParams.get("org_id") || "otg_lab";
    const environment = req.headers.get("x-environment") || url.searchParams.get("environment") || "production";

    let invoiceId: string | null = null;
    let pdfBlob: Blob | null = null;
    let pdfFilename = "invoice.pdf";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      invoiceId = formData.get("invoice_id") as string;
      const file = formData.get("pdf") as File | null;
      if (file) {
        pdfBlob = file;
        pdfFilename = file.name || "invoice.pdf";
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      invoiceId = body.invoice_id;
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
      invoiceId = url.searchParams.get("invoice_id") || req.headers.get("x-invoice-id");
      pdfFilename = url.searchParams.get("filename") || req.headers.get("x-filename") || "invoice.pdf";
      const arrayBuffer = await req.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        pdfBlob = new Blob([arrayBuffer], { type: "application/pdf" });
      }
    } else {
      return new Response(JSON.stringify({ error: "Unsupported content type. Use multipart/form-data, application/json, or application/pdf" }), {
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

    if (!pdfBlob) {
      return new Response(JSON.stringify({ error: "Missing PDF data (use 'pdf' field for multipart or 'pdf_base64' for JSON)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload PDF to Supabase Storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const storagePath = `${invoiceId}/${pdfFilename}`;
    const { error: uploadError } = await supabase.storage
      .from("invoice-pdfs")
      .upload(storagePath, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return new Response(JSON.stringify({ error: "Failed to upload PDF", details: uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update invoice record in Neon DB (where invoices actually live)
    try {
      const sql = getNeonDb(orgId, environment);
      await sql`UPDATE invoices SET invoice_pdf_url = ${storagePath} WHERE id = ${invoiceId}::uuid`;
      console.log(`Updated invoice ${invoiceId} with pdf path ${storagePath} in Neon (${orgId}/${environment})`);
    } catch (dbErr) {
      console.error("Neon DB update error:", dbErr);
      return new Response(JSON.stringify({ error: "PDF uploaded but failed to update invoice record in database", storage_path: storagePath }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      invoice_id: invoiceId,
      storage_path: storagePath,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("invoice-pdf-webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
