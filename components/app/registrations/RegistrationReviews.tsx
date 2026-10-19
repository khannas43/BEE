"use client";

import { useEffect, useState } from "react";
import { RegistrationsTable } from "@/components/app/registrations/RegistrationsTable";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { DECIDED_STATES, waitingStatesFor } from "@/components/app/registrations/labels";
import { type Registration, type RegistrationState, readRegistrationList, registrationReviewsHref } from "@/lib/client/runtimeRegistrations";
import { readCompanyRegistrationsAwaitingApproval, type CompanyRegistrationItem } from "@/lib/client/runtimeCompanyRegistrations";
import { gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadList = () => readRegistrationList();

/** Company registrations (e.g. a new manufacturer's) shown beside the registration requests for the BEE Officer, in one review list. */
function companyRows(items: readonly CompanyRegistrationItem[]): Registration[] {
  const rows: Registration[] = [];
  for (const c of items) {
    const state: RegistrationState | null =
      c.state === "director_review" ? "director_approval" : ["active_observation", "active", "on_hold"].includes(c.state) ? "approved" : c.state === "rejected" ? "rejected" : null;
    if (!state) continue;
    rows.push({ id: c.id, reference: c.reference, kind: "brand", organisation: c.legalName, brandName: c.legalName, state, version: 0, tradeLicenceUploaded: true, companyId: c.id });
  }
  return rows;
}

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
  const [companies, setCompanies] = useState<CompanyRegistrationItem[]>([]);
  const isOfficer = roles.includes("officer");
  useEffect(() => {
    if (!isOfficer) return;
    let cancelled = false;
    void readCompanyRegistrationsAwaitingApproval().then((c) => {
      if (!cancelled && c.ok) setCompanies(c.items);
    });
    return () => {
      cancelled = true;
    };
  }, [isOfficer]);
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
          isEmpty={(r) => r.list.items.length === 0 && (!isOfficer || companies.length === 0)}
          emptyText="No registration request is here."
          emptyTestId="rev-queue-empty"
        >
          {(r) => {
            const all = [...(isOfficer ? companyRows(companies) : []), ...r.list.items];
            const rows = all.filter((item) => matches(tab, item.state, waiting));
            return (
              <div className="space-y-space-sm">
                <p className="text-sm text-on-surface-variant">Brand and agency registration requests that reached review. Open one to read the trail and take the next step.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Tile id="rev-tab-waiting" selected={tab === "waiting"} onSelect={() => setTab("waiting")} count={all.filter((i) => matches("waiting", i.state, waiting)).length} label="Waiting for me" tone="warn" />
                  <Tile id="rev-tab-decided" selected={tab === "decided"} onSelect={() => setTab("decided")} count={all.filter((i) => matches("decided", i.state, waiting)).length} label="Decided" tone="ok" />
                  <Tile id="rev-tab-all" selected={tab === "all"} onSelect={() => setTab("all")} count={all.length} label="All requests" tone="info" />
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
