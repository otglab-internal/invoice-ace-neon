import React, { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Eye } from "lucide-react";
import { toast } from "sonner";
import { neonQuery } from "@/lib/neon-client";

interface LogEntry {
  id: string;
  invoice_id: string;
  action_type: string;
  source: string;
  performed_by: string;
  performed_by_name: string;
  details: any;
  created_at: string;
}

const actionBadge = (type: string) => {
  switch (type) {
    case "request":
      return <Badge variant="outline" className="text-xs border-blue-500 text-blue-600">Request</Badge>;
    case "approved":
      return <Badge variant="default" className="text-xs bg-emerald-600">Approved</Badge>;
    case "rejected":
      return <Badge variant="destructive" className="text-xs">Rejected</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{type}</Badge>;
  }
};

const sourceBadge = (source: string) => (
  <Badge variant="outline" className="text-xs">{source.toUpperCase()}</Badge>
);

const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLog, setDetailLog] = useState<LogEntry | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await neonQuery("invoice_logs", {
      order: { column: "created_at", ascending: false },
      limit: 200,
    });

    if (error) {
      toast.error("Failed to load logs");
    } else {
      setLogs((data as LogEntry[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Logs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Activity log for all invoice actions
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
        ) : logs.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <h3 className="text-sm font-semibold text-foreground mb-1">No logs yet</h3>
            <p className="text-sm text-muted-foreground">Invoice actions will appear here</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
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
                    <td className="py-3 px-4">{sourceBadge(log.source)}</td>
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
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detailLog} onOpenChange={() => setDetailLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Log Details</DialogTitle>
          </DialogHeader>
          {detailLog && (
            <div className="space-y-3 text-sm">
              <p><span className="text-muted-foreground">Invoice ID:</span> <code className="text-xs">{detailLog.invoice_id}</code></p>
              <p><span className="text-muted-foreground">Action:</span> {detailLog.action_type}</p>
              <p><span className="text-muted-foreground">Source:</span> {detailLog.source.toUpperCase()}</p>
              <p><span className="text-muted-foreground">By:</span> {detailLog.performed_by_name || detailLog.performed_by}</p>
              <p><span className="text-muted-foreground">Date:</span> {new Date(detailLog.created_at).toLocaleString()}</p>
              <div>
                <p className="text-muted-foreground mb-1">Invoice Data:</p>
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
