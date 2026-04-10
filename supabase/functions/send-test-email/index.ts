import { neon } from "npm:@neondatabase/serverless";
import { getSmtpConfig, sendEmailViaSMTP } from "../_shared/email-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to } = await req.json();
    if (!to || typeof to !== "string" || !to.includes("@")) {
      return new Response(JSON.stringify({ error: "Invalid 'to' email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const environment = req.headers.get("x-environment") || "production";
    const orgId = req.headers.get("x-org-id") || "";
    const isProd = environment !== "sandbox";

    const mapping = DB_MAP[orgId];
    const dbKey = mapping
      ? (isProd ? mapping.prod : mapping.sb)
      : `DATABASE_URL_${orgId}_${isProd ? "PROD" : "SB"}`.toUpperCase();

    const databaseUrl = Deno.env.get(dbKey);
    if (!databaseUrl) {
      return new Response(JSON.stringify({ error: `Database not configured for ${dbKey}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sql = neon(databaseUrl);
    const smtpConfig = await getSmtpConfig(sql);
    if (!smtpConfig) {
      return new Response(JSON.stringify({ error: "SMTP not configured. Please save SMTP settings first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#1a1a1a;">✅ SMTP Test Email</h2>
        <p style="color:#6b7280;">This is a test email from the Invoice Center.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:4px 0;color:#6b7280;">SMTP Host:</td><td style="padding:4px 0;">${smtpConfig.host}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">SMTP Port:</td><td style="padding:4px 0;">${smtpConfig.port}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">From:</td><td style="padding:4px 0;">${smtpConfig.from_name} &lt;${smtpConfig.from_email}&gt;</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Environment:</td><td style="padding:4px 0;">${environment}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Sent at:</td><td style="padding:4px 0;">${new Date().toISOString()}</td></tr>
        </table>
        <p style="color:#9ca3af;font-size:12px;">If you received this email, your SMTP configuration is working correctly.</p>
      </div>
    `;

    await sendEmailViaSMTP(smtpConfig, [to.trim()], "SMTP Test – Invoice Center", htmlBody);

    return new Response(JSON.stringify({ success: true, message: `Test email sent to ${to}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Send test email error:", err);
    return new Response(
      JSON.stringify({
        error: "Failed to send test email",
        details: err.message || String(err),
        stack: err.stack || null,
        code: err.code || null,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
