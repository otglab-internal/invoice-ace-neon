import React, { useState, useEffect } from "react";
import { nowGMT8 } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X, Eye, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Invoice {
  id: string;
  invoice_number: string | null;
  contact_name: string;
  invoice_date: string;
  reference: string | null;
  line_items: any[];
  total: number;
  submitted_by_name: string;
  submitted_by_system_id: string;
  status: string;
  requires_approval: boolean;
  approval_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  template_id: string | null;
}

const ApprovalsPage: React.FC = () => {
  const { systemId, user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [processing, setProcessing] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);

  const selected = invoices.find((i) => i.id === selectedId);

  const pendingInvoices = invoices.filter((i) => i.status === "pending_approval");
  const processedInvoices = invoices.filter((i) => i.status === "approved" || i.status === "rejected");

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("requires_approval", true)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load invoices");
    } else {
      setInvoices((data as unknown as Invoice[]) || []);
    }
    setLoading(false);
  };

  const logAction = async (invoiceId: string, actionType: string, details: any) => {
    try {
      await supabase.from("invoice_logs").insert({
        invoice_id: invoiceId,
        action_type: actionType,
        source: "ui",
        performed_by: systemId || "",
        performed_by_name: user ? `${user.firstName} ${user.lastName}` : "",
        details: JSON.parse(JSON.stringify(details)),
      } as any);
    } catch (err) {
      console.warn("Failed to write log:", err);
    }
  };

  const handleApprove = async (id: string) => {
    setProcessing(true);
    const approvedAt = nowGMT8();
    const approvedBy = systemId || "";
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "approved",
        approval_note: adjustmentNote || null,
        approved_by: approvedBy,
        approved_at: approvedAt,
      } as any)
      .eq("id", id);

    if (error) {
      toast.error("Failed to approve invoice");
    } else {
      const invoice = invoices.find((i) => i.id === id);
      await logAction(id, "approved", { ...invoice, status: "approved", approved_by: approvedBy, approved_at: approvedAt, approval_note: adjustmentNote || null });

      let webhookDelivered = true;
      if (invoice) {
        try {
          await apiClient.invoices("notify-approval", {
            invoice: { ...invoice, status: "approved", approved_by: approvedBy, approved_at: approvedAt, approval_note: adjustmentNote || null },
          });
        } catch (err) {
          webhookDelivered = false;
          console.warn("n8n webhook notification failed:", err);
        }
      }

      if (webhookDelivered) {
        toast.success("Invoice approved and webhook sent to n8n");
      } else {
        toast.error("Invoice approved, but the n8n webhook failed");
      }

      setSelectedId(null);
      setAdjustmentNote("");
      fetchInvoices();
    }
    setProcessing(false);
  };

  const handleReject = async (id: string) => {
    setProcessing(true);
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "rejected",
        approval_note: adjustmentNote || null,
        approved_by: systemId || "",
        approved_at: nowGMT8(),
      } as any)
      .eq("id", id);

    if (error) {
      toast.error("Failed to reject invoice");
    } else {
      const invoice = invoices.find((i) => i.id === id);
      await logAction(id, "rejected", { ...invoice, status: "rejected", approval_note: adjustmentNote || null });
      toast.error("Invoice rejected");
      setSelectedId(null);
      setAdjustmentNote("");
      fetchInvoices();
    }
    setProcessing(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_approval":
        return <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">Pending</Badge>;
      case "approved":
        return <Badge variant="default" className="text-xs bg-emerald-600">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="text-xs">Rejected</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  const InvoiceTable: React.FC<{ items: Invoice[]; onSelect: (id: string) => void; selectedId: string | null }> = ({ items, onSelect, selectedId: selId }) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/50">
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Invoice ID</th>
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Contact</th>
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Submitted By</th>
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Status</th>
          <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Amount</th>
          <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Date</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {items.map((inv) => (
          <tr
            key={inv.id}
            className={`cursor-pointer hover:bg-muted/50 transition-colors ${selId === inv.id ? "bg-muted/50" : ""}`}
            onClick={() => onSelect(inv.id)}
          >
            <td className="py-3 px-4">
              <code className="text-xs text-foreground">{inv.invoice_number || inv.id.slice(0, 8).toUpperCase()}</code>
            </td>
            <td className="py-3 px-4 text-xs text-foreground">{inv.contact_name}</td>
            <td className="py-3 px-4 text-xs text-muted-foreground">{inv.submitted_by_name || "Unknown"}</td>
            <td className="py-3 px-4">{getStatusBadge(inv.status)}</td>
            <td className="py-3 px-4 text-right text-xs font-medium text-foreground">RM {Number(inv.total).toFixed(2)}</td>
            <td className="py-3 px-4 text-right text-xs text-muted-foreground">{inv.invoice_date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <AppLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Approvals</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {pendingInvoices.length} invoice{pendingInvoices.length !== 1 ? "s" : ""} pending approval
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchInvoices} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : pendingInvoices.length === 0 && processedInvoices.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Check className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">All clear</h3>
            <p className="text-sm text-muted-foreground">No invoices require approval</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Pending section */}
            {pendingInvoices.length > 0 && (
              <div className="flex gap-4">
                {/* List — takes most space */}
                <div className="flex-1 min-w-0 bg-card border border-border rounded-xl overflow-hidden">
                  <InvoiceTable items={pendingInvoices} onSelect={setSelectedId} selectedId={selectedId} />
                </div>

                {/* Compact detail pane */}
                <div className="w-96 shrink-0 bg-card border border-border rounded-xl p-4">
                  {selected && selected.status === "pending_approval" ? (
                    <div className="space-y-2 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold font-display text-foreground text-xs truncate">
                          {selected.invoice_number || selected.id.slice(0, 8).toUpperCase()}
                        </h3>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDetailInvoice(selected)}>
                          <Eye className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="space-y-1 text-xs">
                        <p><span className="text-muted-foreground">Contact:</span> {selected.contact_name}</p>
                        <p><span className="text-muted-foreground">Amount:</span> RM {Number(selected.total).toFixed(2)}</p>
                        <p><span className="text-muted-foreground">Items:</span> {selected.line_items?.length || 0}</p>
                      </div>
                      <Textarea
                        value={adjustmentNote}
                        onChange={(e) => setAdjustmentNote(e.target.value)}
                        placeholder="Notes (optional)..."
                        rows={2}
                        className="text-xs"
                      />
                      <div className="flex gap-2">
                        <Button onClick={() => handleApprove(selected.id)} className="flex-1 gap-1" size="sm" disabled={processing}>
                          {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Approve
                        </Button>
                        <Button onClick={() => handleReject(selected.id)} variant="destructive" className="flex-1 gap-1" size="sm" disabled={processing}>
                          <X className="w-3 h-3" /> Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                      Select a pending invoice
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Processed (Approved / Rejected) section */}
            {processedInvoices.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">Processed</h2>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <InvoiceTable items={processedInvoices} onSelect={(id) => setDetailInvoice(invoices.find((i) => i.id === id) || null)} selectedId={null} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full detail dialog */}
      <Dialog open={!!detailInvoice} onOpenChange={() => setDetailInvoice(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Invoice Details</DialogTitle>
          </DialogHeader>
          {detailInvoice && (
            <div className="space-y-3 text-sm">
              <p><span className="text-muted-foreground">ID:</span> <code className="text-xs">{detailInvoice.id}</code></p>
              <p><span className="text-muted-foreground">Contact:</span> {detailInvoice.contact_name}</p>
              <p><span className="text-muted-foreground">Amount:</span> RM {Number(detailInvoice.total).toFixed(2)}</p>
              <p><span className="text-muted-foreground">Date:</span> {detailInvoice.invoice_date}</p>
              {detailInvoice.reference && <p><span className="text-muted-foreground">Reference:</span> {detailInvoice.reference}</p>}
              <p><span className="text-muted-foreground">Submitted by:</span> {detailInvoice.submitted_by_name}</p>
              {detailInvoice.approval_note && <p><span className="text-muted-foreground">Note:</span> {detailInvoice.approval_note}</p>}
              <div>
                <p className="text-muted-foreground mb-1">Line Items:</p>
                <div className="space-y-2">
                  {(detailInvoice.line_items || []).map((item: any, idx: number) => (
                    <div key={idx} className="text-xs bg-muted p-3 rounded-lg">
                      <pre className="text-foreground whitespace-pre-wrap font-body">{item.description}</pre>
                      <p className="text-muted-foreground mt-1">Qty: {item.quantity} × RM {Number(item.cost).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default ApprovalsPage;
