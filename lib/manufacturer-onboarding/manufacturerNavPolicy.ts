import type { Category } from "@/lib/categories";
import type { RuntimeRoute } from "@/lib/runtimeRoutes";

/** Seeded orgs used for public company-registration demo (not yet permittees). */
export const MANUFACTURER_REGISTRATION_DEMO_ORG_CODES = ["VIRAA", "ONBOARD"] as const;

type OrgLike = { code: string };

/** True when every Spring organisation is a pre-permittee registration demo org. */
export function isManufacturerRegistrationDemoIdentity(
  effectiveRoles: readonly { role: string }[] | null | undefined,
  organisations: readonly OrgLike[] | null | undefined,
): boolean {
  if (!effectiveRoles?.some((g) => g.role === "manufacturer")) return false;
  const orgs = organisations ?? [];
  if (orgs.length === 0) return false;
  return orgs.every((o) => (MANUFACTURER_REGISTRATION_DEMO_ORG_CODES as readonly string[]).includes(o.code) || o.code.startsWith("GUEST-"));
}

/** Runtime menu entries while company registration is still in progress. */
export function filterRuntimeNavForRegistrationDemo(nav: RuntimeRoute[]): RuntimeRoute[] {
  return nav.filter((r) => r.href === "/app/manufacturer/onboarding");
}

/** Sidebar categories: dashboard + company registration only. */
export function filterCategoriesForRegistrationDemo(categories: Category[]): Category[] {
  return categories
    .map((c) => {
      if (c.id === "home") {
        return { ...c, items: c.items.filter((it) => it.href === "/app") };
      }
      return { ...c, items: [] };
    })
    .filter((c) => c.items.length > 0);
}

/** Blocks direct URL access to model/brand journeys until manufacturer registration completes. */
export function manufacturerRegistrationDemoBlocksPath(pathname: string): boolean {
  const path = pathname.split("?")[0];
  if (path === "/app" || path === "/app/") return false;
  if (path.startsWith("/app/manufacturer")) return false;
  if (path === "/app/screens") return false;
  return true;
}
