"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { RoleKey } from "@/lib/roles";

const KEY = "bee-role";

/**
 * The prototype role switcher is a development preview of screens and menus. It
 * lives only in this browser's localStorage, is never sent to the server and
 * never creates a server session; sign-in is /api/auth/login (WP02.1). It is off
 * in production builds unless NEXT_PUBLIC_BEE_ROLE_PREVIEW=1.
 */
export const ROLE_PREVIEW_ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_BEE_ROLE_PREVIEW === "1";

interface RoleCtx {
  role: RoleKey;
  setRole: (r: RoleKey) => void;
  ready: boolean;
}

const Ctx = createContext<RoleCtx>({ role: "admin", setRole: () => {}, ready: false });

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>("admin");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = ROLE_PREVIEW_ENABLED ? (localStorage.getItem(KEY) as RoleKey | null) : null;
      if (saved) setRoleState(saved);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const setRole = (r: RoleKey) => {
    if (!ROLE_PREVIEW_ENABLED) return;
    setRoleState(r);
    try {
      localStorage.setItem(KEY, r);
    } catch {
      /* ignore */
    }
  };

  return <Ctx.Provider value={{ role, setRole, ready }}>{children}</Ctx.Provider>;
}

export function useRole() {
  return useContext(Ctx);
}

/** Helper for the login page's preview picker to set role before navigating. */
export function persistRole(r: RoleKey) {
  if (!ROLE_PREVIEW_ENABLED) return;
  try {
    localStorage.setItem(KEY, r);
  } catch {
    /* ignore */
  }
}
