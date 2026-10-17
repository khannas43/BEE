"use client";

import { useState } from "react";
import { RegistrationsTable } from "@/components/app/registrations/RegistrationsTable";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { DECIDED_STATES, waitingStatesFor } from "@/components/app/registrations/labels";
import { type RegistrationState, readRegistrationList, registrationReviewsHref } from "@/lib/client/runtimeRegistrations";
import { gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadList = () => readRegistrationList();

type Tab = "waiting" | "decided" | "all";

/**
 * The registration requests Spring returns for the signed-in person, split on the screen into waiting, decided and all.
 * Programme waits on programme review; the Director waits on director approval. Provisional local rules, not BEE rules.
 */
export function RegistrationReviews({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("reviews", loadList, revalidation));
  const roles = identity.status === "signed-in" ? identity.me.effectiveRoles.map((r) => r.role) : [];
  const [tab, setTab] = useState<Tab>("waiting");
  const waiting = waitingStatesFor(roles);

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Registration reviews" implemented={runtimeRouteFor(registrationReviewsHref())?.implemented}>
      <div className="space-y-space-md" data-testid="rev-queue">
        <IdentityStrip identity={identity} testId="rev-queue-identity" />
        <ReadPanel
          title="Registration reviews"
          read={read}
          loadingText="Loading registration reviews…"
          loadingTestId="rev-queue-loading"
          errorTestId="rev-queue-error"
          signInReturnTo={registrationReviewsHref()}
          isEmpty={(r) => r.list.items.length === 0}
          emptyText="No registration request is here."
          emptyTestId="rev-queue-empty"
        >
          {(r) => {
            const rows = r.list.items.filter((item) => matches(tab, item.state, waiting));
            return (
              <div className="space-y-space-sm">
                <div className="flex gap-space-sm">
                  <TabButton id="rev-tab-waiting" selected={tab === "waiting"} onSelect={() => setTab("waiting")}>Waiting for me</TabButton>
                  <TabButton id="rev-tab-decided" selected={tab === "decided"} onSelect={() => setTab("decided")}>Decided</TabButton>
                  <TabButton id="rev-tab-all" selected={tab === "all"} onSelect={() => setTab("all")}>All</TabButton>
                </div>
                {rows.length === 0 ? <p className="font-body-sm text-on-surface-variant" data-testid="rev-tab-empty">Nothing in this tab.</p> : (
                  <RegistrationsTable items={rows} variant="review" />
                )}
              </div>
            );
          }}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

function matches(tab: Tab, state: RegistrationState, waiting: Set<RegistrationState>): boolean {
  if (tab === "all") return true;
  if (tab === "decided") return DECIDED_STATES.has(state);
  return waiting.has(state);
}

function TabButton({ id, selected, onSelect, children }: { id: string; selected: boolean; onSelect: () => void; children: string }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} data-testid={id} data-selected={selected ? "true" : "false"} className="border border-primary text-primary py-1.5 px-3 rounded-lg font-label-sm">
      {children}
    </button>
  );
}
