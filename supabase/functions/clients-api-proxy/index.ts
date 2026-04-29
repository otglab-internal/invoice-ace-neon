const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CLIENTS_API_URL = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1/clients-api";
const EXTERNAL_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const environment = req.headers.get("x-environment") || "production";
    const orgId = req.headers.get("x-org-id") || "";

    const orgUpper = orgId === "stridekidz" ? "SK" : "OTG";
    const envSuffix = environment === "sandbox" ? "SB" : "PROD";
    const apiKey = Deno.env.get(`AUTH_API_KEY_${orgUpper}_${envSuffix}`) ||
                   Deno.env.get(environment === "sandbox" ? "AUTH_API_KEY_SANDBOX" : "AUTH_API_KEY_PROD") || "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key not configured for this environment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.text();

    const response = await fetch(CLIENTS_API_URL, {
      method: "POST",
      headers: {
        "apikey": EXTERNAL_API_KEY,
        "x-api-key": apiKey,
        "x-org-id": orgId,
        "Content-Type": "application/json",
      },
      body,
    });

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Clients API proxy error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
