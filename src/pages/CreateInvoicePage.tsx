import React, { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type DescriptionMode = "structured" | "freetext";

interface LineItem {
  id: string;
  descMode: DescriptionMode;
  studentName: string;
  age: string;
  packageName: string;
  firstLesson: string;
  freeDescription: string;
  quantity: string;
  cost: string;
  account: string;
  center: string;
}

const createLineItem = (): LineItem => ({
  id: crypto.randomUUID(),
  descMode: "structured",
  studentName: "",
  age: "",
  packageName: "",
  firstLesson: "",
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

function getGeneratedDescription(item: LineItem): string {
  if (item.descMode === "structured") {
    return [
      item.studentName,
      item.age ? `${item.age} (${new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCFullYear()})` : "",
      item.packageName,
      item.firstLesson ? `First Lesson: ${item.firstLesson}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return item.freeDescription;
}

function isLineItemValid(item: LineItem): boolean {
  const desc = getGeneratedDescription(item).trim();
  return !!desc && !!item.quantity && !!item.cost && !!item.account && !!item.center;
}

const CreateInvoicePage: React.FC = () => {
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

  const [lineItems, setLineItems] = useState<LineItem[]>([createLineItem()]);
  const [submitting, setSubmitting] = useState(false);

  const updateLineItem = useCallback((id: string, updates: Partial<LineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const removeLineItem = useCallback((id: string) => {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  }, []);

  const addLineItem = useCallback(() => {
    setLineItems((prev) => [...prev, createLineItem()]);
  }, []);

  const contactValid = contactMode === "select" ? !!contactId : !!newContactName.trim();
  const allValid = contactValid && lineItems.every(isLineItemValid);

  const total = lineItems.reduce((sum, item) => {
    const q = Number(item.quantity) || 0;
    const c = Number(item.cost) || 0;
    return sum + q * c;
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid) return;
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1200));
    toast.success("Invoice submitted successfully");
    setSubmitting(false);
    setContactId("");
    setNewContactName("");
    setLineItems([createLineItem()]);
  };

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
  onUpdate: (id: string, updates: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}

const LineItemCard: React.FC<LineItemCardProps> = ({ item, index, canRemove, onUpdate, onRemove }) => {
  const update = (updates: Partial<LineItem>) => onUpdate(item.id, updates);
  const desc = getGeneratedDescription(item);

  const setDescMode = (mode: DescriptionMode) => {
    if (mode === "structured") {
      update({ descMode: mode, freeDescription: "" });
    } else {
      update({ descMode: mode, studentName: "", age: "", packageName: "", firstLesson: "" });
    }
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

      {/* Description mode toggle */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Description</Label>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setDescMode("structured")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              item.descMode === "structured"
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            Structured (Option A)
          </button>
          <button
            type="button"
            onClick={() => setDescMode("freetext")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              item.descMode === "freetext"
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            Free Text (Option B)
          </button>
        </div>
      </div>

      {item.descMode === "structured" ? (
        <div className="space-y-3 animate-fade-in">
          <div>
            <Label className="text-xs text-muted-foreground">Student Name</Label>
            <Input value={item.studentName} onChange={(e) => update({ studentName: e.target.value })} placeholder="e.g. Lee Rou Xuan" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Age</Label>
            <Input type="number" min="0" value={item.age} onChange={(e) => update({ age: e.target.value })} placeholder="e.g. 15" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Package Name</Label>
            <Input value={item.packageName} onChange={(e) => update({ packageName: e.target.value })} placeholder="e.g. Grand Opening Term Package (RM 2,000)" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">First Lesson</Label>
            <Input value={item.firstLesson} onChange={(e) => update({ firstLesson: e.target.value })} placeholder="e.g. Last week of March" />
          </div>
          {desc.trim() && (
            <div className="mt-3 p-3 rounded-lg bg-muted border border-border">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Preview:</p>
              <pre className="text-sm text-foreground whitespace-pre-wrap font-body">{desc}</pre>
            </div>
          )}
        </div>
      ) : (
        <div className="animate-fade-in">
          <Textarea
            value={item.freeDescription}
            onChange={(e) => update({ freeDescription: e.target.value })}
            placeholder="Enter invoice description..."
            rows={5}
          />
        </div>
      )}

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
