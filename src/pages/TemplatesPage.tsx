import React, { useState, useEffect } from "react";
import { nowGMT8 } from "@/lib/utils";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, Eye, ArrowLeft, GripVertical, FileText, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { neonQuery, neonInsert, neonUpdate, neonDelete } from "@/lib/neon-client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activity-logger";

interface TemplateField {
  id: string;
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "programmatic";
  required: boolean;
  placeholder: string;
  options: string[];
  /** Formula for programmatic fields, e.g. "{{qty}} * {{price}} + 5". */
  formula?: string;
  /** Decimal places for formatted output (programmatic only). */
  decimals?: number;
  /** Optional currency-style prefix prepended to the formatted value. */
  prefix?: string;
}

interface Template {
  id: string;
  name: string;
  fields: TemplateField[];
  format_string: string;
  created_at: string;
}

type TemplateType = "structured";

const TEMPLATE_TYPES: { value: TemplateType; label: string; description: string }[] = [
  { value: "structured", label: "Structured Template", description: "Define custom fields and a format string to compose the final invoice description" },
];

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
];

const createField = (): TemplateField => ({
  id: crypto.randomUUID(),
  name: "",
  label: "",
  type: "text",
  required: false,
  placeholder: "",
  options: [],
});

const TemplatesPage: React.FC = () => {
  const { user, systemId } = useAuth();
  const performerName = user ? `${user.firstName} ${user.lastName}` : "";
  const performerId = systemId || "";
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "create">("list");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [templateName, setTemplateName] = useState("");
  const [fields, setFields] = useState<TemplateField[]>([createField()]);
  const [formatString, setFormatString] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [templateType, setTemplateType] = useState<TemplateType>("structured");

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await neonQuery("invoice_templates", {
      order: { column: "created_at", ascending: false },
    });

    if (error) {
      toast.error("Failed to load templates");
    } else {
      setTemplates((data as unknown as Template[]) || []);
    }
    setLoading(false);
  };

  const resetBuilder = () => {
    setTemplateName("");
    setFields([createField()]);
    setFormatString("");
    setPreviewValues({});
    setEditingId(null);
    setTemplateType("structured");
  };

  const openCreate = () => {
    resetBuilder();
    setView("create");
  };

  const openEdit = (template: Template) => {
    setTemplateName(template.name);
    setFields(template.fields.length > 0 ? template.fields : [createField()]);
    setFormatString(template.format_string);
    setPreviewValues({});
    setEditingId(template.id);
    setView("create");
  };

  const addField = () => setFields((prev) => [...prev, createField()]);

  const updateField = (id: string, updates: Partial<TemplateField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeField = (id: string) => {
    setFields((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
  };

  const insertPlaceholder = (fieldName: string) => {
    setFormatString((prev) => prev + `{{${fieldName}}}`);
  };

  const getPreviewOutput = (): string => {
    let output = formatString;
    fields.forEach((f) => {
      const val = previewValues[f.id] || f.placeholder || `[${f.label || f.name}]`;
      output = output.split(`{{${f.name}}}`).join(val);
    });
    return output;
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    const validFields = fields.filter((f) => f.name.trim() && f.label.trim());
    if (validFields.length === 0) {
      toast.error("Add at least one field with a name and label");
      return;
    }
    if (!formatString.trim()) {
      toast.error("Please define a format string");
      return;
    }

    setSaving(true);

    const payload = {
      name: templateName.trim(),
      fields: JSON.parse(JSON.stringify(validFields)),
      format_string: formatString,
    };

    let error;
    if (editingId) {
      ({ error } = await neonUpdate("invoice_templates",
        { ...payload, updated_at: nowGMT8() },
        { id: editingId }
      ));
    } else {
      ({ error } = await neonInsert("invoice_templates", payload));
    }

    if (error) {
      toast.error("Failed to save template");
    } else {
      await logActivity(editingId ? "template_updated" : "template_created", "template", performerId, performerName, { name: templateName.trim() });
      toast.success(editingId ? "Template updated" : "Template created");
      resetBuilder();
      setView("list");
      fetchTemplates();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const template = templates.find(t => t.id === id);
    const { error } = await neonDelete("invoice_templates", { id });
    if (error) {
      toast.error("Failed to delete template");
    } else {
      await logActivity("template_deleted", "template", performerId, performerName, { name: template?.name || id });
      toast.success("Template deleted");
      fetchTemplates();
    }
  };

  const handleExport = () => {
    if (templates.length === 0) {
      toast.error("No templates to export");
      return;
    }
    const exportData = templates.map(({ id, created_at, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${templates.length} template(s)`);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const items = Array.isArray(imported) ? imported : [imported];
        let count = 0;
        for (const item of items) {
          if (!item.name || !item.fields || !item.format_string) {
            toast.error(`Skipped invalid template entry`);
            continue;
          }
          const { error } = await neonInsert("invoice_templates", {
            name: item.name,
            fields: typeof item.fields === "string" ? JSON.parse(item.fields) : item.fields,
            format_string: item.format_string,
          });
          if (!error) {
            await logActivity("template_imported", "template", performerId, performerName, { name: item.name });
            count++;
          }
        }
        if (count > 0) {
          toast.success(`Imported ${count} template(s)`);
          fetchTemplates();
        } else {
          toast.error("No templates were imported");
        }
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    input.click();
  };

  if (view === "create") {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => { resetBuilder(); setView("list"); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to templates
          </button>

          <h1 className="text-2xl font-bold font-display text-foreground mb-1">
            {editingId ? "Edit Template" : "Create Template"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Define custom fields and how they appear in the final invoice description
          </p>

          <div className="space-y-6">
            <Card className="p-5">
              <Label className="text-sm font-semibold font-display text-foreground">Template Name</Label>
              <Input
                className="mt-2"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Music Lesson Package"
              />
            </Card>

            <Card className="p-5 space-y-3">
              <Label className="text-sm font-semibold font-display text-foreground">Template Type</Label>
              <div className="grid gap-2">
                {TEMPLATE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTemplateType(t.value)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      templateType === t.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{t.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold font-display text-foreground">Fields</h2>
              <p className="text-xs text-muted-foreground">
                Define the input fields users will fill in when using this template
              </p>

              <div className="space-y-3">
                {fields.map((field, idx) => (
                  <div key={field.id} className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Field {idx + 1}</span>
                      {fields.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeField(field.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Field Name (used in format)</Label>
                        <Input
                          value={field.name}
                          onChange={(e) => updateField(field.id, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                          placeholder="e.g. student_name"
                          className="font-mono text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Display Label</Label>
                        <Input
                          value={field.label}
                          onChange={(e) => updateField(field.id, { label: e.target.value })}
                          placeholder="e.g. Student Name"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Input Type</Label>
                        <Select value={field.type} onValueChange={(v) => updateField(field.id, { type: v as TemplateField["type"] })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Placeholder</Label>
                        <Input
                          value={field.placeholder}
                          onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                          placeholder="e.g. Enter name..."
                        />
                      </div>
                    </div>

                    {field.type === "select" && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Options (comma-separated)</Label>
                        <Input
                          value={field.options.join(", ")}
                          onChange={(e) => updateField(field.id, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                          placeholder="e.g. Piano, Guitar, Violin"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(checked) => updateField(field.id, { required: checked })}
                      />
                      <Label className="text-xs text-muted-foreground cursor-pointer">Required</Label>
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addField}>
                <Plus className="w-3.5 h-3.5" />
                Add Field
              </Button>
            </Card>

            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold font-display text-foreground">Output Format</h2>
              <p className="text-xs text-muted-foreground">
                Define how fields are composed into the final invoice description. Use <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{"{{field_name}}"}</code> to insert field values.
              </p>

              {fields.filter((f) => f.name.trim()).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {fields
                    .filter((f) => f.name.trim())
                    .map((f) => (
                      <Button
                        key={f.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-xs h-7 font-mono"
                        onClick={() => insertPlaceholder(f.name)}
                      >
                        {`{{${f.name}}}`}
                      </Button>
                    ))}
                </div>
              )}

              <Textarea
                value={formatString}
                onChange={(e) => setFormatString(e.target.value)}
                placeholder={`e.g. {{student_name}}\n{{age}} (2026)\n{{package}}\nFirst Lesson: {{first_lesson}}`}
                rows={5}
                className="font-mono text-sm"
              />

              {formatString.trim() && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Live Preview</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {fields
                      .filter((f) => f.name.trim())
                      .map((f) => (
                        <div key={f.id}>
                          <Label className="text-xs text-muted-foreground">{f.label || f.name}</Label>
                          <Input
                            value={previewValues[f.id] || ""}
                            onChange={(e) => setPreviewValues((prev) => ({ ...prev, [f.id]: e.target.value }))}
                            placeholder={f.placeholder || `Sample ${f.label}`}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                  </div>

                  <div className="p-3 rounded-lg bg-muted border border-border">
                    <pre className="text-sm text-foreground whitespace-pre-wrap font-body">
                      {getPreviewOutput()}
                    </pre>
                  </div>
                </div>
              )}
            </Card>

            <div className="flex justify-end gap-3 pb-8">
              <Button type="button" variant="outline" onClick={() => { resetBuilder(); setView("list"); }}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {editingId ? "Update Template" : "Save Template"}
              </Button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Invoice Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create reusable templates for invoice line items
            </p>
          </div>
          {/* Template actions: import / export / create */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleImport}
              className="gap-1.5"
              aria-label="Import templates from JSON"
            >
              <Upload className="w-4 h-4" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={templates.length === 0}
              className="gap-1.5"
              aria-label="Export templates to JSON"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" />
              New Template
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <Card className="p-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No templates yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a template to speed up invoice creation
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="w-4 h-4" />
                Create your first template
              </Button>
              <Button variant="outline" onClick={handleImport} className="gap-2">
                <Upload className="w-4 h-4" />
                Import templates
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <Card
                key={t.id}
                className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.fields.length} field{t.fields.length !== 1 ? "s" : ""} · Created{" "}
                    {new Date(t.created_at).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(t.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default TemplatesPage;
