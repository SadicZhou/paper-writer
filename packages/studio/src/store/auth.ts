import { create } from "zustand";

interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  loadFromStorage: () => void;
  startTokenRefresh: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp ?? null;
  } catch { return null; }
}

const STORAGE_KEY = "paper_writer_auth";

function saveToStorage(accessToken: string, refreshToken: string, user: AuthUser) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken, user }));
  } catch { /* localStorage not available */ }
}

function clearStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        accessToken: data.accessToken ?? null,
        refreshToken: data.refreshToken ?? null,
        user: data.user ?? null,
        isAuthenticated: true,
        isLoading: false,
      };
    }
  } catch { /* ignore */ }
  return { accessToken: null, refreshToken: null, user: null, isAuthenticated: false, isLoading: false };
}

const initialAuth = loadFromStorage();

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initialAuth,

  loadFromStorage: () => {
    const data = loadFromStorage();
    set(data);
    if (data.isAuthenticated) get().startTokenRefresh();
  },

  login: async (username: string, password: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Login failed" }));
      throw new Error((err as any).message ?? "Login failed");
    }
    const data = await res.json();
    saveToStorage(data.accessToken, data.refreshToken, data.user);
    set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user,
      isAuthenticated: true,
    });
    get().startTokenRefresh();
  },

  startTokenRefresh: () => {
    clearRefreshTimer();
    const { accessToken } = get();
    if (!accessToken) return;
    const exp = parseJwtExp(accessToken);
    if (!exp) return;
    const expiresInMs = (exp - Math.floor(Date.now() / 1000)) * 1000;
    // Refresh 5 minutes before expiry, or if already close to expiry
    const refreshInMs = Math.max(0, expiresInMs - 5 * 60 * 1000);
    if (refreshInMs <= 0) {
      // Already expired or about to expire — refresh now
      get().refresh();
      return;
    }
    refreshTimer = setTimeout(() => {
      get().refresh().then(() => get().startTokenRefresh()); // schedule next refresh
    }, refreshInMs);
  },

  logout: async () => {
    clearRefreshTimer();
    const { accessToken } = get();
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch { /* ignore network error */ }
    clearStorage();
    set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false });
  },

  refresh: async () => {
    const { refreshToken } = get();
    if (!refreshToken) {
      set({ isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) throw new Error("Refresh failed");
      const data = await res.json();
      saveToStorage(data.accessToken, data.refreshToken, data.user);
      set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
        isAuthenticated: true,
      });
    } catch {
      clearStorage();
      set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));
