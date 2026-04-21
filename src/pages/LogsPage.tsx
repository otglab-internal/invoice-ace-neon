import React, { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Eye } from "lucide-react";
import { toast } from "sonner";
import { neonQuery } from "@/lib/neon-client";

interface LogEntry {
  id: string;
  invoice_id?: string;
  action_type: string;
  source?: string;
  category?: string;
  performed_by: string;
  performed_by_name: string;
  details: any;
  created_at: string;
}

const actionBadge = (type: string) => {
  const colors: Record<string, string> = {
    request: "border-blue-500 text-blue-600",
    approved: "bg-emerald-600 text-white border-emerald-600",
    rejected: "bg-destructive text-destructive-foreground",
    config_saved: "border-violet-500 text-violet-600",
    data_cleared: "bg-destructive text-destructive-foreground",
    template_created: "border-blue-500 text-blue-600",
    template_updated: "border-amber-500 text-amber-600",
    template_deleted: "bg-destructive text-destructive-foreground",
    staff_assignment_updated: "border-cyan-500 text-cyan-600",
    test_email_sent: "border-green-500 text-green-600",
    xero_connected: "border-green-500 text-green-600",
    xero_disconnected: "border-orange-500 text-orange-600",
  };
  const cls = colors[type];
  if (cls?.includes("bg-")) {
    return <Badge className={`text-xs ${cls}`}>{type.replace(/_/g, " ")}</Badge>;
  }
  return <Badge variant="outline" className={`text-xs ${cls || ""}`}>{type.replace(/_/g, " ")}</Badge>;
};

const categoryBadge = (cat: string) => {
  const colors: Record<string, string> = {
    config: "border-violet-500 text-violet-600",
    template: "border-blue-500 text-blue-600",
    staff: "border-cyan-500 text-cyan-600",
    settings: "border-amber-500 text-amber-600",
    system: "border-red-500 text-red-600",
    invoice: "border-emerald-500 text-emerald-600",
    email: "border-green-500 text-green-600",
  };
  return <Badge variant="outline" className={`text-xs ${colors[cat] || ""}`}>{cat.toUpperCase()}</Badge>;
};

const sourceBadge = (source: string) => (
  <Badge variant="outline" className="text-xs">{source.toUpperCase()}</Badge>
);

const LogsPage: React.FC = () => {
  const [invoiceLogs, setInvoiceLogs] = useState<LogEntry[]>([]);
  const [activityLogs, setActivityLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLog, setDetailLog] = useState<LogEntry | null>(null);
  const [tab, setTab] = useState("invoice");

  const fetchLogs = async () => {
    setLoading(true);
    const [invRes, actRes] = await Promise.all([
      neonQuery("invoice_logs", {
        order: { column: "created_at", ascending: false },
        limit: 200,
      }),
      neonQuery("activity_logs", {
        order: { column: "created_at", ascending: false },
        limit: 200,
      }),
    ]);

    if (invRes.error) toast.error("Failed to load invoice logs");
    else setInvoiceLogs((invRes.data as LogEntry[]) || []);

    if (actRes.error) toast.error("Failed to load activity logs");
    else setActivityLogs((actRes.data as LogEntry[]) || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
  };

  const renderInvoiceTable = (logs: LogEntry[]) => (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">No.</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Date</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">By Who</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Action Type</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Source</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {logs.map((log, idx) => (
            <tr key={log.id} className="hover:bg-muted/30 transition-colors">
              <td className="py-3 px-4 text-xs text-muted-foreground">{idx + 1}</td>
              <td className="py-3 px-4 text-xs text-foreground">{formatDate(log.created_at)}</td>
              <td className="py-3 px-4 text-xs text-foreground">{log.performed_by_name || log.performed_by || "—"}</td>
              <td className="py-3 px-4">{actionBadge(log.action_type)}</td>
              <td className="py-3 px-4">{sourceBadge(log.source || "ui")}</td>
              <td className="py-3 px-4 text-right">
                <Button variant="ghost" size="sm" onClick={() => setDetailLog(log)} className="gap-1">
                  <Eye className="w-3.5 h-3.5" /> View
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderActivityTable = (logs: LogEntry[]) => (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">No.</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Date</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">By Who</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Action</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Category</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {logs.map((log, idx) => (
            <tr key={log.id} className="hover:bg-muted/30 transition-colors">
              <td className="py-3 px-4 text-xs text-muted-foreground">{idx + 1}</td>
              <td className="py-3 px-4 text-xs text-foreground">{formatDate(log.created_at)}</td>
              <td className="py-3 px-4 text-xs text-foreground">{log.performed_by_name || log.performed_by || "—"}</td>
              <td className="py-3 px-4">{actionBadge(log.action_type)}</td>
              <td className="py-3 px-4">{categoryBadge(log.category || "system")}</td>
              <td className="py-3 px-4 text-right">
                <Button variant="ghost" size="sm" onClick={() => setDetailLog(log)} className="gap-1">
                  <Eye className="w-3.5 h-3.5" /> View
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const emptyState = (msg: string) => (
    <div className="bg-card border border-border rounded-xl p-12 text-center">
      <h3 className="text-sm font-semibold text-foreground mb-1">No logs yet</h3>
      <p className="text-sm text-muted-foreground">{msg}</p>
    </div>
  );

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Logs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Complete activity log for all actions
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="invoice">Invoice Logs ({invoiceLogs.length})</TabsTrigger>
              <TabsTrigger value="activity">Activity Logs ({activityLogs.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="invoice">
              {invoiceLogs.length === 0
                ? emptyState("Invoice actions will appear here")
                : renderInvoiceTable(invoiceLogs)}
            </TabsContent>
            <TabsContent value="activity">
              {activityLogs.length === 0
                ? emptyState("System activity will appear here")
                : renderActivityTable(activityLogs)}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={!!detailLog} onOpenChange={() => setDetailLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Log Details</DialogTitle>
          </DialogHeader>
          {detailLog && (
            <div className="space-y-3 text-sm">
              {detailLog.invoice_id && (
                <p><span className="text-muted-foreground">Invoice ID:</span> <code className="text-xs">{detailLog.invoice_id}</code></p>
              )}
              <p><span className="text-muted-foreground">Action:</span> {detailLog.action_type}</p>
              {detailLog.source && <p><span className="text-muted-foreground">Source:</span> {detailLog.source.toUpperCase()}</p>}
              {detailLog.category && <p><span className="text-muted-foreground">Category:</span> {detailLog.category.toUpperCase()}</p>}
              <p><span className="text-muted-foreground">By:</span> {detailLog.performed_by_name || detailLog.performed_by}</p>
              <p><span className="text-muted-foreground">Date:</span> {new Date(detailLog.created_at).toLocaleString()}</p>
              <div>
                <p className="text-muted-foreground mb-1">Payload:</p>
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
                  {JSON.stringify(detailLog.details, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default LogsPage;
