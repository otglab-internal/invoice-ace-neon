import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { neon } from "https://esm.sh/@neondatabase/serverless@0.9.0";

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

  // Handle GET requests for signed URL generation
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

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data, error } = await supabase.storage
        .from("invoice-pdfs")
        .createSignedUrl(storagePath, 300);

      if (error || !data?.signedUrl) {
        return new Response(JSON.stringify({ error: error?.message || "Failed to generate signed URL" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ signedUrl: data.signedUrl }), {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Upload PDF to Supabase storage
    const storagePath = `${invoiceId}/${pdfFilename}`;
    const { error: uploadError } = await supabase.storage.from("invoice-pdfs").upload(storagePath, pdfBlob, {
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

    // Grab invoice number from header if provided
    const invoiceNumber = req.headers.get("x-invoice-number") || null;

    // Ensure columns exist, then update invoice in tenant-specific Neon DB
    const sql = neon(dbUrl);
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT`;

    if (invoiceNumber) {
      await sql`UPDATE invoices SET invoice_pdf_url = ${storagePath}, invoice_number = ${invoiceNumber} WHERE id = ${invoiceId}`;
    } else {
      await sql`UPDATE invoices SET invoice_pdf_url = ${storagePath} WHERE id = ${invoiceId}`;
    }

    console.log(`Updated invoice ${invoiceId} in ${orgId}/${environment} with PDF path: ${storagePath}`);

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
