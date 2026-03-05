import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface AuthState {
  token: string | null;
  username: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  authDisabled: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "aero_auth_token";
const USERNAME_KEY = "aero_auth_username";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem(USERNAME_KEY));
  const [loading, setLoading] = useState(true);
  const [authDisabled, setAuthDisabled] = useState(false);

  const apiBase = import.meta.env.VITE_API_BASE || "";

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    setToken(null);
    setUsername(null);
  }, []);

  // On mount: check if auth is enabled, then validate existing token
  useEffect(() => {
    const init = async () => {
      try {
        // Probe the auth endpoint to see if auth is configured.
        // If auth routes aren't registered, the request falls through to
        // the default handler which returns 200 with text/plain.
        // When auth IS configured, /api/auth/me returns 401 (no token) or 200 (valid token).
        const probe = await fetch(`${apiBase}/api/auth/me`);

        // A 401 means auth is enabled (endpoint exists, just no token).
        // A 200 with non-JSON means auth routes aren't registered (fallback handler).
        const contentType = probe.headers.get("content-type") || "";
        if (probe.status !== 401 && !contentType.includes("application/json")) {
          setAuthDisabled(true);
          setLoading(false);
          return;
        }

        // Auth is enabled — validate existing token if we have one
        const storedToken = localStorage.getItem(TOKEN_KEY);
        if (!storedToken) {
          setLoading(false);
          return;
        }

        const res = await fetch(`${apiBase}/api/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (!res.ok) throw new Error("invalid token");
        const data: { username: string } = await res.json();
        setToken(storedToken);
        setUsername(data.username);
        localStorage.setItem(USERNAME_KEY, data.username);
      } catch {
        logout();
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [apiBase, logout]);

  const login = useCallback(
    async (user: string, pass: string) => {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Login failed" }));
        throw new Error(data.error || "Login failed");
      }

      const data: { token: string; username: string } = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USERNAME_KEY, data.username);
      setToken(data.token);
      setUsername(data.username);
    },
    [apiBase],
  );

  return (
    <AuthContext.Provider
      value={{
        token,
        username,
        isAuthenticated: authDisabled || !!token,
        loading,
        authDisabled,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
