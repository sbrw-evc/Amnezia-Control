import { create } from "zustand";
import { api } from "@/lib/api";
import { live } from "@/lib/live";
import type { PanelUser, Role } from "@/lib/types";

const ORDER: Role[] = ["viewer", "operator", "admin"];
const SIGNED_OUT = "nc_signed_out";

/** Set on sign-out, so that the sign-in page does not go straight back to SPA after SPA's sign-out returns here. */
export function wasSignedOut(): boolean {
  try {
    return sessionStorage.getItem(SIGNED_OUT) === "1";
  } catch {
    return false;
  }
}

export function clearSignedOut() {
  try {
    sessionStorage.removeItem(SIGNED_OUT);
  } catch {
    /* storage is off */
  }
}

function markSignedOut() {
  try {
    sessionStorage.setItem(SIGNED_OUT, "1");
  } catch {
    /* storage is off */
  }
}

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
    const r = await api.auth.logout().catch(() => null);
    live.disconnect();
    markSignedOut();
    set({ user: null });
    // Ends the SPA session too; SPA returns to the address of the application.
    if (r?.redirect) window.location.assign(r.redirect);
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
