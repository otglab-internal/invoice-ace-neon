import React, { useEffect, useState } from "react";
import AppSidebar from "@/components/AppSidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2, Image, Star, Mail, Server, Link, Unlink, ExternalLink, Trash2 } from "lucide-react";
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
import { neonQuery, neonUpsert } from "@/lib/neon-client";
import { invalidateBrandingCache } from "@/hooks/use-branding";
import { getOrgId } from "@/lib/runtime-config";

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
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [xeroStatus, setXeroStatus] = useState<{ connected: boolean; hasCredentials: boolean }>({ connected: false, hasCredentials: false });
  const [xeroConnecting, setXeroConnecting] = useState(false);
  const [xeroDisconnecting, setXeroDisconnecting] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      const { data, error } = await neonQuery("global_config", { select: "key,value" });
      if (error) {
        toast({ title: "Error loading config", description: error.message, variant: "destructive" });
      } else {
        const map: Record<string, string> = {};
        ((data as ConfigEntry[]) || []).forEach((r) => (map[r.key] = r.value));
        setConfig(map);
      }
      setLoading(false);
    };
    fetchConfig();
    checkXeroStatus();
  }, []);

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
        ...SMTP_KEYS.map((k) => k.key),
        ...XERO_KEYS.map((k) => k.key),
        "sandbox_test_email",
      ];

      for (const key of allKeys) {
        const value = config[key] ?? "";
        await neonUpsert("global_config", { key, value, updated_at: nowGMT8() }, "key");
      }

      invalidateBrandingCache({
        logoUrl: config["logo_url"]?.trim() || null,
        faviconUrl: config["favicon_url"]?.trim() || null,
      });
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
      toast({ title: "Xero disconnected" });
    } catch {
      toast({ title: "Failed to disconnect Xero", variant: "destructive" });
    }
    setXeroDisconnecting(false);
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
        } else {
          toast({ title: "Xero connection failed", description: data?.error, variant: "destructive" });
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      };
      exchangeCode();
    }
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 ml-60 p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Global Configuration</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage branding, SMTP, Xero, and environment settings.</p>
          </div>

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
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default GlobalConfigPage;
