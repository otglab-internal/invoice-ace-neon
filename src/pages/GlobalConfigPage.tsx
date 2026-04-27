import React, { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2, Image, Star, Mail, Server, Link, Unlink, ExternalLink, Trash2, Info, Send, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { nowGMT8 } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { neonQuery, neonUpsert, neonDelete } from "@/lib/neon-client";
import { invalidateBrandingCache } from "@/hooks/use-branding";
import { getOrgId } from "@/lib/runtime-config";
import { logActivity } from "@/lib/activity-logger";

function getXeroHeaders(): Record<string, string> {
  return {
    "x-org-id": getOrgId(),
    "x-environment": localStorage.getItem("auth_environment") || "production",
  };
}

interface ConfigEntry {
  key: string;
  value: string;
}

const BRANDING_KEYS = [
  { key: "logo_url", label: "Logo URL", icon: Image, description: "URL for the application logo displayed across all pages", placeholder: "https://example.com/logo.png" },
  { key: "favicon_url", label: "Favicon URL", icon: Star, description: "URL for the browser tab icon (favicon)", placeholder: "https://example.com/favicon.ico" },
];

const COMPANY_KEYS = [
  { key: "company_name", label: "Company Name", description: "Legal company name shown on payment receipts", placeholder: "Acme Sdn Bhd" },
  { key: "company_ssm", label: "SSM / UEN Number", description: "Company registration number (SSM for Malaysia, UEN for Singapore)", placeholder: "202301234567 (1234567-A)" },
  { key: "company_address", label: "Company Address", description: "Registered company address shown on payment receipts", placeholder: "123 Business St, City, Postcode, Country", multiline: true },
];

const SMTP_KEYS = [
  { key: "smtp_host", label: "SMTP Host", placeholder: "smtp.gmail.com" },
  { key: "smtp_port", label: "SMTP Port", placeholder: "587" },
  { key: "smtp_user", label: "SMTP Username", placeholder: "user@example.com" },
  { key: "smtp_pass", label: "SMTP Password", placeholder: "••••••••", type: "password" },
  { key: "smtp_from_email", label: "From Email", placeholder: "noreply@example.com" },
  { key: "smtp_from_name", label: "From Name", placeholder: "Invoice Center" },
];

const XERO_KEYS = [
  { key: "xero_client_id", label: "Client ID", placeholder: "Your Xero OAuth2 Client ID" },
  { key: "xero_client_secret", label: "Client Secret", placeholder: "Your Xero OAuth2 Client Secret", type: "password" },
];

const GlobalConfigPage: React.FC = () => {
  const { isAdmin, user, systemId } = useAuth();
  const performerName = user ? `${user.firstName} ${user.lastName}` : "";
  const performerId = systemId || "";
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [xeroStatus, setXeroStatus] = useState<{ connected: boolean; hasCredentials: boolean }>({ connected: false, hasCredentials: false });
  const [xeroConnecting, setXeroConnecting] = useState(false);
  const [xeroDisconnecting, setXeroDisconnecting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testEmailError, setTestEmailError] = useState<string | null>(null);
  const [allXeroAccounts, setAllXeroAccounts] = useState<{ code: string; name: string; type: string }[]>([]);
  const [visibleAccountCodes, setVisibleAccountCodes] = useState<string[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const handleSendTestEmail = async () => {
    if (!testEmailTo.trim() || !testEmailTo.includes("@")) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    setSendingTestEmail(true);
    setTestEmailError(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-test-email", {
        body: { to: testEmailTo.trim() },
        headers: getXeroHeaders(),
      });
      if (error) {
        const errMsg = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error);
        setTestEmailError(errMsg);
        toast({ title: "Failed to send test email", description: errMsg, variant: "destructive" });
      } else if (data?.error) {
        const errMsg = [data.error, data.details, data.code, data.stack].filter(Boolean).join("\n\n");
        setTestEmailError(errMsg);
        toast({ title: "Failed to send test email", description: data.error, variant: "destructive" });
      } else {
        await logActivity("test_email_sent", "email", performerId, performerName, { to: testEmailTo });
        toast({ title: "Test email sent!", description: `Sent to ${testEmailTo}` });
        setTestEmailError(null);
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      setTestEmailError(errMsg);
      toast({ title: "Failed to send test email", description: errMsg, variant: "destructive" });
    }
    setSendingTestEmail(false);
  };
  useEffect(() => {
    const fetchConfig = async () => {
      const { data, error } = await neonQuery("global_config", { select: "key,value" });
      if (error) {
        toast({ title: "Error loading config", description: error.message, variant: "destructive" });
      } else {
        const map: Record<string, string> = {};
        ((data as ConfigEntry[]) || []).forEach((r) => (map[r.key] = r.value));
        setConfig(map);
        // Parse visible accounts from config
        try {
          const parsed = JSON.parse(map["xero_visible_accounts"] || "[]");
          if (Array.isArray(parsed)) setVisibleAccountCodes(parsed);
        } catch { /* ignore */ }
      }
      setLoading(false);
    };
    fetchConfig();
    checkXeroStatus();
  }, []);

  const fetchXeroAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const { data } = await supabase.functions.invoke("xero", {
        body: { action: "accounts" },
        headers: getXeroHeaders(),
      });
      if (data?.accounts) setAllXeroAccounts(data.accounts);
    } catch (err) {
      console.warn("Failed to fetch Xero accounts:", err);
    }
    setLoadingAccounts(false);
  };

  useEffect(() => {
    if (xeroStatus.connected) fetchXeroAccounts();
  }, [xeroStatus.connected]);

  const checkXeroStatus = async () => {
    try {
      const { data } = await supabase.functions.invoke("xero", {
        body: { action: "status" },
        headers: getXeroHeaders(),
      });
      if (data) {
        setXeroStatus({ connected: data.connected, hasCredentials: data.hasCredentials });
      }
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allKeys = [
        ...BRANDING_KEYS.map((k) => k.key),
        ...COMPANY_KEYS.map((k) => k.key),
        ...SMTP_KEYS.map((k) => k.key),
        ...XERO_KEYS.map((k) => k.key),
        "sandbox_test_email",
        "xero_visible_accounts",
      ];

      const configToSave = { ...config, xero_visible_accounts: JSON.stringify(visibleAccountCodes) };

      for (const key of allKeys) {
        const value = configToSave[key] ?? "";
        await neonUpsert("global_config", { key, value, updated_at: nowGMT8() }, "key");
      }

      invalidateBrandingCache({
        logoUrl: config["logo_url"]?.trim() || null,
        faviconUrl: config["favicon_url"]?.trim() || null,
        companyName: config["company_name"]?.trim() || null,
        companySsm: config["company_ssm"]?.trim() || null,
        companyAddress: config["company_address"]?.trim() || null,
      });
      await logActivity("config_saved", "config", performerId, performerName, { keys: allKeys });
      toast({ title: "Configuration saved" });
      await checkXeroStatus();
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleXeroConnect = async () => {
    setXeroConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/global-config`;
      const { data, error } = await supabase.functions.invoke("xero", {
        body: { action: "get-auth-url", redirectUri },
        headers: getXeroHeaders(),
      });
      if (error || data?.error) {
        toast({ title: "Failed to start Xero OAuth", description: data?.error || "Please save Xero Client ID & Secret first", variant: "destructive" });
      } else if (data?.url) {
        window.location.href = data.url;
      }
    } catch {
      toast({ title: "Failed to connect Xero", variant: "destructive" });
    }
    setXeroConnecting(false);
  };

  const handleXeroDisconnect = async () => {
    setXeroDisconnecting(true);
    try {
      await supabase.functions.invoke("xero", {
        body: { action: "disconnect" },
        headers: getXeroHeaders(),
      });
      setXeroStatus({ connected: false, hasCredentials: xeroStatus.hasCredentials });
      await logActivity("xero_disconnected", "config", performerId, performerName);
      toast({ title: "Xero disconnected" });
    } catch {
      toast({ title: "Failed to disconnect Xero", variant: "destructive" });
    }
    setXeroDisconnecting(false);
  };

  const handleClearData = async () => {
    setClearing(true);
    try {
      const tables = ["invoice_logs", "invoices", "user_approval_flags"];
      for (const table of tables) {
        const { error } = await neonDelete(table, {});
        if (error) throw new Error(`Failed to clear ${table}: ${error.message}`);
      }
      await logActivity("data_cleared", "system", performerId, performerName, { tables: ["invoice_logs", "invoices", "user_approval_flags"] });
      toast({ title: "All data cleared", description: "Invoices, logs, and approval flags have been deleted." });
    } catch (err: any) {
      toast({ title: "Failed to clear data", description: err.message, variant: "destructive" });
    }
    setClearing(false);
  };

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const exchangeCode = async () => {
        const redirectUri = `${window.location.origin}/global-config`;
        const { data } = await supabase.functions.invoke("xero", {
          body: { action: "callback", code, redirectUri },
          headers: getXeroHeaders(),
        });
        if (data?.success) {
          toast({ title: "Xero connected successfully", description: `Tenant: ${data.tenant}` });
          setXeroStatus({ connected: true, hasCredentials: true });
          logActivity("xero_connected", "config", performerId, performerName, { tenant: data.tenant });
        } else {
          toast({ title: "Xero connection failed", description: data?.error, variant: "destructive" });
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      };
      exchangeCode();
    }
  }, []);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Global Configuration</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage branding, SMTP, Xero, and environment settings.</p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                <CardTitle className="text-base">Environment Info</CardTitle>
              </div>
              <CardDescription className="text-xs">Current session details and runtime configuration.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-28">Environment:</span>
                <Badge variant={localStorage.getItem("auth_environment") === "sandbox" ? "outline" : "default"}>
                  {localStorage.getItem("auth_environment") || "production"}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-28">Organization:</span>
                <Badge variant="secondary" className="font-mono">
                  {(() => { try { return getOrgId(); } catch { return "Not configured"; } })()}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-28">Config source:</span>
                <code className="text-xs bg-muted px-2 py-1 rounded">
                  {JSON.stringify((window as any).__APP_CONFIG__ || null)}
                </code>
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Branding</h2>
              {BRANDING_KEYS.map(({ key, label, icon: Icon, description, placeholder }) => (
                <Card key={key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-primary" />
                      <CardTitle className="text-base">{label}</CardTitle>
                    </div>
                    <CardDescription className="text-xs">{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Label htmlFor={key} className="sr-only">{label}</Label>
                    <Input
                      id={key}
                      type="text"
                      placeholder={placeholder}
                      value={config[key] ?? ""}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                    {config[key] && (
                      <div className="mt-3 p-3 border border-border rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                        <img
                          src={config[key]}
                          alt={`${label} preview`}
                          className={key === "favicon_url" ? "w-8 h-8 object-contain" : "max-h-12 object-contain"}
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {isAdmin && (
                <>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-4">Xero Integration</h2>
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-4 h-4 text-primary" />
                        <CardTitle className="text-base">Xero OAuth2</CardTitle>
                      </div>
                      <CardDescription className="text-xs">Connect your Xero account to fetch contacts and push invoices.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {XERO_KEYS.map(({ key, label, placeholder, type }) => (
                        <div key={key}>
                          <Label htmlFor={key} className="text-xs text-muted-foreground">{label}</Label>
                          <Input
                            id={key}
                            type={type || "text"}
                            placeholder={placeholder}
                            value={config[key] ?? ""}
                            onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="mt-1"
                          />
                        </div>
                      ))}
                      <div className="flex items-center gap-3 pt-2">
                        {xeroStatus.connected ? (
                          <>
                            <div className="flex items-center gap-2 text-sm text-green-600">
                              <Link className="w-4 h-4" />
                              <span className="font-medium">Connected to Xero</span>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={handleXeroDisconnect} disabled={xeroDisconnecting}>
                              {xeroDisconnecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlink className="w-3 h-3 mr-1" />}
                              Disconnect
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={handleXeroConnect} disabled={xeroConnecting}>
                              Reconnect
                            </Button>
                          </>
                        ) : (
                          <Button type="button" variant="default" size="sm" onClick={handleXeroConnect} disabled={xeroConnecting}>
                            {xeroConnecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Link className="w-3 h-3 mr-1" />}
                            Connect Xero
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {xeroStatus.connected && (
                    <Card className="mt-4">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <ListChecks className="w-4 h-4 text-primary" />
                          <CardTitle className="text-base">Visible Accounts</CardTitle>
                        </div>
                        <CardDescription className="text-xs">
                          Select which Xero accounts appear in the invoice creation form. If none are selected, all accounts will be shown.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {loadingAccounts ? (
                          <div className="flex items-center gap-2 py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Loading accounts from Xero...</span>
                          </div>
                        ) : allXeroAccounts.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">No accounts found. Make sure Xero is connected.</p>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setVisibleAccountCodes(allXeroAccounts.map((a) => a.code))}>
                                Select All
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => setVisibleAccountCodes([])}>
                                Clear All
                              </Button>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {visibleAccountCodes.length} of {allXeroAccounts.length} selected
                              </span>
                            </div>
                            <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border">
                              {allXeroAccounts.map((a) => (
                                <label key={a.code} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm">
                                  <Checkbox
                                    checked={visibleAccountCodes.includes(a.code)}
                                    onCheckedChange={(checked) => {
                                      setVisibleAccountCodes((prev) =>
                                        checked ? [...prev, a.code] : prev.filter((c) => c !== a.code)
                                      );
                                    }}
                                  />
                                  <span className="font-mono text-xs text-muted-foreground w-12">{a.code}</span>
                                  <span className="flex-1">{a.name}</span>
                                  <Badge variant="outline" className="text-xs">{a.type}</Badge>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-4">SMTP Configuration</h2>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    <CardTitle className="text-base">Email Server (SMTP)</CardTitle>
                  </div>
                  <CardDescription className="text-xs">Configure SMTP settings for sending approval notification emails.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {SMTP_KEYS.map(({ key, label, placeholder, type }) => (
                    <div key={key}>
                      <Label htmlFor={key} className="text-xs text-muted-foreground">{label}</Label>
                      <Input
                        id={key}
                        type={type || "text"}
                        placeholder={placeholder}
                        value={config[key] ?? ""}
                        onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-primary" />
                    <CardTitle className="text-base">Send Test Email</CardTitle>
                  </div>
                  <CardDescription className="text-xs">Send a test email using the SMTP settings above. Save configuration first.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="recipient@example.com"
                      value={testEmailTo}
                      onChange={(e) => setTestEmailTo(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={handleSendTestEmail} disabled={sendingTestEmail} size="sm">
                      {sendingTestEmail ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                      Send
                    </Button>
                  </div>
                  {testEmailError && (
                    <pre className="text-xs text-destructive bg-destructive/10 p-3 rounded-md whitespace-pre-wrap break-all max-h-48 overflow-auto font-mono">
                      {testEmailError}
                    </pre>
                  )}
                </CardContent>
              </Card>

              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-4">Sandbox Settings</h2>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    <CardTitle className="text-base">Sandbox Test Email</CardTitle>
                  </div>
                  <CardDescription className="text-xs">When set, all emails in the Sandbox environment will be redirected to this address instead of the actual approvers.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Label htmlFor="sandbox_test_email" className="sr-only">Sandbox Test Email</Label>
                  <Input
                    id="sandbox_test_email"
                    type="email"
                    placeholder="test@example.com"
                    value={config["sandbox_test_email"] ?? ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, sandbox_test_email: e.target.value }))}
                  />
                </CardContent>
              </Card>

              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Configuration
              </Button>

              {isAdmin && (
                <>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-4">Danger Zone</h2>
                  <Card className="border-destructive/50">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <Trash2 className="w-4 h-4 text-destructive" />
                        <CardTitle className="text-base">Clear All Data</CardTitle>
                      </div>
                      <CardDescription className="text-xs">
                        Permanently delete all invoices, invoice logs, and approval flags for the current environment. Templates, staff assignments, and configuration settings will be preserved.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" disabled={clearing}>
                            {clearing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                            Clear All Data
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete <strong>all invoices, logs, and approval flags</strong> for the current environment. Templates and staff assignments will be preserved. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleClearData}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Yes, delete everything
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
      </div>
    </AppLayout>
  );
};

export default GlobalConfigPage;
