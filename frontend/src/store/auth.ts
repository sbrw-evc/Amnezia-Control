import { create } from "zustand";
import { api } from "@/lib/api";
import { live } from "@/lib/live";
import type { PanelUser, Role } from "@/lib/types";

const ORDER: Role[] = ["viewer", "operator", "admin"];

interface AuthState {
  user: PanelUser | null;
  ready: boolean;
  bootstrap: () => Promise<void>;
  setUser: (u: PanelUser | null) => void;
  logout: () => Promise<void>;
  can: (role: Role) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  bootstrap: async () => {
    try {
      const user = await api.auth.me();
      set({ user, ready: true });
      live.connect();
    } catch {
      set({ user: null, ready: true });
    }
  },
  setUser: (user) => {
    set({ user });
    if (user) live.connect();
    else live.disconnect();
  },
  logout: async () => {
    await api.auth.logout().catch(() => undefined);
    live.disconnect();
    set({ user: null });
  },
  can: (role) => {
    const u = get().user;
    return !!u && ORDER.indexOf(u.role) >= ORDER.indexOf(role);
  },
}));

api.http.onUnauthorized = () => {
  live.disconnect();
  useAuth.setState({ user: null });
};
