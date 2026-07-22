import React, { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, KeyRound } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const INVOICES = `${SUPABASE_URL}/functions/v1/invoices`;
const XERO = `${SUPABASE_URL}/functions/v1/xero`;
const LOGIN = `${SUPABASE_URL}/functions/v1/login-proxy`;
const PDF_WEBHOOK = `${SUPABASE_URL}/functions/v1/invoice-pdf-webhook`;

const ApiDocsPage: React.FC = () => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "missing" | "failed">("idle");
  const currentJwt = useMemo(() => {
    try {
      return localStorage.getItem("auth_token") || "";
    } catch {
      return "";
    }
  }, []);

  const copyCurrentJwt = async () => {
    if (!currentJwt) {
      setCopyStatus("missing");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentJwt);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground">API Documentation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            External API endpoints for programmatic invoice submission, retrieval and Xero contact management.
          </p>
        </div>

        {/* Authentication */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-amber-600 text-xs">AUTH</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Authentication</h2>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold text-foreground">Current browser session JWT</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  For CRM testing, copy this after logging in and completing 2FA, then use it as the raw <code>x-app-jwt</code> header value.
                </p>
                {copyStatus === "copied" && <p className="mt-1 text-xs text-primary">Copied. Use it without a Bearer prefix.</p>}
                {copyStatus === "missing" && <p className="mt-1 text-xs text-destructive">No JWT found. Sign out, sign in again, and complete 2FA.</p>}
                {copyStatus === "failed" && <p className="mt-1 text-xs text-destructive">Unable to copy automatically. Check browser clipboard permissions.</p>}
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={copyCurrentJwt} className="shrink-0">
              <Copy className="mr-2 h-4 w-4" />
              Copy JWT
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            The Federated Gateway now uses <strong>API keys</strong> as the primary credential for
            inter-system access. There is no JWT or session token required for system-to-system calls.
          </p>
          <ol className="text-xs text-muted-foreground list-decimal pl-5 space-y-1">
            <li>
              <strong>Gateway auth</strong> — the Supabase publishable (anon) key on <code>apikey</code> and <code>Authorization: Bearer &lt;anon&gt;</code>. Proves the call is allowed to reach the function.
            </li>
            <li>
              <strong>System auth</strong> — your system's API key on <code>x-api-key</code>. The gateway validates the key and resolves which systems it may act on (<code>allowedSystemIds</code>). Use this for all machine-to-machine calls (CRM → Invoice, etc.).
            </li>
            <li>
              <strong>User session (browser only)</strong> — the opaque session token issued by <code>login-proxy</code> after 2FA is sent as <code>x-app-jwt</code>. Only the web UI needs this path. External integrations should never use it.
            </li>
          </ol>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Tenant routing (always required)</p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li><code>x-org-id</code> — organisation slug, e.g. <code>stridekidz</code> or <code>otg_lab</code>.</li>
              <li><code>x-environment</code> — <code>sandbox</code> or <code>production</code>.</li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Full header set (system-to-system)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`Content-Type: application/json
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
x-api-key: <your system API key>
x-org-id: otg_lab
x-environment: sandbox`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Before calling on behalf of another system, verify your key's <code>allowedSystemIds</code>
              includes that target. The gateway will reject the request with <code>403 system_not_allowed</code>
              otherwise.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Public endpoints (no auth beyond anon key)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`Content-Type: application/json
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
x-org-id: otg_lab
x-environment: sandbox`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>api-submit</code>, <code>api-get</code>, and the PDF webhook currently accept the
              anon key only. To restrict them to registered systems, add <code>x-api-key</code> and the
              gateway will enforce allowed-system checks.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Migrating from JWT</p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li>Remove any 2-step login flow (<code>login</code> → <code>verify-2fa</code>) from server-to-server code.</li>
              <li>Remove the <code>x-app-jwt</code> header from machine-to-machine callers and replace it with <code>x-api-key</code>.</li>
              <li>No token expiry / refresh logic required — API keys are long-lived and rotated out-of-band.</li>
            </ul>
          </div>

        </Card>

        {/* Endpoint map */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold font-display text-foreground">Endpoint Overview</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">URL</th>
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Action</th>
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Purpose</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">App JWT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-foreground">
                <tr><td className="py-2 pr-4 font-mono break-all">/functions/v1/invoices</td><td className="py-2 pr-4 font-mono">api-submit</td><td className="py-2 pr-4 text-muted-foreground">Create invoice from external system</td><td className="py-2 text-muted-foreground">No</td></tr>
                <tr><td className="py-2 pr-4 font-mono break-all">/functions/v1/invoices</td><td className="py-2 pr-4 font-mono">api-get</td><td className="py-2 pr-4 text-muted-foreground">Fetch invoice + PDFs (base64)</td><td className="py-2 text-muted-foreground">No</td></tr>
                <tr><td className="py-2 pr-4 font-mono break-all">/functions/v1/xero</td><td className="py-2 pr-4 font-mono">list-xero-contacts</td><td className="py-2 pr-4 text-muted-foreground">Search Xero contacts (paginated)</td><td className="py-2 text-muted-foreground">Yes</td></tr>
                <tr><td className="py-2 pr-4 font-mono break-all">/functions/v1/xero</td><td className="py-2 pr-4 font-mono">create-xero-contact</td><td className="py-2 pr-4 text-muted-foreground">Find-or-create Xero contact by name</td><td className="py-2 text-muted-foreground">Yes</td></tr>
                <tr><td className="py-2 pr-4 font-mono break-all">/functions/v1/invoice-pdf-webhook</td><td className="py-2 pr-4 font-mono">—</td><td className="py-2 pr-4 text-muted-foreground">n8n uploads Xero PDF back to the app</td><td className="py-2 text-muted-foreground">No</td></tr>
                <tr><td className="py-2 pr-4 font-mono break-all">/functions/v1/login-proxy</td><td className="py-2 pr-4 font-mono">login, verify-2fa</td><td className="py-2 pr-4 text-muted-foreground">Mint an x-app-jwt</td><td className="py-2 text-muted-foreground">No</td></tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* Submit Invoice */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Submit Invoice — api-submit</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">{INVOICES}</code>
          <p className="text-xs text-muted-foreground">
            Push an invoice with multi-line items from an external system (e.g. Open Text). The invoice runs through the same approval workflow as UI-created invoices. No <code>x-app-jwt</code> required.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  action: "api-submit",
  system_id: "EXT-SYSTEM-001",
  user_id: "user-abc-123",
  user_email: "requester@example.com",
  source_system: "OPENTEXT-PROD",
  source_system_name: "Open Text",
  callback_url: "https://your-app.example.com/webhooks/invoice-updates",
  contact_id: "optional-xero-contact-uuid",
  contact_name: "Lee Music Academy",
  invoice_date: "22/03/2026",
  reference: "PO-12345",
  currency: "SGD",
  line_items: [
    {
      description: "Piano Lesson — Grade 3\nStudent: John\nPackage: Monthly",
      quantity: 4,
      cost: 150.00,
      account: "400",
      center: "KL Center"
    },
    {
      description: "Registration Fee",
      quantity: 1,
      cost: 50.00,
      account: "200",
      center: "KL Center"
    }
  ]
}, null, 2)}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Required Fields</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Field</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr><td className="py-2 pr-4 font-mono text-foreground">action</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Must be <code>"api-submit"</code></td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">system_id</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">External system identifier (e.g. Open Text instance ID)</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">user_id</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">ID of the user who requested this invoice</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">contact_name</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Bill-to contact name</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">invoice_date</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Date in DD/MM/YYYY format (GMT+8)</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">line_items</td><td className="py-2 pr-4">array</td><td className="py-2 text-muted-foreground">One or more line items (see schema below)</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Optional Fields</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Field</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr><td className="py-2 pr-4 font-mono text-foreground">reference</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">PO or reference number</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">user_email</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Requester email. If omitted, resolved from <code>user_id</code> via the user directory. Required for payment notifications.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">user_name</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Display name of the submitter (falls back to user directory).</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">contact_id</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Xero contact ID. Omit to let downstream processing create/match the contact by name.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">currency</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground"><code>"SGD"</code> or <code>"MYR"</code> (case-insensitive). If omitted, uses the org's global currency.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">callback_url</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Signed HTTPS webhook receiver for PDF-ready events. See "Webhook Push Notifications".</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">source_system</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Slug of the calling system (e.g. <code>"OPENTEXT-PROD"</code>). Recorded in audit log and appended to the submitter name as <code>(via …)</code>.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">source_system_name</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Human-readable name (e.g. <code>"Open Text"</code>). Preferred over <code>source_system</code> for the <code>(via …)</code> label.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>Approval behaviour:</strong> auto-approves unless the submitting user is in <code>user_approval_flags</code>. Flagged invoices land in <code>pending_approval</code> and trigger the standard approver email + n8n workflow. Templates are UI-only and ignored on this endpoint.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Line Item Fields</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Field</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr><td className="py-2 pr-4 font-mono text-foreground">description</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Multi-line text (use <code>\n</code> — the literal escape is preserved end-to-end)</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">quantity</td><td className="py-2 pr-4">number</td><td className="py-2 text-muted-foreground">Quantity</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">cost</td><td className="py-2 pr-4">number</td><td className="py-2 text-muted-foreground">Unit cost</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">account</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Xero account code. <code>account_code</code> / <code>accountCode</code> also accepted and normalised.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">center</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Tracking category / center name</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (200)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  success: true,
  invoice_id: "uuid-of-created-invoice",
  status: "pending_approval",
  requires_approval: true,
  total: 650.00
}, null, 2)}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Error Response (400)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({ error: "Missing required fields: system_id, contact_name" }, null, 2)}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">cURL Example</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${INVOICES}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: <SUPABASE_ANON_KEY>' \\
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\
  -H 'x-org-id: otg_lab' \\
  -H 'x-environment: sandbox' \\
  -d '{
    "action": "api-submit",
    "system_id": "OPENTEXT-001",
    "user_id": "user-123",
    "contact_name": "Lee Music Academy",
    "invoice_date": "22/03/2026",
    "reference": "PO-99",
    "line_items": [
      {
        "description": "Piano Lesson\\nGrade 3\\nMonthly",
        "quantity": 4,
        "cost": 150,
        "account": "400",
        "center": "KL Center"
      }
    ]
  }'`}
            </pre>
          </div>
        </Card>

        {/* api-get */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Fetch Invoice — api-get</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">{INVOICES}</code>
          <p className="text-xs text-muted-foreground">
            Returns the current state of an invoice (status, totals, line items, approver info) plus the INV PDF and, once paid, the receipt PDF inlined as base64. No <code>x-app-jwt</code> required.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({ action: "api-get", invoice_id: "uuid-returned-by-api-submit" }, null, 2)}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (200)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  success: true,
  invoice: {
    id: "uuid",
    invoice_number: "INV-001",
    status: "paid",
    contact_id: "xero-contact-uuid",
    contact_name: "Lee Music Academy",
    invoice_date: "22/03/2026",
    reference: "PO-99",
    line_items: ["..."],
    total: 650.00,
    currency: "SGD$",
    requires_approval: true,
    submitted_by_system_id: "system-id",
    submitted_by_name: "Jane Doe",
    submitted_by_email: "jane@example.com",
    approved_by: "approver-system-id",
    approved_at: "2026-03-22T10:00:00+08:00",
    approval_note: null,
    created_at: "2026-03-22T09:55:00+08:00"
  },
  invoice_pdf: {
    filename: "INV-001.pdf",
    mime_type: "application/pdf",
    base64: "JVBERi0xLjQKJeLjz9MK..."
  },
  invoice_pdf_error: null,
  receipt_pdf: {
    filename: "Receipt_INV-001.pdf",
    mime_type: "application/pdf",
    base64: "JVBERi0xLjQKJeLjz9MK..."
  },
  receipt_pdf_error: null
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>invoice_pdf</code> is <code>null</code> until Xero has generated the PDF (after approval / sync). <code>receipt_pdf</code> is <code>null</code> until the invoice is paid and the backend has generated the receipt.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">cURL</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${INVOICES}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: <SUPABASE_ANON_KEY>' \\
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\
  -H 'x-org-id: otg_lab' \\
  -H 'x-environment: sandbox' \\
  -d '{
    "action": "api-get",
    "invoice_id": "00000000-0000-0000-0000-000000000000"
  }'`}
            </pre>
          </div>
        </Card>

        {/* Push notifications */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Badge className="bg-indigo-600 text-xs">PUSH</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Webhook Push Notifications</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            If you include a <code>callback_url</code> in <code>api-submit</code>, we POST a signed JSON payload to that URL whenever a new artifact becomes available for the invoice. No polling required.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Events</p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li><code>invoice_pdf_ready</code> — Xero generated the unpaid INV PDF (typically right after approval).</li>
              <li><code>paid_invoice_pdf_ready</code> — invoice marked paid in Xero; refreshed PDF is included.</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Receipt PDFs are generated client-side in this app and are not pushed.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Headers we send</p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li><code>X-Event</code> — the event name.</li>
              <li><code>X-Invoice-Id</code> — the invoice UUID (same as <code>invoice.id</code> in the body).</li>
              <li><code>X-Signature</code> — <code>sha256=&lt;hex&gt;</code> where <code>&lt;hex&gt;</code> is HMAC-SHA256 of the raw request body using your org's signing secret.</li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Verifying the signature (Node.js)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`import crypto from "node:crypto";

app.post("/webhooks/invoice-updates", express.raw({ type: "application/json" }), (req, res) => {
  const sigHeader = req.header("X-Signature") || "";
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.PUSH_SECRET)
    .update(req.body)               // raw bytes, not parsed JSON
    .digest("hex");
  if (sigHeader !== expected) return res.status(401).end();

  const payload = JSON.parse(req.body.toString("utf8"));
  // payload.event, payload.invoice, payload.invoice_pdf.base64, ...
  res.status(200).end();
});`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              The signing secret is shared out-of-band per org. Respond with <code>2xx</code> within ~10s; we retry up to 3 times with exponential backoff (1s, 3s) on non-2xx or network errors.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Payload Shape (same as api-get response)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  event: "invoice_pdf_ready",
  sent_at: "2026-03-22T10:05:00.123Z",
  invoice: {
    id: "uuid",
    invoice_number: "INV-001",
    status: "approved",
    contact_name: "Lee Music Academy",
    total: 650.00,
    "...": "see api-get response"
  },
  invoice_pdf: {
    filename: "INV-001.pdf",
    mime_type: "application/pdf",
    base64: "JVBERi0xLjQK..."
  },
  invoice_pdf_error: null
}, null, 2)}
            </pre>
          </div>
        </Card>

        {/* Xero Contacts: List */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <Badge variant="outline" className="text-xs">x-app-jwt</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">List Xero Contacts — list-xero-contacts</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">{XERO}</code>
          <p className="text-xs text-muted-foreground">
            Returns active Xero contacts for the current tenant. Supports search and pagination. Requires a valid <code>x-app-jwt</code>.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({ action: "list-xero-contacts", search: "Lee Music", page: 1 }, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>search</code> (optional) — case-insensitive substring match on Name. <code>page</code> (optional, default 1) — Xero returns 100 contacts per page.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (200)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  page: 1,
  contacts: [
    { id: "uuid", name: "Lee Music Academy", email: "billing@lee.com", status: "ACTIVE" }
  ]
}, null, 2)}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">cURL</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${XERO}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: <SUPABASE_ANON_KEY>' \\
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\
  -H 'x-app-jwt: <token from verify-2fa>' \\
  -H 'x-org-id: otg_lab' \\
  -H 'x-environment: sandbox' \\
  -d '{ "action": "list-xero-contacts", "search": "Lee Music", "page": 1 }'`}
            </pre>
          </div>
        </Card>

        {/* Xero Contacts: Create */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <Badge variant="outline" className="text-xs">x-app-jwt</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Create Xero Contact — create-xero-contact (find-or-create)</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">{XERO}</code>
          <p className="text-xs text-muted-foreground">
            Looks up an active Xero contact by exact name. If none exists, creates a new one and returns it. Use this before <code>api-submit</code> if you want a guaranteed <code>contact_id</code>. Requires a valid <code>x-app-jwt</code>.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  action: "create-xero-contact",
  name: "Acme Corp Sdn Bhd",
  email: "ap@acme.com",
  first_name: "Alice",
  last_name: "Tan"
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Only <code>action</code> and <code>name</code> are required. <code>email</code>, <code>first_name</code>, <code>last_name</code> are used only when a new contact is created.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (200)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  created: false,
  contact: { id: "uuid", name: "Acme Corp Sdn Bhd", email: "ap@acme.com" }
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>created</code> is <code>true</code> when a new Xero contact was created, <code>false</code> when an existing match was returned. Note the ID is on <code>contact.id</code>.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">cURL</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${XERO}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: <SUPABASE_ANON_KEY>' \\
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\
  -H 'x-app-jwt: <token from verify-2fa>' \\
  -H 'x-org-id: otg_lab' \\
  -H 'x-environment: sandbox' \\
  -d '{ "action": "create-xero-contact", "name": "Acme Corp Sdn Bhd" }'`}
            </pre>
          </div>
        </Card>

        {/* PDF Webhook */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="text-xs bg-blue-600">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Invoice PDF Webhook (n8n → App)</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">{PDF_WEBHOOK}</code>
          <p className="text-xs text-muted-foreground">
            n8n calls this endpoint after pushing the invoice to Xero to attach the generated PDF.
            Supports <strong>multipart/form-data</strong> or <strong>JSON with base64</strong>.
          </p>

          <div>
            <p className="text-xs font-medium text-foreground mb-1">Option A: Multipart Form Data</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${PDF_WEBHOOK}' \\
  -H 'apikey: <SUPABASE_ANON_KEY>' \\
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\
  -F 'invoice_id=<uuid>' \\
  -F 'pdf=@/path/to/invoice.pdf'`}
            </pre>
          </div>

          <div>
            <p className="text-xs font-medium text-foreground mb-1">Option B: JSON with Base64</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${PDF_WEBHOOK}' \\
  -H 'apikey: <SUPABASE_ANON_KEY>' \\
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "invoice_id": "<uuid>",
    "pdf_base64": "<base64-encoded-pdf>",
    "filename": "INV-001.pdf"
  }'`}
            </pre>
          </div>

          <div>
            <p className="text-xs font-medium text-foreground mb-1">Response</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`{
  "success": true,
  "invoice_id": "<uuid>",
  "pdf_url": "https://.../invoice-pdfs/<uuid>/invoice.pdf"
}`}
            </pre>
          </div>
        </Card>

        {/* Troubleshooting */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold font-display text-foreground">Troubleshooting</h2>
          <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-2">
            <li>
              <strong>401 Unauthorized</strong> on <code>/xero</code> — <code>x-app-jwt</code> is missing, malformed, or expired. Re-run the 2-step login flow. This header must be the raw JWT, not <code>Bearer &lt;jwt&gt;</code>.
            </li>
            <li>
              <strong>401 Unauthorized</strong> on <code>/invoices</code> for <code>api-submit</code>/<code>api-get</code> — this usually means the Supabase gateway rejected the request. Verify both <code>apikey</code> and <code>Authorization: Bearer &lt;anon&gt;</code> use the current publishable key.
            </li>
            <li>
              <strong>"Missing or unknown org"</strong> — <code>x-org-id</code> header (or <code>org_id</code> in body) is missing or not one of the allowed values.
            </li>
            <li>
              <strong>Wrong environment data</strong> — check <code>x-environment</code> is <code>sandbox</code> or <code>production</code>; omitting it defaults to <code>production</code>.
            </li>
            <li>
              <strong>Newlines rendered as literal <code>\n</code></strong> — that's intentional in transport; the UI renders them as line breaks via <code>whitespace-pre-wrap</code>.
            </li>
          </ul>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ApiDocsPage;
