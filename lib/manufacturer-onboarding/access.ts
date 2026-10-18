import type { ManufacturerOnboardingRole } from "./types";

export type ManufacturerRouteKind =
  | "onboarding"
  | "application"
  | "director"
  | "monitoring"
  | "view360";

export function routeKindForPath(pathname: string): ManufacturerRouteKind | null {
  if (pathname === "/app/manufacturer/onboarding") return "onboarding";
  if (pathname.startsWith("/app/manufacturer/application/")) return "application";
  if (pathname === "/app/manufacturer/director") return "director";
  if (pathname === "/app/manufacturer/monitoring") return "monitoring";
  if (pathname.startsWith("/app/manufacturer/360/")) return "view360";
  return null;
}

export function canAccessManufacturerRoute(
  kind: ManufacturerRouteKind,
  roles: readonly ManufacturerOnboardingRole[],
): boolean {
  if (roles.length === 0) return false;
  switch (kind) {
    case "onboarding":
      return roles.includes("applicant");
    case "application":
    case "view360":
      return roles.some((r) => r === "applicant" || r === "director" || r === "finance" || r === "programme");
    case "director":
      return roles.includes("director");
    case "monitoring":
      return roles.includes("director") || roles.includes("finance") || roles.includes("programme");
    default:
      return false;
  }
}

export function canDirectorDecide(roles: readonly ManufacturerOnboardingRole[]): boolean {
  return roles.includes("director");
}

export function canRaiseAnomaly(roles: readonly ManufacturerOnboardingRole[]): boolean {
  return roles.includes("finance") || roles.includes("programme") || roles.includes("director");
}

export function canResolveOrRevoke(roles: readonly ManufacturerOnboardingRole[]): boolean {
  return roles.includes("director");
}
