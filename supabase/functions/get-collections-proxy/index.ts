const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GET_COLLECTIONS_URL = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1/get-collections";
const EXTERNAL_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const environment = url.searchParams.get("environment") || "production";
    const orgId = url.searchParams.get("org_id") || "";
    const action = url.searchParams.get("action") || "get";
    const name = url.searchParams.get("name") || "";

    // Resolve API key based on org + environment
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

    const targetUrl = `${GET_COLLECTIONS_URL}?action=${encodeURIComponent(action)}&name=${encodeURIComponent(name)}`;

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "apikey": EXTERNAL_API_KEY,
        "x-api-key": apiKey,
        "x-org-id": orgId,
      },
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Get collections proxy error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
