import React, { useState, useEffect } from "react";
import { nowGMT8 } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X, Eye, Loader2, RefreshCw, Pencil, Trash2, Plus, ArrowRightLeft, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { neonQuery, neonInsert, neonUpdate } from "@/lib/neon-client";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-logger";

interface LineItem {
  description: string;
  quantity: number;
  cost: number;
  account?: string;
  center?: string;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  contact_id: string | null;
  contact_name: string;
  invoice_date: string;
  reference: string | null;
  line_items: LineItem[];
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
  amendment_status: string | null;
  amendment_data: any | null;
  amendment_requested_by: string | null;
  amendment_requested_by_name: string | null;
  amendment_requested_at: string | null;
  amendment_note: string | null;
  invoice_pdf_url: string | null;
  /** Per-invoice currency captured at submission time. */
  currency?: string | null;
}

const ApprovalsPage: React.FC = () => {
  const { systemId, user, role, centreLocations } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [processing, setProcessing] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLineItems, setEditLineItems] = useState<LineItem[]>([]);
  const [editContactName, setEditContactName] = useState("");
  const [editReference, setEditReference] = useState("");
  const [activeTab, setActiveTab] = useState<"approvals" | "amendments">("approvals");
  const [selectedAmendmentId, setSelectedAmendmentId] = useState<string | null>(null);
  const [amendmentNote, setAmendmentNote] = useState("");

  const selected = invoices.find((i) => i.id === selectedId);
  const selectedAmendment = invoices.find((i) => i.id === selectedAmendmentId);

  const pendingInvoices = invoices.filter((i) => i.status === "pending_approval");
  const processedInvoices = invoices.filter((i) => (i.status === "approved" || i.status === "rejected") && !i.amendment_status);
  const pendingAmendments = invoices.filter((i) => i.amendment_status === "pending");

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    setLoading(true);
    const { data, error } = await neonQuery("invoices", {
      orFilters: [
        { requires_approval: true },
        { amendment_status: "pending" },
      ],
      order: { column: "created_at", ascending: false },
    });

    if (error) {
      toast.error("Failed to load invoices");
    } else {
      setInvoices((data as unknown as Invoice[]) || []);
    }
    setLoading(false);
  };

  const logAction = async (invoiceId: string, actionType: string, details: any) => {
    try {
      await neonInsert("invoice_logs", {
        invoice_id: invoiceId,
        action_type: actionType,
        source: "ui",
        performed_by: systemId || "",
        performed_by_name: user ? `${user.firstName} ${user.lastName}` : "",
        details: JSON.parse(JSON.stringify(details)),
      });
    } catch (err) {
      console.warn("Failed to write log:", err);
    }
  };

  const startEditing = (inv: Invoice) => {
    setEditing(true);
    setEditContactName(inv.contact_name);
    setEditReference(inv.reference || "");
    setEditLineItems(
      (inv.line_items || []).map((li: any) => ({
        description: li.description || "",
        quantity: Number(li.quantity) || 0,
        cost: Number(li.cost) || 0,
        account: li.account || "",
        center: li.center || "",
      }))
    );
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditLineItems([]);
    setEditContactName("");
    setEditReference("");
  };

  const saveEdits = async (id: string) => {
    const newTotal = editLineItems.reduce((s, li) => s + li.quantity * li.cost, 0);
    const { error } = await neonUpdate("invoices", {
      contact_name: editContactName,
      reference: editReference,
      line_items: JSON.parse(JSON.stringify(editLineItems)),
      total: newTotal,
    }, { id });

    if (error) {
      toast.error("Failed to save edits");
    } else {
      const performerName = user ? `${user.firstName} ${user.lastName}` : "";
      await logActivity("invoice_edited", "invoice", systemId || "", performerName, { invoice_id: id, contact_name: editContactName, total: newTotal });
      toast.success("Invoice updated");
      setEditing(false);
      fetchInvoices();
    }
  };

  const updateEditItem = (idx: number, updates: Partial<LineItem>) => {
    setEditLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, ...updates } : li))
    );
  };

  const removeEditItem = (idx: number) => {
    setEditLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const addEditItem = () => {
    setEditLineItems((prev) => [...prev, { description: "", quantity: 1, cost: 0 }]);
  };

  const editTotal = editLineItems.reduce((s, li) => s + (li.quantity || 0) * (li.cost || 0), 0);

  const handleApprove = async (id: string) => {
    setProcessing(true);
    const approvedAt = nowGMT8();
    const approvedBy = systemId || "";
    const { error } = await neonUpdate("invoices", {
      status: "approved",
      approval_note: adjustmentNote || null,
      approved_by: approvedBy,
      approved_at: approvedAt,
    }, { id });

    if (error) {
      toast.error("Failed to approve invoice");
    } else {
      const invoice = invoices.find((i) => i.id === id);
      await logAction(id, "approved", { ...invoice, status: "approved", approved_by: approvedBy, approved_at: approvedAt, approval_note: adjustmentNote || null });

      // Send "approved invoice" notification email
      try {
        await apiClient.invoices("send-approved-email", {
          invoice: { ...invoice, status: "approved", approved_by: approvedBy, approved_at: approvedAt, approval_note: adjustmentNote || null },
        });
      } catch (err) {
        console.warn("Approved invoice email failed:", err);
      }

      let webhookDelivered = true;
      if (invoice) {
        try {
          await apiClient.invoices("notify-approval", {
            invoice: { ...invoice, status: "approved", approved_by: approvedBy, approved_at: approvedAt, approval_note: adjustmentNote || null, contact_id: invoice.contact_id },
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
      setEditing(false);
      fetchInvoices();
    }
    setProcessing(false);
  };

  const handleReject = async (id: string) => {
    setProcessing(true);
    const { error } = await neonUpdate("invoices", {
      status: "rejected",
      approval_note: adjustmentNote || null,
      approved_by: systemId || "",
      approved_at: nowGMT8(),
    }, { id });

    if (error) {
      toast.error("Failed to reject invoice");
    } else {
      const invoice = invoices.find((i) => i.id === id);
      await logAction(id, "rejected", { ...invoice, status: "rejected", approval_note: adjustmentNote || null });
      toast.error("Invoice rejected");
      setSelectedId(null);
      setAdjustmentNote("");
      setEditing(false);
      fetchInvoices();
    }
    setProcessing(false);
  };

  const handleApproveAmendment = async (id: string) => {
    setProcessing(true);
    const invoice = invoices.find((i) => i.id === id);
    if (!invoice?.amendment_data) {
      toast.error("No amendment data found");
      setProcessing(false);
      return;
    }

    const aData = invoice.amendment_data;
    const { error } = await neonUpdate("invoices", {
      contact_name: aData.contact_name,
      contact_id: aData.contact_id || null,
      reference: aData.reference || "",
      line_items: JSON.parse(JSON.stringify(aData.line_items)),
      total: aData.total,
      amendment_status: "approved",
      amendment_data: null,
    }, { id });

    if (error) {
      toast.error("Failed to approve amendment");
    } else {
      await logAction(id, "amendment_approved", {
        approved_by: systemId,
        amendment_data: aData,
        note: amendmentNote,
      });

      try {
        await apiClient.invoices("notify-amendment", {
          invoice: {
            ...invoice,
            contact_name: aData.contact_name,
            contact_id: aData.contact_id || invoice.contact_id,
            reference: aData.reference,
            line_items: aData.line_items,
            total: aData.total,
            status: "approved",
            amendment_approved: true,
          },
          previous: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            contact_id: invoice.contact_id,
            contact_name: invoice.contact_name,
            reference: invoice.reference,
            line_items: invoice.line_items,
            total: invoice.total,
          },
        });
        toast.success("Amendment approved and sent to Xero");
      } catch {
        toast.success("Amendment approved (Xero resubmit may have failed)");
      }

      setSelectedAmendmentId(null);
      setAmendmentNote("");
      fetchInvoices();
    }
    setProcessing(false);
  };

  const handleRejectAmendment = async (id: string) => {
    setProcessing(true);
    const { error } = await neonUpdate("invoices", {
      amendment_status: "rejected",
      amendment_data: null,
    }, { id });

    if (error) {
      toast.error("Failed to reject amendment");
    } else {
      await logAction(id, "amendment_rejected", {
        rejected_by: systemId,
        note: amendmentNote,
      });
      toast.error("Amendment rejected");
      setSelectedAmendmentId(null);
      setAmendmentNote("");
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
              {inv.invoice_pdf_url && <FileText className="w-3 h-3 inline ml-1.5 text-primary" />}
            </td>
            <td className="py-3 px-4 text-xs text-foreground">{inv.contact_name}</td>
            <td className="py-3 px-4 text-xs text-muted-foreground">{inv.submitted_by_name || "Unknown"}</td>
            <td className="py-3 px-4">{getStatusBadge(inv.status)}</td>
            <td className="py-3 px-4 text-right text-xs font-medium text-foreground">{inv.currency || "RM"} {Number(inv.total).toFixed(2)}</td>
            <td className="py-3 px-4 text-right text-xs text-muted-foreground">{inv.invoice_date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const AmendmentTable: React.FC<{ items: Invoice[]; onSelect: (id: string) => void; selectedId: string | null }> = ({ items, onSelect, selectedId: selId }) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/50">
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Invoice ID</th>
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Contact</th>
          <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Requested By</th>
          <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Current</th>
          <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Amended</th>
          <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Requested</th>
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
            <td className="py-3 px-4 text-xs text-foreground">{inv.amendment_data?.contact_name || inv.contact_name}</td>
            <td className="py-3 px-4 text-xs text-muted-foreground">{inv.amendment_requested_by_name || "Unknown"}</td>
            <td className="py-3 px-4 text-right text-xs font-medium text-foreground">{inv.currency || "RM"} {Number(inv.total).toFixed(2)}</td>
            <td className="py-3 px-4 text-right text-xs font-medium text-foreground">{inv.currency || "RM"} {Number(inv.amendment_data?.total || 0).toFixed(2)}</td>
            <td className="py-3 px-4 text-right text-xs text-muted-foreground">
              {inv.amendment_requested_at ? new Date(inv.amendment_requested_at).toLocaleDateString("en-MY") : "—"}
            </td>
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
              {pendingInvoices.length} invoice{pendingInvoices.length !== 1 ? "s" : ""} pending
              {pendingAmendments.length > 0 && (
                <span className="ml-2">• {pendingAmendments.length} amendment{pendingAmendments.length !== 1 ? "s" : ""} pending</span>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchInvoices} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {pendingAmendments.length > 0 && (
          <div className="flex gap-1 mb-4 bg-muted/50 p-1 rounded-lg w-fit">
            <button
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "approvals" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveTab("approvals")}
            >
              Approvals ({pendingInvoices.length})
            </button>
            <button
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "amendments" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveTab("amendments")}
            >
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Amendments ({pendingAmendments.length})
              </span>
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : activeTab === "amendments" && pendingAmendments.length > 0 ? (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-w-0 bg-card border border-border rounded-xl overflow-x-auto">
              <AmendmentTable items={pendingAmendments} onSelect={(id) => { setSelectedAmendmentId(id); setAmendmentNote(""); }} selectedId={selectedAmendmentId} />
            </div>

            <div className="w-full lg:shrink-0 lg:w-[768px] bg-card border border-border rounded-xl p-5 overflow-y-auto lg:max-h-[80vh]">
              {selectedAmendment ? (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="font-semibold font-display text-foreground text-sm">
                    Amendment: {selectedAmendment.invoice_number || selectedAmendment.id.slice(0, 8).toUpperCase()}
                  </h3>

                  <div className="text-xs text-muted-foreground">
                    Requested by <span className="text-foreground font-medium">{selectedAmendment.amendment_requested_by_name}</span>
                    {selectedAmendment.amendment_note && (
                      <p className="mt-1 italic">"{selectedAmendment.amendment_note}"</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Current</p>
                      <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-xs">
                        <p><span className="text-muted-foreground">Contact:</span> {selectedAmendment.contact_name}</p>
                        <p><span className="text-muted-foreground">Reference:</span> {selectedAmendment.reference || "—"}</p>
                        <p><span className="text-muted-foreground">Total:</span> {selectedAmendment.currency || "RM"} {Number(selectedAmendment.total).toFixed(2)}</p>
                        <p className="text-muted-foreground mt-2 font-medium">Line Items ({selectedAmendment.line_items?.length || 0})</p>
                        {(selectedAmendment.line_items || []).map((li: any, idx: number) => (
                          <div key={idx} className="pl-2 border-l-2 border-border mt-1">
                            <p className="whitespace-pre-wrap">{(li.description || "").replace(/\\n/g, "\n")}</p>
                            <p className="text-muted-foreground">Qty: {li.quantity} × {selectedAmendment.currency || "RM"} {Number(li.cost).toFixed(2)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-primary mb-1">Proposed</p>
                      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1 text-xs">
                        <p><span className="text-muted-foreground">Contact:</span> {selectedAmendment.amendment_data?.contact_name}</p>
                        <p><span className="text-muted-foreground">Reference:</span> {selectedAmendment.amendment_data?.reference || "—"}</p>
                        <p><span className="text-muted-foreground">Total:</span> {selectedAmendment.currency || "RM"} {Number(selectedAmendment.amendment_data?.total || 0).toFixed(2)}</p>
                        <p className="text-muted-foreground mt-2 font-medium">Line Items ({selectedAmendment.amendment_data?.line_items?.length || 0})</p>
                        {(selectedAmendment.amendment_data?.line_items || []).map((li: any, idx: number) => (
                          <div key={idx} className="pl-2 border-l-2 border-primary/30 mt-1">
                            <p className="whitespace-pre-wrap">{(li.description || "").replace(/\\n/g, "\n")}</p>
                            <p className="text-muted-foreground">Qty: {li.quantity} × {selectedAmendment.currency || "RM"} {Number(li.cost).toFixed(2)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <Textarea
                    value={amendmentNote}
                    onChange={(e) => setAmendmentNote(e.target.value)}
                    placeholder="Notes (optional)..."
                    rows={2}
                    className="text-xs"
                  />

                  <div className="flex gap-2">
                    <Button onClick={() => handleApproveAmendment(selectedAmendment.id)} className="flex-1 gap-1" size="sm" disabled={processing}>
                      {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Approve Amendment
                    </Button>
                    <Button onClick={() => handleRejectAmendment(selectedAmendment.id)} variant="destructive" className="flex-1 gap-1" size="sm" disabled={processing}>
                      <X className="w-3 h-3" /> Reject
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                  Select a pending amendment
                </div>
              )}
            </div>
          </div>
        ) : pendingInvoices.length === 0 && processedInvoices.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Check className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">All clear</h3>
            <p className="text-sm text-muted-foreground">No invoices require approval</p>
          </div>
        ) : (
          <div className="space-y-6">
            {pendingInvoices.length > 0 && (
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1 min-w-0 bg-card border border-border rounded-xl overflow-x-auto">
                  <InvoiceTable items={pendingInvoices} onSelect={(id) => { setSelectedId(id); cancelEditing(); }} selectedId={selectedId} />
                </div>

                <div className="w-full lg:shrink-0 lg:w-[768px] bg-card border border-border rounded-xl p-5 overflow-y-auto lg:max-h-[80vh]">
                  {selected && selected.status === "pending_approval" ? (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold font-display text-foreground text-sm">
                          {selected.invoice_number || selected.id.slice(0, 8).toUpperCase()}
                        </h3>
                        <div className="flex gap-1">
                          {!editing && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => startEditing(selected)}>
                              <Pencil className="w-3 h-3" /> Edit
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDetailInvoice(selected)}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {editing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs text-muted-foreground">Contact Name</Label>
                              <Input value={editContactName} onChange={(e) => setEditContactName(e.target.value)} className="mt-1 text-sm" />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Reference</Label>
                              <Input value={editReference} onChange={(e) => setEditReference(e.target.value)} className="mt-1 text-sm" />
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <Label className="text-xs text-muted-foreground font-medium">Line Items</Label>
                              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 gap-1 text-xs" onClick={addEditItem}>
                                <Plus className="w-3 h-3" /> Add
                              </Button>
                            </div>
                            <div className="space-y-3">
                              {editLineItems.map((li, idx) => (
                                <div key={idx} className="bg-muted/50 border border-border rounded-lg p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <Label className="text-xs text-muted-foreground">Description</Label>
                                      <Textarea
                                        value={li.description}
                                        onChange={(e) => updateEditItem(idx, { description: e.target.value })}
                                        rows={2}
                                        className="mt-1 text-xs"
                                      />
                                    </div>
                                    {editLineItems.length > 1 && (
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 mt-5 text-destructive" onClick={() => removeEditItem(idx)}>
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                                      <Input
                                        type="number"
                                        value={li.quantity}
                                        onChange={(e) => updateEditItem(idx, { quantity: Number(e.target.value) })}
                                        className="mt-1 text-xs"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-muted-foreground">Cost ({selected?.currency || "RM"})</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={li.cost}
                                        onChange={(e) => updateEditItem(idx, { cost: Number(e.target.value) })}
                                        className="mt-1 text-xs"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="text-sm font-medium text-foreground">
                            Total: {selected.currency || "RM"} {editTotal.toFixed(2)}
                          </div>

                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => saveEdits(selected.id)} className="flex-1">Save Edits</Button>
                            <Button size="sm" variant="outline" onClick={cancelEditing}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <p><span className="text-muted-foreground">Contact:</span> {selected.contact_name}</p>
                            <p><span className="text-muted-foreground">Amount:</span> {selected.currency || "RM"} {Number(selected.total).toFixed(2)}</p>
                            <p><span className="text-muted-foreground">Date:</span> {selected.invoice_date}</p>
                            {selected.reference && <p><span className="text-muted-foreground">Ref:</span> {selected.reference}</p>}
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground font-medium">Line Items ({selected.line_items?.length || 0})</p>
                            {(selected.line_items || []).map((item: any, idx: number) => (
                              <div key={idx} className="text-xs bg-muted/50 p-2 rounded-lg">
                                <p className="text-foreground whitespace-pre-wrap">{(item.description || "").replace(/\\n/g, "\n")}</p>
                                <p className="text-muted-foreground mt-0.5">Qty: {item.quantity} × {selected.currency || "RM"} {Number(item.cost).toFixed(2)}</p>
                              </div>
                            ))}
                          </div>

                          {selected.invoice_pdf_url && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 w-full"
                              onClick={async () => {
                                try {
                                  const res = await fetch(
                                    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoice-pdf-webhook?path=${encodeURIComponent(selected.invoice_pdf_url!)}`,
                                    { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
                                  );
                                  const result = await res.json();
                                  if (result.signedUrl) {
                                    window.open(result.signedUrl, "_blank");
                                  } else {
                                    toast.error("Failed to get PDF URL: " + (result.error || "Unknown error"));
                                  }
                                } catch (e: any) {
                                  toast.error("Failed to get PDF URL: " + e.message);
                                }
                              }}
                            >
<FileText className="w-3.5 h-3.5" /> View Xero Invoice PDF
                            </Button>
                          )}

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
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                      Select a pending invoice
                    </div>
                  )}
                </div>
              </div>
            )}

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
              {detailInvoice.invoice_pdf_url && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 mt-1"
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoice-pdf-webhook?path=${encodeURIComponent(detailInvoice.invoice_pdf_url!)}`,
                        { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
                      );
                      const result = await res.json();
                      if (result.signedUrl) {
                        window.open(result.signedUrl, "_blank");
                      } else {
                        toast.error("Failed to get PDF URL: " + (result.error || "Unknown error"));
                      }
                    } catch (e: any) {
                      toast.error("Failed to get PDF URL: " + e.message);
                    }
                  }}
                >
                  <FileText className="w-3.5 h-3.5" /> View Xero Invoice PDF
                </Button>
              )}
              <div>
                <p className="text-muted-foreground mb-1">Line Items:</p>
                <div className="space-y-2">
                  {(detailInvoice.line_items || []).map((item: any, idx: number) => (
                    <div key={idx} className="text-xs bg-muted p-3 rounded-lg">
                      <pre className="text-foreground whitespace-pre-wrap font-body">{(item.description || "").replace(/\\n/g, "\n")}</pre>
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
