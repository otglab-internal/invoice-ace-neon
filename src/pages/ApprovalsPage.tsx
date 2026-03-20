import React, { useState, useEffect } from "react";
import { nowGMT8 } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Check, X, Eye, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Invoice {
  id: string;
  invoice_number: string | null;
  contact_name: string;
  invoice_date: string;
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

  const selected = invoices.find((i) => i.id === selectedId);

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

  const handleApprove = async (id: string) => {
    setProcessing(true);
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "approved",
        approval_note: adjustmentNote || null,
        approved_by: systemId || "",
        approved_at: nowGMT8(),
      } as any)
      .eq("id", id);

    if (error) {
      toast.error("Failed to approve invoice");
    } else {
      toast.success("Invoice approved and will be pushed to Xero");
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
      toast.error("Invoice rejected");
      setSelectedId(null);
      setAdjustmentNote("");
      fetchInvoices();
    }
    setProcessing(false);
  };

  const pendingCount = invoices.filter((i) => i.status === "pending_approval").length;

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

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Approvals</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {pendingCount} invoice{pendingCount !== 1 ? "s" : ""} pending approval
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
        ) : invoices.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Check className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">All clear</h3>
            <p className="text-sm text-muted-foreground">No invoices require approval</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {/* List */}
            <div className="col-span-2 bg-card border border-border rounded-xl divide-y divide-border">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className={`px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors ${
                    selectedId === inv.id ? "bg-muted/50" : ""
                  }`}
                  onClick={() => setSelectedId(inv.id)}
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {inv.invoice_number || inv.id.slice(0, 8).toUpperCase()}
                      </span>
                      {getStatusBadge(inv.status)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{inv.contact_name}</p>
                    <p className="text-xs text-muted-foreground">
                      by {inv.submitted_by_name || "Unknown"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">RM {Number(inv.total).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{inv.invoice_date}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Detail */}
            <div className="bg-card border border-border rounded-xl p-5">
              {selected ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold font-display text-foreground">
                      {selected.invoice_number || selected.id.slice(0, 8).toUpperCase()}
                    </h3>
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-muted-foreground">Contact:</span> {selected.contact_name}</p>
                    <p><span className="text-muted-foreground">Amount:</span> RM {Number(selected.total).toFixed(2)}</p>
                    <p><span className="text-muted-foreground">Date:</span> {selected.invoice_date}</p>
                    <p><span className="text-muted-foreground">Submitted by:</span> {selected.submitted_by_name}</p>
                  </div>

                  {/* Line items */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Line Items ({selected.line_items?.length || 0}):</p>
                    <div className="space-y-2">
                      {(selected.line_items || []).map((item: any, idx: number) => (
                        <div key={idx} className="text-sm bg-muted p-3 rounded-lg">
                          <pre className="text-foreground whitespace-pre-wrap font-body text-xs">{item.description}</pre>
                          <p className="text-xs text-muted-foreground mt-1">
                            Qty: {item.quantity} × RM {Number(item.cost).toFixed(2)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selected.status === "pending_approval" && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Adjustment Notes</p>
                        <Textarea
                          value={adjustmentNote}
                          onChange={(e) => setAdjustmentNote(e.target.value)}
                          placeholder="Optional notes..."
                          rows={3}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleApprove(selected.id)}
                          className="flex-1 gap-1"
                          size="sm"
                          disabled={processing}
                        >
                          {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Approve
                        </Button>
                        <Button
                          onClick={() => handleReject(selected.id)}
                          variant="destructive"
                          className="flex-1 gap-1"
                          size="sm"
                          disabled={processing}
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </Button>
                      </div>
                    </>
                  )}

                  {selected.status === "approved" && (
                    <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 text-sm font-medium text-center">
                      ✓ Approved{selected.approval_note ? ` — ${selected.approval_note}` : ""}
                    </div>
                  )}

                  {selected.status === "rejected" && (
                    <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                      Rejected{selected.approval_note ? `: ${selected.approval_note}` : ""}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  Select an invoice to review
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ApprovalsPage;
