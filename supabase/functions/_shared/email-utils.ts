import { neon } from "npm:@neondatabase/serverless";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1/get-users";
const GATEWAY_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from_email: string;
  from_name: string;
}

export async function getSmtpConfig(sql: ReturnType<typeof neon>): Promise<SmtpConfig | null> {
  const rows = await sql`
    SELECT key, value FROM global_config
    WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_email', 'smtp_from_name')
  `;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  if (!map.smtp_host || !map.smtp_user || !map.smtp_pass) return null;

  return {
    host: map.smtp_host,
    port: Number(map.smtp_port) || 587,
    user: map.smtp_user,
    pass: map.smtp_pass,
    from_email: map.smtp_from_email || map.smtp_user,
    from_name: map.smtp_from_name || "Invoice Center",
  };
}

export async function getSandboxTestEmail(sql: ReturnType<typeof neon>): Promise<string | null> {
  const rows = await sql`
    SELECT value FROM global_config WHERE key = 'sandbox_test_email'
  `;
  const val = rows[0]?.value;
  return val && val.trim() ? val.trim() : null;
}

/**
 * Resolve an array of exact user IDs to email addresses via the Federation Gateway.
 * Direct email addresses are passed through unchanged.
 */
export async function resolveSystemIdsToEmails(
  systemIds: string[],
  orgId: string,
  environment: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (systemIds.length === 0) return result;

  // Separate emails from UUIDs
  const uuidsToResolve: string[] = [];
  for (const id of systemIds) {
    if (id.includes("@")) {
      result[id] = id;
    } else {
      uuidsToResolve.push(id);
    }
  }
  if (uuidsToResolve.length === 0) return result;

  const orgUpper = orgId === "stridekidz" ? "SK" : "OTG";
  const envSuffix = environment === "sandbox" ? "SB" : "PROD";
  const authApiKey = Deno.env.get(`AUTH_API_KEY_${orgUpper}_${envSuffix}`) ||
    Deno.env.get(environment === "sandbox" ? "AUTH_API_KEY_SANDBOX" : "AUTH_API_KEY_PROD") || "";

  try {
    const gwRes = await fetch(GATEWAY_URL, {
      method: "GET",
      headers: {
        "apikey": GATEWAY_API_KEY,
        "x-api-key": authApiKey,
        "x-org-id": orgId,
      },
    });
    if (gwRes.ok) {
      const gwData = await gwRes.json();
      const users = gwData.data || [];
      for (const uuid of uuidsToResolve) {
        for (const u of users) {
          if (u.id === uuid && u.email) {
            result[uuid] = u.email;
            console.log(`email-utils: Resolved ${uuid} -> ${u.email} (id match)`);
            break;
          }
        }
        if (!result[uuid]) {
          console.warn(`email-utils: Could not resolve exact user id ${uuid} to any email`);
        }
      }
    } else {
      console.error(`email-utils: Gateway get-users failed: ${gwRes.status}`);
    }
  } catch (gwErr) {
    console.error(`email-utils: Gateway lookup error:`, gwErr);
  }

  return result;
}

export async function getApproverEmails(
  sql: ReturnType<typeof neon>,
  centreLocations: string[],
  orgId: string,
  environment: string,
): Promise<string[]> {
  const approvers = await sql`
    SELECT system_id, centre_locations, user_role
    FROM staff_centre_assignments
    WHERE 'approver' = ANY(tags)
  `;

  const matchingIds: string[] = [];
  for (const a of approvers) {
    const role = (a.user_role || "").toLowerCase();
    if (role === "admin" || role === "management") {
      matchingIds.push(a.system_id);
    } else {
      const aLocations: string[] = a.centre_locations || [];
      if (centreLocations.some((loc) => aLocations.includes(loc))) {
        matchingIds.push(a.system_id);
      }
    }
  }

  if (matchingIds.length === 0) return [];

  // Resolve UUIDs to emails
  const emailMap = await resolveSystemIdsToEmails(matchingIds, orgId, environment);
  const emails = matchingIds.map((id) => emailMap[id]).filter(Boolean) as string[];
  
  if (emails.length === 0) {
    console.warn(`email-utils: Found ${matchingIds.length} approver IDs but resolved 0 emails`);
  }

  return emails;
}

