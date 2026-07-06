import { uploadToR2 } from "./r2-utils.ts";
import { createReceiptPdfBytes, type PaymentEntry } from "./receipt-pdf.ts";

// deno-lint-ignore no-explicit-any
type Sql = any;

export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
  xero_payment_id: string | null;
  payment_number: number;
  amount: number;
  payment_date: string | null;
  reference: string | null;
  amount_paid_after: number | null;
  amount_due_after: number | null;
  is_consolidated: boolean;
  receipt_pdf_url: string | null;
  created_at: string;
}

let ensured = false;

export async function ensureInvoicePaymentsTable(sql: Sql): Promise<void> {
  if (ensured) return;
  await sql.query(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      xero_payment_id text,
      payment_number integer NOT NULL,
      amount numeric(12,2) NOT NULL DEFAULT 0,
      payment_date text,
      reference text,
      amount_paid_after numeric(12,2),
      amount_due_after numeric(12,2),
      is_consolidated boolean NOT NULL DEFAULT false,
      receipt_pdf_url text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS invoice_payments_invoice_id_idx ON invoice_payments(invoice_id);`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_xero_id_uidx ON invoice_payments(xero_payment_id) WHERE xero_payment_id IS NOT NULL;`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_consolidated_uidx ON invoice_payments(invoice_id) WHERE is_consolidated = true;`);
  ensured = true;
}

export async function listInvoicePayments(sql: Sql, invoiceId: string): Promise<InvoicePaymentRow[]> {
  await ensureInvoicePaymentsTable(sql);
  const rows = await sql.query(
    `SELECT id, invoice_id, xero_payment_id, payment_number, amount::float8 AS amount,
            payment_date, reference,
            amount_paid_after::float8 AS amount_paid_after,
            amount_due_after::float8 AS amount_due_after,
            is_consolidated, receipt_pdf_url, created_at
     FROM invoice_payments
     WHERE invoice_id = $1
     ORDER BY is_consolidated ASC, payment_number ASC, created_at ASC`,
    [invoiceId],
  );
  return rows as InvoicePaymentRow[];
}

export interface InvoiceRecordForReceipt {
  id: string;
  invoice_number: string | null;
  contact_name: string;
  invoice_date: string;
  reference: string | null;
  total: number;
  line_items: unknown[];
  submitted_by_name: string;
  currency: string | null;
}

export interface BrandingForReceipt {
  logoUrl: string | null;
  companyName: string | null;
  companySsm: string | null;
  companyAddress: string | null;
}

interface XeroPayment {
  PaymentID?: string;
  Amount?: number;
  Date?: string;
  Reference?: string;
  Status?: string;
  IsReconciled?: boolean;
}

const parseXeroDate = (raw?: string | null): string | null => {
  if (!raw) return null;
  const m = /\/Date\((\d+)/.exec(String(raw));
  if (m) {
    const ts = Number(m[1]);
    if (Number.isFinite(ts)) {
      return new Date(ts).toISOString().slice(0, 10);
    }
  }
  return String(raw).slice(0, 10);
};

async function uploadPaymentReceipt(invoiceId: string, paymentRowId: string, bytes: Uint8Array): Promise<string> {
  const path = `receipts/${invoiceId}/${paymentRowId}.pdf`;
  await uploadToR2(path, bytes, "application/pdf");
  return path;
}

async function uploadConsolidatedReceipt(invoiceId: string, bytes: Uint8Array): Promise<string> {
  const path = `receipts/${invoiceId}/consolidated.pdf`;
  await uploadToR2(path, bytes, "application/pdf");
  return path;
}

/**
 * Reconcile invoice_payments rows with Xero's Payments array. Creates missing
 * payment rows and generates per-payment receipt PDFs. When the invoice is
 * fully paid, also generates a single consolidated receipt (idempotent).
 *
 * Returns the up-to-date rows and a pointer to the latest PDF path (useful for
 * legacy invoices.receipt_pdf_url backward compatibility).
 */
export async function reconcileInvoicePayments(params: {
  sql: Sql;
  invoiceId: string;
  invoiceRecord: InvoiceRecordForReceipt;
  xeroInvoice: Record<string, unknown>;
  branding: BrandingForReceipt;
}): Promise<{ rows: InvoicePaymentRow[]; latestReceiptPath: string | null; isFullyPaid: boolean }> {
  const { sql, invoiceId, invoiceRecord, xeroInvoice, branding } = params;
  await ensureInvoicePaymentsTable(sql);

  const xeroStatus = String(xeroInvoice.Status || "").toUpperCase();
  const total = Number(xeroInvoice.Total ?? invoiceRecord.total ?? 0) || 0;
  const rawPayments = Array.isArray(xeroInvoice.Payments) ? xeroInvoice.Payments as XeroPayment[] : [];

  // Filter out voided/deleted payments; Xero returns those with Status="DELETED"
  const activePayments = rawPayments.filter((p) => (p.Status || "").toUpperCase() !== "DELETED");

  // Sort payments by date ascending, then PaymentID for determinism
  activePayments.sort((a, b) => {
    const da = parseXeroDate(a.Date) || "";
    const db = parseXeroDate(b.Date) || "";
    if (da !== db) return da < db ? -1 : 1;
    return (a.PaymentID || "").localeCompare(b.PaymentID || "");
  });

  const existing = await listInvoicePayments(sql, invoiceId);
  const existingByXeroId = new Map<string, InvoicePaymentRow>();
  for (const r of existing) {
    if (r.xero_payment_id) existingByXeroId.set(r.xero_payment_id, r);
  }

  const commonPdfInputs = {
    invoiceNumber: invoiceRecord.invoice_number,
    contactName: invoiceRecord.contact_name || "—",
    invoiceDate: invoiceRecord.invoice_date || "—",
    reference: invoiceRecord.reference || null,
    total,
    lineItems: Array.isArray(invoiceRecord.line_items) ? invoiceRecord.line_items as Array<Record<string, unknown>> : [],
    submittedByName: invoiceRecord.submitted_by_name || "—",
    currency: invoiceRecord.currency || "RM",
    logoUrl: branding.logoUrl,
    companyName: branding.companyName,
    companySsm: branding.companySsm,
    companyAddress: branding.companyAddress,
  };

  let runningPaid = 0;
  let latestReceiptPath: string | null = null;
  let paymentNumber = 0;

  // Build history entries for consolidated receipt as we go
  const paymentEntries: PaymentEntry[] = [];

  for (const xp of activePayments) {
    paymentNumber += 1;
    const amount = Number(xp.Amount || 0) || 0;
    runningPaid += amount;
    const remaining = Math.max(total - runningPaid, 0);
    const dateStr = parseXeroDate(xp.Date);
    const xeroPaymentId = xp.PaymentID || null;

    const entry: PaymentEntry = {
      number: paymentNumber,
      amount,
      date: dateStr,
      reference: xp.Reference || null,
    };
    paymentEntries.push(entry);

    const alreadyExists = xeroPaymentId ? existingByXeroId.get(xeroPaymentId) : undefined;
    if (alreadyExists && alreadyExists.receipt_pdf_url) {
      latestReceiptPath = alreadyExists.receipt_pdf_url;
      continue;
    }

    // Insert row (or update the existing one) first to get the row id.
    let rowId: string;
    if (alreadyExists) {
      rowId = alreadyExists.id;
      await sql.query(
        `UPDATE invoice_payments
         SET payment_number = $2, amount = $3, payment_date = $4, reference = $5,
             amount_paid_after = $6, amount_due_after = $7
         WHERE id = $1`,
        [rowId, paymentNumber, amount, dateStr, xp.Reference || null, runningPaid, remaining],
      );
    } else {
      const inserted = await sql.query(
        `INSERT INTO invoice_payments
           (invoice_id, xero_payment_id, payment_number, amount, payment_date, reference,
            amount_paid_after, amount_due_after, is_consolidated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
         RETURNING id`,
        [invoiceId, xeroPaymentId, paymentNumber, amount, dateStr, xp.Reference || null, runningPaid, remaining],
      );
      rowId = (inserted[0]?.id as string) || "";
    }

    if (!rowId) continue;

    try {
      const pdfBytes = await createReceiptPdfBytes({
        ...commonPdfInputs,
        mode: "payment",
        paymentNumber,
        paymentAmount: amount,
        paymentDate: dateStr,
        paymentReference: xp.Reference || null,
        amountPaid: runningPaid,
        amountDue: remaining,
        isPartial: remaining > 0,
        paymentsList: paymentEntries.slice(),
      });
      const path = await uploadPaymentReceipt(invoiceId, rowId, pdfBytes);
      await sql.query(`UPDATE invoice_payments SET receipt_pdf_url = $2 WHERE id = $1`, [rowId, path]);
      latestReceiptPath = path;
    } catch (err) {
      console.error(`reconcileInvoicePayments: failed to generate payment receipt for row ${rowId}:`, err);
    }
  }

  const isFullyPaid = xeroStatus === "PAID" || (runningPaid > 0 && Math.abs(total - runningPaid) < 0.005);

  // Consolidated receipt: create only when fully paid AND not yet created
  if (isFullyPaid && paymentEntries.length > 0) {
    const consolidatedRows = existing.filter((r) => r.is_consolidated);
    let consolidatedRow = consolidatedRows[0];
    if (!consolidatedRow) {
      const inserted = await sql.query(
        `INSERT INTO invoice_payments
           (invoice_id, xero_payment_id, payment_number, amount, payment_date, reference,
            amount_paid_after, amount_due_after, is_consolidated)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, 0, true)
         RETURNING id, invoice_id, xero_payment_id, payment_number, amount::float8 AS amount,
                   payment_date, reference,
                   amount_paid_after::float8 AS amount_paid_after,
                   amount_due_after::float8 AS amount_due_after,
                   is_consolidated, receipt_pdf_url, created_at`,
        [invoiceId, paymentEntries.length + 1, total, new Date().toISOString().slice(0, 10), "Consolidated", runningPaid],
      );
      consolidatedRow = inserted[0] as InvoicePaymentRow;
    }

    if (consolidatedRow && !consolidatedRow.receipt_pdf_url) {
      try {
        const pdfBytes = await createReceiptPdfBytes({
          ...commonPdfInputs,
          mode: "consolidated",
          amountPaid: runningPaid,
          amountDue: 0,
          isPartial: false,
          paymentsList: paymentEntries,
        });
        const path = await uploadConsolidatedReceipt(invoiceId, pdfBytes);
        await sql.query(`UPDATE invoice_payments SET receipt_pdf_url = $2 WHERE id = $1`, [consolidatedRow.id, path]);
        latestReceiptPath = path;
      } catch (err) {
        console.error(`reconcileInvoicePayments: failed to generate consolidated receipt for invoice ${invoiceId}:`, err);
      }
    } else if (consolidatedRow?.receipt_pdf_url) {
      latestReceiptPath = consolidatedRow.receipt_pdf_url;
    }
  }

  const finalRows = await listInvoicePayments(sql, invoiceId);
  return { rows: finalRows, latestReceiptPath, isFullyPaid };
}
