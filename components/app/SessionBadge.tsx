"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface SpringMe {
  displayName: string;
  effectiveRoles: { role: string; scope: string }[];
  organisations: { code: string }[];
}

/**
 * Shows the signed-in identity as Spring reports it (roles and organisation from
 * the BEE database), fetched through the Next.js server. No token is involved on
 * this side: the browser only sends its httpOnly session cookie.
 */
export function SessionBadge({ signedOut }: { signedOut?: React.ReactNode }) {
  const [me, setMe] = useState<SpringMe | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/runtime/me", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<SpringMe>) : null))
      .then((body) => live && setMe(body))
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, []);

  if (!me) return <>{signedOut}</>;
  const roles = me.effectiveRoles.map((r) => `${r.role} (${r.scope})`).join(", ");
  const orgs = me.organisations.map((o) => o.code).join(", ");
  return (
    <div className="flex items-center gap-space-sm" data-testid="session-badge">
      <div className="hidden md:block leading-tight text-right">
        <div className="font-label-md text-label-md text-on-surface font-semibold">{me.displayName}</div>
        <div className="font-label-sm text-label-sm text-on-surface-variant">
          {roles}
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
