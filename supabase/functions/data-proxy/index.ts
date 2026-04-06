import { neon } from "npm:@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

const ALLOWED_TABLES = new Set([
  "invoices", "invoice_templates", "invoice_logs",
  "staff_centre_assignments", "user_approval_flags", "global_config",
]);

function safeName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return name;
}

function safeSelect(select: string): string {
  if (!select || select === "*") return "*";
  return select.split(",").map(s => safeName(s.trim())).join(", ");
}

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sql = getDb(req);
    const body = await req.json();
    const { action, table } = body;

    if (!table || !ALLOWED_TABLES.has(table)) {
      return err(400, `Invalid table: ${table}`);
    }

    const tbl = safeName(table);

    // ── QUERY ──
    if (action === "query") {
      const { select = "*", filters = {}, orFilters, order, limit, maybeSingle } = body;
      const sel = safeSelect(select);
      const params: unknown[] = [];
      const conditions: string[] = [];

      for (const [key, value] of Object.entries(filters)) {
        params.push(value);
        conditions.push(`${safeName(key)} = $${params.length}`);
      }

      if (Array.isArray(orFilters) && orFilters.length > 0) {
        const orParts = orFilters.map((filterSet: Record<string, unknown>) => {
          const sub: string[] = [];
          for (const [key, value] of Object.entries(filterSet)) {
            params.push(value);
            sub.push(`${safeName(key)} = $${params.length}`);
          }
          return sub.length === 1 ? sub[0] : `(${sub.join(" AND ")})`;
        });
        conditions.push(`(${orParts.join(" OR ")})`);
      }

      let query = `SELECT ${sel} FROM ${tbl}`;
      if (conditions.length > 0) query += ` WHERE ${conditions.join(" AND ")}`;

      if (order) {
        query += ` ORDER BY ${safeName(order.column)} ${order.ascending === false ? "DESC" : "ASC"}`;
      }

      if (maybeSingle) {
        query += " LIMIT 1";
      } else if (limit) {
        params.push(limit);
        query += ` LIMIT $${params.length}`;
      }

      const rows = await sql.query(query, params);
      return ok({ rows: maybeSingle ? (rows[0] || null) : rows });
    }

    // ── INSERT ──
    if (action === "insert") {
      const { row } = body;
      if (!row || typeof row !== "object") return err(400, "Missing row data");

      // Strip tenant fields that no longer exist in NeonDB tables
      const { org_id: _o, environment: _e, ...cleanRow } = row;
      const keys = Object.keys(cleanRow).map(k => safeName(k));
      const values = Object.values(cleanRow).map(v => (typeof v === "object" && v !== null) ? JSON.stringify(v) : v);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const query = `INSERT INTO ${tbl} (${keys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
      const rows = await sql.query(query, values);
      return ok({ row: rows[0] });
    }

    // ── UPDATE ──
    if (action === "update") {
      const { updates, filters = {} } = body;
      if (!updates || typeof updates !== "object") return err(400, "Missing updates");

      const { org_id: _o2, environment: _e2, ...cleanUpdates } = updates;
      const params: unknown[] = [];
      const setClauses: string[] = [];

      for (const [key, value] of Object.entries(cleanUpdates)) {
        params.push((typeof value === "object" && value !== null) ? JSON.stringify(value) : value);
        setClauses.push(`${safeName(key)} = $${params.length}`);
      }

      const conditions: string[] = [];
      for (const [key, value] of Object.entries(filters)) {
        params.push(value);
        conditions.push(`${safeName(key)} = $${params.length}`);
      }

      let query = `UPDATE ${tbl} SET ${setClauses.join(", ")}`;
      if (conditions.length > 0) query += ` WHERE ${conditions.join(" AND ")}`;
      query += " RETURNING *";

      const rows = await sql.query(query, params);
      return ok({ rows });
    }

    // ── DELETE ──
    if (action === "delete") {
      const { filters = {} } = body;
      const params: unknown[] = [];
      const conditions: string[] = [];

      for (const [key, value] of Object.entries(filters)) {
        params.push(value);
        conditions.push(`${safeName(key)} = $${params.length}`);
      }

      let query = `DELETE FROM ${tbl}`;
      if (conditions.length > 0) query += ` WHERE ${conditions.join(" AND ")}`;

      await sql.query(query, params);
      return ok({ success: true });
    }

    // ── UPSERT ──
    if (action === "upsert") {
      const { row, conflictKey } = body;
      if (!row || !conflictKey) return err(400, "Missing row or conflictKey");

      const { org_id: _o, environment: _e, ...cleanRow } = row;
      const keys = Object.keys(cleanRow);
      const vals = Object.values(cleanRow);
      const safeCK = safeName(conflictKey);

      const colList = keys.map(k => safeName(k)).join(", ");
      const valList = vals.map((_, i) => `$${i + 1}`).join(", ");
      const updateList = keys
        .filter(k => k !== conflictKey)
        .map(k => `${safeName(k)} = EXCLUDED.${safeName(k)}`)
        .join(", ");

      const query = `INSERT INTO ${tbl} (${colList}) VALUES (${valList}) ON CONFLICT (${safeCK}) DO UPDATE SET ${updateList} RETURNING *`;
      const rows = await sql.query(query, vals);
      return ok({ row: rows[0] });
    }

    return err(400, "Unknown action. Valid: query, insert, update, delete, upsert");
  } catch (e) {
    console.error("data-proxy error:", e);
    return err(500, String(e));
  }
});
