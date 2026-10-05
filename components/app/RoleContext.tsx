"use client";

import { createContext, useContext, useMemo } from "react";
import { useClientStorageReady, useStoredValue, writeStoredValue } from "@/lib/client/useStoredValue";
import { RoleKey, ROLE_ORDER, roleByKey } from "@/lib/roles";

const KEY = "bee-role";

/**
 * The prototype role switcher is a development preview of screens and menus. It
 * lives only in this browser's localStorage, is never sent to the server and
 * never creates a server session; sign-in is /api/auth/login (WP02.1). It is off
 * in production builds unless NEXT_PUBLIC_BEE_ROLE_PREVIEW=1.
 */
export const ROLE_PREVIEW_ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_BEE_ROLE_PREVIEW === "1";

/**
 * Every name derived from the preview role carries this suffix, so a preview role
 * can never read as the signed-in person or as an access grant. Elements that
 * render a preview role also carry data-preview-role (checked by local:browser).
 */
export const PREVIEW_SUFFIX = " (preview)";

export function previewRoleOf(r: RoleKey) {
  const base = roleByKey(r);
  return { ...base, name: base.name + PREVIEW_SUFFIX, short: base.short + PREVIEW_SUFFIX };
}

function roleFromStored(stored: string | null): RoleKey {
  if (!stored || !ROLE_PREVIEW_ENABLED) return "admin";
  return ROLE_ORDER.includes(stored as RoleKey) ? (stored as RoleKey) : "admin";
}

interface RoleCtx {
  role: RoleKey;
  setRole: (r: RoleKey) => void;
  ready: boolean;
}

const Ctx = createContext<RoleCtx>({ role: "admin", setRole: () => {}, ready: false });

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const stored = useStoredValue(KEY);
  const ready = useClientStorageReady();
  const role = useMemo(() => roleFromStored(stored), [stored]);

  const setRole = (r: RoleKey) => {
    if (!ROLE_PREVIEW_ENABLED) return;
    writeStoredValue(KEY, r);
  };

  return <Ctx.Provider value={{ role, setRole, ready }}>{children}</Ctx.Provider>;
}

export function useRole() {
  return useContext(Ctx);
}

/** Helper for the login page's preview picker to set role before navigating. */
export function persistRole(r: RoleKey) {
  if (!ROLE_PREVIEW_ENABLED) return;
  writeStoredValue(KEY, r);
}
