"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { isManufacturerRegistrationDemoIdentity } from "@/lib/manufacturer-onboarding/manufacturerNavPolicy";
import { manufacturerProfileHref } from "@/lib/client/runtimeManufacturers";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import type { SpringIdentity } from "@/components/app/SessionBadge";
import { adminDemonstrationReadOnly } from "@/lib/adminDemonstration";
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
  const router = useRouter();
  const kind = routeKindForPath(pathname);
  // The company-registration wizard is for an organisation still registering; a registered manufacturer goes to its own 360 profile.
  const manufacturerOnly = me.effectiveRoles.length > 0 && me.effectiveRoles.every((r) => r.role === "manufacturer");
  const registered = kind === "onboarding" && manufacturerOnly && me.organisations.length > 0 && !isManufacturerRegistrationDemoIdentity(me.effectiveRoles, me.organisations);
  const profile = manufacturerProfileHref(me.organisations[0]?.code);
  useEffect(() => {
    if (registered) router.replace(profile);
  }, [registered, router, profile]);
  if (registered) return <LoadingState label="Opening your Manufacturer 360 profile…" />;
  if (!kind) return <>{children}</>;
  const roles = effectiveOnboardingRoles(me);
  const readOnlyAdmin = adminDemonstrationReadOnly(me);
  if (!canAccessManufacturerRoute(kind, roles, readOnlyAdmin)) return <AccessDeniedPanel />;
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
