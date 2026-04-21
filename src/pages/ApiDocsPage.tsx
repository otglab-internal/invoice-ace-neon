import React from "react";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ENDPOINT = `${SUPABASE_URL}/functions/v1/invoices`;

const ApiDocsPage: React.FC = () => {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground">API Documentation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            External API endpoints for programmatic invoice submission
          </p>
        </div>

        {/* Base URL */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold font-display text-foreground">Base URL</h2>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">
            {ENDPOINT}
          </code>
          <p className="text-xs text-muted-foreground">
            All requests are <Badge variant="outline" className="text-xs">POST</Badge> with JSON body. Include the header:
          </p>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground">
            {`apikey: <your-anon-key>`}
          </code>
        </Card>

        {/* Submit Invoice */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Submit Invoice</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Push an invoice with multi-line items from an external system (e.g. Open Text). The invoice will go through the same approval workflow as UI-created invoices.
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
  template_id: "optional-template-uuid",
  callback_url: "https://your-app.example.com/webhooks/invoice-updates",
  contact_name: "Lee Music Academy",
  invoice_date: "22/03/2026",
  reference: "PO-12345",
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
                  <tr><td className="py-2 pr-4 font-mono text-foreground">invoice_date</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Date in DD/MM/YYYY format</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">line_items</td><td className="py-2 pr-4">array</td><td className="py-2 text-muted-foreground">One or more line items (supports multi-line descriptions)</td></tr>
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
                  <tr><td className="py-2 pr-4 font-mono text-foreground">reference</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Purchase order or reference number</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">user_email</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Requester email. If omitted, resolved automatically from <code>user_id</code> via the user directory. Required for payment notifications.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">template_id</td><td className="py-2 pr-4">uuid</td><td className="py-2 text-muted-foreground">Optional invoice template ID. If the template has <code>requires_approval=true</code>, the invoice will go through approval regardless of user flags.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">contact_id</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Xero contact ID. Omit to let downstream processing create/match the contact by name.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">source_system</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Identifier of the calling external system (e.g. <code>"OPENTEXT-PROD"</code>). Recorded in the invoice audit log and appended to the submitter name as <code>(via …)</code> so the source is visible in the UI.</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">source_system_name</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Human-readable name of the calling system (e.g. <code>"Open Text"</code>). Preferred over <code>source_system</code> for the <code>(via …)</code> label when both are provided.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>Approval behaviour:</strong> The invoice honours the same rules as the UI — it auto-approves unless the submitting user is in <code>user_approval_flags</code> or the chosen template requires approval. Flagged invoices land in <code>pending_approval</code> and trigger the standard approver email + n8n workflow.
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
                  <tr><td className="py-2 pr-4 font-mono text-foreground">description</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Multi-line text description (use \n for line breaks)</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">quantity</td><td className="py-2 pr-4">number</td><td className="py-2 text-muted-foreground">Quantity</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">cost</td><td className="py-2 pr-4">number</td><td className="py-2 text-muted-foreground">Unit cost</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">account</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Account code</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-foreground">center</td><td className="py-2 pr-4">string</td><td className="py-2 text-muted-foreground">Center name</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (201)</p>
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
{JSON.stringify({
  error: "Missing required fields: system_id, contact_name"
}, null, 2)}
            </pre>
          </div>
        </Card>

        {/* Webhook Callback */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-blue-600 text-xs">WEBHOOK</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Approval Callback</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            When an invoice is approved or rejected, a POST webhook is sent to the configured n8n URL with the full invoice data including the <code className="text-foreground">invoice_id</code>.
          </p>
          <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  event: "invoice_approved",
  invoice: {
    id: "uuid-of-invoice",
    invoice_number: "INV-001",
    contact_name: "Lee Music Academy",
    status: "approved",
    total: 650.00,
    line_items: ["..."],
    approved_by: "approver-system-id",
    approved_at: "2026-03-22T10:00:00+08:00"
  }
}, null, 2)}
          </pre>
        </Card>

        {/* cURL example */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold font-display text-foreground">cURL Example</h2>
          <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${ENDPOINT}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: <your-anon-key>' \\
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
        </Card>

        {/* api-get: fetch invoice + INV PDF */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Fetch Invoice (api-get)</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">
            {ENDPOINT}
          </code>
          <p className="text-xs text-muted-foreground">
            Returns the current state of an invoice (status, totals, line items, approver info) plus the INV PDF (Xero-generated) inlined as base64.
            Receipt PDFs are generated on demand in the UI and not persisted, so they are not returned by this endpoint.
            Required headers: <code>x-org-id</code> and <code>x-environment</code>.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  action: "api-get",
  invoice_id: "uuid-returned-by-api-submit"
}, null, 2)}
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
  receipt_pdf: null,
  receipt_pdf_note: "Receipt PDFs are generated on demand in the UI and not persisted; not available via API."
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>invoice_pdf</code> is <code>null</code> until Xero has generated the PDF (after approval/sync). If retrieval fails, <code>invoice_pdf_error</code> contains the reason.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">cURL</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST '${ENDPOINT}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: <your-anon-key>' \\
  -H 'x-org-id: stridekidz' \\
  -H 'x-environment: production' \\
  -d '{
    "action": "api-get",
    "invoice_id": "00000000-0000-0000-0000-000000000000"
  }'`}
            </pre>
          </div>
        </Card>

        {/* Xero Contacts: List */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">List Xero Contacts</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">
            {`${SUPABASE_URL}/functions/v1/xero`}
          </code>
          <p className="text-xs text-muted-foreground">
            Returns active Xero contacts for the current tenant. Supports search and pagination.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  action: "list-xero-contacts",
  search: "Lee Music",
  page: 1
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>search</code> (optional) — case-insensitive name match. <code>page</code> (optional, default 1) — Xero returns 100 contacts per page.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (200)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  success: true,
  page: 1,
  contacts: [
    { contact_id: "uuid", name: "Lee Music Academy", email: "billing@lee.com" }
  ]
}, null, 2)}
            </pre>
          </div>
        </Card>

        {/* Xero Contacts: Create */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-600 text-xs">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Create Xero Contact (find-or-create)</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">
            {`${SUPABASE_URL}/functions/v1/xero`}
          </code>
          <p className="text-xs text-muted-foreground">
            Looks up an active Xero contact by exact name. If none exists, creates a new one and returns it. Use this before <code>api-submit</code> if you want a guaranteed <code>contact_id</code>.
          </p>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Request Body</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  action: "create-xero-contact",
  name: "Acme Corp Sdn Bhd"
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Only <code>action</code> and <code>name</code> are required. Optional fields when creating a new contact: <code>email</code>, <code>first_name</code>, <code>last_name</code>.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Response (200)</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{JSON.stringify({
  success: true,
  created: false,
  contact: { contact_id: "uuid", name: "Acme Corp Sdn Bhd", email: "ap@acme.com" }
}, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              <code>created</code> is <code>true</code> when a new Xero contact was created, <code>false</code> when an existing match was returned.
            </p>
          </div>
        </Card>

        {/* PDF Webhook */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="text-xs bg-blue-600">POST</Badge>
            <h2 className="text-sm font-semibold font-display text-foreground">Invoice PDF Webhook (n8n → App)</h2>
          </div>
          <code className="block text-xs bg-muted p-3 rounded-lg text-foreground break-all">
            {`${SUPABASE_URL}/functions/v1/invoice-pdf-webhook`}
          </code>
          <p className="text-xs text-muted-foreground">
            n8n calls this endpoint after pushing the invoice to Xero to attach the generated PDF.
            Supports <strong>multipart/form-data</strong> or <strong>JSON with base64</strong>.
          </p>

          <div>
            <p className="text-xs font-medium text-foreground mb-1">Option A: Multipart Form Data</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST \\
  "${SUPABASE_URL}/functions/v1/invoice-pdf-webhook" \\
  -H "apikey: <your-anon-key>" \\
  -F "invoice_id=<uuid>" \\
  -F "pdf=@/path/to/invoice.pdf"`}
            </pre>
          </div>

          <div>
            <p className="text-xs font-medium text-foreground mb-1">Option B: JSON with Base64</p>
            <pre className="text-xs bg-muted p-4 rounded-lg text-foreground overflow-x-auto whitespace-pre">
{`curl -X POST \\
  "${SUPABASE_URL}/functions/v1/invoice-pdf-webhook" \\
  -H "apikey: <your-anon-key>" \\
  -H "Content-Type: application/json" \\
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
  "pdf_url": "https://...storage.../invoice-pdfs/<uuid>/invoice.pdf"
}`}
            </pre>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ApiDocsPage;
