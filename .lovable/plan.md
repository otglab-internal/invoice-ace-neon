## Goal

Remove n8n from the invoice pipeline entirely. When an invoice is approved (manually or auto-approved via API), and when an amendment is approved, this app talks to Xero directly using the existing OAuth2 connection: creates/reuses the contact, creates or updates the invoice as AUTHORISED, pulls the Xero PDF, stores it, and lets Xero email the client. Existing Xero payment webhook and outbound API push-back keep working unchanged.

## Flow after the change

```text
approve / auto-approve
        |
        v
[ resolve Xero contact ]  -- existing contact by ContactID or name
        |                     -- else create it (name, email, first/last)
        v
[ POST /Invoices  Type=ACCREC, Status=AUTHORISED ]
        |   line items -> Description, Quantity, UnitAmount,
        |                 AccountCode, Tracking[]
        |   CurrencyCode, DueDate = invoice_date + due_days, Reference
        v
[ store InvoiceID + InvoiceNumber on our row ]
        |
        +--> send_to_client? -> POST /Invoices/{id}/Email  (Xero-branded)
        |
        +--> GET /Invoices/{id} (Accept: application/pdf)
                 -> strip protection -> upload to R2 -> invoice_pdf_url
                 -> dispatchApiPush("invoice_pdf_ready") for API-submitted invoices
```

Amendment approval follows the same path but issues `POST /Invoices/{InvoiceID}` (Xero upsert) against the stored Xero invoice id, then re-pulls the PDF.

## Work

**1. New shared module `supabase/functions/_shared/xero-invoice.ts**`

- Token handling lifted from `xero/index.ts`: config map read, `refreshAccessToken`, 401-retry-once wrapper, tenant id/name resolution.
- `resolveXeroContact()` — lookup by `contact_id` (ContactID) first, else exact-name lookup, else create. Same authorization/scope error surfacing already built for `create-xero-contact`.
- `pushInvoiceToXero()` — builds the ACCREC payload, creates or upserts, returns `{ xeroInvoiceId, invoiceNumber, status }`.
- `emailXeroInvoice()` — Xero's email endpoint, only when `send_to_client` is true.
- `syncXeroInvoicePdf()` — fetch PDF, `stripPdfProtection`, `uploadToR2` to `invoices/{id}.pdf`, update `invoice_pdf_url`. Reuses the same paths `xero-webhook` already writes, so the later paid/partially-paid refresh overwrites cleanly.

**2. Database (one migration per tenant DB, run through the existing Neon proxy pattern)**

- `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT` (plus the same `IF NOT EXISTS` guard used for `callback_url`/`currency` so older slices self-heal).

**3. `supabase/functions/invoices/index.ts**`

- `api-submit` auto-approve branch: replace the n8n fetch with the Xero push.
- `approve` action: same replacement.
- `notify-approval`: becomes a direct Xero push (kept as an action so the frontend call site is unchanged), returning the created invoice number instead of a webhook status.
- `notify-amendment`: replace the hardcoded n8n test webhook with the Xero update path.
- Drop all `N8N_WEBHOOK_URL` reads.
- Failure handling: if the Xero push fails, the invoice stays approved but gets `xero_sync_error` recorded in `invoice_logs`, the action returns a readable error, and the UI can retry.

**4. Retry surface**

- Add a `retry-xero-push` action on the invoices function and a "Retry Xero sync" item in the invoice row actions, shown when an approved invoice has no `xero_invoice_id`.

**5. Cleanup**

- Delete `supabase/functions/admin-resend-n8n/index.ts`.
- `invoice-pdf-webhook` stays (external PDF ingestion + presigned URL GET still used by the UI) but is no longer part of the approval path.
- Update `ApiDocsPage.tsx` wording where it describes the n8n hop.

## Technical notes

- Xero create is idempotent-guarded by our stored `xero_invoice_id`; a retry after a partial failure upserts rather than duplicating.
- `xero-webhook` matching is unchanged (still by `invoice_number`), and now the number is written at creation time so the match is immediate.
- Currency is still normalised to letters only (`SGD$` -> `SGD`); Xero rejects unknown codes, so an unsupported code surfaces as a readable error rather than a silent failure.
- Line items require `AccountCode`; the create form already enforces account selection, but API-submitted line items without an account will be rejected with an explicit message.
- Tracking categories map straight from the existing `tracking: [{ name, option }]` shape.
- `N8N_WEBHOOK_URL` secret becomes unused; it can be deleted afterwards.

## Not included

- No change to the payment/receipt reconciliation, the outbound API push contract, or the tenant-binding work.  

  User note: **ensure** that all Xero operations abide by their environment's Xero connection. Stridekidz sandbox and production, and OTG Lab's sandbox and production should be 4 separate and distinct connections that only interact with their established Xero connection. None should interacting with the others'. The point of this change is to reduce the confusion and errors that have arised regarding the app sending invoices to the wrong Xero.