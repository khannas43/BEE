"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { ApplicationHistory } from "@/components/app/lifecycle/ApplicationHistory";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { workTasks } from "@/components/app/workflow/workTasks";
import { gateRead } from "@/lib/client/runtimeHttp";
import { type ModelApplication, readModelApplicationList, stateLabel } from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * Three read-only workflow views over the same scoped application list the stage screens use. Spring decides which
 * applications the signed-in person may see; these screens only arrange them. They hold no time limits: none are decided
 * (BL-128), so nothing here says an application is late.
 */
const loadList = () => readModelApplicationList();
const LIST_TARGET = "list";
const FINISHED = ["approved", "rejected"];
const IN_FLIGHT_STAGES = ["fee_due", "iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval", "returned"] as const;

const REVIEW_ROUTE = "/app/workflow/application-review";
const HISTORY_ROUTE = "/app/workflow/workflow-history";
const ESCALATION_ROUTE = "/app/workflow/escalation-dashboard";

function useApplications() {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const roles = identity.status === "signed-in" ? identity.me.effectiveRoles.map((r) => r.role) : [];
  return { identity, list, roles };
}

function refCell(prefix: string, a: ModelApplication) {
  return <span className="font-mono" data-testid={`${prefix}-ref-${a.reference}`}>{a.reference}</span>;
}
const brandCell = (a: ModelApplication) => (
  <div>
    <div className="font-semibold text-on-surface">{a.brandName}</div>
    <div className="font-label-sm text-label-sm text-on-surface-variant">{a.modelNumber}</div>
  </div>
);

