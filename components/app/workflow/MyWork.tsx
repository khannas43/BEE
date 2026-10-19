"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { type WorkTask, workTasks } from "@/components/app/workflow/workTasks";
import { gateRead } from "@/lib/client/runtimeHttp";
import { readModelApplicationList, stateLabel } from "@/lib/client/runtimeModelApplications";
import { readCompanyRegistrationsAwaitingApproval, type CompanyRegistrationItem } from "@/lib/client/runtimeCompanyRegistrations";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * The task source for the first slice: the applications waiting for the signed-in person, each with the action and a link
 * to the screen where it is done. "My approvals" shows only the Director and Secretary decisions. The list is the same
 * scoped read the stage screens use, so nothing here is visible that Spring would not already return.
 */
export type MyWorkKind = "inbox" | "approvals";

/** The model-application list plus, for the BEE Officer, the company registrations waiting for approval. */
const loadList = async () => {
  const [models, companies] = await Promise.all([readModelApplicationList(), readCompanyRegistrationsAwaitingApproval()]);
  return models.ok ? { ...models, companies: companies.ok ? companies.items : [] } : models;
};
const LIST_TARGET = "list";

export const MY_WORK_COPY = {
  inbox: {
    route: "/app/workflow/personal-inbox",
    prefix: "inbox",
    subtitle: "Applications waiting for you",
    title: "Waiting for you",
    loading: "Loading your tasks…",
    empty: "Nothing is waiting for you.",
  },
  approvals: {
    route: "/app/workflow/my-approvals",
    prefix: "approvals",
    subtitle: "Applications waiting for your decision",
    title: "Waiting for your decision",
    loading: "Loading your approvals…",
    empty: "No application is waiting for your decision.",
  },
} as const;

export function MyWork({ module, screen, kind }: { module: Module; screen: Screen; kind: MyWorkKind }) {
  const copy = MY_WORK_COPY[kind];
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const roles = identity.status === "signed-in" ? identity.me.effectiveRoles.map((r) => r.role) : [];

  return (
    <ScreenChrome module={module} screen={screen} subtitle={copy.subtitle} implemented={runtimeRouteFor(copy.route)?.implemented}>
      <div className="space-y-space-md" data-testid={`${copy.prefix}-screen`}>
        <IdentityStrip identity={identity} testId={`${copy.prefix}-identity`} />
        <ReadPanel
          title={copy.title}
          read={list}
          loadingText={copy.loading}
          loadingTestId={`${copy.prefix}-loading`}
          errorTestId={`${copy.prefix}-error`}
          signInReturnTo={copy.route}
          isEmpty={(r) => rowsFor(kind, roles, r.list.items, r.companies).length === 0}
          emptyText={copy.empty}
          emptyTestId={`${copy.prefix}-empty`}
          resultAction={(r) => (
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              {rowsFor(kind, roles, r.list.items, r.companies).length} waiting
            </span>
          )}
        >
          {(r) => <TaskTable prefix={copy.prefix} rows={rowsFor(kind, roles, r.list.items, r.companies)} />}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

function tasksFor(kind: MyWorkKind, roles: readonly string[], items: Parameters<typeof workTasks>[1]): WorkTask[] {
  const all = workTasks(roles, items);
  return kind === "approvals" ? all.filter((t) => t.approval) : all;
}

interface InboxRow {
  key: string;
  reference: string;
  title: string;
  subtitle: string;
  stage: string;
  action: string;
  submittedAt: string | null;
  href: string;
}

/** The company registrations awaiting approval are the BEE Officer's decision, so they appear for that role only. */
function rowsFor(kind: MyWorkKind, roles: readonly string[], items: Parameters<typeof workTasks>[1], companies: readonly CompanyRegistrationItem[] = []): InboxRow[] {
  const models: InboxRow[] = tasksFor(kind, roles, items).map((t) => ({
    key: t.application.id,
    reference: t.application.reference,
    title: t.application.brandName,
    subtitle: t.application.modelNumber,
    stage: stateLabel(t.application.state),
    action: t.action,
    submittedAt: t.application.submittedAt ?? null,
    href: t.href,
  }));
  const company: InboxRow[] = roles.includes("officer")
    ? companies
        .filter((c) => c.state === "director_review")
        .map((c) => ({
          key: c.id,
          reference: c.reference,
          title: c.legalName,
          subtitle: "Company registration",
          stage: "Awaiting BEE Officer approval",
          action: "Review and approve the company registration",
          submittedAt: c.createdAt,
          href: "/app/manufacturer/director",
        }))
    : [];
  return [...company, ...models];
}

function TaskTable({ prefix, rows }: { prefix: string; rows: InboxRow[] }) {
  const columns: DataTableColumn<InboxRow>[] = [
    {
      key: "reference",
      header: "Reference",
      sortValue: (t) => t.reference,
      render: (t) => (
        <span className="font-mono" data-testid={`${prefix}-ref-${t.reference}`}>
          {t.reference}
        </span>
      ),
    },
    {
      key: "brand",
      header: "Brand / Model",
      sortValue: (t) => `${t.title} ${t.subtitle}`,
      render: (t) => (
        <div>
          <div className="font-semibold text-on-surface">{t.title}</div>
          <div className="font-label-sm text-label-sm text-on-surface-variant">{t.subtitle}</div>
        </div>
      ),
    },
    { key: "state", header: "Stage", sortValue: (t) => t.stage, render: (t) => t.stage },
    { key: "action", header: "To do", sortValue: (t) => t.action, render: (t) => t.action },
    { key: "submitted", header: "Submitted on", sortValue: (t) => t.submittedAt ?? "", render: (t) => (t.submittedAt ? t.submittedAt.slice(0, 10) : "—") },
    {
      key: "open",
      header: "",
      render: (t) => (
        <Link
          href={t.href}
          className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1"
          data-testid={`${prefix}-open-${t.reference}`}
        >
          Open <Icon name="arrow_forward" size={14} />
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      dateOf={(t) => t.submittedAt ?? undefined}
      dateLabel="Submitted on"
      columns={columns}
      rows={rows}
      rowKey={(t) => t.key}
      pageSize={100}
      tableTestId={`${prefix}-table`}
      filterTestId={`${prefix}-filter`}
    />
  );
}
