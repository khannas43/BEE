"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { HISTORY_COPY } from "@/components/app/lifecycle/ApplicationHistory";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { HISTORY_ACTION_LABELS, type ApplicationHistory, readModelHistory } from "@/lib/client/runtimeModelHistory";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { manufacturerProfileHref } from "@/lib/demo/manufacturerDirectory";
import { workTasks } from "@/components/app/workflow/workTasks";
import { gateRead } from "@/lib/client/runtimeHttp";
import { type ModelApplication, modelDashboardHref, readModelApplicationList, stateLabel } from "@/lib/client/runtimeModelApplications";
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
  <Link href={manufacturerProfileHref(a.organisation)} className="block hover:underline" title="Open the Manufacturer 360 profile" data-testid={`profile-link-${a.reference}`}>
    <div className="font-semibold text-primary">{a.brandName}</div>
    <div className="font-label-sm text-label-sm text-primary/80">{a.modelNumber}</div>
  </Link>
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
      { key: "submitted", header: "Submitted on", sortValue: (a) => a.submittedAt ?? "", render: (a) => (a.submittedAt ? a.submittedAt.slice(0, 10) : "—") },
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
            return <DataTable dateOf={(a) => a.submittedAt} dateLabel="Submitted on" columns={columns(rows)} rows={rows} rowKey={(a) => a.id} pageSize={100} tableTestId="review-table" filterTestId="review-filter" />;
          }}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

/** Audit History: choose an application and read every step taken on it, as the person is allowed to see them. */
const STAGE_TONE = (state: string) =>
  state === "approved" ? "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]"
  : state === "rejected" ? "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]"
  : state === "returned" ? "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]"
  : "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]";
const ACTION_ICON: Record<string, string> = {
  submit: "send", confirm_fee: "payments", iame_recommend: "fact_check", reviewer_forward: "forward_to_inbox", compute_rating: "star",
  director_recommend: "thumb_up", secretary_approve: "verified", return: "undo", resubmit: "replay", reject: "cancel", reverse_fee: "currency_exchange",
};
const ACTION_TONE = (a: string) => (a === "reject" ? "bg-[#ba1a1a]" : a === "return" || a === "reverse_fee" ? "bg-[#f59e0b]" : a === "secretary_approve" ? "bg-[#1c7c4a]" : "bg-[#254e9e]");
const auditWhen = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const auditCard = "rounded-xl border border-[#dbe6f7] bg-white";
const auditTh = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";

