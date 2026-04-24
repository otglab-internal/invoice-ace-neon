import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import AmendInvoiceDialog from "@/components/AmendInvoiceDialog";
import { FileText, Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { neonQuery } from "@/lib/neon-client";
import { toast } from "@/hooks/use-toast";
import { generateReceiptPdf } from "@/lib/generate-receipt-pdf";
import { useBranding } from "@/hooks/use-branding";
import InvoiceStatusBadge from "@/components/InvoiceStatusBadge";
import InvoiceRowActions from "@/components/InvoiceRowActions";

interface Invoice {
  id: string;
  contact_name: string;
  contact_id: string | null;
  reference: string | null;
  invoice_date: string;
  total: number;
  status: string;
  created_at: string;
  invoice_number: string | null;
  submitted_by_system_id: string;
  submitted_by_name: string;
  line_items: any[];
  amendment_status: string | null;
  invoice_pdf_url: string | null;
  /** Per-invoice currency captured at submission time. */
  currency?: string | null;
}


const displayCurrency = (currency?: string | null) => {
  const c = (currency || "RM").trim();
  if (c === "RM") return "MYR";
  if (c === "SGD$") return "SGD";
  return c.replace(/\$$/, "");
};

const formatCurrency = (amount: number, currency = "RM") =>
  `${displayCurrency(currency)} ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });

const AllInvoicesPage: React.FC = () => {
  const { user, systemId, permissions, centreLocations, role } = useAuth();
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("RM");
  const [amendInvoice, setAmendInvoice] = useState<Invoice | null>(null);
  const [loadingPdf, setLoadingPdf] = useState<string | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { logoUrl } = useBranding();

  const isAdmin = permissions.isSystemAdmin;
  const isCentre = role === "centre";
  const isRequester = permissions.canCreateInvoice;
  const ownOnly = permissions.viewOwnInvoicesOnly;

  useEffect(() => {
    neonQuery("global_config", { select: "value", filters: { key: "currency" }, maybeSingle: true })
      .then(({ data }) => { if ((data as any)?.value) setCurrency((data as any).value); });
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const queryOptions: any = {
      select: "id, contact_name, contact_id, reference, invoice_date, total, status, created_at, invoice_number, submitted_by_system_id, submitted_by_name, line_items, amendment_status, invoice_pdf_url, currency",
      order: { column: "created_at", ascending: false },
    };

    // Requesters (without approver tag) only see their own invoices.
    // Match on system_id OR submitted name to handle id-shape mismatches
    // (auth system_id may be a UUID while invoices store the staff system_id).
    if (ownOnly) {
      const requesterName = user ? `${user.firstName} ${user.lastName}`.trim() : "";
      const ors: Array<Record<string, any>> = [];
      if (systemId) ors.push({ submitted_by_system_id: systemId });
      if (requesterName) ors.push({ submitted_by_name: requesterName });
      if (ors.length > 0) queryOptions.orFilters = ors;
      else queryOptions.filters = { submitted_by_system_id: "__none__" };
    }

    const { data, error } = await neonQuery("invoices", queryOptions);

    if (!error && data) {
      let invoices = data as Invoice[];

      // Centre approvers: show invoices in their centres + always include their own.
      // (Centre requesters-only are already filtered server-side via `ownOnly`.)
      if (isCentre && !isAdmin && !ownOnly) {
        invoices = invoices.filter((inv) => {
          if (systemId && inv.submitted_by_system_id === systemId) return true;
          if (centreLocations.length === 0) return false;
          const invoiceCentres = (inv.line_items || []).map((li: any) => li.center).filter(Boolean);
          if (invoiceCentres.length === 0) return false;
          return invoiceCentres.some((c: string) => centreLocations.includes(c));
        });
      }

      setAllInvoices(invoices);
    }
    setLoading(false);
  }, [systemId, user, isAdmin, isCentre, ownOnly, centreLocations]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleViewPdf = useCallback(async (inv: Invoice) => {
    if (!inv.invoice_pdf_url) return;
    setLoadingPdf(inv.id);
    try {
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `${baseUrl}/functions/v1/invoice-pdf-webhook?path=${encodeURIComponent(inv.invoice_pdf_url)}`,
        { headers: { apikey: anonKey } }
      );
      const result = await res.json();
      if (result.signedUrl) {
        window.open(result.signedUrl, "_blank");
      } else {
        toast({ title: "Error", description: result.error || "Failed to get PDF URL", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to fetch PDF", variant: "destructive" });
    } finally {
      setLoadingPdf(null);
    }
  }, []);

  const handleDownloadReceipt = useCallback(async (inv: Invoice) => {
    setLoadingReceipt(inv.id);
    try {
      await generateReceiptPdf({
        invoiceNumber: inv.invoice_number,
        contactName: inv.contact_name,
        invoiceDate: inv.invoice_date,
        reference: inv.reference,
        total: inv.total,
        lineItems: inv.line_items,
        submittedByName: inv.submitted_by_name,
        currency: inv.currency || currency,
        logoUrl,
      });
    } catch {
      toast({ title: "Error", description: "Failed to generate receipt", variant: "destructive" });
    } finally {
      setLoadingReceipt(null);
    }
  }, [currency, logoUrl]);

  const canAmendInvoice = (inv: Invoice) => {
    if (!isRequester) return false;
    if (inv.status === "paid") return false;
    if (!["approved", "submitted", "pushed"].includes(inv.status)) return false;
    if (inv.amendment_status === "pending") return false;
    const invoiceCentres = (inv.line_items || []).map((li: any) => li.center).filter(Boolean);
    if (invoiceCentres.length === 0) return true;
    return invoiceCentres.some((c: string) => centreLocations.includes(c));
  };

  const filteredInvoices = useMemo(() => {
    let result = allInvoices;

    if (statusFilter !== "all") {
      result = result.filter((inv) => inv.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((inv) =>
        inv.contact_name.toLowerCase().includes(q) ||
        (inv.invoice_number || "").toLowerCase().includes(q) ||
        (inv.reference || "").toLowerCase().includes(q) ||
        inv.submitted_by_name.toLowerCase().includes(q)
      );
    }

    return result;
  }, [allInvoices, statusFilter, searchQuery]);

  const scopeLabel = ownOnly
    ? "My Invoices"
    : isAdmin || role === "management"
      ? "All Invoices"
      : isCentre
        ? "Centre Invoices"
        : "My Invoices";

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-display text-foreground">{scopeLabel}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ownOnly
              ? "Viewing your submitted invoices"
              : isAdmin || role === "management"
                ? "Viewing all invoices across the organisation"
                : isCentre
                  ? "Viewing invoices from your centres"
                  : "Viewing your submitted invoices"}
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, invoice #, reference..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="pushed">Pushed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="partially_paid">Partially Paid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[110px_minmax(0,1.5fr)_minmax(0,1fr)_100px_110px_110px_120px] gap-3 px-5 py-3 border-b border-border bg-muted/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Invoice #</span>
            <span>Contact</span>
            <span>Submitted By</span>
            <span>Date</span>
            <span className="text-right">Amount</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : filteredInvoices.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                No invoices found
              </div>
            ) : (
              filteredInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="grid grid-cols-[110px_minmax(0,1.5fr)_minmax(0,1fr)_100px_110px_110px_120px] gap-3 px-5 py-2.5 items-center hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm font-medium text-foreground truncate">
                    {inv.invoice_number || "—"}
                  </span>
                  <span className="text-sm text-foreground truncate">{inv.contact_name}</span>
                  <span className="text-xs text-muted-foreground truncate">{inv.submitted_by_name}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">{formatDate(inv.created_at)}</span>
                  <span className="text-sm font-medium text-foreground tabular-nums text-right">
                    {formatCurrency(inv.total, inv.currency || currency)}
                  </span>
                  <div className="flex justify-start">
                    <InvoiceStatusBadge status={inv.status} amendmentStatus={inv.amendment_status} />
                  </div>
                  <InvoiceRowActions
                    canViewPdf={!!inv.invoice_pdf_url}
                    canDownloadReceipt={inv.status === "paid"}
                    canAmend={canAmendInvoice(inv)}
                    loadingPdf={loadingPdf === inv.id}
                    loadingReceipt={loadingReceipt === inv.id}
                    onViewPdf={() => handleViewPdf(inv)}
                    onDownloadReceipt={() => handleDownloadReceipt(inv)}
                    onAmend={() => setAmendInvoice(inv)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <AmendInvoiceDialog
        invoice={amendInvoice}
        open={!!amendInvoice}
        onOpenChange={(open) => { if (!open) setAmendInvoice(null); }}
        onAmendmentSubmitted={fetchInvoices}
      />
    </AppLayout>
  );
};

export default AllInvoicesPage;
