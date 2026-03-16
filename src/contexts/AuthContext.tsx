import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const LOGIN_URL = "https://ckrglmxxsrctofupqrgl.supabase.co/functions/v1/login-user";
const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcmdsbXh4c3JjdG9mdXBxcmdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODQxMzgsImV4cCI6MjA4ODM2MDEzOH0.ArvthPlj5wq4LdNnJWA9t85DQr_BELyzPCGVcXBP5TQ";

export interface AuthUser {
  firstName: string;
  lastName: string;
  role: string;
  country: string;
  firstDay: string;
  expiryDate: string;
}

interface LoginResponse {
  requires_2fa?: boolean;
  challenge_token?: string;
  error?: string;
  message?: string;
  success?: boolean;
  environment?: string;
  system_id?: string;
  user?: {
    first_name: string;
    last_name: string;
    role: string;
    country: string;
    first_day: string;
    expiry_date: string;
  };
}

interface AuthContextType {
  user: AuthUser | null;
  environment: string | null;
  systemId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, apiKey: string) => Promise<{ requires2FA: boolean; challengeToken?: string }>;
  verify2FA: (code: string, challengeToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

async function postLogin(body: Record<string, unknown>): Promise<LoginResponse> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": API_KEY,
    },
    body: JSON.stringify(body),
  });

  const data: LoginResponse = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.message || data.error || "Request failed");
  }

  return data;
}

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

  const login = useCallback(async (email: string, password: string, apiKey: string) => {
    const data = await postLogin({ email, password, api_key: apiKey });

    if (data.requires_2fa) {
      return { requires2FA: true, challengeToken: data.challenge_token };
    }

    // If no 2FA required, the API should have returned an error (2FA_NOT_CONFIGURED)
    // but just in case:
    throw new Error("Two-factor authentication is required but was not triggered.");
  }, []);

  const verify2FA = useCallback(async (code: string, challengeToken: string) => {
    const data = await postLogin({
      action: "verify-2fa",
      challenge_token: challengeToken,
      totp_code: code,
    });

    if (!data.success || !data.user) {
      throw new Error("Verification failed");
    }

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
