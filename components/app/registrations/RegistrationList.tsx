"use client";

import Link from "next/link";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { REGISTRATION_FEE_STATE, REGISTRATION_KIND_LABEL, REGISTRATION_STATE_LABEL } from "@/components/app/registrations/labels";
import { readRegistrationList, registrationListHref, registrationNewHref, registrationRequestHref } from "@/lib/client/runtimeRegistrations";
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
            <table className="w-full font-body-sm text-body-sm" data-testid="reg-list-table">
              <thead>
                <tr className="text-left text-on-surface-variant font-label-sm">
                  <th className="py-1 pr-3">Reference</th>
                  <th className="py-1 pr-3">Kind</th>
                  <th className="py-1 pr-3">Brand</th>
                  <th className="py-1 pr-3">State</th>
                  <th className="py-1 pr-3">Fee</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {r.list.items.map((item) => (
                  <tr key={item.id} data-testid={`reg-row-${item.reference}`} data-state={item.state}>
                    <td className="py-1 pr-3">{item.reference}</td>
                    <td className="py-1 pr-3">{REGISTRATION_KIND_LABEL[item.kind]}</td>
                    <td className="py-1 pr-3">{item.brandName}</td>
                    <td className="py-1 pr-3">{REGISTRATION_STATE_LABEL[item.state]}</td>
                    <td className="py-1 pr-3">
                      {REGISTRATION_FEE_STATE[item.state]}
                      {item.submissionFee ? ` · INR ${item.submissionFee.totalInr} · ${item.submissionFee.label}` : ""}
                    </td>
                    <td className="py-1">
                      <Link href={registrationRequestHref(item.id)} className="text-primary" data-testid={`reg-open-${item.reference}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}
