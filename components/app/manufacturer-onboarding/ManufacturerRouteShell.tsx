"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import type { SpringIdentity } from "@/components/app/SessionBadge";
import { canAccessManufacturerRoute, routeKindForPath } from "@/lib/manufacturer-onboarding/access";
import { effectiveOnboardingRoles } from "@/lib/manufacturer-onboarding/identity";
import { ManufacturerOnboardingProvider } from "./ManufacturerOnboardingProvider";
import { AccessDeniedPanel, LoadingState } from "./shared";
import { Icon } from "@/components/ui/Icon";

function SignInRequiredPanel() {
  return (
    <div className="p-space-md lg:p-space-lg max-w-lg mx-auto text-center" data-testid="onboarding-sign-in-required">
      <Icon name="login" size={32} className="text-primary mb-space-sm" />
      <h1 className="font-headline-sm text-headline-sm">Sign in required</h1>
      <p className="font-body-md text-body-md text-on-surface-variant mt-2">
        Manufacturer onboarding uses your signed-in BEE identity. The development preview role does not grant access.
      </p>
      <Link
        href="/login?returnTo=/app/manufacturer/onboarding"
        className="inline-flex items-center gap-1 mt-space-md text-primary font-semibold"
        data-testid="onboarding-sign-in-link"
      >
        Sign in
      </Link>
    </div>
  );
}

function Gate({ children, me }: { children: ReactNode; me: SpringIdentity }) {
  const pathname = usePathname();
  const kind = routeKindForPath(pathname);
  if (!kind) return <>{children}</>;
  const roles = effectiveOnboardingRoles(me);
  if (!canAccessManufacturerRoute(kind, roles)) return <AccessDeniedPanel />;
  return <>{children}</>;
}

export function ManufacturerRouteShell({ children }: { children: ReactNode }) {
  const identity = useSpringIdentity();
  const pathname = usePathname();
  const kind = routeKindForPath(pathname);

  if (kind && identity.status === "loading") {
    return <LoadingState label="Checking your signed-in identity…" />;
  }
  if (kind && identity.status === "signed-out") {
    return <SignInRequiredPanel />;
  }

  const me = identity.status === "signed-in" ? identity.me : null;

  return (
    <ManufacturerOnboardingProvider identity={me}>
      {me && kind ? <Gate me={me}>{children}</Gate> : children}
    </ManufacturerOnboardingProvider>
  );
}
