import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";

const compactStatus = (status?: string | null) =>
  (status || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");

export const isFullyPaidStatus = (status?: string | null) => compactStatus(status) === "paid";

export const isPartiallyPaidStatus = (status?: string | null) => {
  const statusKey = compactStatus(status);
  return [
    "partial",
    "partialpaid",
    "partpaid",
    "partpayment",
    "partiallypaid",
    "partiallysettled",
  ].includes(statusKey);
};

export const canDownloadReceiptPdf = (status?: string | null, receiptPdfUrl?: string | null) =>
  !!receiptPdfUrl || isFullyPaidStatus(status) || isPartiallyPaidStatus(status);

function getFunctionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-org-id": getOrgId(),
    "X-Environment": localStorage.getItem("auth_environment") || "production",
  };
  const token = localStorage.getItem("auth_token");
  if (token) headers["x-app-jwt"] = token;
  return headers;
}

export async function getSignedPdfUrl(storagePath: string): Promise<string> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(
    `${baseUrl}/functions/v1/invoice-pdf-webhook?path=${encodeURIComponent(storagePath)}`,
    { headers: { apikey: anonKey } },
  );
  const result = await res.json();
  if (!result.signedUrl) throw new Error(result.error || "Failed to get PDF URL");
  return result.signedUrl;
}

export interface InvoiceReceiptRow {
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

export async function syncReceiptPdf(invoiceId: string): Promise<{
  receiptPdfUrl: string;
  status?: string;
  receipts: InvoiceReceiptRow[];
}> {
  const { data, error } = await supabase.functions.invoke("xero", {
    body: { action: "sync-invoice-receipt", invoice_id: invoiceId },
    headers: getFunctionHeaders(),
  });

  if (error || data?.error) {
    throw new Error(data?.error || "Failed to generate receipt PDF");
  }
  if (!data?.receipt_pdf_url) throw new Error("Receipt PDF is not available yet");

  return {
    receiptPdfUrl: data.receipt_pdf_url,
    status: data.status,
    receipts: Array.isArray(data.receipts) ? data.receipts : [],
  };
}

export async function listInvoiceReceipts(invoiceId: string): Promise<InvoiceReceiptRow[]> {
  const { data, error } = await supabase.functions.invoke("xero", {
    body: { action: "list-invoice-receipts", invoice_id: invoiceId },
    headers: getFunctionHeaders(),
  });
  if (error || data?.error) {
    throw new Error(data?.error || "Failed to fetch receipts");
  }
  return Array.isArray(data?.receipts) ? data.receipts : [];
}