export async function sendEmailViaSMTP(
  config: SmtpConfig,
  to: string[],
  subject: string,
  htmlBody: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  for (const recipient of to) {
    await transporter.sendMail({
      from: `${config.from_name} <${config.from_email}>`,
      to: recipient,
      subject,
      html: htmlBody,
    });
  }
}

export function buildApprovalEmailHtml(invoice: Record<string, any>): string {
  // Per-invoice currency captured at submission time. Falls back to RM for legacy rows.
  const cur = invoice.currency || "RM";
  const lineItemsHtml = (invoice.line_items || [])
    .map(
      (li: any) =>
        `<tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${(li.description || "").replace(/\\n/g, "<br>").replace(/\n/g, "<br>")}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${li.quantity}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${cur} ${Number(li.cost).toFixed(2)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${cur} ${(Number(li.quantity) * Number(li.cost)).toFixed(2)}</td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#1a1a1a;">Invoice Requires Approval</h2>
      <p style="color:#6b7280;">A new invoice has been submitted and requires your approval.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;">Invoice ID:</td><td style="padding:4px 0;font-weight:600;">${invoice.invoice_number || invoice.id?.slice(0, 8).toUpperCase() || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Contact:</td><td style="padding:4px 0;">${invoice.contact_name || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Date:</td><td style="padding:4px 0;">${invoice.invoice_date || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Reference:</td><td style="padding:4px 0;">${invoice.reference || "-"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Submitted By:</td><td style="padding:4px 0;">${invoice.submitted_by_name || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Total:</td><td style="padding:4px 0;font-weight:600;font-size:18px;">${cur} ${Number(invoice.total).toFixed(2)}</td></tr>
      </table>
      <h3 style="color:#1a1a1a;margin-top:16px;">Line Items</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Description</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:center;">Qty</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">Cost</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>
      <p style="color:#6b7280;margin-top:16px;font-size:12px;">Please log in to the Invoice Center to approve or reject this invoice.</p>
    </div>
  `;
}

export function buildApprovedEmailHtml(invoice: Record<string, any>): string {
  const lineItemsHtml = (invoice.line_items || [])
    .map(
      (li: any) =>
        `<tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${(li.description || "").replace(/\\n/g, "<br>").replace(/\n/g, "<br>")}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${li.quantity}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">RM ${Number(li.cost).toFixed(2)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">RM ${(Number(li.quantity) * Number(li.cost)).toFixed(2)}</td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#16a34a;">Invoice Approved</h2>
      <p style="color:#6b7280;">An invoice has been approved and is being processed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;">Invoice ID:</td><td style="padding:4px 0;font-weight:600;">${invoice.invoice_number || invoice.id?.slice(0, 8).toUpperCase() || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Contact:</td><td style="padding:4px 0;">${invoice.contact_name || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Date:</td><td style="padding:4px 0;">${invoice.invoice_date || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Reference:</td><td style="padding:4px 0;">${invoice.reference || "—"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Submitted By:</td><td style="padding:4px 0;">${invoice.submitted_by_name || "N/A"}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Total:</td><td style="padding:4px 0;font-weight:600;font-size:18px;">RM ${Number(invoice.total).toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Status:</td><td style="padding:4px 0;"><span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">APPROVED</span></td></tr>
      </table>
      <h3 style="color:#1a1a1a;margin-top:16px;">Line Items</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Description</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:center;">Qty</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">Cost</th>
            <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>
      <p style="color:#6b7280;margin-top:16px;font-size:12px;">This invoice has been approved and will be pushed to Xero for processing.</p>
    </div>
  `;
}
