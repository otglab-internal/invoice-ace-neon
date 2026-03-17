import React, { useEffect, useState } from "react";
import AppSidebar from "@/components/AppSidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2, Globe, Image } from "lucide-react";
import { nowGMT8 } from "@/lib/utils";

interface ConfigEntry {
  key: string;
  value: string;
}

const CONFIG_KEYS = [
  { key: "connection_string_production", label: "Production Connection String", icon: Globe, description: "Database connection string for the production environment" },
  { key: "connection_string_sandbox", label: "Sandbox Connection String", icon: Globe, description: "Database connection string for the sandbox environment" },
  { key: "logo_url", label: "Logo URL", icon: Image, description: "URL for the application logo displayed across all pages" },
];

const GlobalConfigPage: React.FC = () => {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      const { data, error } = await supabase
        .from("global_config")
        .select("key, value");
      if (error) {
        toast({ title: "Error loading config", description: error.message, variant: "destructive" });
      } else {
        const map: Record<string, string> = {};
        (data as ConfigEntry[]).forEach((r) => (map[r.key] = r.value));
        setConfig(map);
      }
      setLoading(false);
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const { key } of CONFIG_KEYS) {
        const { error } = await supabase
          .from("global_config")
          .update({ value: config[key] ?? "", updated_at: nowGMT8() })
          .eq("key", key);
        if (error) throw error;
      }
      toast({ title: "Configuration saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 ml-60 p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Global Configuration</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage connection strings and branding across environments.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {CONFIG_KEYS.map(({ key, label, icon: Icon, description }) => (
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
                      type={key.startsWith("connection_string") ? "password" : "text"}
                      placeholder={key === "logo_url" ? "https://example.com/logo.png" : "postgresql://..."}
                      value={config[key] ?? ""}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                    {key === "logo_url" && config[key] && (
                      <div className="mt-3 p-3 border border-border rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                        <img src={config[key]} alt="Logo preview" className="max-h-12 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

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
