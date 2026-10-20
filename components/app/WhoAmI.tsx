"use client";

import { ROLES } from "@/lib/roles";
import { useSpringIdentity, type SpringIdentity } from "./SessionBadge";

/** The short role words shown under a name: Officer, Director, Finance and so on. */
const SHORT: Record<string, string> = { officer: "Officer", director: "Director", finance: "Finance", programme: "Programme", admin: "Admin", reviewer: "Reviewer", auditor: "Auditor", helpdesk: "Helpdesk", iame: "IAME", sda: "SDA" };
const roleName = (key: string) => SHORT[key] ?? ROLES.find((r) => r.key === key)?.short ?? key;
const clean = (name: string) => name.replace(/\s*\((synthetic[^)]*|not yet permittee)\)\s*$/i, "").trim();

/** The line shown under the person's name: the company for a manufacturer or agency, otherwise the BEE role. */
export function identityLine(me: SpringIdentity): string {
  const roles = me.effectiveRoles.map((r) => r.role);
  const external = roles.length > 0 && roles.every((r) => r === "manufacturer" || r === "agency");
  const org = me.organisations.find((o) => o.name)?.name;
  if (external && org) return clean(org);
  const names = [...new Set(roles.map(roleName))];
  return names.join(", ") || (org ? clean(org) : "");
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

/** Who is signed in: name, and the role or company beneath it. Shown before the notification bell. */
export function WhoAmI() {
  const id = useSpringIdentity();
  if (id.status !== "signed-in") return null;
  const line = identityLine(id.me);
  return (
    <div className="flex items-center gap-space-sm" data-testid="whoami" title={`${id.me.displayName}${line ? `, ${line}` : ""}`}>
      <span aria-hidden className="hidden sm:flex h-9 w-9 items-center justify-center rounded-full bg-primary-container text-on-primary text-[13px] font-bold">{initials(id.me.displayName)}</span>
      <div className="hidden sm:block leading-tight text-left max-w-[240px]">
        <div className="truncate font-label-md text-label-md font-semibold text-on-surface" data-testid="whoami-name">{id.me.displayName}</div>
        <div className="truncate font-label-sm text-label-sm text-on-surface-variant" data-testid="whoami-line">{line}</div>
      </div>
    </div>
  );
}
