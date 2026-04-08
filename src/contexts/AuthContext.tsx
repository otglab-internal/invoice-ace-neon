import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { neonQuery } from "@/lib/neon-client";
import { normalizeRole, getPermissions, type AppRole, type StaffTag, type Permissions } from "@/lib/permissions";
import { getOrgId } from "@/lib/runtime-config";

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

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [systemId, setSystemId] = useState<string | null>(null);
  const [tags, setTags] = useState<StaffTag[]>([]);
  const [centreLocations, setCentreLocations] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setEnvironment(storedEnv);
        setSystemId(storedSysId);
        const tagLookupId = storedUserId || storedSysId;
        if (tagLookupId) fetchTags(tagLookupId);
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
      // The edge function may return error details in data even on failure
      const bodyError = data?.error || data?.message || error?.message;
      throw new Error(bodyError || "Login failed. Please try again.");
    }
    if (data?.error) throw new Error(data.message || data.error);

    if (data.requires_2fa) {
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
      const bodyError = data?.error || data?.message || error?.message;
      throw new Error(bodyError || "Verification failed. Please try again.");
    }
    if (data?.error) throw new Error(data.message || data.error);
    if (!data.success || !data.user) throw new Error("Verification failed");

    const authUser: AuthUser = {
      firstName: data.user.first_name,
      lastName: data.user.last_name,
      role: data.user.role,
      country: data.user.country,
      firstDay: data.user.first_day,
      expiryDate: data.user.expiry_date,
    };

    const userId = data.user.id || data.system_id || null;
    const sysId = data.system_id || userId;

    setUser(authUser);
    setEnvironment(data.environment || null);
    setSystemId(sysId);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
    localStorage.setItem("auth_environment", data.environment || "");
    localStorage.setItem("auth_system_id", sysId || "");
    localStorage.setItem("auth_user_id", userId || "");
    if (data.token) {
      localStorage.setItem("auth_token", data.token);
    }

    if (userId) await fetchTags(userId);
  }, [fetchTags]);

  const logout = useCallback(() => {
    setUser(null);
    setEnvironment(null);
    setSystemId(null);
    setTags([]);
    setCentreLocations([]);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_environment");
    localStorage.removeItem("auth_system_id");
    localStorage.removeItem("auth_user_id");
    localStorage.removeItem("auth_token");
  }, []);

  const role = normalizeRole(user?.role);
  const permissions = user ? getPermissions(role, tags) : defaultPermissions;
  const isAdmin = permissions.isSystemAdmin;

  return (
    <AuthContext.Provider value={{ user, environment, systemId, isAuthenticated: !!user, isLoading, role, tags, centreLocations, permissions, isAdmin, login, verify2FA, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
