import { neon } from "npm:@neondatabase/serverless";
import { SMTPClient } from "npm:emailjs@4.0.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

export async function getApproverEmails(sql: ReturnType<typeof neon>, centreLocations: string[]): Promise<string[]> {
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

  return matchingIds;
}

export async function sendEmailViaSMTP(
  config: SmtpConfig,
  to: string[],
  subject: string,
  htmlBody: string
): Promise<void> {
  const client = new SMTPClient({
    user: config.user,
    password: config.pass,
    host: config.host,
    port: config.port,
    tls: config.port === 465,
    ssl: config.port === 465,
  });

  for (const recipient of to) {
    try {
      await client.sendAsync({
        from: `${config.from_name} <${config.from_email}>`,
        to: recipient,
        subject,
        attachment: [{ data: htmlBody, alternative: true }],
      });
    } catch (err) {
      console.error(`Failed to send email to ${recipient}:`, err);
      throw err;
    }
  }
}

export function buildApprovalEmailHtml(invoice: Record<string, any>): string {
  const lineItemsHtml = (invoice.line_items || [])
    .map(
      (li: any) =>
        `<tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${li.description || ""}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${li.quantity}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">RM ${Number(li.cost).toFixed(2)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">RM ${(Number(li.quantity) * Number(li.cost)).toFixed(2)}</td>
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
        <tr><td style="padding:4px 0;color:#6b7280;">Total:</td><td style="padding:4px 0;font-weight:600;font-size:18px;">RM ${Number(invoice.total).toFixed(2)}</td></tr>
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
