import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

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

    if (!pdfBlob) {
      return new Response(JSON.stringify({ error: "Missing PDF data (use 'pdf' field for multipart or 'pdf_base64' for JSON)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Upload PDF to storage
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

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("invoice-pdfs")
      .getPublicUrl(storagePath);

    const pdfUrl = urlData.publicUrl;

    // Update invoices table with the PDF URL
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ invoice_pdf_url: pdfUrl })
      .eq("id", invoiceId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return new Response(JSON.stringify({ error: "PDF uploaded but failed to update invoice record", pdf_url: pdfUrl }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      invoice_id: invoiceId,
      pdf_url: pdfUrl,
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
