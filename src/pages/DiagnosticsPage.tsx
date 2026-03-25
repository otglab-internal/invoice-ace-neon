import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getOrgId } from "@/lib/runtime-config";
import { CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";

interface CheckResult {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}

const DiagnosticsPage: React.FC = () => {
  const [prodCheck, setProdCheck] = useState<CheckResult>({ status: "idle" });
  const [sbCheck, setSbCheck] = useState<CheckResult>({ status: "idle" });

  let orgId: string | null = null;
  let orgIdError: string | null = null;
  try {
    orgId = getOrgId();
  } catch (e: any) {
    orgIdError = e.message;
  }

  const testEnvironment = async (env: string, setter: React.Dispatch<React.SetStateAction<CheckResult>>) => {
    setter({ status: "loading" });
    try {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {
        "X-Environment": env,
        "x-org-id": orgId || "",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const { data, error } = await supabase.functions.invoke("auth", {
        body: { action: "health-check", org_id: orgId },
        headers,
      });
      if (error) {
        setter({ status: "error", message: error.message });
      } else if (data?.error) {
        // Even an "unknown action" error means connectivity works
        setter({ status: "success", message: `Edge function reachable. Response: ${JSON.stringify(data)}` });
      } else {
        setter({ status: "success", message: JSON.stringify(data, null, 2) });
      }
    } catch (e: any) {
      setter({ status: "error", message: e.message });
    }
  };

  const runAll = () => {
    if (!orgId) return;
    testEnvironment("production", setProdCheck);
    testEnvironment("sandbox", setSbCheck);
  };

  const StatusIcon: React.FC<{ status: CheckResult["status"] }> = ({ status }) => {
    if (status === "loading") return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
    if (status === "success") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (status === "error") return <XCircle className="w-5 h-5 text-destructive" />;
    return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />;
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">System Diagnostics</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runtime Config (config.js)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">org_id:</span>
            {orgId ? (
              <Badge variant="secondary" className="font-mono">{orgId}</Badge>
            ) : (
              <Badge variant="destructive">{orgIdError || "Not set"}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">window.__APP_CONFIG__:</span>
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {JSON.stringify((window as any).__APP_CONFIG__ || null)}
            </code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Backend Connectivity</CardTitle>
          <Button size="sm" variant="outline" onClick={runAll} disabled={!orgId}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Test Both
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Production", check: prodCheck },
            { label: "Sandbox", check: sbCheck },
          ].map(({ label, check }) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusIcon status={check.status} />
                <span className="text-sm font-medium">{label}</span>
                {check.status === "success" && <Badge variant="outline" className="text-green-600">Connected</Badge>}
                {check.status === "error" && <Badge variant="destructive">Failed</Badge>}
              </div>
              {check.message && (
                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32 ml-7">
                  {check.message}
                </pre>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        This page is temporary and should be removed before production release.
      </p>
    </div>
  );
};

export default DiagnosticsPage;
