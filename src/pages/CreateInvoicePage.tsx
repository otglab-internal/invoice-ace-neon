import React, { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

type DescriptionMode = "structured" | "freetext";

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

const CreateInvoicePage: React.FC = () => {
  const [contactMode, setContactMode] = useState<"select" | "new">("select");
  const [contactId, setContactId] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [invoiceDate] = useState(() => {
    const now = new Date();
    // Convert to GMT+8
    const gmt8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const d = gmt8.getUTCDate().toString().padStart(2, "0");
    const m = (gmt8.getUTCMonth() + 1).toString().padStart(2, "0");
    const y = gmt8.getUTCFullYear();
    return `${d}/${m}/${y}`;
  });
  const [descMode, setDescMode] = useState<DescriptionMode>("structured");

  // Option A fields
  const [studentName, setStudentName] = useState("");
  const [age, setAge] = useState("");
  const [packageName, setPackageName] = useState("");
  const [firstLesson, setFirstLesson] = useState("");

  // Option B field
  const [freeDescription, setFreeDescription] = useState("");

  // Common fields
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [account, setAccount] = useState("");
  const [center, setCenter] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // When switching to structured, clear free text and vice versa
  useEffect(() => {
    if (descMode === "structured") {
      setFreeDescription("");
    } else {
      setStudentName("");
      setAge("");
      setPackageName("");
      setFirstLesson("");
    }
  }, [descMode]);

  // Auto-null Option B when Option A fields are filled
  useEffect(() => {
    if (studentName || age || packageName || firstLesson) {
      setDescMode("structured");
      setFreeDescription("");
    }
  }, [studentName, age, packageName, firstLesson]);

  const generatedDescription =
    descMode === "structured"
      ? [
          studentName,
          age ? `${age} (${new Date().getFullYear()})` : "",
          packageName,
          firstLesson ? `First Lesson: ${firstLesson}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : freeDescription;

  const isValid =
    (contactMode === "select" ? !!contactId : !!newContactName.trim()) &&
    !!generatedDescription.trim() &&
    !!quantity &&
    !!cost &&
    !!account &&
    !!center;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1200));
    toast.success("Invoice submitted successfully");
    setSubmitting(false);
    // Reset form
    setContactId("");
    setNewContactName("");
    setStudentName("");
    setAge("");
    setPackageName("");
    setFirstLesson("");
    setFreeDescription("");
    setQuantity("");
    setCost("");
    setAccount("");
    setCenter("");
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
              <Button
                type="button"
                variant={contactMode === "select" ? "default" : "outline"}
                size="sm"
                onClick={() => setContactMode("select")}
              >
                Select Contact
              </Button>
              <Button
                type="button"
                variant={contactMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setContactMode("new")}
              >
                Create New
              </Button>
            </div>
            {contactMode === "select" ? (
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a contact" />
                </SelectTrigger>
                <SelectContent>
                  {demoContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Contact name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
              />
            )}
          </div>

          {/* Invoice Date */}
          <div className="bg-card border border-border rounded-xl p-5">
            <Label className="text-sm font-semibold font-display text-foreground">Date of Invoice</Label>
            <Input value={invoiceDate} disabled className="mt-2 bg-muted cursor-not-allowed" />
          </div>

          {/* Description */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display text-foreground">Description</h2>

            {/* Segmented control */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setDescMode("structured")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  descMode === "structured"
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
                  descMode === "freetext"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                Free Text (Option B)
              </button>
            </div>

            {descMode === "structured" ? (
              <div className="space-y-3 animate-fade-in">
                <div>
                  <Label className="text-xs text-muted-foreground">Student Name</Label>
                  <Input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="e.g. Lee Rou Xuan" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Age (Year)</Label>
                  <Input value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 15" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Package Name</Label>
                  <Input value={packageName} onChange={(e) => setPackageName(e.target.value)} placeholder="e.g. Grand Opening Term Package (RM 2,000)" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">First Lesson</Label>
                  <Input value={firstLesson} onChange={(e) => setFirstLesson(e.target.value)} placeholder="e.g. Last week of March" />
                </div>

                {/* Preview */}
                {generatedDescription.trim() && (
                  <div className="mt-3 p-3 rounded-lg bg-muted border border-border">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Preview:</p>
                    <pre className="text-sm text-foreground whitespace-pre-wrap font-body">{generatedDescription}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="animate-fade-in">
                <Textarea
                  value={freeDescription}
                  onChange={(e) => setFreeDescription(e.target.value)}
                  placeholder="Enter invoice description..."
                  rows={5}
                />
              </div>
            )}
          </div>

          {/* Common Fields */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display text-foreground">Line Item Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Quantity</Label>
                <Select value={quantity} onValueChange={setQuantity}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Account</Label>
                <Select value={account} onValueChange={setAccount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {demoAccounts.map((a) => (
                      <SelectItem key={a.code} value={a.code}>{a.code} - {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Center</Label>
                <Select value={center} onValueChange={setCenter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select center" />
                  </SelectTrigger>
                  <SelectContent>
                    {demoCenters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Sticky Submit */}
          <div className="sticky bottom-0 bg-background border-t border-border -mx-8 px-8 py-4 flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {quantity && cost ? (
                <span>
                  Total: <strong className="text-foreground">RM {(Number(quantity) * Number(cost)).toFixed(2)}</strong>
                </span>
              ) : (
                "Fill in quantity and cost to see total"
              )}
            </div>
            <Button type="submit" disabled={!isValid || submitting} className="gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit Invoice
            </Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
};

export default CreateInvoicePage;
