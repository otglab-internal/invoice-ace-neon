import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { neonUpdate, neonInsert } from "@/lib/neon-client";
import { useAuth } from "@/contexts/AuthContext";
import { sanitizeString, sanitizeObject } from "@/lib/sanitize";

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
  /** Per-invoice currency captured at submission time. */
  currency?: string | null;
}

interface AmendInvoiceDialogProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAmendmentSubmitted: () => void;
}

const AmendInvoiceDialog: React.FC<AmendInvoiceDialogProps> = ({
  invoice,
  open,
  onOpenChange,
  onAmendmentSubmitted,
}) => {
  const { systemId, user } = useAuth();
  const [contactName, setContactName] = useState("");
  const [reference, setReference] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (invoice && open) {
      setContactName(invoice.contact_name);
      setReference(invoice.reference || "");
      setLineItems(
        (invoice.line_items || []).map((li: any) => ({
          description: li.description || "",
          quantity: Number(li.quantity) || 0,
          cost: Number(li.cost) || 0,
          account: li.account || "",
          center: li.center || "",
        }))
      );
      setNote("");
    }
  }, [invoice, open]);

  const updateItem = (idx: number, updates: Partial<LineItem>) => {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, ...updates } : li)));
  };

  const removeItem = (idx: number) => {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const addItem = () => {
    setLineItems((prev) => [...prev, { description: "", quantity: 1, cost: 0 }]);
  };

  const total = lineItems.reduce((s, li) => s + (li.quantity || 0) * (li.cost || 0), 0);

  const handleSubmit = async () => {
    if (!invoice) return;
    setSubmitting(true);

    try {
      const amendmentData = sanitizeObject({
        contact_name: contactName,
        contact_id: invoice.contact_id,
        reference,
        line_items: lineItems,
        total,
      });

      const { error } = await neonUpdate(
        "invoices",
        {
          amendment_status: "pending",
          amendment_data: JSON.parse(JSON.stringify(amendmentData)),
          amendment_requested_by: systemId || "",
          amendment_requested_by_name: user ? `${user.firstName} ${user.lastName}` : "",
          amendment_requested_at: new Date().toISOString(),
          amendment_note: note || null,
        },
        { id: invoice.id }
      );

      if (error) {
        toast.error("Failed to submit amendment");
      } else {
        // Log the amendment request
        try {
          await neonInsert("invoice_logs", {
            invoice_id: invoice.id,
            action_type: "amendment_requested",
            source: "ui",
            performed_by: systemId || "",
            performed_by_name: user ? `${user.firstName} ${user.lastName}` : "",
            details: JSON.parse(JSON.stringify({ amendment_data: amendmentData, note })),
          });
        } catch (logErr) {
          console.warn("Failed to write log:", logErr);
        }

        toast.success("Amendment submitted for approval");
        onOpenChange(false);
        onAmendmentSubmitted();
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            Amend Invoice — {invoice.invoice_number || invoice.id.slice(0, 8).toUpperCase()}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Contact Name</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-muted-foreground font-medium">Line Items</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 gap-1 text-xs" onClick={addItem}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            <div className="space-y-3">
              {lineItems.map((li, idx) => (
                <div key={idx} className="bg-muted/50 border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">Description</Label>
                      <Textarea
                        value={li.description}
                        onChange={(e) => updateItem(idx, { description: e.target.value })}
                        rows={2}
                        className="mt-1 text-xs"
                      />
                    </div>
                    {lineItems.length > 1 && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 mt-5 text-destructive" onClick={() => removeItem(idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input type="number" value={li.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} className="mt-1 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Cost ({invoice?.currency || "RM"})</Label>
                      <Input type="number" step="0.01" value={li.cost} onChange={(e) => updateItem(idx, { cost: Number(e.target.value) })} className="mt-1 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Account</Label>
                      <Input value={li.account || ""} onChange={(e) => updateItem(idx, { account: e.target.value })} className="mt-1 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Centre</Label>
                      <Input value={li.center || ""} onChange={(e) => updateItem(idx, { center: e.target.value })} className="mt-1 text-xs" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-sm font-medium text-foreground">
            New Total: {invoice?.currency || "RM"} {total.toFixed(2)}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Reason for Amendment</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Briefly explain why this invoice needs amending..."
              rows={2}
              className="mt-1 text-xs"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={submitting || !contactName.trim() || lineItems.length === 0} className="flex-1">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit Amendment for Approval
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AmendInvoiceDialog;
