import React, { useState, useCallback, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { resolveUserEmail } from "@/lib/resolve-user-email";
import { sanitizeString, sanitizeObject } from "@/lib/sanitize";
import { evaluateFormula, formatNumber } from "@/lib/formula";

interface TemplateField {
  id: string;
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "programmatic";
  required: boolean;
  placeholder: string;
  options: string[];
  formula?: string;
  decimals?: number;
  prefix?: string;
}

interface Template {
  id: string;
  name: string;
  fields: TemplateField[];
  format_string: string;
  requires_approval: boolean;
}

const FREETEXT_ID = "__freetext__";

interface TrackingCategory {
  id: string;
  name: string;
  options: { id: string; name: string; status: string }[];
}

interface LineItem {
  id: string;
  templateId: string;
  fieldValues: Record<string, string>;
  freeDescription: string;
  quantity: string;
  cost: string;
  account: string;
  center: string;
  trackingValues: Record<string, string>; // categoryId -> optionName
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
  trackingValues: {},
});

interface XeroContact {
  id: string;
  name: string;
  emails?: string[];
}

interface XeroAccount {
  code: string;
  name: string;
  type: string;
}



function computeProgrammaticValue(field: TemplateField, fieldValues: Record<string, string>): string {
  if (!field.formula?.trim()) return "";
  const result = evaluateFormula(field.formula, { values: fieldValues });
  if (!result.ok || result.value === null) return "";
  return formatNumber(result.value, field.decimals ?? 2, field.prefix);
}

function getResolvedFieldValues(
  template: { fields: TemplateField[] },
  fieldValues: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = { ...fieldValues };
  // Compute programmatic fields using non-programmatic siblings.
  template.fields.forEach((f) => {
    if (f.type === "programmatic") {
      const override = fieldValues[f.name];
      if (override !== undefined && override !== "") {
        resolved[f.name] = override;
      } else {
        resolved[f.name] = computeProgrammaticValue(f, fieldValues);
      }
    }
  });
  return resolved;
}

function getGeneratedDescription(item: LineItem, templates: Template[]): string {
  if (item.templateId === FREETEXT_ID) {
    return item.freeDescription;
  }
  const template = templates.find((t) => t.id === item.templateId);
  if (!template) return item.freeDescription;

  const resolved = getResolvedFieldValues(template, item.fieldValues);
  let output = template.format_string;
  template.fields.forEach((f) => {
    const val = resolved[f.name] || "";
    output = output.split(`{{${f.name}}}`).join(val);
  });
  return output;
}

function normalizeSubmittedEmail(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.trim();
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  return lower === "undefined" || lower === "null" ? "" : normalized;
}

function isLineItemValid(item: LineItem, templates: Template[], trackingCategories: TrackingCategory[]): boolean {
  const desc = getGeneratedDescription(item, templates).trim();
  if (!desc || !item.quantity || !item.cost || !item.account) return false;
  if (trackingCategories.length > 0) {
    return trackingCategories.every((tc) => !!item.trackingValues[tc.id]);
  }
  return true;
}

