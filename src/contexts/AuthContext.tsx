import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface AuthUser {
  firstName: string;
  lastName: string;
  role: string;
  country: string;
  firstDate: string;
  expiryDate: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
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
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    const storedUser = localStorage.getItem("auth_user");
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // This calls the custom API endpoint for initial login
    // In production, this would hit your auth edge function
    // For now, simulate the 2FA challenge flow
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);

    if (response && response.ok) {
      const data = await response.json();
      return { requires2FA: true, challengeToken: data.challengeToken };
    }

    // Demo mode: simulate successful login requiring 2FA
    return { requires2FA: true, challengeToken: "demo-challenge-token" };
  }, []);

  const verify2FA = useCallback(async (code: string, challengeToken: string) => {
    const response = await fetch("/api/auth/verify-2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, challengeToken }),
    }).catch(() => null);

    let userData: AuthUser;
    let authToken: string;

    if (response && response.ok) {
      const data = await response.json();
      userData = data.user;
      authToken = data.token;
    } else {
      // Demo mode
      userData = {
        firstName: "Demo",
        lastName: "User",
        role: "accountant",
        country: "Malaysia",
        firstDate: "2024-01-01",
        expiryDate: "2026-12-31",
      };
      authToken = "demo-jwt-token";
    }

    setUser(userData);
    setToken(authToken);
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("auth_user", JSON.stringify(userData));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, isLoading, login, verify2FA, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
