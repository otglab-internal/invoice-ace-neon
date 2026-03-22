import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { FileText, Clock, CheckCircle, AlertTriangle, ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Invoice {
  id: string;
  contact_name: string;
  total: number;
  status: string;
  created_at: string;
  invoice_number: string | null;
}

const statusPill = (status: string) => {
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

  const canView = permissions.canViewInvoices;

  useEffect(() => {
    supabase.from("global_config").select("value").eq("key", "currency").maybeSingle()
      .then(({ data }) => { if (data?.value) setCurrency(data.value); });
  }, []);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }

    const fetchInvoices = async () => {
      let query = supabase
        .from("invoices")
        .select("id, contact_name, total, status, created_at, invoice_number, submitted_by_system_id")
        .order("created_at", { ascending: false });

      if (permissions.viewOwnInvoicesOnly && systemId) {
        query = query.eq("submitted_by_system_id", systemId);
      }

      const { data, error } = await query;
      if (!error && data) setInvoices(data);
      setLoading(false);
    };
    fetchInvoices();
  }, [systemId, permissions, centreLocations, role, canView]);

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

  const stats = [
    { label: "Total Invoices", value: String(totalCount), icon: FileText, color: "text-primary" },
    { label: "Pending Approval", value: String(pendingCount), icon: Clock, color: "text-warning" },
    { label: "Pushed to Xero", value: String(pushedCount), icon: CheckCircle, color: "text-success" },
    { label: "Failed", value: String(failedCount), icon: AlertTriangle, color: "text-destructive" },
  ];

  const recentInvoices = invoices.slice(0, 10);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold font-display text-foreground">
            Welcome back, {user?.firstName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Here's your invoicing overview</p>
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
                  <div className="flex items-center gap-6">
                    <span className="text-sm text-muted-foreground">{formatDate(inv.created_at)}</span>
                    <span className="text-sm font-medium text-foreground w-24 text-right">
                      {formatCurrency(inv.total, currency)}
                    </span>
                    {statusPill(inv.status)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default DashboardPage;
