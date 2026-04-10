import React, { useState, useCallback, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, Send, Plus, Trash2, ShieldAlert, ChevronsUpDown, Check, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/api-client";
import { getOrgId } from "@/lib/runtime-config";
import { neonQuery, neonInsert } from "@/lib/neon-client";

interface TemplateField {
  id: string;
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  required: boolean;
  placeholder: string;
  options: string[];
}

interface Template {
  id: string;
  name: string;
  fields: TemplateField[];
  format_string: string;
  requires_approval: boolean;
}

const FREETEXT_ID = "__freetext__";

interface LineItem {
  id: string;
  templateId: string;
  fieldValues: Record<string, string>;
  freeDescription: string;
  quantity: string;
  cost: string;
  account: string;
  center: string;
}

const createLineItem = (defaultTemplateId: string): LineItem => ({
  id: crypto.randomUUID(),
  templateId: defaultTemplateId,
  fieldValues: {},
  freeDescription: "",
  quantity: "",
  cost: "",
  account: "",
  center: "",
});

interface XeroContact {
  id: string;
  name: string;
}

interface XeroAccount {
  code: string;
  name: string;
  type: string;
}

interface XeroCenter {
  id: string;
  name: string;
}

function getGeneratedDescription(item: LineItem, templates: Template[]): string {
  if (item.templateId === FREETEXT_ID) {
    return item.freeDescription;
  }
  const template = templates.find((t) => t.id === item.templateId);
  if (!template) return item.freeDescription;

  let output = template.format_string;
  template.fields.forEach((f) => {
    const val = item.fieldValues[f.name] || "";
    output = output.split(`{{${f.name}}}`).join(val);
  });
  return output;
}

function isLineItemValid(item: LineItem, templates: Template[]): boolean {
  const desc = getGeneratedDescription(item, templates).trim();
  return !!desc && !!item.quantity && !!item.cost && !!item.account && !!item.center;
}

const CreateInvoicePage: React.FC = () => {
  const { user, systemId } = useAuth();
  const [userFlagged, setUserFlagged] = useState(false);
  const [freeTextFlagged, setFreeTextFlagged] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<XeroContact[]>([]);
  const [xeroAccounts, setXeroAccounts] = useState<XeroAccount[]>([]);
  const [xeroCenters, setXeroCenters] = useState<XeroCenter[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [reference, setReference] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactMode, setContactMode] = useState<"select" | "new">("select");
  const [contactId, setContactId] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [invoiceDate] = useState(() => {
    const now = new Date();
    const gmt8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const d = gmt8.getUTCDate().toString().padStart(2, "0");
    const m = (gmt8.getUTCMonth() + 1).toString().padStart(2, "0");
    const y = gmt8.getUTCFullYear();
    return `${d}/${m}/${y}`;
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoadingTemplates(true);
      const { data, error } = await neonQuery("invoice_templates", {
        order: { column: "created_at", ascending: true },
      });

      if (error) {
        toast.error("Failed to load templates");
        setTemplates([]);
      } else {
        const parsed = ((data as any[]) || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          fields: (typeof t.fields === "string" ? JSON.parse(t.fields) : t.fields) as TemplateField[],
          format_string: t.format_string,
          requires_approval: t.requires_approval,
        }));
        setTemplates(parsed);
      }
      setLoadingTemplates(false);
    };
    fetchTemplates();
  }, []);

  // Fetch Xero contacts and accounts, and centers from collections
  useEffect(() => {
    const xeroHeaders = {
      "x-org-id": getOrgId(),
      "x-environment": localStorage.getItem("auth_environment") || "production",
    };

    const fetchContacts = async () => {
      setLoadingContacts(true);
      try {
        const { data } = await supabase.functions.invoke("xero", {
          body: { action: "contacts" },
          headers: xeroHeaders,
        });
        if (data?.contacts) setContacts(data.contacts);
      } catch (err) {
        console.warn("Failed to fetch Xero contacts:", err);
      }
      setLoadingContacts(false);
    };

    const fetchCenters = async () => {
      try {
        const env = localStorage.getItem("auth_environment") || "production";
        const orgId = getOrgId();
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/get-collections-proxy?action=get&name=centre&environment=${env}&org_id=${encodeURIComponent(orgId)}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
        );
        const data = await res.json();
        if (data?.data && Array.isArray(data.data)) {
          setXeroCenters(data.data.map((item: any) => ({
            id: item.name || item.id || item,
            name: item.name || item.label || item,
          })));
        }
      } catch (err) {
        console.warn("Failed to fetch centers from collections:", err);
      }
    };

    const fetchAccounts = async () => {
      try {
        const { data } = await supabase.functions.invoke("xero", {
          body: { action: "accounts" },
          headers: xeroHeaders,
        });
        if (data?.accounts) setXeroAccounts(data.accounts);
      } catch (err) {
        console.warn("Failed to fetch Xero accounts:", err);
      }
    };

    fetchContacts();
    fetchCenters();
    fetchAccounts();
  }, []);

  // Check if the current user is flagged and if free text is flagged
  useEffect(() => {
    const checkFlags = async () => {
      const [userRes, freeTextRes] = await Promise.all([
        systemId
          ? neonQuery("user_approval_flags", { select: "requires_approval", filters: { system_id: systemId }, maybeSingle: true })
          : Promise.resolve({ data: null, error: null }),
        neonQuery("global_config", { select: "value", filters: { key: "freetext_requires_approval" }, maybeSingle: true }),
      ]);
      setUserFlagged((userRes.data as any)?.requires_approval === true);
      setFreeTextFlagged((freeTextRes.data as any)?.value === "true");
    };
    checkFlags();
  }, [systemId]);

  // Initialize line items once templates load
  useEffect(() => {
    if (!loadingTemplates && lineItems.length === 0) {
      const defaultId = templates.length > 0 ? templates[0].id : FREETEXT_ID;
      setLineItems([createLineItem(defaultId)]);
    }
  }, [loadingTemplates]);

  const updateLineItem = useCallback((id: string, updates: Partial<LineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const removeLineItem = useCallback((id: string) => {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  }, []);

  const addLineItem = useCallback(() => {
    const defaultId = templates.length > 0 ? templates[0].id : FREETEXT_ID;
    setLineItems((prev) => [...prev, createLineItem(defaultId)]);
  }, [templates]);

  const contactName = contactMode === "select"
    ? contacts.find((c) => c.id === contactId)?.name || ""
    : newContactName.trim();

  const contactValid = contactMode === "select" ? !!contactId : !!newContactName.trim();
  const allValid = contactValid && lineItems.every((item) => isLineItemValid(item, templates));

  const total = lineItems.reduce((sum, item) => {
    const q = Number(item.quantity) || 0;
    const c = Number(item.cost) || 0;
    return sum + q * c;
  }, 0);

  const hasFreeText = lineItems.some((i) => i.templateId === FREETEXT_ID);
  const selectedTemplateIds = [...new Set(lineItems.map((i) => i.templateId).filter((id) => id !== FREETEXT_ID))];
  const templateFlagged = templates.some((t) => selectedTemplateIds.includes(t.id) && t.requires_approval);
  const freeTextTriggered = hasFreeText && freeTextFlagged;
  const willNeedApproval = userFlagged || templateFlagged || freeTextTriggered;

  const approvalReasons: string[] = [];
  if (userFlagged) approvalReasons.push("Your account is flagged for approval");
  if (templateFlagged) approvalReasons.push("A selected template requires approval");
  if (freeTextTriggered) approvalReasons.push("Free text is flagged for approval");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid) return;
    setSubmitting(true);

    try {
      const lineItemsPayload = lineItems.map((item) => ({
        description: getGeneratedDescription(item, templates),
        quantity: Number(item.quantity),
        cost: Number(item.cost),
        account: item.account,
        center: item.center,
      }));

      const finalContactId = contactMode === "select" && contactId ? contactId : "__new__";

      const invoicePayload = {
        contact_id: finalContactId,
        contact_name: contactName,
        invoice_date: invoiceDate,
        reference: reference.trim(),
        line_items: JSON.parse(JSON.stringify(lineItemsPayload)),
        total,
        submitted_by_system_id: systemId || "",
        submitted_by_name: user ? `${user.firstName} ${user.lastName}` : "",
        requires_approval: willNeedApproval,
        status: willNeedApproval ? "pending_approval" : "submitted",
        template_id: selectedTemplateIds.length === 1 ? selectedTemplateIds[0] : null,
      };

      const { data: inserted, error } = await neonInsert("invoices", invoicePayload);

      if (error) {
        toast.error("Failed to submit invoice");
      } else {
        // Log the creation
        try {
          await neonInsert("invoice_logs", {
            invoice_id: (inserted as any).id,
            action_type: "request",
            source: "ui",
            performed_by: systemId || "",
            performed_by_name: user ? `${user.firstName} ${user.lastName}` : "",
            details: JSON.parse(JSON.stringify(inserted)),
          });
        } catch (logErr) {
          console.warn("Failed to write log:", logErr);
        }

        // Send approval notification email if needed
        if (willNeedApproval) {
          try {
            await apiClient.invoices("send-approval-email", { invoiceId: (inserted as any).id });
          } catch (emailErr) {
            console.warn("Failed to send approval email:", emailErr);
          }
          toast.info("Invoice submitted for approval", {
            description: "Your invoice requires approval before being pushed to Xero.",
            icon: <ShieldAlert className="w-4 h-4" />,
          });
        } else {
          toast.success("Invoice auto-submitted to Xero", {
            description: "Your invoice has been automatically validated and pushed.",
            icon: <Zap className="w-4 h-4" />,
          });
        }
      }

      const defaultId = templates.length > 0 ? templates[0].id : FREETEXT_ID;
      setContactId("");
      setNewContactName("");
      setReference("");
      setLineItems([createLineItem(defaultId)]);
    } catch (err) {
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingTemplates) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-display text-foreground">Create Invoice</h1>
          <p className="text-sm text-muted-foreground mt-1">Fill in the details below to create a new invoice</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Bill To */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display text-foreground">Bill To</h2>
            <Popover open={contactOpen} onOpenChange={setContactOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={contactOpen}
                  className="w-full justify-between font-normal"
                >
                  {contactId
                    ? contacts.find((c) => c.id === contactId)?.name
                    : loadingContacts ? "Loading contacts..." : "Search contacts..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search contacts..." value={contactSearch} onValueChange={setContactSearch} />
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
                          <Check className={cn("mr-2 h-4 w-4", contactId === c.id ? "opacity-100" : "opacity-0")} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {contactMode === "new" && (
              <div className="flex items-center gap-2 animate-fade-in">
                <Input
                  placeholder="New contact name"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
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

          {/* Date & Reference */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-semibold font-display text-foreground">Date of Invoice</Label>
                <Input value={invoiceDate} disabled className="mt-2 bg-muted cursor-not-allowed" />
              </div>
              <div>
                <Label className="text-sm font-semibold font-display text-foreground">Reference</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. PO-12345"
                  className="mt-2"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          {lineItems.map((item, index) => (
            <LineItemCard
              key={item.id}
              item={item}
              index={index}
              canRemove={lineItems.length > 1}
              templates={templates}
              accounts={xeroAccounts}
              centers={xeroCenters}
              onUpdate={updateLineItem}
              onRemove={removeLineItem}
            />
          ))}

          <Button type="button" variant="outline" className="w-full gap-2 border-dashed" onClick={addLineItem}>
            <Plus className="w-4 h-4" />
            Add Line Item
          </Button>

          {willNeedApproval ? (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-destructive" />
                <span className="text-sm font-semibold text-destructive">Requires Approval</span>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                {approvalReasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">This invoice will be sent to the approvals queue instead of being pushed directly to Xero.</p>
            </div>
          ) : (
            <div className="bg-success/10 border border-success/20 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-success" />
                <span className="text-sm font-semibold text-success">Automated</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">This invoice will be automatically validated and pushed to Xero upon submission.</p>
            </div>
          )}

          <div className="sticky bottom-0 bg-background border-t border-border -mx-8 px-8 py-4 flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {total > 0 ? (
                <span>
                  Total: <strong className="text-foreground">RM {total.toFixed(2)}</strong>
                  {lineItems.length > 1 && <span className="ml-2">({lineItems.length} items)</span>}
                </span>
              ) : (
                "Fill in quantity and cost to see total"
              )}
            </div>
            <Button type="submit" disabled={!allValid || submitting} className="gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : willNeedApproval ? <ShieldAlert className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
              {willNeedApproval ? "Submit for Approval" : "Submit to Xero"}
            </Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
};

interface LineItemCardProps {
  item: LineItem;
  index: number;
  canRemove: boolean;
  templates: Template[];
  accounts: XeroAccount[];
  centers: XeroCenter[];
  onUpdate: (id: string, updates: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}

const LineItemCard: React.FC<LineItemCardProps> = ({ item, index, canRemove, templates, accounts, centers, onUpdate, onRemove }) => {
  const update = (updates: Partial<LineItem>) => onUpdate(item.id, updates);
  const selectedTemplate = templates.find((t) => t.id === item.templateId);
  const desc = getGeneratedDescription(item, templates);

  const handleTemplateChange = (templateId: string) => {
    update({ templateId, fieldValues: {}, freeDescription: "" });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold font-display text-foreground">
          Line Item {index + 1}
        </h2>
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => onRemove(item.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Template</Label>
        <Select value={item.templateId} onValueChange={handleTemplateChange}>
          <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
            <SelectItem value={FREETEXT_ID}>Free Text</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {item.templateId === FREETEXT_ID ? (
        <div className="animate-fade-in">
          <Textarea
            value={item.freeDescription}
            onChange={(e) => update({ freeDescription: e.target.value })}
            placeholder="Enter invoice description..."
            rows={5}
          />
        </div>
      ) : selectedTemplate ? (
        <div className="space-y-3 animate-fade-in">
          {selectedTemplate.fields.map((field) => (
            <div key={field.id}>
              <Label className="text-xs text-muted-foreground">
                {field.label}
                {field.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              {field.type === "select" ? (
                <Select
                  value={item.fieldValues[field.name] || ""}
                  onValueChange={(v) => update({ fieldValues: { ...item.fieldValues, [field.name]: v } })}
                >
                  <SelectTrigger><SelectValue placeholder={field.placeholder || `Select ${field.label}`} /></SelectTrigger>
                  <SelectContent>
                    {field.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                  value={item.fieldValues[field.name] || ""}
                  onChange={(e) => update({ fieldValues: { ...item.fieldValues, [field.name]: e.target.value } })}
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}

          {desc.trim() && (
            <div className="mt-3 p-3 rounded-lg bg-muted border border-border">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Preview:</p>
              <pre className="text-sm text-foreground whitespace-pre-wrap font-body">{desc}</pre>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Quantity</Label>
          <Select value={item.quantity} onValueChange={(v) => update({ quantity: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Cost</Label>
          <Input type="number" step="0.01" min="0" value={item.cost} onChange={(e) => update({ cost: e.target.value })} placeholder="0.00" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Account</Label>
          <Select value={item.account} onValueChange={(v) => update({ account: v })}>
            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.code} value={a.code}>{a.code} - {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Center</Label>
          <Select value={item.center} onValueChange={(v) => update({ center: v })}>
            <SelectTrigger><SelectValue placeholder="Select center" /></SelectTrigger>
            <SelectContent>
              {centers.map((c) => (
                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default CreateInvoicePage;
