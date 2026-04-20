import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { neonQuery } from "@/lib/neon-client";
import { normalizeRole, getPermissions, type AppRole, type StaffTag, type Permissions } from "@/lib/permissions";
import { getOrgId } from "@/lib/runtime-config";
import { parseEdgeError } from "@/lib/edge-error";

export interface AuthUser {
  firstName: string;
  lastName: string;
  role: string;
  country: string;
  firstDay: string;
  expiryDate: string;
}

interface AuthContextType {
  user: AuthUser | null;
  environment: string | null;
  systemId: string | null;
  userEmail: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: AppRole;
  tags: StaffTag[];
  centreLocations: string[];
  permissions: Permissions;
  isAdmin: boolean;
  login: (email: string, password: string, environment: string) => Promise<{ requires2FA: boolean; challengeToken?: string }>;
  verify2FA: (code: string, challengeToken: string) => Promise<void>;
  logout: () => void;
}

const defaultPermissions = getPermissions("sales", []);

const AuthContext = createContext<AuthContextType | null>(null);

const normalizeAuthEmail = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (lower === "undefined" || lower === "null") return null;

  return normalized;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [systemId, setSystemId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tags, setTags] = useState<StaffTag[]>([]);
  const [centreLocations, setCentreLocations] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingEnvironment, setPendingEnvironment] = useState<string | null>(null);

  const fetchTags = useCallback(async (sysId: string, _env?: string) => {
    const { data } = await neonQuery("staff_centre_assignments", {
      select: "tags, centre_locations",
      filters: { system_id: sysId },
      limit: 1,
    });

    const rows = data as any[];
    if (rows && rows.length > 0) {
      const row = rows[0];
      const rawTags: string[] = row.tags || [];
      setTags(rawTags.filter((t: string) => t === "requester" || t === "approver") as StaffTag[]);
      setCentreLocations(row.centre_locations || []);
    } else {
      setTags([]);
      setCentreLocations([]);
    }
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem("auth_user");
    const storedEnv = localStorage.getItem("auth_environment");
    const storedSysId = localStorage.getItem("auth_system_id");
    const storedUserId = localStorage.getItem("auth_user_id");
    const storedEmail = normalizeAuthEmail(localStorage.getItem("auth_email"));
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setEnvironment(storedEnv);
        // CANONICAL: always prefer auth_user_id over auth_system_id.
        // Older sessions may have stored a divergent value in auth_system_id;
        // realign both to the user_id so downstream queries are consistent.
        const canonicalId = storedUserId || storedSysId;
        setSystemId(canonicalId);
        if (canonicalId && canonicalId !== storedSysId) {
          localStorage.setItem("auth_system_id", canonicalId);
        }
        setUserEmail(storedEmail);
        if (storedEmail) {
          localStorage.setItem("auth_email", storedEmail);
        } else {
          localStorage.removeItem("auth_email");
        }
        if (canonicalId) fetchTags(canonicalId);
      } catch {
        localStorage.removeItem("auth_user");
      }
    }
    setIsLoading(false);
  }, [fetchTags]);

  const login = useCallback(async (email: string, password: string, env: string) => {
    const orgId = getOrgId();

    const { data, error } = await supabase.functions.invoke("login-proxy", {
      body: { email, password, environment: env, org_id: orgId },
    });

    if (error) {
      const msg = await parseEdgeError(error, data, "Login failed. Please try again.");
      throw new Error(msg);
    }
    if (data?.error) {
      const msg = await parseEdgeError(null, data, "Login failed. Please try again.");
      throw new Error(msg);
    }

    if (data.requires_2fa) {
      setPendingEmail(email);
      setPendingEnvironment(env);
      return { requires2FA: true, challengeToken: data.challenge_token };
    }

    throw new Error("Two-factor authentication is not enabled for this account.");
  }, []);

  const verify2FA = useCallback(async (code: string, challengeToken: string) => {
    const orgId = getOrgId();

    const { data, error } = await supabase.functions.invoke("login-proxy", {
      body: { action: "verify-2fa", challenge_token: challengeToken, totp_code: code, org_id: orgId },
    });

    if (error) {
      const msg = await parseEdgeError(error, data, "Verification failed. Please try again.");
      throw new Error(msg);
    }
    if (data?.error) {
      const msg = await parseEdgeError(null, data, "Verification failed. Please try again.");
      throw new Error(msg);
    }
    if (!data.success || !data.user) throw new Error("Verification failed");

    const authUser: AuthUser = {
      firstName: data.user.first_name,
      lastName: data.user.last_name,
      role: data.user.role,
      country: data.user.country,
      firstDay: data.user.first_day,
      expiryDate: data.user.expiry_date,
    };

    // CANONICAL IDENTITY: always use `data.user.id` (the external users.id).
    // It is the same key returned by get-users-proxy and stored in
    // staff_centre_assignments.system_id, so all downstream references
    // (invoice.submitted_by_system_id, approved_by, amendment_requested_by,
    //  invoice_logs.performed_by, activity_logs.performed_by) line up.
    const userId = data.user.id || data.system_id || null;
    const sysId = userId;
    const resolvedEmail = normalizeAuthEmail(data.user.email) ?? normalizeAuthEmail(pendingEmail);

    const resolvedEnv = pendingEnvironment || data.environment || "production";

    setUser(authUser);
    setEnvironment(resolvedEnv);
    setSystemId(sysId);
    setUserEmail(resolvedEmail);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
    localStorage.setItem("auth_environment", resolvedEnv);
    localStorage.setItem("auth_system_id", sysId || "");
    localStorage.setItem("auth_user_id", userId || "");
    if (resolvedEmail) {
      localStorage.setItem("auth_email", resolvedEmail);
    } else {
      localStorage.removeItem("auth_email");
    }
    setPendingEmail(null);
    setPendingEnvironment(null);
    if (data.token) {
      localStorage.setItem("auth_token", data.token);
    }

    if (userId) await fetchTags(userId);
  }, [fetchTags, pendingEmail]);

  const logout = useCallback(() => {
    setUser(null);
    setEnvironment(null);
    setSystemId(null);
    setUserEmail(null);
    setTags([]);
    setCentreLocations([]);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_environment");
    localStorage.removeItem("auth_system_id");
    localStorage.removeItem("auth_user_id");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_email");
  }, []);

  const role = normalizeRole(user?.role);
  const permissions = user ? getPermissions(role, tags) : defaultPermissions;
  const isAdmin = permissions.isSystemAdmin;

  return (
    <AuthContext.Provider value={{ user, environment, systemId, userEmail, isAuthenticated: !!user, isLoading, role, tags, centreLocations, permissions, isAdmin, login, verify2FA, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
