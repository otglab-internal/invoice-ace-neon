import React, { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const SettingsPage: React.FC = () => {
  const [autoMode, setAutoMode] = useState(true);
  const [saving, setSaving] = useState(false);

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

          {/* NeonDB */}
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
