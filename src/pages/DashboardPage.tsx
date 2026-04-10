import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import AmendInvoiceDialog from "@/components/AmendInvoiceDialog";
import { FileText, Clock, CheckCircle, AlertTriangle, ShieldX, Pencil, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { neonQuery } from "@/lib/neon-client";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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

const DashboardPage: React.FC = () => {
  const { user, systemId, permissions, centreLocations, role } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("RM");
  const [amendInvoice, setAmendInvoice] = useState<Invoice | null>(null);
  const [loadingPdf, setLoadingPdf] = useState<string | null>(null);

  const handleViewPdf = useCallback(async (inv: Invoice) => {
    if (!inv.invoice_pdf_url) return;
    setLoadingPdf(inv.id);
    try {
      const { data, error } = await supabase.functions.invoke("invoice-pdf-webhook", {
        method: "GET",
        headers: { "x-org-id": "" },
        body: undefined,
      } as any);
      // Use fetch directly since supabase.functions.invoke doesn't support GET with query params well
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
    } catch (err) {
      toast({ title: "Error", description: "Failed to fetch PDF", variant: "destructive" });
    } finally {
      setLoadingPdf(null);
    }
  }, []);

  const canView = permissions.canViewInvoices;
  const isRequester = permissions.canCreateInvoice;

  useEffect(() => {
    neonQuery("global_config", { select: "value", filters: { key: "currency" }, maybeSingle: true })
      .then(({ data }) => { if ((data as any)?.value) setCurrency((data as any).value); });
  }, []);

  const fetchInvoices = async () => {
    const filters: Record<string, any> = {};
    if (permissions.viewOwnInvoicesOnly && systemId) {
      filters.submitted_by_system_id = systemId;
    }

    const { data, error } = await neonQuery("invoices", {
      select: "id, contact_name, contact_id, reference, invoice_date, total, status, created_at, invoice_number, submitted_by_system_id, submitted_by_name, line_items, amendment_status",
      filters,
      order: { column: "created_at", ascending: false },
    });
    if (!error && data) setInvoices(data as Invoice[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    fetchInvoices();
  }, [systemId, permissions, centreLocations, role, canView]);

  const canAmendInvoice = (inv: Invoice) => {
    if (!isRequester) return false;
    if (inv.status !== "approved" && inv.status !== "submitted" && inv.status !== "pushed") return false;
    if (inv.amendment_status === "pending") return false;
    const invoiceCentres = (inv.line_items || []).map((li: any) => li.center).filter(Boolean);
    if (invoiceCentres.length === 0) return true;
    return invoiceCentres.some((c: string) => centreLocations.includes(c));
  };

  if (!canView) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold font-display text-foreground">
              Welcome back, {user?.firstName}
            </h1>
          </div>
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <ShieldX className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">No Invoice Access</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              You don't have requester or approver permissions yet. Contact your manager or admin to get tagged with the appropriate access.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const totalCount = invoices.length;
  const pendingCount = invoices.filter((i) => i.status === "pending_approval").length;
  const pushedCount = invoices.filter((i) => ["submitted", "approved", "pushed"].includes(i.status)).length;
  const failedCount = invoices.filter((i) => ["failed", "rejected"].includes(i.status)).length;
  const amendmentPendingCount = invoices.filter((i) => i.amendment_status === "pending").length;

  const stats = [
    { label: "Total Invoices", value: String(totalCount), icon: FileText, color: "text-primary" },
    { label: "Pending Approval", value: String(pendingCount), icon: Clock, color: "text-warning" },
    { label: "Pushed to Xero", value: String(pushedCount), icon: CheckCircle, color: "text-success" },
    { label: "Failed", value: String(failedCount), icon: AlertTriangle, color: "text-destructive" },
  ];

  const recentInvoices = invoices.slice(0, 20);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold font-display text-foreground">
            Welcome back, {user?.firstName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's your invoicing overview
            {amendmentPendingCount > 0 && (
              <span className="ml-2 text-orange-600">• {amendmentPendingCount} amendment{amendmentPendingCount !== 1 ? "s" : ""} pending</span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-8">
          {stats.map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <p className="text-2xl font-bold font-display text-foreground">
                {loading ? "–" : s.value}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold font-display text-foreground">Recent Invoices</h2>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : recentInvoices.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No invoices yet</div>
            ) : (
              recentInvoices.map((inv) => (
                <div key={inv.id} className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-foreground w-20">
                      {inv.invoice_number || "—"}
                    </span>
                    <span className="text-sm text-foreground">{inv.contact_name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{formatDate(inv.created_at)}</span>
                    <span className="text-sm font-medium text-foreground w-24 text-right">
                      {formatCurrency(inv.total, currency)}
                    </span>
                    {statusPill(inv.status, inv.amendment_status)}
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

export default DashboardPage;