/** Application review: every application in progress that the person may see, its stage and the next action. */
export function ApplicationReviewView({ module, screen }: { module: Module; screen: Screen }) {
  const { identity, list, roles } = useApplications();
  const inFlight = (items: ModelApplication[]) => items.filter((a) => !FINISHED.includes(a.state) && a.state !== "draft");
  const columns = (items: ModelApplication[]): DataTableColumn<ModelApplication>[] => {
    const next = new Map(workTasks(roles, items).map((t) => [t.application.id, t]));
    return [
      { key: "reference", header: "Reference", sortValue: (a) => a.reference, render: (a) => refCell("review", a) },
      { key: "brand", header: "Brand / Model", sortValue: (a) => `${a.brandName} ${a.modelNumber}`, render: brandCell },
      { key: "organisation", header: "Organisation", sortValue: (a) => a.organisation, render: (a) => a.organisation },
      { key: "state", header: "Stage", sortValue: (a) => a.state, render: (a) => stateLabel(a.state) },
      {
        key: "next",
        header: "Your next action",
        render: (a) => {
          const t = next.get(a.id);
          return t ? (
            <Link href={t.href} className="text-primary hover:underline inline-flex items-center gap-1" data-testid={`review-action-${a.reference}`}>
              {t.action} <Icon name="arrow_forward" size={14} />
            </Link>
          ) : (
            <span className="text-on-surface-variant" data-testid={`review-action-${a.reference}`}>None for you</span>
          );
        },
      },
      {
        key: "history",
        header: "",
        render: (a) => (
          <Link href={`${HISTORY_ROUTE}?id=${encodeURIComponent(a.id)}`} className="text-primary hover:underline" data-testid={`review-history-${a.reference}`}>
            History
          </Link>
        ),
      },
    ];
  };
  return (
    <ScreenChrome module={module} screen={screen} subtitle="Applications in progress" implemented={runtimeRouteFor(REVIEW_ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="review-screen">
        <IdentityStrip identity={identity} testId="review-identity" />
        <ReadPanel
          title="Applications in progress"
          read={list}
          loadingText="Loading applications…"
          loadingTestId="review-loading"
          errorTestId="review-error"
          signInReturnTo={REVIEW_ROUTE}
          isEmpty={(r) => inFlight(r.list.items).length === 0}
          emptyText="No application is in progress."
          emptyTestId="review-empty"
          resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{inFlight(r.list.items).length} in progress</span>}
        >
          {(r) => {
            const rows = inFlight(r.list.items);
            return <DataTable columns={columns(rows)} rows={rows} rowKey={(a) => a.id} pageSize={100} tableTestId="review-table" filterTestId="review-filter" />;
          }}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

/** Workflow history: choose an application and read its steps, as the person is allowed to see them. */
export function WorkflowHistoryView({ module, screen }: { module: Module; screen: Screen }) {
  const { identity, list } = useApplications();
  const selectedId = useSearchParams().get("id");
  const columns: DataTableColumn<ModelApplication>[] = [
    { key: "reference", header: "Reference", sortValue: (a) => a.reference, render: (a) => refCell("wfh", a) },
    { key: "brand", header: "Brand / Model", sortValue: (a) => `${a.brandName} ${a.modelNumber}`, render: brandCell },
    { key: "state", header: "Stage", sortValue: (a) => a.state, render: (a) => stateLabel(a.state) },
    {
      key: "open",
      header: "",
      render: (a) => (
        <Link
          href={`${HISTORY_ROUTE}?id=${encodeURIComponent(a.id)}`}
          className={`font-label-sm text-label-sm ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
          data-testid={`wfh-open-${a.reference}`}
        >
          {a.id === selectedId ? "Selected" : "Show history"}
        </Link>
      ),
    },
  ];
  return (
    <ScreenChrome module={module} screen={screen} subtitle="The steps of one application" implemented={runtimeRouteFor(HISTORY_ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="wfh-screen">
        <IdentityStrip identity={identity} testId="wfh-identity" />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-2" : ""}>
            <ReadPanel
              title="Applications"
              read={list}
              loadingText="Loading applications…"
              loadingTestId="wfh-loading"
              errorTestId="wfh-error"
              signInReturnTo={HISTORY_ROUTE}
              isEmpty={(r) => r.list.count === 0}
              emptyText="You can see no application."
              emptyTestId="wfh-empty"
            >
              {(r) => <DataTable columns={columns} rows={r.list.items} rowKey={(a) => a.id} pageSize={100} tableTestId="wfh-table" filterTestId="wfh-filter" />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-3 bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="wfh-detail" data-selected-id={selectedId}>
              <h2 className="font-title-md text-title-md text-on-surface mb-space-sm">History</h2>
              <ApplicationHistory key={selectedId} applicationId={selectedId} testIdPrefix="wfh-history" />
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

/** SLA and escalations: how many applications wait at each stage. No limits are set, so nothing is called late. */
export function EscalationView({ module, screen }: { module: Module; screen: Screen }) {
  const { identity, list } = useApplications();
  return (
    <ScreenChrome module={module} screen={screen} subtitle="Where applications are waiting" implemented={runtimeRouteFor(ESCALATION_ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="escalation-screen">
        <IdentityStrip identity={identity} testId="escalation-identity" />
        <ReadPanel
          title="Waiting, by stage"
          read={list}
          loadingText="Loading applications…"
          loadingTestId="escalation-loading"
          errorTestId="escalation-error"
          signInReturnTo={ESCALATION_ROUTE}
          isEmpty={(r) => r.list.items.filter((a) => !FINISHED.includes(a.state) && a.state !== "draft").length === 0}
          emptyText="No application is waiting."
          emptyTestId="escalation-empty"
        >
          {(r) => (
            <div className="space-y-space-md">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md" data-testid="escalation-counts">
                {IN_FLIGHT_STAGES.map((s) => (
                  <div key={s} className="rounded-xl bg-surface-ground p-space-md">
                    <div className="font-label-sm text-label-sm text-on-surface-variant capitalize">{stateLabel(s)}</div>
                    <div className="font-headline-md text-headline-md text-on-surface" data-testid={`escalation-count-${s}`}>
                      {r.list.items.filter((a) => a.state === s).length}
                    </div>
                  </div>
                ))}
              </div>
              <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="escalation-no-limits">
                No time limits are set yet, so no application is shown as late. Overdue items and ages appear once BEE decides the limits.
              </p>
            </div>
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}
