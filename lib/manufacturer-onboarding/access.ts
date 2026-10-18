import type { RoleKey } from "@/lib/roles";
import type { ManufacturerOnboardingRole } from "./types";

export function onboardingRoleFromPreview(role: RoleKey): ManufacturerOnboardingRole | null {
  switch (role) {
    case "manufacturer":
      return "applicant";
    case "director":
      return "director";
    case "finance":
      return "finance";
    case "programme":
      return "programme";
    default:
      return null;
  }
}

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

export function canAccessManufacturerRoute(kind: ManufacturerRouteKind, role: ManufacturerOnboardingRole | null): boolean {
  if (!role) return false;
  switch (kind) {
    case "onboarding":
    case "application":
      return role === "applicant";
    case "director":
      return role === "director";
    case "monitoring":
      return role === "director" || role === "finance" || role === "programme";
    case "view360":
      return role === "applicant" || role === "director" || role === "finance" || role === "programme";
    default:
      return false;
  }
}
