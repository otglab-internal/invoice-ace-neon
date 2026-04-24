import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Trash2, Loader2, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { neonUpdate, neonInsert } from "@/lib/neon-client";
import { useAuth } from "@/contexts/AuthContext";
import { sanitizeString } from "@/lib/sanitize";
import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";

interface LineItem {
  description: string;
  quantity: number;
  cost: number;
  account?: string;
  center?: string;
}

interface XeroContact {
  id: string;
  name: string;
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
  const [reference, setReference] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Contact picker state (mirrors CreateInvoicePage)
  const [contacts, setContacts] = useState<XeroContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactMode, setContactMode] = useState<"select" | "new">("select");
  const [contactId, setContactId] = useState("");
  const [newContactName, setNewContactName] = useState("");

  useEffect(() => {
    if (invoice && open) {
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
      // Seed contact selection from existing invoice
      if (invoice.contact_id && invoice.contact_id !== "__new__") {
        setContactMode("select");
        setContactId(invoice.contact_id);
        setNewContactName("");
      } else {
        setContactMode("new");
        setContactId("");
        setNewContactName(invoice.contact_name || "");
      }
    }
  }, [invoice, open]);

  // Fetch Xero contacts when dialog opens
  useEffect(() => {
    if (!open) return;
    const xeroHeaders = {
      "x-org-id": getOrgId(),
      "x-environment": localStorage.getItem("auth_environment") || "production",
    };
    setLoadingContacts(true);
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("xero", {
          body: { action: "contacts" },
          headers: xeroHeaders,
        });
        if (data?.contacts) setContacts(data.contacts);
      } catch (err) {
        console.warn("Failed to fetch Xero contacts:", err);
      } finally {
        setLoadingContacts(false);
      }
    })();
  }, [open]);

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

  const resolvedContactName =
    contactMode === "select"
      ? contacts.find((c) => c.id === contactId)?.name || invoice?.contact_name || ""
      : newContactName.trim();

  const contactValid = contactMode === "select" ? !!contactId : !!newContactName.trim();

  const handleSubmit = async () => {
    if (!invoice) return;
    setSubmitting(true);

    try {
      const finalContactId = contactMode === "select" && contactId ? contactId : "__new__";

      // Sanitize everything EXCEPT line item descriptions — those must keep
      // real newlines for UI rendering. The \n→literal conversion is only
      // applied at the n8n webhook boundary, not at storage time.
      const amendmentData = {
        contact_name: sanitizeString(resolvedContactName),
        contact_id: finalContactId,
        reference: sanitizeString(reference),
        line_items: lineItems.map((li) => ({
          ...li,
          description: (li.description || "")
            .replace(/<[^>]*>/g, "")
            .replace(/javascript:/gi, "")
            .replace(/on\w+\s*=/gi, "")
            .trim(),
          account: li.account ? sanitizeString(li.account) : li.account,
          center: li.center ? sanitizeString(li.center) : li.center,
        })),
        total,
      };

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
              <Label className="text-xs text-muted-foreground">Contact</Label>
              <Popover open={contactOpen} onOpenChange={setContactOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={contactOpen}
                    className="mt-1 w-full justify-between font-normal text-sm h-9"
                  >
                    <span className="truncate">
                      {contactMode === "new"
                        ? newContactName || "New contact..."
                        : contactId
                        ? contacts.find((c) => c.id === contactId)?.name || invoice.contact_name
                        : loadingContacts
                        ? "Loading contacts..."
                        : "Search contacts..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search contacts..."
                      value={contactSearch}
                      onValueChange={setContactSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No contacts found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__create_new__"
                          onSelect={() => {
                            setContactMode("new");
                            setNewContactName(contactSearch);
                            setContactId("");
                            setContactOpen(false);
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4 text-primary" />
                          <span className="text-primary font-medium">Create New Contact</span>
                        </CommandItem>
                        {contacts.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => {
                              setContactId(c.id);
                              setContactMode("select");
                              setNewContactName("");
                              setContactOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                contactId === c.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {c.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {contactMode === "new" && (
                <div className="flex items-center gap-2 mt-2 animate-fade-in">
                  <Input
                    placeholder="New contact name"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    className="text-sm h-8"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setContactMode("select");
                      setNewContactName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
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
            <Button onClick={handleSubmit} disabled={submitting || !contactValid || lineItems.length === 0} className="flex-1">
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