function StageChip({ state }: { state: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${STAGE_TONE(state)}`}>{stateLabel(state)}</span>;
}

function AuditStat({ icon, label, value, note, on, onClick }: { icon: string; label: string; value: number; note: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`${auditCard} p-4 text-left hover:border-[#9dbdec] ${on ? "border-[#254e9e] ring-2 ring-[#c9d9f7]" : ""}`}>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#64748b]"><Icon name={icon} size={16} />{label}</span>
      <span className="mt-1 block text-[28px] font-extrabold leading-8 text-[#14315E]">{value}</span>
      <span className="block text-[12px] text-[#64748b]">{note}</span>
    </button>
  );
}

function AuditList({ items }: { items: ModelApplication[] }) {
  const [group, setGroup] = useState<"" | "working" | "approved" | "returned">("");
  const inGroup = (a: ModelApplication) => group === "" || (group === "approved" ? a.state === "approved" : group === "returned" ? a.state === "returned" || a.state === "rejected" : !FINISHED.includes(a.state) && a.state !== "returned");
  const n = (g: "working" | "approved" | "returned") => items.filter((a) => (g === "approved" ? a.state === "approved" : g === "returned" ? a.state === "returned" || a.state === "rejected" : !FINISHED.includes(a.state) && a.state !== "returned")).length;
  const rows = items.filter(inGroup);
  const tools = useListTools({
    rows,
    text: (a) => `${a.reference} ${a.brandName} ${a.modelNumber} ${stateLabel(a.state)}`,
    date: (a) => a.submittedAt?.slice(0, 10),
    sortValue: (a, k) => (k === "ref" ? a.reference : k === "brand" ? `${a.brandName} ${a.modelNumber}` : k === "stage" ? a.state : a.submittedAt ?? ""),
    pageSize: 10,
  });
  return (
    <div className="space-y-space-md" data-testid="wfh-table-wrap">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="wfh-summary">
        <AuditStat icon="folder_open" label="All applications" value={items.length} note="with a recorded history" on={group === ""} onClick={() => setGroup("")} />
        <AuditStat icon="pending_actions" label="In progress" value={n("working")} note="still moving through stages" on={group === "working"} onClick={() => setGroup(group === "working" ? "" : "working")} />
        <AuditStat icon="verified" label="Approved" value={n("approved")} note="final approval given" on={group === "approved"} onClick={() => setGroup(group === "approved" ? "" : "approved")} />
        <AuditStat icon="undo" label="Returned or rejected" value={n("returned")} note="sent back or refused" on={group === "returned"} onClick={() => setGroup(group === "returned" ? "" : "returned")} />
      </div>
      <ListToolbar tools={tools} searchLabel="Search applications" placeholder="Reference, brand, model or stage" dateLabel="Submitted on"
        exportCsv={{ filename: "audit-history-applications", header: ["Reference", "Brand", "Model", "Stage", "Submitted on"], rows: tools.visible.map((a) => [a.reference, a.brandName, a.modelNumber, stateLabel(a.state), a.submittedAt?.slice(0, 10) ?? ""]) }} />
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No application matches.</p> : (
        <>
          <div className={`${auditCard} overflow-x-auto`}>
            <table className="w-full text-[13px]" data-testid="wfh-table">
              <caption className="sr-only">Applications with a recorded history</caption>
              <thead><tr className="bg-[#eef3fb]">
                <SortableTh tools={tools} k="ref" className={auditTh}>Reference</SortableTh><SortableTh tools={tools} k="brand" className={auditTh}>Brand / Model</SortableTh>
                <SortableTh tools={tools} k="stage" className={auditTh}>Stage</SortableTh><SortableTh tools={tools} k="submitted" className={auditTh}>Submitted on</SortableTh>
                <th className={auditTh}><span className="sr-only">Open</span></th>
              </tr></thead>
              <tbody>
                {tools.paged.pageRows.map((a) => (
                  <tr key={a.id} className="border-t border-[#e7edf6] hover:bg-[#f4f8ff]">
                    <td className="px-3 py-2 align-top font-mono font-semibold text-[#14315E]" data-testid={`wfh-ref-${a.reference}`}>{a.reference}</td>
                    <td className="px-3 py-2 align-top">{brandCell(a)}</td>
                    <td className="px-3 py-2 align-top"><StageChip state={a.state} /></td>
                    <td className="px-3 py-2 align-top">{a.submittedAt ? a.submittedAt.slice(0, 10) : "—"}</td>
                    <td className="px-3 py-2 align-top">
                      <Link href={`${HISTORY_ROUTE}?id=${encodeURIComponent(a.id)}`} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`wfh-open-${a.reference}`}>
                        View history <Icon name="arrow_forward" size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager tools={tools} />
        </>
      )}
    </div>
  );
}

function AuditDetail({ id, application }: { id: string; application: ModelApplication | null }) {
  const [history, setHistory] = useState<ApplicationHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readModelHistory(id).then((r) => {
      if (!live) return;
      if (r.ok) { setHistory(r.history); setError(null); } else setError(r.failure.message || HISTORY_COPY.failed);
    });
    return () => { live = false; };
  }, [id]);
  const items = history?.items ?? [];
  const first = items[0];
  const last = items[items.length - 1];
  return (
    <div className="space-y-space-md" data-testid="wfh-detail" data-selected-id={id}>
      <Link href={HISTORY_ROUTE} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary" data-testid="wfh-back"><Icon name="arrow_back" size={16} /> All applications</Link>
      <div className={`${auditCard} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div role="heading" aria-level={2} className="font-mono text-[22px] font-extrabold text-[#14315E]">{application?.reference ?? history?.reference ?? "Application"}</div>
            {application ? <div className="text-[14px] text-[#475569]">{application.brandName} {application.modelNumber}</div> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {application ? <StageChip state={application.state} /> : last ? <StageChip state={last.toState} /> : null}
            {application ? <Link href={modelDashboardHref(application.id)} className="inline-flex items-center gap-1 rounded-lg border border-primary px-3 py-1 text-[13px] font-semibold text-primary" data-testid="wfh-open-record"><Icon name="open_in_new" size={16} /> Open application record</Link> : null}
          </div>
        </div>
        {history ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Steps recorded</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{history.count}</div></div>
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">First step</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{first ? auditWhen(first.at) : "—"}</div></div>
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Latest step</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{last ? auditWhen(last.at) : "—"}</div></div>
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Shown as</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{history.viewedAs === "officer" ? "Officer view (names and notes)" : "Applicant view"}</div></div>
          </div>
        ) : null}
      </div>
      <div className={`${auditCard} p-5`}>
        <div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Audit trail</div>
        {error ? <p className="text-error font-body-sm" data-testid="wfh-history-error">{error}</p> : null}
        {!history && !error ? <p className="font-body-sm text-on-surface-variant" data-testid="wfh-history-loading">{HISTORY_COPY.loading}</p> : null}
        {history && items.length === 0 ? <p className="font-body-sm text-on-surface-variant" data-testid="wfh-history-empty">{HISTORY_COPY.empty}</p> : null}
        {history && history.viewedAs === "applicant" ? <p className="mb-3 text-[12px] text-[#64748b]" data-testid="wfh-history-applicant-note">{HISTORY_COPY.applicantNote}</p> : null}
        {items.length ? (
          <ol className="space-y-3" data-testid="wfh-history-list">
            {items.map((e, i) => (
              <li key={e.sequence} className="relative pl-10" data-testid={`wfh-history-step-${e.sequence}`} data-action={e.action}>
                {i < items.length - 1 ? <span className="absolute left-[15px] top-8 bottom-[-12px] w-0.5 bg-[#c9d9f7]" aria-hidden /> : null}
                <span className={`absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full text-white ${ACTION_TONE(e.action)}`}><Icon name={ACTION_ICON[e.action] ?? "history"} size={16} /></span>
                <div className="rounded-xl border border-[#dbe6f7] bg-[#f9fbff] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#14315E]">{e.sequence}. {HISTORY_ACTION_LABELS[e.action]}</span>
                    <span className="text-[12px] text-[#64748b]">{auditWhen(e.at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#475569]">
                    <StageChip state={e.fromState} /><Icon name="arrow_forward" size={14} /><StageChip state={e.toState} />
                    <span>· {e.actorName ? `${e.actorName}, ` : ""}{e.actorRole} ({e.actorOrganisation})</span>
                  </div>
                  {e.note ? <div className="mt-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] text-[#1e293b]" data-testid={`wfh-history-note-${e.sequence}`}><span className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Note</span>{e.note}</div> : null}
                  {e.facts.length ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {e.facts.map((f) => <div key={f.label}><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{f.label}</div><div className="text-[13px] font-semibold text-[#14315E]">{f.value}</div></div>)}
                    </div>
                  ) : null}
                  {e.withheld ? <p className="mt-2 text-[12px] italic text-[#64748b]" data-testid={`wfh-history-withheld-${e.sequence}`}>{HISTORY_COPY.withheld}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowHistoryView({ module, screen }: { module: Module; screen: Screen }) {
  const { identity, list } = useApplications();
  const selectedId = useSearchParams().get("id");
  return (
    <ScreenChrome module={module} screen={{ ...screen, name: "Audit History" }} subtitle="Every step taken on an application" implemented={runtimeRouteFor(HISTORY_ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="wfh-screen">
        <IdentityStrip identity={identity} testId="wfh-identity" />
        <ReadPanel
          title={selectedId ? "Application" : "Applications"}
          read={list}
          loadingText="Loading applications…"
          loadingTestId="wfh-loading"
          errorTestId="wfh-error"
          signInReturnTo={HISTORY_ROUTE}
          isEmpty={(r) => r.list.count === 0 && !selectedId}
          emptyText="You can see no application."
          emptyTestId="wfh-empty"
        >
          {(r) => (selectedId ? <AuditDetail key={selectedId} id={selectedId} application={r.list.items.find((a) => a.id === selectedId) ?? null} /> : <AuditList items={r.list.items} />)}
        </ReadPanel>
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
