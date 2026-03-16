import React, { useState, useCallback, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Plus, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  templateId: string; // template id or FREETEXT_ID
  fieldValues: Record<string, string>; // keyed by field name
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

const demoContacts = [
  { id: "1", name: "Lee Music Academy" },
  { id: "2", name: "Tan Piano Studio" },
  { id: "3", name: "Wong Violin Lessons" },
];

const demoAccounts = [
  { code: "200", name: "Sales" },
  { code: "400", name: "Tuition Revenue" },
  { code: "260", name: "Other Revenue" },
];

const demoCenters = [
  { id: "c1", name: "KL Center" },
  { id: "c2", name: "PJ Center" },
  { id: "c3", name: "JB Center" },
];

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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
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
      const { data, error } = await supabase
        .from("invoice_templates")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        toast.error("Failed to load templates");
        setTemplates([]);
      } else {
        const parsed = (data || []).map((t: any) => ({
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
    ? demoContacts.find((c) => c.id === contactId)?.name || ""
    : newContactName.trim();

  const contactValid = contactMode === "select" ? !!contactId : !!newContactName.trim();
  const allValid = contactValid && lineItems.every((item) => isLineItemValid(item, templates));

  const total = lineItems.reduce((sum, item) => {
    const q = Number(item.quantity) || 0;
    const c = Number(item.cost) || 0;
    return sum + q * c;
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid) return;
    setSubmitting(true);

    try {
      // Check if user is flagged for approval
      const { data: userFlag } = await supabase
        .from("user_approval_flags")
        .select("requires_approval")
        .eq("system_id", systemId || "")
        .maybeSingle();

      const userFlagged = userFlag?.requires_approval === true;

      // Check if any selected template is flagged
      const selectedTemplateIds = [...new Set(lineItems.map((i) => i.templateId).filter((id) => id !== FREETEXT_ID))];
      const templateFlagged = templates.some(
        (t) => selectedTemplateIds.includes(t.id) && t.requires_approval
      );

      const needsApproval = userFlagged || templateFlagged;

      const lineItemsPayload = lineItems.map((item) => ({
        description: getGeneratedDescription(item, templates),
        quantity: Number(item.quantity),
        cost: Number(item.cost),
        account: item.account,
        center: item.center,
      }));

      const invoicePayload = {
        contact_name: contactName,
        invoice_date: invoiceDate,
        line_items: JSON.parse(JSON.stringify(lineItemsPayload)),
        total,
        submitted_by_system_id: systemId || "",
        submitted_by_name: user ? `${user.firstName} ${user.lastName}` : "",
        requires_approval: needsApproval,
        status: needsApproval ? "pending_approval" : "submitted",
        template_id: selectedTemplateIds.length === 1 ? selectedTemplateIds[0] : null,
      };

      const { error } = await supabase.from("invoices").insert(invoicePayload as any);

      if (error) {
        toast.error("Failed to submit invoice");
      } else if (needsApproval) {
        toast.info("Invoice submitted for admin approval", {
          description: "Your invoice has been flagged and requires approval before being processed.",
          icon: <ShieldAlert className="w-4 h-4" />,
        });
      } else {
        toast.success("Invoice submitted successfully");
      }

      const defaultId = templates.length > 0 ? templates[0].id : FREETEXT_ID;
      setContactId("");
      setNewContactName("");
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
            <div className="flex gap-2 mb-3">
              <Button type="button" variant={contactMode === "select" ? "default" : "outline"} size="sm" onClick={() => setContactMode("select")}>
                Select Contact
              </Button>
              <Button type="button" variant={contactMode === "new" ? "default" : "outline"} size="sm" onClick={() => setContactMode("new")}>
                Create New
              </Button>
            </div>
            {contactMode === "select" ? (
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger><SelectValue placeholder="Select a contact" /></SelectTrigger>
                <SelectContent>
                  {demoContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input placeholder="Contact name" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} />
            )}
          </div>

          {/* Invoice Date */}
          <div className="bg-card border border-border rounded-xl p-5">
            <Label className="text-sm font-semibold font-display text-foreground">Date of Invoice</Label>
            <Input value={invoiceDate} disabled className="mt-2 bg-muted cursor-not-allowed" />
          </div>

          {/* Line Items */}
          {lineItems.map((item, index) => (
            <LineItemCard
              key={item.id}
              item={item}
              index={index}
              canRemove={lineItems.length > 1}
              templates={templates}
              onUpdate={updateLineItem}
              onRemove={removeLineItem}
            />
          ))}

          {/* Add Line Item Button */}
          <Button type="button" variant="outline" className="w-full gap-2 border-dashed" onClick={addLineItem}>
            <Plus className="w-4 h-4" />
            Add Line Item
          </Button>

          {/* Sticky Submit */}
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
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit Invoice
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
  onUpdate: (id: string, updates: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}

const LineItemCard: React.FC<LineItemCardProps> = ({ item, index, canRemove, templates, onUpdate, onRemove }) => {
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

      {/* Template selector */}
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

      {/* Template fields or free text */}
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

          {/* Preview */}
          {desc.trim() && (
            <div className="mt-3 p-3 rounded-lg bg-muted border border-border">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Preview:</p>
              <pre className="text-sm text-foreground whitespace-pre-wrap font-body">{desc}</pre>
            </div>
          )}
        </div>
      ) : null}

      {/* Quantity, Cost, Account, Center */}
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
              {demoAccounts.map((a) => (
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
              {demoCenters.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default CreateInvoicePage;
