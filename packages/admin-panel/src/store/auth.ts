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
  loadFromStorage: () => void;
}

const STORAGE_KEY = "paper_writer_auth";

function saveToStorage(accessToken: string, refreshToken: string, user: AuthUser) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken, user })); } catch { /* */ }
}

function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
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
  } catch { /* */ }
  return { accessToken: null, refreshToken: null, user: null, isAuthenticated: false, isLoading: false };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadFromStorage(),

  loadFromStorage: () => set(loadFromStorage()),

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
  },

  logout: async () => {
    const { accessToken } = get();
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      });
    } catch { /* */ }
    clearStorage();
    set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false });
  },
}));
