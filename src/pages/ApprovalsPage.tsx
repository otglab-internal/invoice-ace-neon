import React, { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Eye } from "lucide-react";
import { toast } from "sonner";

interface PendingInvoice {
  id: string;
  contact: string;
  description: string;
  amount: string;
  date: string;
  status: "pending" | "approved" | "rejected";
  reason?: string;
}

const initialInvoices: PendingInvoice[] = [
  { id: "INV-006", contact: "Lee Music Academy", description: "Lee Rou Xuan\n15 (2026)\nGrand Opening Term Package (RM 2,000)\nFirst Lesson: Last week of March", amount: "RM 2,000.00", date: "2026-03-15", status: "pending" },
  { id: "INV-007", contact: "Tan Piano Studio", description: "Private lesson package x3 months", amount: "RM 1,500.00", date: "2026-03-14", status: "pending" },
  { id: "INV-008", contact: "Wong Violin Lessons", description: "Summer camp registration fee", amount: "RM 800.00", date: "2026-03-13", status: "pending" },
];

const ApprovalsPage: React.FC = () => {
  const [invoices, setInvoices] = useState<PendingInvoice[]>(initialInvoices);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjustmentNote, setAdjustmentNote] = useState("");

  const selected = invoices.find((i) => i.id === selectedId);

  const handleApprove = (id: string) => {
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status: "approved" as const } : i)));
    toast.success(`${id} approved and pushed to Xero`);
    setSelectedId(null);
  };

  const handleReject = (id: string) => {
    setInvoices((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "rejected" as const, reason: adjustmentNote } : i))
    );
    toast.error(`${id} rejected`);
    setSelectedId(null);
    setAdjustmentNote("");
  };

  const pendingCount = invoices.filter((i) => i.status === "pending").length;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-display text-foreground">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pendingCount} invoice{pendingCount !== 1 ? "s" : ""} pending approval
          </p>
        </div>

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
                    <span className="text-sm font-medium text-foreground">{inv.id}</span>
                    <span
                      className={
                        inv.status === "pending"
                          ? "pill-manual"
                          : inv.status === "approved"
                          ? "pill-automated"
                          : "pill-failed"
                      }
                    >
                      {inv.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{inv.contact}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{inv.amount}</p>
                  <p className="text-xs text-muted-foreground">{inv.date}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Detail */}
          <div className="bg-card border border-border rounded-xl p-5">
            {selected ? (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold font-display text-foreground">{selected.id}</h3>
                  <Eye className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Contact:</span> {selected.contact}</p>
                  <p><span className="text-muted-foreground">Amount:</span> {selected.amount}</p>
                  <p><span className="text-muted-foreground">Date:</span> {selected.date}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description:</p>
                  <pre className="text-sm text-foreground whitespace-pre-wrap bg-muted p-3 rounded-lg font-body">{selected.description}</pre>
                </div>

                {selected.status === "pending" && (
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
                      <Button onClick={() => handleApprove(selected.id)} className="flex-1 gap-1" size="sm">
                        <Check className="w-3.5 h-3.5" /> Approve
                      </Button>
                      <Button
                        onClick={() => handleReject(selected.id)}
                        variant="destructive"
                        className="flex-1 gap-1"
                        size="sm"
                      >
                        <X className="w-3.5 h-3.5" /> Reject
                      </Button>
                    </div>
                  </>
                )}

                {selected.status === "approved" && (
                  <div className="p-3 rounded-lg bg-success/10 text-success text-sm font-medium text-center">
                    ✓ Pushed to Xero
                  </div>
                )}

                {selected.status === "rejected" && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    Rejected{selected.reason ? `: ${selected.reason}` : ""}
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
      </div>
    </AppLayout>
  );
};

export default ApprovalsPage;
