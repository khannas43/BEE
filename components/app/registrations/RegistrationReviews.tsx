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
                <p className="text-sm text-on-surface-variant">Brand and agency registration requests that reached review. Open one to read the trail and take the next step.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Tile id="rev-tab-waiting" selected={tab === "waiting"} onSelect={() => setTab("waiting")} count={r.list.items.filter((i) => matches("waiting", i.state, waiting)).length} label="Waiting for me" tone="warn" />
                  <Tile id="rev-tab-decided" selected={tab === "decided"} onSelect={() => setTab("decided")} count={r.list.items.filter((i) => matches("decided", i.state, waiting)).length} label="Decided" tone="ok" />
                  <Tile id="rev-tab-all" selected={tab === "all"} onSelect={() => setTab("all")} count={r.list.items.length} label="All requests" tone="info" />
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

const TILE_TONE = { warn: "text-[#8a4b00]", ok: "text-[#14532d]", info: "text-primary" } as const;

function Tile({ id, selected, onSelect, count, label, tone }: { id: string; selected: boolean; onSelect: () => void; count: number; label: string; tone: keyof typeof TILE_TONE }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={id}
      data-selected={selected ? "true" : "false"}
      className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition-colors ${selected ? "border-primary bg-primary/10" : "border-border-subtle bg-white hover:bg-surface-container-lowest"}`}
    >
      <span className={`block text-2xl font-bold tabular-nums ${TILE_TONE[tone]}`}>{count}</span>
      <span className="block text-sm font-semibold text-on-surface">{label}</span>
    </button>
  );
}
