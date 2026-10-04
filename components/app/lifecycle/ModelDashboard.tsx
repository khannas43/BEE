"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, ScreenChrome } from "@/components/app/ScreenScaffold";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { ApplicationDocuments } from "@/components/app/lifecycle/ApplicationDocuments";
import { RecordTabs } from "@/components/app/kit/RecordTabs";
import { DescriptionList, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { orgsText, rolesText, useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import { modelDraftFormHref } from "@/lib/client/runtimeModelDrafts";
import {
  type DetailRead,
  type ModelApplication,
  modelDashboardHref,
  READ_UI_MESSAGES,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const DETAIL_TAB_DETAILS = "details";
const DETAIL_TAB_DOCUMENTS = "documents";
/** Large page size keeps every scoped row visible for the live read-ui check (client-side paging only). */
const APPLICATION_TABLE_PAGE_SIZE = 100;

function detailTabFromParam(raw: string | null): string {
  return raw === DETAIL_TAB_DOCUMENTS ? DETAIL_TAB_DOCUMENTS : DETAIL_TAB_DETAILS;
}

function modelDashboardHrefWithTab(id: string, tab: string): string {
  const q = new URLSearchParams({ id });
  if (tab !== DETAIL_TAB_DETAILS) q.set("tab", tab);
  return `/app/model-label/model-dashboard?${q.toString()}`;
}

/**
 * WP05.1a read-only list/detail on the existing model-dashboard route, built on the screen kit
 * (components/app/kit, lib/client/runtimeHttp). Rows come only from the authenticated BFF; lifecycle
 * localStorage is not used here. Create/edit/submit/fee/rating/approval controls are not offered as
 * operational actions.
 *
 * Records are shown only while the Spring identity is signed in. The identity, list and selected detail
 * are read again when the tab regains focus or becomes visible, when the page is restored from the
 * back-forward cache, and every 30 s; a failed read (sign-out, expiry, revoked role, outage) replaces the
 * records instead of leaving them on screen.
 */
const RETURN_TO = "/app/model-label/model-dashboard";
const LIST_TARGET = "list";

// Stable loaders: useRuntimeRead takes them as effect dependencies.
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export function ModelDashboard({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();

  const shownList = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const shownDetail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Server-persisted applications you may read"
      implemented={runtimeRouteFor(modelDashboardHref())?.implemented}
      actions={
        identity.status === "signed-in" ? (
          <Link href={modelDraftFormHref()} className="inline-flex items-center gap-1 px-space-md py-2 rounded-lg bg-primary text-on-primary font-label-md" data-testid="model-app-new-draft">
            New application <Icon name="note_add" size={18} />
          </Link>
        ) : null
      }
    >
      <div className="space-y-space-md" data-testid="model-applications-read">
        <IdentityStrip identity={identity} />

        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title="My model applications"
              read={shownList}
              loadingText={READ_UI_MESSAGES.loading}
              loadingTestId="model-applications-loading"
              errorTestId="model-applications-list-error"
              signInReturnTo={RETURN_TO}
              isEmpty={(r) => r.list.count === 0}
              emptyText={READ_UI_MESSAGES.empty_list}
              emptyTestId="model-applications-empty"
              resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>}
            >
              {(r) => <ApplicationTable items={r.list.items} selectedId={selectedId} />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2">
              <DetailPanel selectedId={selectedId} detailRead={shownDetail} />
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

function IdentityStrip({ identity }: { identity: ReturnType<typeof useSpringIdentity> }) {
  return (
    <Card>
      <div className="flex items-start gap-space-sm" data-testid="model-applications-identity">
        <Icon name="badge" size={20} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">Signed-in identity (BEE records)</div>
          {identity.status === "loading" ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1" data-testid="model-applications-identity-loading">Checking your sign-in…</p>
          ) : identity.status === "signed-out" ? (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">No signed-in BEE identity with an active role.</p>
          ) : (
            <p className="font-body-sm text-body-sm text-on-surface mt-1">
              <span className="font-semibold">{identity.me.displayName}</span>
              {" · "}
              {rolesText(identity.me)}
              {orgsText(identity.me) ? ` · ${orgsText(identity.me)}` : ""}
            </p>
          )}
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            The development preview role above is not your identity and does not grant access to these records.
          </p>
        </div>
      </div>
    </Card>
  );
}

function ApplicationTable({ items, selectedId }: { items: ModelApplication[]; selectedId: string | null }) {
  const columns: DataTableColumn<ModelApplication>[] = [
    {
      key: "reference",
      header: "Reference",
      sortValue: (a) => a.reference,
      render: (a) => (
        <span className="font-mono" data-testid={`model-app-ref-${a.reference}`}>
          {a.reference}
        </span>
      ),
    },
    {
      key: "organisation",
      header: "Organisation",
      sortValue: (a) => a.organisation,
      render: (a) => a.organisation,
    },
    {
      key: "brand",
      header: "Brand / Model",
      sortValue: (a) => `${a.brandName} ${a.modelNumber}`,
      render: (a) => (
        <div>
          <div className="font-semibold text-on-surface">{a.brandName}</div>
          <div className="font-label-sm text-label-sm text-on-surface-variant">{a.modelNumber}</div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortValue: (a) => a.category,
      render: (a) => a.category,
    },
    {
      key: "state",
      header: "State",
      sortValue: (a) => a.state,
      render: (a) => <span className="capitalize">{stateLabel(a.state)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (a) => (
        <span className="inline-flex flex-col gap-1 items-start">
          <Link
            href={modelDashboardHref(a.id)}
            className={`font-label-sm text-label-sm inline-flex items-center gap-1 ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
            data-testid={`model-app-open-${a.reference}`}
          >
            {a.id === selectedId ? "Selected" : "View"} <Icon name="arrow_forward" size={14} />
          </Link>
          {a.state === "draft" ? (
            <Link
              href={modelDraftFormHref(a.id)}
              className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1"
              data-testid={`model-app-edit-${a.reference}`}
            >
              Edit <Icon name="edit" size={14} />
            </Link>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(a) => a.id}
      pageSize={APPLICATION_TABLE_PAGE_SIZE}
      tableTestId="model-applications-table"
      filterTestId="model-applications-table-filter"
    />
  );
}

function DetailPanel({ selectedId, detailRead }: { selectedId: string; detailRead: DetailRead | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const activeTab = detailTabFromParam(params.get("tab"));

  const onTabChange = useCallback(
    (tabId: string) => {
      router.replace(modelDashboardHrefWithTab(selectedId, tabId));
    },
    [router, selectedId],
  );

  return (
    <div data-testid="model-applications-detail" data-selected-id={selectedId}>
      <ReadPanel
        title="Application detail"
        read={detailRead}
        loadingText={READ_UI_MESSAGES.loading_detail}
        errorTestId="model-applications-detail-error"
        signInReturnTo={RETURN_TO}
        action={
          <Link href={modelDashboardHref()} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="model-app-detail-close">
            Close <Icon name="close" size={14} />
          </Link>
        }
      >
        {(r) => (
          <>
            <RecordTabs
              tabs={[
                {
                  id: DETAIL_TAB_DETAILS,
                  label: "Details",
                  render: () => <DetailFields application={r.application} />,
                },
                {
                  id: DETAIL_TAB_DOCUMENTS,
                  label: "Documents",
                  render: () => <ApplicationDocuments key={r.application.id} applicationId={r.application.id} />,
                },
              ]}
              activeTabId={activeTab}
              onTabChange={onTabChange}
              tabListTestId="model-app-detail-tabs"
              tabTestId={(id) => `model-app-detail-tab-${id}`}
              panelTestId={(id) => `model-app-detail-panel-${id}`}
            />
            {r.application.state === "draft" ? (
              <Link
                href={modelDraftFormHref(r.application.id)}
                className="inline-flex items-center gap-1 mt-space-md px-space-md py-2 rounded-lg bg-primary text-on-primary font-label-md"
                data-testid="model-app-detail-edit"
              >
                Edit draft <Icon name="edit" size={18} />
              </Link>
            ) : null}
          </>
        )}
      </ReadPanel>
    </div>
  );
}

function DetailFields({ application }: { application: ModelApplication }) {
  return (
    <DescriptionList
      testId="model-applications-detail-fields"
      rows={[
        { label: "Reference", value: application.reference, mono: true },
        { label: "Organisation", value: application.organisation },
        { label: "Brand", value: application.brandName },
        { label: "Model number", value: application.modelNumber },
        { label: "Category", value: application.category },
        { label: "State", value: stateLabel(application.state), capitalize: true },
        { label: "Version", value: String(application.version) },
        { label: "Read basis", value: application.readBasis.join(", ") },
        { label: "Record id", value: application.id, mono: true },
      ]}
    />
  );
}
