import React, { useState, useCallback } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  getSignedPdfUrl,
  listInvoiceReceipts,
  syncReceiptPdf,
  type InvoiceReceiptRow,
} from "@/lib/invoice-receipts";

interface Props {
  invoiceId: string;
  invoiceNumber: string | null;
  currency: string;
  available: boolean;
}

const formatAmount = (amount: number, currency: string) =>
  `${currency} ${Number(amount || 0).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const ReceiptDownloadMenu: React.FC<Props> = ({ invoiceId, invoiceNumber, currency, available }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<InvoiceReceiptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Try list first (cheap). If empty, run a full sync against Xero.
      let rows = await listInvoiceReceipts(invoiceId);
      if (rows.length === 0) {
        const synced = await syncReceiptPdf(invoiceId);
        rows = synced.receipts;
      }
      setReceipts(rows);
    } catch (err) {
      const msg = (err as Error)?.message || "Failed to load receipts";
      setError(msg);
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && receipts === null && !loading) {
      loadReceipts();
    }
  };

  const handleDownload = async (row: InvoiceReceiptRow) => {
    if (!row.receipt_pdf_url) {
      toast({ title: "Not ready", description: "This receipt is still being generated.", variant: "destructive" });
      return;
    }
    setDownloadingId(row.id);
    try {
      const url = await getSignedPdfUrl(row.receipt_pdf_url);
      window.open(url, "_blank");
    } catch (err) {
      toast({ title: "Error", description: (err as Error)?.message || "Failed to open receipt", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const label = available ? "Download receipt PDF" : "Download receipt PDF (unavailable)";

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 ${
        available
          ? "text-primary hover:text-primary hover:bg-primary/10"
          : "text-muted-foreground/30 cursor-not-allowed hover:bg-transparent"
      }`}
      aria-label={label}
      aria-disabled={!available}
      disabled={!available}
    >
      <Download className="w-4 h-4" />
    </Button>
  );

  if (!available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    );
  }

  const sorted = (receipts || []).slice().sort((a, b) => {
    if (a.is_consolidated !== b.is_consolidated) return a.is_consolidated ? 1 : -1;
    return a.payment_number - b.payment_number;
  });

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Download receipt PDF</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">
          Receipts{invoiceNumber ? ` – ${invoiceNumber}` : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Syncing with Xero…
          </div>
        )}
        {!loading && error && (
          <div className="px-2 py-3 text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && sorted.length === 0 && (
          <div className="px-2 py-3 text-sm text-muted-foreground">No receipts available yet.</div>
        )}
        {!loading && sorted.map((row) => {
          const isDownloading = downloadingId === row.id;
          const heading = row.is_consolidated
            ? "Consolidated Receipt"
            : `Payment #${row.payment_number}`;
          const sub = [row.payment_date, formatAmount(row.amount, currency)]
            .filter(Boolean)
            .join(" · ");
          const disabled = !row.receipt_pdf_url || isDownloading;
          return (
            <DropdownMenuItem
              key={row.id}
              disabled={disabled}
              onClick={(e) => {
                e.preventDefault();
                handleDownload(row);
              }}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <div className="flex w-full items-center gap-2 text-sm font-medium">
                {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                {heading}
                {row.is_consolidated && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Full</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {sub || "—"}
                {!row.receipt_pdf_url && " (generating…)"}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ReceiptDownloadMenu;
