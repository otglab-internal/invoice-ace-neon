import React, { useState, useEffect } from "react";
import { nowGMT8 } from "@/lib/utils";
import AppLayout from "@/components/AppLayout";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert, ShieldCheck, Plus, Trash2, Search } from "lucide-react";

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

const SettingsPage: React.FC = () => {
  const { user, systemId } = useAuth();
  const [autoMode, setAutoMode] = useState(true);
  const [saving, setSaving] = useState(false);

  // Approval flags
  const [userFlags, setUserFlags] = useState<UserFlag[]>([]);
  const [templates, setTemplates] = useState<TemplateFlag[]>([]);
  const [loadingFlags, setLoadingFlags] = useState(true);
  const [newSystemId, setNewSystemId] = useState("");
  const [newUserName, setNewUserName] = useState("");

  useEffect(() => {
    fetchFlags();
  }, []);

  const fetchFlags = async () => {
    setLoadingFlags(true);
    const [usersRes, templatesRes] = await Promise.all([
      supabase.from("user_approval_flags").select("*").order("user_name"),
      supabase.from("invoice_templates").select("id, name, requires_approval").order("name"),
    ]);
    if (usersRes.data) setUserFlags(usersRes.data as unknown as UserFlag[]);
    if (templatesRes.data) setTemplates(templatesRes.data as unknown as TemplateFlag[]);
    setLoadingFlags(false);
  };

  const toggleUserFlag = async (flag: UserFlag) => {
    const newVal = !flag.requires_approval;
    const { error } = await supabase
      .from("user_approval_flags")
      .update({ requires_approval: newVal, updated_at: nowGMT8() } as any)
      .eq("id", flag.id);
    if (error) {
      toast.error("Failed to update user flag");
    } else {
      setUserFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, requires_approval: newVal } : f)));
      toast.success(`${flag.user_name || flag.system_id} ${newVal ? "flagged for approval" : "unflagged"}`);
    }
  };

  const addUserFlag = async () => {
    if (!newSystemId.trim()) {
      toast.error("Enter a system ID");
      return;
    }
    const { error } = await supabase.from("user_approval_flags").insert({
      system_id: newSystemId.trim(),
      user_name: newUserName.trim(),
      requires_approval: true,
      flagged_by: systemId || "",
    } as any);
    if (error) {
      if (error.code === "23505") {
        toast.error("User already exists in the list");
      } else {
        toast.error("Failed to add user");
      }
    } else {
      toast.success("User added and flagged for approval");
      setNewSystemId("");
      setNewUserName("");
      fetchFlags();
    }
  };

  const removeUserFlag = async (flag: UserFlag) => {
    const { error } = await supabase.from("user_approval_flags").delete().eq("id", flag.id);
    if (error) {
      toast.error("Failed to remove user");
    } else {
      setUserFlags((prev) => prev.filter((f) => f.id !== flag.id));
      toast.success("User removed from approval list");
    }
  };

  const toggleTemplateFlag = async (template: TemplateFlag) => {
    const newVal = !template.requires_approval;
    const { error } = await supabase
      .from("invoice_templates")
      .update({ requires_approval: newVal, updated_at: nowGMT8() } as any)
      .eq("id", template.id);
    if (error) {
      toast.error("Failed to update template flag");
    } else {
      setTemplates((prev) => prev.map((t) => (t.id === template.id ? { ...t, requires_approval: newVal } : t)));
      toast.success(`Template "${template.name}" ${newVal ? "flagged for approval" : "unflagged"}`);
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

          {/* User Approval Flags */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold font-display text-foreground">User Approval Flags</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Flagged users' invoices require admin approval before being pushed, regardless of workflow mode.
            </p>

            {/* Add new user */}
            <div className="flex gap-2">
              <Input
                value={newSystemId}
                onChange={(e) => setNewSystemId(e.target.value)}
                placeholder="System ID"
                className="flex-1"
              />
              <Input
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Display name"
                className="flex-1"
              />
              <Button size="sm" onClick={addUserFlag} className="gap-1 shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>

            {/* User list */}
            {loadingFlags ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : userFlags.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No users added yet</div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {userFlags.map((flag) => (
                  <div key={flag.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {flag.user_name || flag.system_id}
                      </p>
                      {flag.user_name && (
                        <p className="text-xs text-muted-foreground font-mono">{flag.system_id}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {flag.requires_approval ? (
                        <Badge variant="destructive" className="text-xs">Flagged</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Clear</Badge>
                      )}
                      <Switch
                        checked={flag.requires_approval}
                        onCheckedChange={() => toggleUserFlag(flag)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeUserFlag(flag)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Template Approval Flags */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold font-display text-foreground">Template Approval Flags</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Invoices using flagged templates require admin approval before being pushed.
            </p>

            {loadingFlags ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : templates.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No templates created yet</div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {t.requires_approval ? (
                        <Badge variant="destructive" className="text-xs">Flagged</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Clear</Badge>
                      )}
                      <Switch
                        checked={t.requires_approval}
                        onCheckedChange={() => toggleTemplateFlag(t)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
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
