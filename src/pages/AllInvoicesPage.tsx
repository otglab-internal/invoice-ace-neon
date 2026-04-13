import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import AmendInvoiceDialog from "@/components/AmendInvoiceDialog";
import { FileText, Eye, Pencil, Search, Filter, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { neonQuery } from "@/lib/neon-client";
import { toast } from "@/hooks/use-toast";
import { generateReceiptPdf } from "@/lib/generate-receipt-pdf";
import { useBranding } from "@/hooks/use-branding";

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
}

const statusPill = (status: string, amendmentStatus: string | null) => {
  if (status === "paid") {
    return <Badge className="text-xs bg-green-600 text-white border-green-600">Paid</Badge>;
  }
  if (status === "partially_paid") {
    return <Badge className="text-xs bg-amber-500 text-white border-amber-500">Partially Paid</Badge>;
  }
  if (amendmentStatus === "pending") {
    return <Badge variant="outline" className="text-xs border-orange-500 text-orange-600">Amendment Pending</Badge>;
  }
  const map: Record<string, string> = {
    submitted: "pill-automated",
    approved: "pill-automated",
    pushed: "pill-automated",
    pending_approval: "pill-pending",
    rejected: "pill-failed",
    failed: "pill-failed",
  };
  return <span className={map[status] || "pill-pending"}>{status.replace("_", " ")}</span>;
};

const formatCurrency = (amount: number, currency = "RM") =>
  `${currency} ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

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

  useEffect(() => {
    neonQuery("global_config", { select: "value", filters: { key: "currency" }, maybeSingle: true })
      .then(({ data }) => { if ((data as any)?.value) setCurrency((data as any).value); });
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, any> = {};

    // Sales users: only their own invoices
    if (!isAdmin && !isCentre && role !== "management") {
      if (systemId) filters.submitted_by_system_id = systemId;
    }

    const { data, error } = await neonQuery("invoices", {
      select: "id, contact_name, contact_id, reference, invoice_date, total, status, created_at, invoice_number, submitted_by_system_id, submitted_by_name, line_items, amendment_status, invoice_pdf_url",
      filters,
      order: { column: "created_at", ascending: false },
    });

    if (!error && data) {
      let invoices = data as Invoice[];

      // Centre role: filter to invoices that have line items matching their centres
      if (isCentre && !isAdmin && centreLocations.length > 0) {
        invoices = invoices.filter((inv) => {
          // Include own invoices
          if (inv.submitted_by_system_id === systemId) return true;
          // Include invoices with line items in their centres
          const invoiceCentres = (inv.line_items || []).map((li: any) => li.center).filter(Boolean);
          if (invoiceCentres.length === 0) return false;
          return invoiceCentres.some((c: string) => centreLocations.includes(c));
        });
      }

      setAllInvoices(invoices);
    }
    setLoading(false);
  }, [systemId, isAdmin, isCentre, role, centreLocations]);

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
        currency,
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

  const scopeLabel = isAdmin || role === "management"
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
            {isAdmin || role === "management"
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
        <div className="bg-card border border-border rounded-xl">
          <div className="grid grid-cols-[100px_1fr_120px_100px_100px_120px_auto] gap-2 px-5 py-3 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
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
                <div key={inv.id} className="grid grid-cols-[100px_1fr_120px_100px_100px_120px_auto] gap-2 px-5 py-3 items-center">
                  <span className="text-sm font-medium text-foreground truncate">
                    {inv.invoice_number || "—"}
                  </span>
                  <span className="text-sm text-foreground truncate">{inv.contact_name}</span>
                  <span className="text-xs text-muted-foreground truncate">{inv.submitted_by_name}</span>
                  <span className="text-sm text-muted-foreground">{formatDate(inv.created_at)}</span>
                  <span className="text-sm font-medium text-foreground text-right">
                    {formatCurrency(inv.total, currency)}
                  </span>
                  <span>{statusPill(inv.status, inv.amendment_status)}</span>
                  <div className="flex items-center gap-1">
                    {inv.invoice_pdf_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1 text-xs"
                        onClick={() => handleViewPdf(inv)}
                        disabled={loadingPdf === inv.id}
                      >
                        <Eye className="w-3 h-3" /> {loadingPdf === inv.id ? "…" : "INV PDF"}
                      </Button>
                    )}
                    {inv.status === "paid" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1 text-xs"
                        onClick={() => handleDownloadReceipt(inv)}
                        disabled={loadingReceipt === inv.id}
                      >
                        <Download className="w-3 h-3" /> {loadingReceipt === inv.id ? "…" : "Receipt PDF"}
                      </Button>
                    )}
                    {canAmendInvoice(inv) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1 text-xs"
                        onClick={() => setAmendInvoice(inv)}
                      >
                        <Pencil className="w-3 h-3" /> Amend
                      </Button>
                    )}
                  </div>
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
