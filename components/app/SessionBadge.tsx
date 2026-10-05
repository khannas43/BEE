"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

export interface SpringIdentity {
  displayName: string;
  effectiveRoles: { role: string; scope: string }[];
  /** The permissions the roles hold; the menu offers a screen by it. Spring still decides every action. */
  capabilities?: string[];
  organisations: { code: string }[];
}

export type IdentityState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: SpringIdentity };

// One request per page load, shared by the preview banner, the top-bar badge and the
// sidebar, until refreshIdentity() asks again.
let pending: Promise<IdentityState> | null = null;
const listeners = new Set<(s: IdentityState) => void>();
const fetchIdentity = () =>
  fetch("/api/runtime/me", { cache: "no-store" })
    .then(async (r): Promise<IdentityState> => (r.ok ? { status: "signed-in", me: (await r.json()) as SpringIdentity } : { status: "signed-out" }))
    .catch((): IdentityState => ({ status: "signed-out" }));
const loadIdentity = () => (pending ??= fetchIdentity());

/** Re-reads the identity (after sign-out elsewhere, expiry or revocation) and updates every subscriber. */
export function refreshIdentity(): Promise<IdentityState> {
  const next = fetchIdentity();
  pending = next;
  return next.then((s) => {
    if (pending === next) listeners.forEach((l) => l(s));
    return s;
  });
}

/**
 * The signed-in identity as Spring reports it (roles and organisation from the
 * BEE database), fetched through the Next.js server. The browser sends only its
 * httpOnly session cookie; no token is involved on this side.
 */
export function useSpringIdentity(): IdentityState {
  const [state, setState] = useState<IdentityState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    const update = (s: IdentityState) => live && setState(s);
    listeners.add(update);
    const first = loadIdentity();
    first.then((s) => pending === first && update(s));
    return () => {
      live = false;
      listeners.delete(update);
    };
  }, []);
  return state;
}

export const rolesText = (me: SpringIdentity) => me.effectiveRoles.map((r) => `${r.role} (${r.scope})`).join(", ");
export const orgsText = (me: SpringIdentity) => me.organisations.map((o) => o.code).join(", ");

export function SessionBadge({ signedOut }: { signedOut?: React.ReactNode }) {
  const id = useSpringIdentity();
  if (id.status !== "signed-in") return <>{signedOut}</>;
  const orgs = orgsText(id.me);
  return (
    <div className="flex items-center gap-space-sm" data-testid="session-badge">
      <div className="hidden md:block leading-tight text-right">
        <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">Signed in</div>
        <div className="font-label-md text-label-md text-on-surface font-semibold">{id.me.displayName}</div>
        <div className="font-label-sm text-label-sm text-on-surface-variant">
          {rolesText(id.me)}
          {orgs ? ` · ${orgs}` : ""}
        </div>
      </div>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="text-on-surface-variant hover:text-error flex items-center" title="Sign out">
          <Icon name="logout" size={20} />
        </button>
      </form>
    </div>
  );
}
