import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuthUser {
  firstName: string;
  lastName: string;
  role: string;
  country: string;
  firstDay: string;
  expiryDate: string;
}

// Change this value to switch between "production" and "sandbox"
const AUTH_ENVIRONMENT = "sandbox";

interface AuthContextType {
  user: AuthUser | null;
  environment: string | null;
  systemId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<{ requires2FA: boolean; challengeToken?: string }>;
  verify2FA: (code: string, challengeToken: string) => Promise<void>;
  logout: () => void;
}

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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem("auth_user");
    const storedEnv = localStorage.getItem("auth_environment");
    const storedSysId = localStorage.getItem("auth_system_id");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setEnvironment(storedEnv);
        setSystemId(storedSysId);
      } catch {
        localStorage.removeItem("auth_user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.functions.invoke("login-proxy", {
      body: { email, password, environment: AUTH_ENVIRONMENT },
    });

    // Extract a clean error message from either the SDK error or the response body
    if (error) {
      // The SDK wraps the response body in the error message, try to parse the actual error
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

    setUser(authUser);
    setEnvironment(data.environment || null);
    setSystemId(data.system_id || null);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
    localStorage.setItem("auth_environment", data.environment || "");
    localStorage.setItem("auth_system_id", data.system_id || "");
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setEnvironment(null);
    setSystemId(null);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_environment");
    localStorage.removeItem("auth_system_id");
  }, []);

  return (
    <AuthContext.Provider value={{ user, environment, systemId, isAuthenticated: !!user, isLoading, login, verify2FA, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
