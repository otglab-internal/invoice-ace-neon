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
import { useAuth } from "@/contexts/AuthContext";
import { neonQuery, neonInsert, neonUpdate, neonUpsert } from "@/lib/neon-client";
import { logActivity } from "@/lib/activity-logger";
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
  const performerName = user ? `${user.firstName} ${user.lastName}` : "";
  const performerId = systemId || "";
  const [autoMode, setAutoMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState("RM");
  const FREETEXT_ID = "__freetext__";
  const [freeTextFlagged, setFreeTextFlagged] = useState(false);

  const [userFlags, setUserFlags] = useState<UserFlag[]>([]);
  const [templates, setTemplates] = useState<TemplateFlag[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [loadingFlags, setLoadingFlags] = useState(true);

  const [userComboOpen, setUserComboOpen] = useState(false);
  const [templateComboOpen, setTemplateComboOpen] = useState(false);

  useEffect(() => {
    fetchFlags();
  }, []);

  const fetchFlags = async () => {
    setLoadingFlags(true);
    const [usersRes, templatesRes, staffRes, freeTextRes, currencyRes] = await Promise.all([
      neonQuery("user_approval_flags", { order: { column: "user_name", ascending: true } }),
      neonQuery("invoice_templates", { select: "id,name,requires_approval", order: { column: "name", ascending: true } }),
      neonQuery("staff_centre_assignments", { select: "system_id,user_name", order: { column: "user_name", ascending: true } }),
      neonQuery("global_config", { select: "value", filters: { key: "freetext_requires_approval" }, maybeSingle: true }),
      neonQuery("global_config", { select: "value", filters: { key: "currency" }, maybeSingle: true }),
    ]);
    if (usersRes.data) setUserFlags(usersRes.data as unknown as UserFlag[]);
    if (templatesRes.data) setTemplates(templatesRes.data as unknown as TemplateFlag[]);
    if (staffRes.data) setStaffOptions(staffRes.data as unknown as StaffOption[]);
    setFreeTextFlagged((freeTextRes.data as any)?.value === "true");
    if ((currencyRes.data as any)?.value) setCurrency((currencyRes.data as any).value);
    setLoadingFlags(false);
  };

  const flaggedUserIds = new Set(userFlags.filter((f) => f.requires_approval).map((f) => f.system_id));

  const addUserFlag = async (staff: StaffOption) => {
    const existing = userFlags.find((f) => f.system_id === staff.system_id);
    if (existing) {
      const { error } = await neonUpdate("user_approval_flags",
        { requires_approval: true, updated_at: nowGMT8() },
        { id: existing.id }
      );
      if (error) {
        toast.error("Failed to flag user");
      } else {
        setUserFlags((prev) =>
          prev.map((f) => (f.id === existing.id ? { ...f, requires_approval: true } : f))
        );
        toast.success(`${staff.user_name} flagged for approval`);
      }
    } else {
      const { error } = await neonInsert("user_approval_flags", {
        system_id: staff.system_id,
        user_name: staff.user_name,
        requires_approval: true,
        flagged_by: systemId || "",
      });
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
    const { error } = await neonUpdate("user_approval_flags",
      { requires_approval: false, updated_at: nowGMT8() },
      { id: flag.id }
    );
    if (error) {
      toast.error("Failed to unflag user");
    } else {
      setUserFlags((prev) =>
        prev.map((f) => (f.id === flag.id ? { ...f, requires_approval: false } : f))
      );
      toast.success(`${flag.user_name || flag.system_id} unflagged`);
    }
  };

  const flaggedTemplateIds = new Set(templates.filter((t) => t.requires_approval).map((t) => t.id));

  const toggleTemplateFlag = async (template: TemplateFlag, flag: boolean) => {
    const { error } = await neonUpdate("invoice_templates",
      { requires_approval: flag, updated_at: nowGMT8() },
      { id: template.id }
    );
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
    const { error } = await neonUpsert("global_config", {
      key: "freetext_requires_approval",
      value: String(flag),
      updated_at: nowGMT8(),
    }, "key");

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
    const { error } = await neonUpsert("global_config", {
      key: "currency",
      value: val,
      updated_at: nowGMT8(),
    }, "key");
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

            <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={userComboOpen} className="w-full justify-between font-normal">
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
                        <CommandItem key={s.system_id} value={`${s.user_name} ${s.system_id}`} onSelect={() => addUserFlag(s)}>
                          <span className="font-medium">{s.user_name}</span>
                          <span className="ml-2 text-xs text-muted-foreground font-mono">{s.system_id}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

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
                    <button onClick={() => removeUserFlag(flag)} className="ml-1 hover:text-destructive transition-colors">
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

            <Popover open={templateComboOpen} onOpenChange={setTemplateComboOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={templateComboOpen} className="w-full justify-between font-normal">
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
                        <CommandItem value="Free Text" onSelect={() => toggleFreeTextFlag(true)}>
                          <span className="font-medium">Free Text</span>
                          <span className="ml-2 text-xs text-muted-foreground">(custom descriptions)</span>
                        </CommandItem>
                      )}
                      {unflaggedTemplates.map((t) => (
                        <CommandItem key={t.id} value={t.name} onSelect={() => toggleTemplateFlag(t, true)}>
                          {t.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

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
                    <button onClick={() => toggleFreeTextFlag(false)} className="ml-1 hover:text-destructive transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                )}
                {flaggedTemplates.map((t) => (
                  <Badge key={t.id} variant="secondary" className="gap-1.5 py-1.5 px-3 text-sm">
                    <ShieldCheck className="w-3 h-3 text-destructive" />
                    {t.name}
                    <button onClick={() => toggleTemplateFlag(t, false)} className="ml-1 hover:text-destructive transition-colors">
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
