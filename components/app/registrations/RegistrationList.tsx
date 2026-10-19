"use client";

import Link from "next/link";
import { RegistrationsTable } from "@/components/app/registrations/RegistrationsTable";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { useAdminDemonstrationReadOnly } from "@/lib/adminDemonstration";
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
  const readOnlyAdmin = useAdminDemonstrationReadOnly();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("list", loadList, revalidation));
  const newRequest = readOnlyAdmin ? null : (
    <Link href={registrationNewHref()} className="inline-flex items-center gap-1 rounded-xl bg-primary px-4 py-2 font-semibold text-on-primary shadow-sm hover:opacity-95" data-testid="reg-new">
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
          {(r) => {
            const items = r.list.items;
            const n = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).length;
            const tiles = [
              { label: "All requests", value: items.length, tone: "text-primary" },
              { label: "In progress", value: n((i) => ["draft", "fee_due", "programme_review", "director_approval"].includes(i.state)), tone: "text-[#8a4b00]" },
              { label: "Registered", value: n((i) => i.state === "approved"), tone: "text-[#14532d]" },
              { label: "Returned or rejected", value: n((i) => i.state === "returned" || i.state === "rejected"), tone: "text-[#93000a]" },
            ];
            return (
              <div className="space-y-space-md">
                <p className="text-sm text-on-surface-variant">Brand registrations and agency authorisations filed by your organisation, with the stage each has reached. Open one to read its trail.</p>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="reg-list-tiles">
                  {tiles.map((t) => (
                    <div key={t.label} className="rounded-2xl border border-border-subtle bg-white px-4 py-3 shadow-sm">
                      <div className={`text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</div>
                      <div className="text-sm font-semibold text-on-surface">{t.label}</div>
                    </div>
                  ))}
                </div>
                <RegistrationsTable items={items} variant="mine" />
              </div>
            );
          }}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}
