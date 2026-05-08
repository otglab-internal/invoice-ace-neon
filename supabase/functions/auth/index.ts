import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Map org_id + environment to the correct tenant database secret
const ORG_DB_MAP: Record<string, { prod: string; sb: string }> = {
  otg_lab: { prod: "DATABASE_URL_OTG_PROD", sb: "DATABASE_URL_OTG_SB" },
  stridekidz: { prod: "DATABASE_URL_SK_PROD", sb: "DATABASE_URL_SK_SB" },
};

function getDb(req: Request) {
  const env = req.headers.get("x-environment") || "development";
  const isProd = env === "production";
  const org = req.headers.get("x-org-id") || "";
  const mapping = ORG_DB_MAP[org];

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
    throw new Error(`No database connection configured for org="${org}" env="${env}"`);
  }
  return neon(url);
}

// PBKDF2 helpers using Web Crypto API
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(bits));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password: string, storedHash: string, saltHex: string): Promise<boolean> {
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const hash = await hashPassword(password, salt);
  return hash === storedHash;
}

// Simple JWT (HS256) using Web Crypto
async function createJwt(payload: Record<string, unknown>): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const enc = new TextEncoder();

  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + 86400 }; // 24h expiry
  const body = btoa(JSON.stringify(claims))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${body}.${signature}`;
}

async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  try {
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const enc = new TextEncoder();
    const [header, body, signature] = token.split(".");

    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Reconstruct signature bytes
    const sigStr = signature.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sigStr + "=".repeat((4 - (sigStr.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(`${header}.${body}`));
    if (!valid) return null;

    const bodyStr = body.replace(/-/g, "+").replace(/_/g, "/");
    const bodyPadded = bodyStr + "=".repeat((4 - (bodyStr.length % 4)) % 4);
    const payload = JSON.parse(atob(bodyPadded));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Generate 6-digit 2FA code
function generate2FACode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sql = getDb(req);
    const { action, ...body } = await req.json();

    // ACTION: health-check - verify connectivity and list tables (auth required)
    if (action === "health-check") {
      const authHeader = req.headers.get("authorization");
      const claims = authHeader?.startsWith("Bearer ") ? await verifyJwt(authHeader.slice(7)) : null;
      if (!claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        await sql`SELECT 1`;
        const tables = await sql`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' ORDER BY table_name
        `;
        return new Response(JSON.stringify({ 
          status: "ok", 
          env: req.headers.get("x-environment") || "development",
          org: req.headers.get("x-org-id") || "",
          tables: tables.map((t: any) => t.table_name),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (dbErr) {
        return new Response(JSON.stringify({ status: "error", message: String(dbErr) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ACTION: init-tables - Create required tables if they don't exist (admin only)
    if (action === "init-tables") {
      const authHeader = req.headers.get("authorization");
      const claims = authHeader?.startsWith("Bearer ") ? await verifyJwt(authHeader.slice(7)) : null;
      if (!claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (claims.role !== "admin") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'sales',
            country TEXT NOT NULL DEFAULT '',
            first_date TEXT,
            expiry_date TEXT,
            company_roles TEXT[] DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS two_factor_challenges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            challenge_token TEXT UNIQUE NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS contacts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS invoices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id TEXT,
            contact_name TEXT NOT NULL,
            invoice_date TEXT NOT NULL,
            reference TEXT DEFAULT '',
            line_items JSONB NOT NULL DEFAULT '[]',
            total NUMERIC NOT NULL DEFAULT 0,
            submitted_by_system_id TEXT NOT NULL,
            submitted_by_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending_approval',
            requires_approval BOOLEAN NOT NULL DEFAULT false,
            template_id UUID,
            approval_note TEXT,
            approved_by TEXT,
            approved_at TIMESTAMPTZ,
            invoice_number TEXT,
            amendment_status TEXT,
            amendment_data JSONB,
            amendment_requested_by TEXT,
            amendment_requested_by_name TEXT,
            amendment_requested_at TIMESTAMPTZ,
            amendment_note TEXT,
            invoice_pdf_url TEXT,
            receipt_pdf_url TEXT,
            submitted_by_email TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        // Add columns that may be missing from older schemas
        await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT`);
        await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_pdf_url TEXT`);
        await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT`);
        await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS submitted_by_email TEXT`);
        await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS callback_url TEXT`);
        await sql`
          CREATE TABLE IF NOT EXISTS invoice_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            fields JSONB NOT NULL DEFAULT '[]',
            format_string TEXT NOT NULL DEFAULT '',
            requires_approval BOOLEAN NOT NULL DEFAULT false,
            created_by UUID,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS invoice_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id UUID NOT NULL,
            action_type TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'ui',
            performed_by TEXT NOT NULL DEFAULT '',
            performed_by_name TEXT NOT NULL DEFAULT '',
            details JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS staff_centre_assignments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            system_id TEXT NOT NULL,
            user_name TEXT NOT NULL DEFAULT '',
            user_role TEXT NOT NULL DEFAULT 'sales',
            tags TEXT[] DEFAULT '{}',
            centre_locations TEXT[] DEFAULT '{}',
            assigned_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS user_approval_flags (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            system_id TEXT NOT NULL,
            user_name TEXT NOT NULL DEFAULT '',
            requires_approval BOOLEAN NOT NULL DEFAULT false,
            flagged_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS global_config (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS activity_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            action_type TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'system',
            performed_by TEXT NOT NULL DEFAULT '',
            performed_by_name TEXT NOT NULL DEFAULT '',
            details JSONB NOT NULL DEFAULT '{}',
            org_id TEXT NOT NULL DEFAULT '',
            environment TEXT NOT NULL DEFAULT 'production',
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
        const tables = await sql`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' ORDER BY table_name
        `;
        return new Response(JSON.stringify({ 
          status: "ok", 
          message: "Tables initialized",
          tables: tables.map((t: any) => t.table_name),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (dbErr) {
        return new Response(JSON.stringify({ status: "error", message: String(dbErr) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    if (action === "login") {
      const { email, password } = body;
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "Email and password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const users = await sql`
        SELECT id, email, password_hash, password_salt, first_name, last_name, role, country, first_date, expiry_date
        FROM users WHERE email = ${email} LIMIT 1
      `;

      if (users.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const user = users[0];
      const valid = await verifyPassword(password, user.password_hash, user.password_salt);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate 2FA code and store it
      const code = generate2FACode();
      const challengeToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

      await sql`
        INSERT INTO two_factor_challenges (challenge_token, user_id, code, expires_at)
        VALUES (${challengeToken}, ${user.id}, ${code}, ${expiresAt})
      `;

      // In production, send code via email/SMS. For now, log it.
      console.log(`2FA code for ${email}: ${code}`);

      return new Response(
        JSON.stringify({ requires2FA: true, challengeToken }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: verify-2fa - Step 2
    if (action === "verify-2fa") {
      const { code, challengeToken } = body;
      if (!code || !challengeToken) {
        return new Response(JSON.stringify({ error: "Code and challenge token required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const challenges = await sql`
        SELECT c.user_id, c.code, c.expires_at,
               u.first_name, u.last_name, u.role, u.country, u.first_date, u.expiry_date
        FROM two_factor_challenges c
        JOIN users u ON u.id = c.user_id
        WHERE c.challenge_token = ${challengeToken}
        LIMIT 1
      `;

      if (challenges.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid challenge" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const challenge = challenges[0];

      if (new Date(challenge.expires_at) < new Date()) {
        await sql`DELETE FROM two_factor_challenges WHERE challenge_token = ${challengeToken}`;
        return new Response(JSON.stringify({ error: "Challenge expired" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (challenge.code !== code) {
        return new Response(JSON.stringify({ error: "Invalid code" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clean up challenge
      await sql`DELETE FROM two_factor_challenges WHERE challenge_token = ${challengeToken}`;

      // Generate JWT
      const token = await createJwt({
        sub: challenge.user_id,
        role: challenge.role,
        country: challenge.country,
      });

      return new Response(
        JSON.stringify({
          token,
          user: {
            firstName: challenge.first_name,
            lastName: challenge.last_name,
            role: challenge.role,
            country: challenge.country,
            firstDate: challenge.first_date,
            expiryDate: challenge.expiry_date,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: verify-token - validate existing JWT
    if (action === "verify-token") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payload = await verifyJwt(authHeader.replace("Bearer ", ""));
      if (!payload) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const users = await sql`
        SELECT first_name, last_name, role, country, first_date, expiry_date
        FROM users WHERE id = ${payload.sub} LIMIT 1
      `;

      if (users.length === 0) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const u = users[0];
      return new Response(
        JSON.stringify({
          user: {
            firstName: u.first_name,
            lastName: u.last_name,
            role: u.role,
            country: u.country,
            firstDate: u.first_date,
            expiryDate: u.expiry_date,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Auth error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
