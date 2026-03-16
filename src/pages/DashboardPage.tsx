import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { FileText, Clock, CheckCircle, AlertTriangle } from "lucide-react";

const stats = [
  { label: "Total Invoices", value: "124", icon: FileText, color: "text-primary" },
  { label: "Pending Approval", value: "8", icon: Clock, color: "text-warning" },
  { label: "Pushed to Xero", value: "112", icon: CheckCircle, color: "text-success" },
  { label: "Failed", value: "4", icon: AlertTriangle, color: "text-destructive" },
];

const recentInvoices = [
  { id: "INV-001", contact: "Lee Music Academy", amount: "RM 2,000", status: "automated", date: "2026-03-15" },
  { id: "INV-002", contact: "Tan Piano Studio", amount: "RM 1,500", status: "manual", date: "2026-03-14" },
  { id: "INV-003", contact: "Wong Violin Lessons", amount: "RM 800", status: "automated", date: "2026-03-13" },
  { id: "INV-004", contact: "Lim Guitar School", amount: "RM 3,200", status: "failed", date: "2026-03-12" },
  { id: "INV-005", contact: "Chen Music Hub", amount: "RM 1,800", status: "pending", date: "2026-03-11" },
];

const statusPill = (status: string) => {
  const map: Record<string, string> = {
    automated: "pill-automated",
    manual: "pill-manual",
    failed: "pill-failed",
    pending: "pill-pending",
  };
  return <span className={map[status] || "pill-pending"}>{status}</span>;
};

const DashboardPage: React.FC = () => {
  const { user } = useAuth();

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
              <p className="text-2xl font-bold font-display text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold font-display text-foreground">Recent Invoices</h2>
          </div>
          <div className="divide-y divide-border">
            {recentInvoices.map((inv) => (
              <div key={inv.id} className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-foreground w-20">{inv.id}</span>
                  <span className="text-sm text-foreground">{inv.contact}</span>
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-sm text-muted-foreground">{inv.date}</span>
                  <span className="text-sm font-medium text-foreground w-24 text-right">{inv.amount}</span>
                  {statusPill(inv.status)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default DashboardPage;
