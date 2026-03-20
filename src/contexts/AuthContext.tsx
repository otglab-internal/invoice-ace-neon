import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeRole, getPermissions, type AppRole, type StaffTag, type Permissions } from "@/lib/permissions";

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
  /** Normalized role */
  role: AppRole;
  /** Tags assigned to this user (requester / approver) */
  tags: StaffTag[];
  /** Centre location from staff_centre_assignments */
  centreLocation: string | null;
  /** Computed permissions for the current role + tags */
  permissions: Permissions;
  /** Legacy convenience — true for admin */
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
  const [centreLocation, setCentreLocation] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch tags from staff_centre_assignments when systemId changes
  const fetchTags = useCallback(async (sysId: string) => {
    const { data } = await supabase
      .from("staff_centre_assignments")
      .select("tags, centre_location")
      .eq("system_id", sysId)
      .limit(1);

    if (data && data.length > 0) {
      const row = data[0] as any;
      const rawTags: string[] = row.tags || [];
      setTags(rawTags.filter((t: string) => t === "requester" || t === "approver") as StaffTag[]);
      setCentreLocation(row.centre_location || null);
    } else {
      setTags([]);
      setCentreLocation(null);
    }
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem("auth_user");
    const storedEnv = localStorage.getItem("auth_environment");
    const storedSysId = localStorage.getItem("auth_system_id");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setEnvironment(storedEnv);
        setSystemId(storedSysId);
        if (storedSysId) fetchTags(storedSysId);
      } catch {
        localStorage.removeItem("auth_user");
      }
    }
    setIsLoading(false);
  }, [fetchTags]);

  const login = useCallback(async (email: string, password: string, env: string) => {
    const { data, error } = await supabase.functions.invoke("login-proxy", {
      body: { email, password, environment: env },
    });

    if (error) {
      const bodyError = data?.error || data?.message;
      if (bodyError) throw new Error(bodyError);
      throw new Error("Login failed");
    }
    if (data?.error) throw new Error(data.message || data.error);

    if (data.requires_2fa) {
      return { requires2FA: true, challengeToken: data.challenge_token };
    }

    throw new Error("Two-factor authentication is not enabled for this account.");
  }, []);

  const verify2FA = useCallback(async (code: string, challengeToken: string) => {
    const { data, error } = await supabase.functions.invoke("login-proxy", {
      body: { action: "verify-2fa", challenge_token: challengeToken, totp_code: code },
    });

    if (error) {
      const bodyError = data?.error || data?.message;
      if (bodyError) throw new Error(bodyError);
      throw new Error("Verification failed");
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

    // Use the user's own ID for tag lookups (not system_id which may be a system_access entry)
    const userId = data.user.id || data.system_id || null;
    const sysId = data.system_id || userId;

    setUser(authUser);
    setEnvironment(data.environment || null);
    setSystemId(sysId);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
    localStorage.setItem("auth_environment", data.environment || "");
    localStorage.setItem("auth_system_id", sysId || "");
    // Store user ID separately for tag lookups
    localStorage.setItem("auth_user_id", userId || "");

    if (userId) await fetchTags(userId);
  }, [fetchTags]);

  const logout = useCallback(() => {
    setUser(null);
    setEnvironment(null);
    setSystemId(null);
    setTags([]);
    setCentreLocation(null);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_environment");
    localStorage.removeItem("auth_system_id");
  }, []);

  const role = normalizeRole(user?.role);
  const permissions = user ? getPermissions(role, tags) : defaultPermissions;
  const isAdmin = permissions.isSystemAdmin;

  return (
    <AuthContext.Provider value={{ user, environment, systemId, isAuthenticated: !!user, isLoading, role, tags, centreLocation, permissions, isAdmin, login, verify2FA, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
