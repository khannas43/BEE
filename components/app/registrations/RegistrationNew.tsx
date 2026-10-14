"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { RegistrationForm } from "@/components/app/registrations/RegistrationForm";
import { indiaToday } from "@/components/app/registrations/labels";
import { registrationNewHref, registrationRequestHref } from "@/lib/client/runtimeRegistrations";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * A new registration draft. A manufacturer names a brand; an agency chooses one and a start date.
 * The signed-in Spring role chooses which form is shown. Spring still refuses a request the role cannot file.
 */
export function RegistrationNew({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const router = useRouter();
  const today = indiaToday();
  const [notice, setNotice] = useState<string | null>(null);
  const roles = identity.status === "signed-in" ? identity.me.effectiveRoles.map((r) => r.role) : [];
  const kind = roles.includes("agency") && !roles.includes("manufacturer") ? "agency" : roles.includes("manufacturer") ? "brand" : null;
  const onSaved = useCallback((registration: { id: string; reference: string }) => {
    setNotice(`Draft ${registration.reference} saved.`);
    router.push(registrationRequestHref(registration.id));
  }, [router]);

  return (
    <ScreenChrome module={module} screen={screen} subtitle="File a registration request" implemented={runtimeRouteFor(registrationNewHref())?.implemented}>
      <div className="space-y-space-md" data-testid="reg-new-screen">
        <IdentityStrip identity={identity} testId="reg-new-identity" />
        {identity.status === "loading" ? <p className="font-body-sm text-on-surface-variant" data-testid="reg-new-loading">Checking your sign-in…</p> : null}
        {identity.status === "signed-out" ? <p className="font-body-sm" data-testid="reg-new-signed-out">Sign in to file a registration request.</p> : null}
        {kind ? (
          <RegistrationForm kind={kind} today={today} signInReturnTo={registrationNewHref()} onSaved={onSaved} />
        ) : identity.status === "signed-in" ? (
          <p className="font-body-sm" data-testid="reg-new-unavailable">A manufacturer or an agency files a registration request.</p>
        ) : null}
        {notice ? <p className="font-body-sm" data-testid="reg-new-saved">{notice}</p> : null}
      </div>
    </ScreenChrome>
  );
}
