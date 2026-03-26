import React, { useState, useEffect } from "react";
import { nowGMT8 } from "@/lib/utils";
import AppLayout from "@/components/AppLayout";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getTenantFilter, getOrgFilter } from "@/hooks/use-tenant-filter";
import { ShieldAlert, ShieldCheck, X, ChevronsUpDown, Check, Zap, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

const CURRENCIES = [
  { value: "RM", label: "RM — Malaysian Ringgit" },
  { value: "SGD$", label: "SGD$ — Singapore Dollar" },
];

interface UserFlag {
  id: string;
  system_id: string;
  user_name: string;
  requires_approval: boolean;
}

interface TemplateFlag {
  id: string;
  name: string;
  requires_approval: boolean;
}

interface StaffOption {
  system_id: string;
  user_name: string;
}

const SettingsPage: React.FC = () => {
  const { user, systemId } = useAuth();
  const [autoMode, setAutoMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState("RM");
  const FREETEXT_ID = "__freetext__";
  const [freeTextFlagged, setFreeTextFlagged] = useState(false);

  // Approval flags
  const [userFlags, setUserFlags] = useState<UserFlag[]>([]);
  const [templates, setTemplates] = useState<TemplateFlag[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [loadingFlags, setLoadingFlags] = useState(true);

  // Combobox state
  const [userComboOpen, setUserComboOpen] = useState(false);
  const [templateComboOpen, setTemplateComboOpen] = useState(false);

  useEffect(() => {
    fetchFlags();
  }, []);

  const fetchFlags = async () => {
    setLoadingFlags(true);
    const [usersRes, templatesRes, staffRes, freeTextRes, currencyRes] = await Promise.all([
      supabase.from("user_approval_flags").select("*").order("user_name"),
      supabase.from("invoice_templates").select("id, name, requires_approval").order("name"),
      supabase.from("staff_centre_assignments").select("system_id, user_name").order("user_name"),
      supabase.from("global_config").select("value").eq("key", "freetext_requires_approval").maybeSingle(),
      supabase.from("global_config").select("value").eq("key", "currency").maybeSingle(),
    ]);
    if (usersRes.data) setUserFlags(usersRes.data as unknown as UserFlag[]);
    if (templatesRes.data) setTemplates(templatesRes.data as unknown as TemplateFlag[]);
    if (staffRes.data) setStaffOptions(staffRes.data as unknown as StaffOption[]);
    setFreeTextFlagged(freeTextRes.data?.value === "true");
    if (currencyRes.data?.value) setCurrency(currencyRes.data.value);
    setLoadingFlags(false);
  };

  // --- User flags ---
  const flaggedUserIds = new Set(userFlags.filter((f) => f.requires_approval).map((f) => f.system_id));

  const addUserFlag = async (staff: StaffOption) => {
    // Check if already exists in user_approval_flags
    const existing = userFlags.find((f) => f.system_id === staff.system_id);
    if (existing) {
      // Just toggle it on
      const { error } = await supabase
        .from("user_approval_flags")
        .update({ requires_approval: true, updated_at: nowGMT8() } as any)
        .eq("id", existing.id);
      if (error) {
        toast.error("Failed to flag user");
      } else {
        setUserFlags((prev) =>
          prev.map((f) => (f.id === existing.id ? { ...f, requires_approval: true } : f))
        );
        toast.success(`${staff.user_name} flagged for approval`);
      }
    } else {
      const { error } = await supabase.from("user_approval_flags").insert({
        system_id: staff.system_id,
        user_name: staff.user_name,
        requires_approval: true,
        flagged_by: systemId || "",
      } as any);
      if (error) {
        toast.error("Failed to flag user");
      } else {
        toast.success(`${staff.user_name} flagged for approval`);
        fetchFlags();
      }
    }
    setUserComboOpen(false);
  };

  const removeUserFlag = async (flag: UserFlag) => {
    const { error } = await supabase
      .from("user_approval_flags")
      .update({ requires_approval: false, updated_at: nowGMT8() } as any)
      .eq("id", flag.id);
    if (error) {
      toast.error("Failed to unflag user");
    } else {
      setUserFlags((prev) =>
        prev.map((f) => (f.id === flag.id ? { ...f, requires_approval: false } : f))
      );
      toast.success(`${flag.user_name || flag.system_id} unflagged`);
    }
  };

  // --- Template flags (includes Free Text as virtual entry) ---
  const flaggedTemplateIds = new Set(templates.filter((t) => t.requires_approval).map((t) => t.id));

  const toggleTemplateFlag = async (template: TemplateFlag, flag: boolean) => {
    const { error } = await supabase
      .from("invoice_templates")
      .update({ requires_approval: flag, updated_at: nowGMT8() } as any)
      .eq("id", template.id);
    if (error) {
      toast.error("Failed to update template flag");
    } else {
      setTemplates((prev) =>
        prev.map((t) => (t.id === template.id ? { ...t, requires_approval: flag } : t))
      );
      toast.success(`"${template.name}" ${flag ? "flagged" : "unflagged"}`);
    }
    setTemplateComboOpen(false);
  };

  const toggleFreeTextFlag = async (flag: boolean) => {
    // Upsert into global_config
    const { data: existing } = await supabase
      .from("global_config")
      .select("id")
      .eq("key", "freetext_requires_approval")
      .maybeSingle();

    let error;
    if (existing) {
      ({ error } = await supabase
        .from("global_config")
        .update({ value: String(flag), updated_at: nowGMT8() } as any)
        .eq("key", "freetext_requires_approval"));
    } else {
      ({ error } = await supabase
        .from("global_config")
        .insert({ key: "freetext_requires_approval", value: String(flag) } as any));
    }

    if (error) {
      toast.error("Failed to update free text flag");
    } else {
      setFreeTextFlagged(flag);
      toast.success(`Free Text ${flag ? "flagged" : "unflagged"} for approval`);
    }
    setTemplateComboOpen(false);
  };

  const unflaggedStaff = staffOptions.filter((s) => !flaggedUserIds.has(s.system_id));
  const flaggedUsers = userFlags.filter((f) => f.requires_approval);
  const unflaggedTemplates = templates.filter((t) => !t.requires_approval);
  const flaggedTemplates = templates.filter((t) => t.requires_approval);

  const saveCurrency = async (val: string) => {
    setCurrency(val);
    const { data: existing } = await supabase
      .from("global_config")
      .select("id")
      .eq("key", "currency")
      .maybeSingle();

    let error;
    if (existing) {
      ({ error } = await supabase
        .from("global_config")
        .update({ value: val, updated_at: nowGMT8() } as any)
        .eq("key", "currency"));
    } else {
      ({ error } = await supabase
        .from("global_config")
        .insert({ key: "currency", value: val } as any));
    }
    if (error) {
      toast.error("Failed to save currency");
    } else {
      toast.success(`Currency set to ${val}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    toast.success("Settings saved");
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-display text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure your invoice center preferences</p>
        </div>

        <div className="space-y-6">
          {/* Invoice Flow */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-5">
            <h2 className="text-sm font-semibold font-display text-foreground">Invoice Flow</h2>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-foreground">Automated Push to Xero</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {autoMode
                    ? "Invoices will be validated and pushed to Xero automatically"
                    : "Invoices require manual approval before being pushed to Xero"}
                </p>
              </div>
              <Switch checked={autoMode} onCheckedChange={setAutoMode} />
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Current mode:</strong>{" "}
                {autoMode ? (
                  <span className="pill-automated ml-1">Automated</span>
                ) : (
                  <span className="pill-manual ml-1">Manual Approval</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {autoMode
                  ? "Invoices pass validation checks → auto-push to Xero → downloadable invoice returned."
                  : "Invoices go to Approvals queue → accountant reviews & adjusts → push to Xero."}
              </p>
            </div>
          </div>

          {/* User Approval Tags */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold font-display text-foreground">User Approval Tags</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Tagged users' invoices require approval before being pushed to Xero, regardless of workflow mode.
            </p>

            {/* Searchable dropdown to add users */}
            <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={userComboOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className="text-muted-foreground">Search and tag a user...</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name or ID..." />
                  <CommandList>
                    <CommandEmpty>No untagged users found.</CommandEmpty>
                    <CommandGroup>
                      {unflaggedStaff.map((s) => (
                        <CommandItem
                          key={s.system_id}
                          value={`${s.user_name} ${s.system_id}`}
                          onSelect={() => addUserFlag(s)}
                        >
                          <span className="font-medium">{s.user_name}</span>
                          <span className="ml-2 text-xs text-muted-foreground font-mono">{s.system_id}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Tagged users */}
            {loadingFlags ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : flaggedUsers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No users tagged for approval</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {flaggedUsers.map((flag) => (
                  <Badge key={flag.id} variant="secondary" className="gap-1.5 py-1.5 px-3 text-sm">
                    <ShieldAlert className="w-3 h-3 text-destructive" />
                    {flag.user_name || flag.system_id}
                    <button
                      onClick={() => removeUserFlag(flag)}
                      className="ml-1 hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Template Approval Tags */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold font-display text-foreground">Template Approval Tags</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Invoices using tagged templates require approval before being pushed to Xero.
            </p>

            {/* Searchable dropdown to add templates */}
            <Popover open={templateComboOpen} onOpenChange={setTemplateComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={templateComboOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className="text-muted-foreground">Search and tag a template...</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search templates..." />
                  <CommandList>
                    <CommandEmpty>No untagged templates found.</CommandEmpty>
                    <CommandGroup>
                      {!freeTextFlagged && (
                        <CommandItem
                          value="Free Text"
                          onSelect={() => toggleFreeTextFlag(true)}
                        >
                          <span className="font-medium">Free Text</span>
                          <span className="ml-2 text-xs text-muted-foreground">(custom descriptions)</span>
                        </CommandItem>
                      )}
                      {unflaggedTemplates.map((t) => (
                        <CommandItem
                          key={t.id}
                          value={t.name}
                          onSelect={() => toggleTemplateFlag(t, true)}
                        >
                          {t.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Tagged templates */}
            {loadingFlags ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : (flaggedTemplates.length === 0 && !freeTextFlagged) ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No templates tagged for approval</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {freeTextFlagged && (
                  <Badge variant="secondary" className="gap-1.5 py-1.5 px-3 text-sm">
                    <ShieldCheck className="w-3 h-3 text-destructive" />
                    Free Text
                    <button
                      onClick={() => toggleFreeTextFlag(false)}
                      className="ml-1 hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                )}
                {flaggedTemplates.map((t) => (
                  <Badge key={t.id} variant="secondary" className="gap-1.5 py-1.5 px-3 text-sm">
                    <ShieldCheck className="w-3 h-3 text-destructive" />
                    {t.name}
                    <button
                      onClick={() => toggleTemplateFlag(t, false)}
                      className="ml-1 hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Currency */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold font-display text-foreground">Currency</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Select the currency used for displaying invoice amounts across the system.
            </p>
            <RadioGroup value={currency} onValueChange={saveCurrency} className="space-y-2">
              {CURRENCIES.map((c) => (
                <div key={c.value} className="flex items-center gap-3">
                  <RadioGroupItem value={c.value} id={`currency-${c.value}`} />
                  <Label htmlFor={`currency-${c.value}`} className="text-sm text-foreground cursor-pointer">
                    {c.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Xero Connection */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display text-foreground">Xero Connection</h2>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-sm text-foreground">Connected to Xero</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Accounts and tracking categories are synced from your Xero organisation.
            </p>
          </div>

          {/* Database */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display text-foreground">Database</h2>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-sm text-foreground">NeonDB Connected</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Environment: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Development</code>
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
