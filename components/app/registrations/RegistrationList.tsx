"use client";

import Link from "next/link";
import { RegistrationsTable } from "@/components/app/registrations/RegistrationsTable";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { readRegistrationList, registrationListHref, registrationNewHref } from "@/lib/client/runtimeRegistrations";
import { gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadList = () => readRegistrationList();

/**
 * The requests the signed-in organisation may read. A manufacturer files a brand; an agency asks to act for one.
 * Spring decides the rows. Provisional local rules, not BEE rules.
 */
export function RegistrationList({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("list", loadList, revalidation));
  const newRequest = (
    <Link href={registrationNewHref()} className="border border-primary text-primary py-1.5 px-3 rounded-lg font-label-sm" data-testid="reg-new">
      New request
    </Link>
  );

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Brand and agency requests" implemented={runtimeRouteFor(registrationListHref())?.implemented}>
      <div className="space-y-space-md" data-testid="reg-list">
        <IdentityStrip identity={identity} testId="reg-list-identity" />
        <ReadPanel
          title="My registration requests"
          read={read}
          loadingText="Loading registration requests…"
          loadingTestId="reg-list-loading"
          errorTestId="reg-list-error"
          signInReturnTo={registrationListHref()}
          isEmpty={(r) => r.list.items.length === 0}
          emptyText="No registration request exists yet."
          emptyTestId="reg-list-empty"
          action={newRequest}
          resultAction={() => newRequest}
        >
          {(r) => (
            <RegistrationsTable items={r.list.items} variant="mine" />
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}
