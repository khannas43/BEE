"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { canAccessManufacturerRoute, routeKindForPath } from "@/lib/manufacturer-onboarding/access";
import { ManufacturerOnboardingProvider, useManufacturerOnboardingPreviewRole } from "./ManufacturerOnboardingProvider";
import { AccessDeniedPanel } from "./shared";

function Gate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const kind = routeKindForPath(pathname);
  const role = useManufacturerOnboardingPreviewRole();
  if (!kind) return <>{children}</>;
  if (!canAccessManufacturerRoute(kind, role)) return <AccessDeniedPanel />;
  return <>{children}</>;
}

export function ManufacturerRouteShell({ children }: { children: ReactNode }) {
  return (
    <ManufacturerOnboardingProvider>
      <Gate>{children}</Gate>
    </ManufacturerOnboardingProvider>
  );
}