const CreateInvoicePage: React.FC = () => {
  const { user, systemId, userEmail } = useAuth();
  const requesterName = user ? `${user.firstName} ${user.lastName}`.trim() : "";
  const [resolvedSystemId, setResolvedSystemId] = useState("");
  const [checkingApprovalState, setCheckingApprovalState] = useState(true);
  const [userFlagged, setUserFlagged] = useState(false);
  const [freeTextFlagged, setFreeTextFlagged] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [contacts, setContacts] = useState<XeroContact[]>([]);
  const [xeroAccounts, setXeroAccounts] = useState<XeroAccount[]>([]);
  const [visibleAccountCodes, setVisibleAccountCodes] = useState<string[] | null>(null);
  const [trackingCategories, setTrackingCategories] = useState<TrackingCategory[]>([]);
  const [currency, setCurrency] = useState("RM");
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [reference, setReference] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactMode, setContactMode] = useState<"select" | "new">("select");
  const [contactId, setContactId] = useState("");
  const [existingContactNewEmail, setExistingContactNewEmail] = useState("");
  // Schema-driven new client / new contact forms
  type SchemaField = { name: string; required: boolean; type: string };
  type EntitySchema = { display_field: string; fields: SchemaField[] } | null;
  const [clientSchema, setClientSchema] = useState<EntitySchema>(null);
  const [contactSchema, setContactSchema] = useState<EntitySchema>(null);
  const [newClientFields, setNewClientFields] = useState<Record<string, string>>({});
  const [newContactFields, setNewContactFields] = useState<Record<string, string>>({});
  
  // New client form mode
  const [clientMode, setClientMode] = useState<"select" | "new">("select");

  // Fields hidden from the user — system-managed (e.g. ClientGUID auto-generated on submit).
  const HIDDEN_SCHEMA_FIELDS = new Set(["ClientGUID"]);

  // Heuristic field-name pickers used to map dynamic schemas onto our invoice payload (display name + email).
  const pickEmailField = (schema: EntitySchema): string | null => {
    if (!schema) return null;
    const f = schema.fields.find((x) => /email/i.test(x.name));
    return f?.name ?? null;
  };
  const formatLabel = (name: string): string =>
    name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
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
  const [sendToClient, setSendToClient] = useState(false);
  const [dueDays, setDueDays] = useState<string>("7");
  const [selectedRecipientEmails, setSelectedRecipientEmails] = useState<string[]>([]);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  useEffect(() => {
    neonQuery("global_config", { select: "value", filters: { key: "currency" }, maybeSingle: true })
      .then(({ data }) => { if ((data as any)?.value) setCurrency((data as any).value); });
  }, []);

  useEffect(() => {
    const xeroHeaders = {
      "x-org-id": getOrgId(),
      "x-environment": localStorage.getItem("auth_environment") || "production",
    };

    const fetchClients = async () => {
      setLoadingClients(true);
      try {
        const { data } = await supabase.functions.invoke("clients-api-proxy", {
          body: {
            action: "read",
            entity: "clients",
            payload: {
              select: ["ContactName"],
              limit: 1000,
            },
          },
          headers: xeroHeaders,
        });
        if (Array.isArray(data?.data)) {
          const mapped = data.data.map((row: any) => ({
            id: String(row.id),
            name: row.ContactName || row.Name || "(no name)",
          }));
          mapped.sort((a, b) => a.name.localeCompare(b.name));
          setClients(mapped);
        }
      } catch (err) {
        console.warn("Failed to fetch clients:", err);
      }
      setLoadingClients(false);
    };

    const fetchTrackingCategories = async () => {
      try {
        const { data } = await supabase.functions.invoke("xero", {
          body: { action: "tracking-categories" },
          headers: xeroHeaders,
        });
        if (data?.categories) {
          // Only include categories that have active options
          const active = (data.categories as TrackingCategory[]).filter(
            (tc) => tc.options.some((o) => o.status === "ACTIVE")
          );
          setTrackingCategories(active);
        }
      } catch (err) {
        console.warn("Failed to fetch Xero tracking categories:", err);
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

    // Fetch visible account codes from config
    const fetchVisibleAccounts = async () => {
      try {
        const { data } = await neonQuery("global_config", {
          select: "value",
          filters: { key: "xero_visible_accounts" },
          maybeSingle: true,
        });
        if (data && (data as any).value) {
          const parsed = JSON.parse((data as any).value);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setVisibleAccountCodes(parsed);
          }
        }
      } catch { /* ignore */ }
    };

    // Serialize all Xero calls to avoid token refresh race conditions
    const loadXeroData = async () => {
      await fetchClients();
      await fetchTrackingCategories();
      await fetchAccounts();
      await fetchVisibleAccounts();
    };
    loadXeroData();
  }, []);

  // Fetch dynamic schemas for clients & contacts so "create new" forms render whatever fields each org has configured.
  useEffect(() => {
    let cancelled = false;
    const headers = {
      "x-org-id": getOrgId(),
      "x-environment": localStorage.getItem("auth_environment") || "production",
    };
    const fetchSchema = async (entity: "clients" | "contacts") => {
      try {
        const { data } = await supabase.functions.invoke("clients-api-proxy", {
          body: { action: "describe", entity },
          headers,
        });
        if (cancelled || !data?.fields) return null;
        return {
          display_field: data.display_field,
          fields: data.fields as Array<{ name: string; required: boolean; type: string }>,
        };
      } catch (err) {
        console.warn(`Failed to describe ${entity}:`, err);
        return null;
      }
    };
    (async () => {
      const [c, p] = await Promise.all([fetchSchema("clients"), fetchSchema("contacts")]);
      if (cancelled) return;
      if (c) setClientSchema(c);
      if (p) setContactSchema(p);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let active = true;
    const identityFilters: Array<Record<string, string>> = [];

    if (systemId) identityFilters.push({ system_id: systemId });
    if (requesterName) identityFilters.push({ user_name: requesterName });

    const checkFlags = async () => {
      setCheckingApprovalState(true);

      const [staffRes, userRes, freeTextRes] = await Promise.all([
        identityFilters.length > 0
          ? neonQuery("staff_centre_assignments", {
              select: "system_id,user_name",
              orFilters: identityFilters,
              limit: 10,
            })
          : Promise.resolve({ data: [], error: null }),
        identityFilters.length > 0
          ? neonQuery("user_approval_flags", {
              select: "system_id,user_name,requires_approval",
              orFilters: identityFilters,
              limit: 10,
            })
          : Promise.resolve({ data: [], error: null }),
        neonQuery("global_config", {
          select: "value",
          filters: { key: "freetext_requires_approval" },
          maybeSingle: true,
        }),
      ]);

      if (!active) return;

      const staffRows = (staffRes.data as any[]) || [];
      const matchedStaff =
        staffRows.find((row) => systemId && row.system_id === systemId) ||
        staffRows.find((row) => requesterName && row.user_name === requesterName) ||
        null;

      const flagRows = (userRes.data as any[]) || [];
      const matchedFlag =
        flagRows.find((row) => matchedStaff?.system_id && row.system_id === matchedStaff.system_id) ||
        flagRows.find((row) => systemId && row.system_id === systemId) ||
        flagRows.find((row) => requesterName && row.user_name === requesterName) ||
        null;

      setResolvedSystemId(matchedStaff?.system_id || matchedFlag?.system_id || systemId || "");
      setUserFlagged(matchedFlag?.requires_approval === true);
      setFreeTextFlagged((freeTextRes.data as any)?.value === "true");
      setCheckingApprovalState(false);
    };

    checkFlags();

    return () => {
      active = false;
    };
  }, [requesterName, systemId]);

  useEffect(() => {
    if (!loadingTemplates && lineItems.length === 0) {
      const defaultId = templates.length > 0 ? templates[0].id : FREETEXT_ID;
      setLineItems([createLineItem(defaultId)]);
    }
  }, [loadingTemplates, lineItems.length, templates]);

  // Fetch contacts whenever the selected client changes.
  useEffect(() => {
    if (!clientId) {
      setContacts([]);
      setContactId("");
      setContactMode(clientMode === "new" ? "new" : "select");
      return;
    }
    const selectedClient = clients.find((c) => c.id === clientId);
    const clientName = selectedClient?.name;
    let cancelled = false;
    const xeroHeaders = {
      "x-org-id": getOrgId(),
      "x-environment": localStorage.getItem("auth_environment") || "production",
    };
    const fetchContactsForClient = async () => {
      setLoadingContacts(true);
      try {
        const { data } = await supabase.functions.invoke("clients-api-proxy", {
          body: {
            action: "read",
            entity: "contacts",
            payload: {
              select: ["ContactName", "Name", "FirstName", "LastName", "EmailAddress", "ContactPersons"],
              limit: 1000,
            },
          },
          headers: xeroHeaders,
        });
        if (cancelled) return;
        const rows = Array.isArray(data?.data) ? data.data : [];
        const mapped: XeroContact[] = rows.map((row: any) => {
          const emails = new Set<string>();
          if (row.EmailAddress && typeof row.EmailAddress === "string") {
            emails.add(row.EmailAddress);
          }
          if (Array.isArray(row.ContactPersons)) {
            for (const p of row.ContactPersons) {
              if (p?.IncludeInEmails && p?.EmailAddress) emails.add(p.EmailAddress);
            }
          }
          const fullName = [row.FirstName, row.LastName].filter(Boolean).join(" ").trim();
          return {
            id: String(row.id),
            name: row.ContactName || row.Name || fullName || "(no name)",
            emails: Array.from(emails),
          };
        });
        const clientScoped = clientName && clientName !== "(no name)"
          ? mapped.filter((contact) => contact.name === clientName)
          : [];
        const nextContacts = clientScoped.length > 0 ? clientScoped : mapped;
        nextContacts.sort((a, b) => a.name.localeCompare(b.name));
        setContacts(nextContacts);
        setContactId("");
      } catch (err) {
        console.warn("Failed to fetch contacts:", err);
      }
      if (!cancelled) setLoadingContacts(false);
    };
    fetchContactsForClient();
    return () => { cancelled = true; };
  }, [clientId, clients, clientMode]);

  // When the selected contact changes, default to selecting all of its emails.
  useEffect(() => {
    if (contactMode === "select" && contactId) {
      const c = contacts.find((x) => x.id === contactId);
      setSelectedRecipientEmails(c?.emails ? [...c.emails] : []);
    } else {
      setSelectedRecipientEmails([]);
    }
  }, [contactId, contactMode, contacts]);

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

  // Map dynamic schema field-values into the canonical name + email used by invoice payload.
  const getDynamicName = (
    schema: EntitySchema,
    values: Record<string, string>,
  ): string => {
    if (!schema) return "";
    return (values[schema.display_field] || "").trim();
  };
  const getDynamicEmail = (
    schema: EntitySchema,
    values: Record<string, string>,
  ): string => {
    const f = pickEmailField(schema);
    return f ? (values[f] || "").trim() : "";
  };

  const newClientName = getDynamicName(clientSchema, newClientFields);
  const newClientEmail = getDynamicEmail(clientSchema, newClientFields);
  const newContactFullName = getDynamicName(contactSchema, newContactFields);
  const newContactEmail = getDynamicEmail(contactSchema, newContactFields);

  const effectiveContactMode = clientMode === "new" ? "new" : contactMode;

  const contactName = effectiveContactMode === "select"
    ? contacts.find((c) => c.id === contactId)?.name || ""
    : newContactFullName;

  // Validate dynamic schema: every required (visible) field must have a value, and any email-named field
  // that has been filled in must be a valid email address.
  const validateSchemaValues = (
    schema: EntitySchema,
    values: Record<string, string>,
  ): { valid: boolean; missing: string[] } => {
    if (!schema) return { valid: false, missing: ["Loading schema..."] };
    const missing: string[] = [];
    for (const f of schema.fields) {
      if (HIDDEN_SCHEMA_FIELDS.has(f.name)) continue;
      const v = (values[f.name] || "").trim();
      if (f.required && !v) missing.push(formatLabel(f.name));
      if (v && /email/i.test(f.name) && !emailRegex.test(v)) {
        missing.push(`Valid ${formatLabel(f.name)}`);
      }
    }
    return { valid: missing.length === 0, missing };
  };

  const clientNewCheck = validateSchemaValues(clientSchema, newClientFields);
  const contactNewCheck = validateSchemaValues(contactSchema, newContactFields);

  const clientValid = clientMode === "select" ? !!clientId : clientNewCheck.valid;
  const contactValid = effectiveContactMode === "select" ? !!contactId : contactNewCheck.valid;
  const lineItemsValid = lineItems.every((item) => isLineItemValid(item, templates, trackingCategories));
  const allValid = clientValid && contactValid && lineItemsValid;

  const missingFields: string[] = [];
  if (!clientValid) {
    if (clientMode === "select") {
      missingFields.push("Select a client");
    } else {
      clientNewCheck.missing.forEach((m) => missingFields.push(`Client: ${m}`));
    }
  }
  if (!contactValid) {
    if (effectiveContactMode === "select") {
      missingFields.push("Select a contact");
    } else {
      contactNewCheck.missing.forEach((m) => missingFields.push(`Contact: ${m}`));
    }
  }
  if (!lineItemsValid) missingFields.push("Complete all line items");

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
    if (!allValid || checkingApprovalState) return;
    setSubmitting(true);

    try {
      const lineItemsPayload = lineItems.map((item) => {
        const base: Record<string, unknown> = {
          description: getGeneratedDescription(item, templates),
          quantity: Number(item.quantity),
          cost: Number(item.cost),
          account: item.account,
        };
        // Include tracking categories only if they exist
        if (trackingCategories.length > 0) {
          base.tracking = trackingCategories.map((tc) => ({
            name: tc.name,
            option: item.trackingValues[tc.id] || "",
          }));
        }
        return base;
      });

      // Step 1: If creating a new client and/or contact, push them to the auth app first.
      const xeroHeaders = {
        "x-org-id": getOrgId(),
        "x-environment": localStorage.getItem("auth_environment") || "production",
      };

      let effectiveClientId = clientId;
      let effectiveClientName = clients.find((c) => c.id === clientId)?.name || "";

      if (clientMode === "new") {
        try {
          // Build payload from whatever fields the schema declares — only send non-empty values,
          // plus an auto-generated ClientGUID for the system-managed identity field if present.
          const clientData: Record<string, string> = {};
          for (const f of clientSchema?.fields ?? []) {
            const v = (newClientFields[f.name] || "").trim();
            if (v) clientData[f.name] = v;
          }
          if (clientSchema?.fields.some((f) => f.name === "ClientGUID")) {
            clientData.ClientGUID = crypto.randomUUID();
          }
          const { data: createRes, error: createErr } = await supabase.functions.invoke("clients-api-proxy", {
            body: { action: "create", entity: "clients", payload: { data: clientData } },
            headers: xeroHeaders,
          });
          if (createErr || !createRes?.data?.id) {
            throw new Error(createRes?.error || createErr?.message || "Failed to create client");
          }
          effectiveClientId = String(createRes.data.id);
          effectiveClientName = newClientName;
          // Reflect in local list so subsequent UI is consistent.
          setClients((prev) => [...prev, { id: effectiveClientId, name: effectiveClientName }].sort((a, b) => a.name.localeCompare(b.name)));
        } catch (clientErr: any) {
          toast.error(clientErr?.message || "Failed to create client in auth app");
          setSubmitting(false);
          return;
        }
      }

      let effectiveContactId = contactId;
      let effectiveContactName = contactName;

      if (effectiveContactMode === "new") {
        if (!effectiveClientId) {
          toast.error("Cannot create contact: client is missing");
          setSubmitting(false);
          return;
        }
        try {
          const contactData: Record<string, string> = {};
          for (const f of contactSchema?.fields ?? []) {
            const v = (newContactFields[f.name] || "").trim();
            if (v) contactData[f.name] = v;
          }
          const contactPayload = {
            data: contactData,
            parent_id: effectiveClientId,
          };
          const { data: createRes, error: createErr } = await supabase.functions.invoke("clients-api-proxy", {
            body: { action: "create", entity: "contacts", payload: contactPayload },
            headers: xeroHeaders,
          });
          if (createErr || !createRes?.data?.id) {
            throw new Error(createRes?.error || createErr?.message || "Failed to create contact");
          }
          effectiveContactId = String(createRes.data.id);
          effectiveContactName = newContactFullName;
        } catch (contactErr: any) {
          toast.error(contactErr?.message || "Failed to create contact in auth app");
          setSubmitting(false);
          return;
        }
      }

      const finalContactId = effectiveContactId || "__new__";
      const submitterSystemId = resolvedSystemId || systemId || "";

      // Guarantee submitted_by_email is never empty — older sessions may not
      // have cached auth_email, so fall back to a live auth-gateway lookup.
      let resolvedEmail: string;
      try {
        resolvedEmail = await resolveUserEmail(userEmail, submitterSystemId);
      } catch (emailErr: any) {
        toast.error(emailErr?.message || "Could not determine your account email.");
        setSubmitting(false);
        return;
      }

      const invoicePayload = sanitizeObject({
        contact_id: finalContactId,
        contact_name: effectiveContactName,
        invoice_date: invoiceDate,
        reference: reference.trim(),
        line_items: JSON.parse(JSON.stringify(lineItemsPayload)),
        total,
        // Lock the currency in effect at submission time onto the invoice itself,
        // so future display & downstream syncs ignore later global changes.
        currency,
        submitted_by_system_id: submitterSystemId,
        submitted_by_name: requesterName,
        submitted_by_email: resolvedEmail,
        requires_approval: willNeedApproval,
        status: willNeedApproval ? "pending_approval" : "submitted",
        template_id: selectedTemplateIds.length === 1 ? selectedTemplateIds[0] : null,
        send_to_client: sendToClient,
        due_days: Number(dueDays) || 7,
        recipient_emails: sendToClient
          ? (effectiveContactMode === "new"
              ? [newContactEmail.trim()].filter((e) => emailRegex.test(e))
              : selectedRecipientEmails.map((e) => e.trim()).filter((e) => emailRegex.test(e)))
          : [],
        contact_persons: [],
      });

      const { data: inserted, error } = await neonInsert("invoices", invoicePayload);

      if (error) {
        toast.error("Failed to submit invoice");
      } else {
        try {
          await neonInsert("invoice_logs", {
            invoice_id: (inserted as any).id,
            action_type: "request",
            source: "ui",
            performed_by: submitterSystemId,
            performed_by_name: requesterName,
            details: JSON.parse(JSON.stringify(inserted)),
          });
        } catch (logErr) {
          console.warn("Failed to write log:", logErr);
        }

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
          const inv = inserted as any;
          const notificationInvoice = {
            ...inv,
            contact_id: finalContactId,
            contact_name: effectiveContactName,
          };

          const [emailResult, webhookResult] = await Promise.allSettled([
            apiClient.invoices("send-approved-email", {
              invoice: notificationInvoice,
            }),
            apiClient.invoices("notify-approval", {
              invoice: notificationInvoice,
            }),
          ]);

          if (emailResult.status === "rejected") {
            console.warn("Approved invoice email failed for auto-submitted invoice:", emailResult.reason);
          }

          const webhookDelivered = webhookResult.status === "fulfilled";
          if (!webhookDelivered) {
            console.warn("n8n webhook failed for auto-submitted invoice:", webhookResult.reason);
          }

          if (webhookDelivered) {
            toast.success("Invoice auto-submitted to Xero", {
              description: "Your invoice has been automatically validated and pushed.",
              icon: <Zap className="w-4 h-4" />,
            });
          } else {
            toast.error("Invoice saved, but the webhook to Xero failed", {
              description: "Please contact your admin.",
            });
          }
        }
      }

      const defaultId = templates.length > 0 ? templates[0].id : FREETEXT_ID;
      setClientMode("select");
      setClientId("");
      setNewClientFields({});
      setContactMode("select");
      setContactId("");
      setNewContactFields({});
      setReference("");
      setSendToClient(false);
      setDueDays("7");
      setLineItems([createLineItem(defaultId)]);
    } catch {
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
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display text-foreground">Bill To</h2>

            <div className="space-y-2">
              <Label className="text-xs font-semibold font-display text-foreground uppercase tracking-wide">
                Client
              </Label>
              <Popover open={clientOpen} onOpenChange={setClientOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientOpen}
                    className="w-full justify-between font-normal"
                  >
                    {clientMode === "new"
                      ? (newClientName.trim() || "New client (fill details below)")
                      : clientId
                      ? clients.find((c) => c.id === clientId)?.name
                      : loadingClients ? "Loading clients..." : "Search clients..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search clients..." value={clientSearch} onValueChange={setClientSearch} />
                    <CommandList>
                      <CommandEmpty>No clients found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__create_new_client__"
                          onSelect={() => {
                            setClientMode("new");
                            // Seed the display field (e.g. ContactName) with the search text, if schema is loaded.
                            setNewClientFields(
                              clientSchema?.display_field
                                ? { [clientSchema.display_field]: clientSearch }
                                : {}
                            );
                            setClientId("");
                            // Reset contact when switching to a brand-new client
                            setContactMode("new");
                            setContactId("");
                            setContacts([]);
                            setClientOpen(false);
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4 text-primary" />
                          <span className="text-primary font-medium">Create New Client</span>
                        </CommandItem>
                        {clients.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => {
                              setClientMode("select");
                              setClientId(c.id);
                              setClientOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", clientId === c.id && clientMode === "select" ? "opacity-100" : "opacity-0")} />
                            {c.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {clientMode === "new" && (
                <div className="space-y-3 animate-fade-in rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold font-display text-foreground uppercase tracking-wide">
                      New client details
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setClientMode("select");
                        setNewClientFields({});
                        setContactMode("select");
                        setNewContactFields({});
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {!clientSchema ? (
                    <p className="text-xs text-muted-foreground">Loading client fields…</p>
                  ) : (
                    clientSchema.fields
                      .filter((f) => !HIDDEN_SCHEMA_FIELDS.has(f.name))
                      .map((f, idx) => {
                        const isEmail = /email/i.test(f.name);
                        return (
                          <div key={f.name} className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                              {formatLabel(f.name)} {f.required ? "*" : "(optional)"}
                            </Label>
                            <Input
                              type={isEmail ? "email" : "text"}
                              value={newClientFields[f.name] || ""}
                              onChange={(e) =>
                                setNewClientFields((prev) => ({ ...prev, [f.name]: e.target.value }))
                              }
                              autoFocus={idx === 0}
                            />
                          </div>
                        );
                      })
                  )}
                  <p className="text-xs text-muted-foreground">
                    Add the contact person below — both will be created on submit.
                  </p>
                </div>
              )}
            </div>

            {(clientId || clientMode === "new") && (
              <div className="space-y-2 animate-fade-in">
                <Label className="text-xs font-semibold font-display text-foreground uppercase tracking-wide">
                  Contact
                </Label>
                {clientMode === "new" ? (
                  <p className="text-xs text-muted-foreground">
                    A contact person will be created for this new client.
                  </p>
                ) : (
                  <Popover open={contactOpen} onOpenChange={setContactOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={contactOpen}
                        className="w-full justify-between font-normal"
                      >
                        {contactMode === "new"
                          ? (newContactFullName || "New contact (fill details below)")
                          : contactId
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
                                setNewContactFields(
                                  contactSchema?.display_field
                                    ? { [contactSchema.display_field]: contactSearch }
                                    : {}
                                );
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
                                  setNewContactFields({});
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
                )}

            {effectiveContactMode === "new" && (
              <div className="space-y-3 animate-fade-in rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold font-display text-foreground uppercase tracking-wide">
                    New contact details
                  </p>
                  {clientMode !== "new" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setContactMode("select");
                        setNewContactFields({});
                        
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
                {!contactSchema ? (
                  <p className="text-xs text-muted-foreground">Loading contact fields…</p>
                ) : (
                  contactSchema.fields
                    .filter((f) => !HIDDEN_SCHEMA_FIELDS.has(f.name))
                    .map((f, idx) => {
                      const isEmail = /email/i.test(f.name);
                      return (
                        <div key={f.name} className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            {formatLabel(f.name)} {f.required ? "*" : "(optional)"}
                          </Label>
                          <Input
                            type={isEmail ? "email" : "text"}
                            value={newContactFields[f.name] || ""}
                            onChange={(e) =>
                              setNewContactFields((prev) => ({ ...prev, [f.name]: e.target.value }))
                            }
                            autoFocus={idx === 0}
                          />
                        </div>
                      );
                    })
                )}
              </div>
            )}
            {contactMode === "select" && contactId && (() => {
              const selected = contacts.find((c) => c.id === contactId);
              const emails = selected?.emails ?? [];
              return (
                <div className="space-y-2 animate-fade-in">
                  <Label className="text-xs font-semibold font-display text-foreground uppercase tracking-wide">
                    Send invoice to
                  </Label>
                  {emails.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No email addresses found on this contact. Update the contact to add an email address.
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      {emails.map((email) => {
                        const checked = selectedRecipientEmails.includes(email);
                        return (
                          <label
                            key={email}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                setSelectedRecipientEmails((prev) =>
                                  v ? [...new Set([...prev, email])] : prev.filter((e) => e !== email),
                                );
                              }}
                            />
                            <span className="text-foreground break-all">{email}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
              </div>
            )}
          </div>

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
              <div>
                <Label className="text-sm font-semibold font-display text-foreground">Due Date</Label>
                <Select value={dueDays} onValueChange={setDueDays}>
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="28">28 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="send-to-client" className="text-sm font-semibold font-display text-foreground">
                  Send invoice to client
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, the invoice will be emailed to the client immediately after being created in Xero.
                </p>
              </div>
              <Switch
                id="send-to-client"
                checked={sendToClient}
                onCheckedChange={setSendToClient}
              />
            </div>
          </div>

          {lineItems.map((item, index) => (
            <LineItemCard
              key={item.id}
              item={item}
              index={index}
              canRemove={lineItems.length > 1}
              templates={templates}
              accounts={visibleAccountCodes && visibleAccountCodes.length > 0 ? xeroAccounts.filter((a) => visibleAccountCodes.includes(a.code)) : xeroAccounts}
              trackingCategories={trackingCategories}
              onUpdate={updateLineItem}
              onRemove={removeLineItem}
            />
          ))}

          <Button type="button" variant="outline" className="w-full gap-2 border-dashed" onClick={addLineItem}>
            <Plus className="w-4 h-4" />
            Add Line Item
          </Button>

          {checkingApprovalState ? (
            <div className="bg-muted border border-border rounded-xl p-4">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Checking approval rules</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Please wait while we validate requester and template approval requirements.
              </p>
            </div>
          ) : willNeedApproval ? (
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

          <div className="sticky bottom-0 bg-background border-t border-border -mx-8 px-8 py-4 flex justify-between items-center gap-4">
            <div className="text-sm text-muted-foreground flex-1 min-w-0">
              {total > 0 ? (
                <span>
                  Total: <strong className="text-foreground">{currency} {total.toFixed(2)}</strong>
                  {lineItems.length > 1 && <span className="ml-2">({lineItems.length} items)</span>}
                </span>
              ) : (
                "Fill in quantity and cost to see total"
              )}
              {!allValid && !checkingApprovalState && missingFields.length > 0 && (
                <div className="text-xs text-destructive mt-1">
                  Missing: {missingFields.join(", ")}
                </div>
              )}
            </div>
            <Button type="submit" disabled={!allValid || submitting || checkingApprovalState} className="gap-2">
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : checkingApprovalState ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : willNeedApproval ? (
                <ShieldAlert className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {checkingApprovalState ? "Checking approval rules..." : willNeedApproval ? "Submit for Approval" : "Submit to Xero"}
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
  trackingCategories: TrackingCategory[];
  onUpdate: (id: string, updates: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}

const LineItemCard: React.FC<LineItemCardProps> = ({ item, index, canRemove, templates, accounts, trackingCategories, onUpdate, onRemove }) => {
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
          {selectedTemplate.fields.map((field) => {
            // Auto-computed value for programmatic fields, used as a placeholder/default.
            const computed =
              field.type === "programmatic"
                ? computeProgrammaticValue(field, item.fieldValues)
                : "";
            const currentValue = item.fieldValues[field.name] ?? "";
            const displayValue =
              field.type === "programmatic" && currentValue === "" ? computed : currentValue;

            return (
              <div key={field.id}>
                <Label className="text-xs text-muted-foreground">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                  {field.type === "programmatic" && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-primary">
                      auto · editable
                    </span>
                  )}
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
                ) : field.type === "programmatic" ? (
                  <div className="flex gap-2">
                    <Input
                      value={displayValue}
                      onChange={(e) => update({ fieldValues: { ...item.fieldValues, [field.name]: e.target.value } })}
                      placeholder={computed || field.placeholder}
                      className="font-mono"
                    />
                    {currentValue !== "" && currentValue !== computed && computed !== "" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => update({ fieldValues: { ...item.fieldValues, [field.name]: "" } })}
                        title="Reset to auto-computed value"
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                ) : (
                  <Input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    value={item.fieldValues[field.name] || ""}
                    onChange={(e) => update({ fieldValues: { ...item.fieldValues, [field.name]: e.target.value } })}
                    placeholder={field.placeholder}
                  />
                )}
              </div>
            );
          })}

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
        {trackingCategories.map((tc) => (
          <div key={tc.id}>
            <Label className="text-xs text-muted-foreground">{tc.name}</Label>
            <Select
              value={item.trackingValues[tc.id] || ""}
              onValueChange={(v) => update({ trackingValues: { ...item.trackingValues, [tc.id]: v } })}
            >
              <SelectTrigger><SelectValue placeholder={`Select ${tc.name.toLowerCase()}`} /></SelectTrigger>
              <SelectContent>
                {tc.options.filter((o) => o.status === "ACTIVE").map((o) => (
                  <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CreateInvoicePage;
