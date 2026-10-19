import type { ManufacturerOnboardingRole } from "./types";

export type SpringIdentityLike = {
  effectiveRoles: { role: string; scope: string }[];
};

/** Map Spring effective roles to onboarding capabilities (identity only — not preview role). */
export function effectiveOnboardingRoles(me: SpringIdentityLike): ManufacturerOnboardingRole[] {
  const out = new Set<ManufacturerOnboardingRole>();
  for (const g of me.effectiveRoles) {
    if (g.role === "manufacturer") out.add("applicant");
    // Brief C3: the operational decision (activate, hold, clear, revoke) belongs to the BEE Officer; the Director (final
    // authority) reads the queue and monitoring and may raise an anomaly, which is the Programme capability set here.
    if (g.role === "officer") out.add("director");
    if (g.role === "director") out.add("programme");
    if (g.role === "finance") out.add("finance");
    if (g.role === "programme") out.add("programme");
  }
  return [...out];
}

export function primaryOnboardingRole(roles: readonly ManufacturerOnboardingRole[]): ManufacturerOnboardingRole | null {
  if (roles.includes("director")) return "director";
  if (roles.includes("finance")) return "finance";
  if (roles.includes("programme")) return "programme";
  if (roles.includes("applicant")) return "applicant";
  return null;
}
