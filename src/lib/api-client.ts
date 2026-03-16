const API_BASE = "";

const getEnvironment = (): string => {
  return import.meta.env.MODE === "production" ? "production" : "development";
};

export const apiClient = {
  async post<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`${API_BASE}/api/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Environment": getEnvironment(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }));
      throw new Error(error.message || "Request failed");
    }

    return response.json();
  },
};
