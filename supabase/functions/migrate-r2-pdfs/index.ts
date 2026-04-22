/**
 * One-off migration: move R2 PDFs from the legacy <invoiceId>/<filename>
 * layout to a flat layout:
 *   - invoices/<invoiceId>.pdf
 *   - receipts/<invoiceId>.pdf
 *
 * For each tenant DB it:
 *   1. Finds invoices whose invoice_pdf_url / receipt_pdf_url is a legacy
 *      key (not already prefixed with "invoices/" or "receipts/").
 *   2. Copies the R2 object to the new key.
 *   3. Updates the DB column to the new key.
 *   4. Deletes the old R2 object.
 *
 * Trigger via POST. Optional body { dry_run: true } to preview without writing.
 */
import { neon } from "npm:@neondatabase/serverless";
import { copyR2Object, deleteR2Object } from "../_shared/r2-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TENANTS: { org: string; env: string; secret: string }[] = [
  { org: "otg_lab",    env: "production", secret: "DATABASE_URL_OTG_PROD" },
  { org: "otg_lab",    env: "sandbox",    secret: "DATABASE_URL_OTG_SB" },
  { org: "stridekidz", env: "production", secret: "DATABASE_URL_SK_PROD" },
  { org: "stridekidz", env: "sandbox",    secret: "DATABASE_URL_SK_SB" },
];

interface RowResult {
  invoice_id: string;
  kind: "invoice" | "receipt";
  old_key: string;
  new_key: string;
  status: "migrated" | "missing_in_r2" | "already_migrated" | "error";
  error?: string;
}

interface TenantResult {
  org: string;
  env: string;
  scanned: number;
  migrated: number;
  missing: number;
  already: number;
  errors: number;
  rows: RowResult[];
  fatal?: string;
}

function newKeyFor(invoiceId: string, kind: "invoice" | "receipt"): string {
  return kind === "invoice" ? `invoices/${invoiceId}.pdf` : `receipts/${invoiceId}.pdf`;
}

function isLegacyKey(key: string | null): boolean {
  if (!key) return false;
  if (key.startsWith("invoices/") || key.startsWith("receipts/")) return false;
  return key.includes("/"); // legacy form is "<uuid>/<filename>"
}

async function migrateOne(
  invoiceId: string,
  kind: "invoice" | "receipt",
  oldKey: string,
  dryRun: boolean,
  sql: ReturnType<typeof neon>,
): Promise<RowResult> {
  const newKey = newKeyFor(invoiceId, kind);

  if (oldKey === newKey) {
    return { invoice_id: invoiceId, kind, old_key: oldKey, new_key: newKey, status: "already_migrated" };
  }

  if (dryRun) {
    return { invoice_id: invoiceId, kind, old_key: oldKey, new_key: newKey, status: "migrated" };
  }

  try {
    const copied = await copyR2Object(oldKey, newKey);
    if (!copied) {
      // Source missing — still update DB to the new (intended) key? No — leave DB alone so we don't break the link.
      // Instead, blank the column so the UI doesn't try to load a non-existent path.
      const column = kind === "invoice" ? "invoice_pdf_url" : "receipt_pdf_url";
      await sql.query(`UPDATE invoices SET ${column} = NULL WHERE id = $1`, [invoiceId]);
      return { invoice_id: invoiceId, kind, old_key: oldKey, new_key: newKey, status: "missing_in_r2" };
    }

    const column = kind === "invoice" ? "invoice_pdf_url" : "receipt_pdf_url";
    await sql.query(`UPDATE invoices SET ${column} = $2 WHERE id = $1`, [invoiceId, newKey]);

    // Best-effort cleanup of the old object.
    try {
      await deleteR2Object(oldKey);
    } catch (delErr) {
      console.warn(`migrate-r2-pdfs: failed to delete old key ${oldKey}:`, delErr);
    }

    return { invoice_id: invoiceId, kind, old_key: oldKey, new_key: newKey, status: "migrated" };
  } catch (err) {
    return {
      invoice_id: invoiceId,
      kind,
      old_key: oldKey,
      new_key: newKey,
      status: "error",
      error: String(err),
    };
  }
}

async function migrateTenant(
  tenant: typeof TENANTS[number],
  dryRun: boolean,
): Promise<TenantResult> {
  const result: TenantResult = {
    org: tenant.org,
    env: tenant.env,
    scanned: 0,
    migrated: 0,
    missing: 0,
    already: 0,
    errors: 0,
    rows: [],
  };

  const dbUrl = Deno.env.get(tenant.secret);
  if (!dbUrl) {
    result.fatal = `Missing secret ${tenant.secret}`;
    return result;
  }

  try {
    const sql = neon(dbUrl);
    // Ensure expected columns exist on this tenant (older tenants may pre-date receipt_pdf_url).
    await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_pdf_url TEXT`);
    await sql.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_pdf_url TEXT`);

    const rows = await sql.query(
      `SELECT id, invoice_pdf_url, receipt_pdf_url
         FROM invoices
        WHERE invoice_pdf_url IS NOT NULL OR receipt_pdf_url IS NOT NULL`,
    ) as Array<{ id: string; invoice_pdf_url: string | null; receipt_pdf_url: string | null }>;

    for (const row of rows) {
      if (isLegacyKey(row.invoice_pdf_url)) {
        result.scanned++;
        const r = await migrateOne(row.id, "invoice", row.invoice_pdf_url!, dryRun, sql);
        result.rows.push(r);
        if (r.status === "migrated") result.migrated++;
        else if (r.status === "missing_in_r2") result.missing++;
        else if (r.status === "already_migrated") result.already++;
        else if (r.status === "error") result.errors++;
      }
      if (isLegacyKey(row.receipt_pdf_url)) {
        result.scanned++;
        const r = await migrateOne(row.id, "receipt", row.receipt_pdf_url!, dryRun, sql);
        result.rows.push(r);
        if (r.status === "migrated") result.migrated++;
        else if (r.status === "missing_in_r2") result.missing++;
        else if (r.status === "already_migrated") result.already++;
        else if (r.status === "error") result.errors++;
      }
    }
  } catch (err) {
    result.fatal = String(err);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let dryRun = false;
  let onlyTenant: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    dryRun = Boolean(body?.dry_run);
    onlyTenant = body?.tenant || null; // e.g. "otg_lab:production"
  } catch {
    /* ignore */
  }

  const targets = onlyTenant
    ? TENANTS.filter(t => `${t.org}:${t.env}` === onlyTenant)
    : TENANTS;

  const results: TenantResult[] = [];
  for (const t of targets) {
    console.log(`migrate-r2-pdfs: starting ${t.org}/${t.env} (dry_run=${dryRun})`);
    const r = await migrateTenant(t, dryRun);
    console.log(`migrate-r2-pdfs: done ${t.org}/${t.env} — migrated=${r.migrated} missing=${r.missing} errors=${r.errors}`);
    results.push(r);
  }

  return new Response(
    JSON.stringify({ dry_run: dryRun, results }, null, 2),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
