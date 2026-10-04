"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { DescriptionList, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { ApplicationDocuments } from "@/components/app/lifecycle/ApplicationDocuments";
import { ApplicationHistory } from "@/components/app/lifecycle/ApplicationHistory";
import { ReturnToApplicant, ReturnedNote } from "@/components/app/lifecycle/ReturnToApplicant";
import { RejectApplication, RejectedNote } from "@/components/app/lifecycle/RejectApplication";
import type { StageRejectReceipt } from "@/lib/client/runtimeStageReject";
import type { StageReturnReceipt } from "@/lib/client/runtimeStageReturn";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type DetailRead,
  type ModelApplication,
  readModelApplication,
  readModelApplicationList,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const LIST_TARGET = "list";
/** All assigned rows stay visible; paging and filtering here are display only. */
const TABLE_PAGE_SIZE = 100;

const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export type StageWorkCopy = {
  listTitle: string;
  loading: string;
  loadingDetail: string;
  empty: string;
  provisional: string;
};

export type StageWorkHelpers = {
  reload: () => void;
};

export type StageWorkScreenProps = {
  module: Module;
  screen: Screen;
  route: string;
  subtitle: string;
  screenTestId: string;
  testIdPrefix: string;
  copy: StageWorkCopy;
  detailFieldsTestId: string;
  historyTestIdPrefix: string;
  showReturnPanel?: boolean;
  returnRejectTestIdPrefix?: string | ((application: ModelApplication) => string);
  detailRows: (application: ModelApplication) => Parameters<typeof DescriptionList>[0]["rows"];
  renderExtraDetail?: (application: ModelApplication) => ReactNode;
  renderPrimary: (application: ModelApplication, helpers: StageWorkHelpers) => ReactNode;
  /** When set, replaces the whole detail aside (Director uses this for unified done state). */
  renderDetailAside?: (selectedId: string) => ReactNode | null | undefined;
  /** Primary command success note when `renderDetailAside` is not used. */
  renderPrimaryDone?: (selectedId: string) => ReactNode | null;
  /** When set, return/reject success is owned by the screen (e.g. Director unified done state). */
  onReturned?: (receipt: StageReturnReceipt) => void;
  onRejected?: (receipt: StageRejectReceipt) => void;
};

function resolvePrefix(
  application: ModelApplication,
  prefix: string | ((application: ModelApplication) => string),
): string {
  return typeof prefix === "function" ? prefix(application) : prefix;
}

export function StageWorkScreen({
  module,
  screen,
  route,
  subtitle,
  screenTestId,
  testIdPrefix,
  copy,
  detailFieldsTestId,
  historyTestIdPrefix,
  showReturnPanel = true,
  returnRejectTestIdPrefix: returnRejectPrefixProp,
  detailRows,
  renderExtraDetail,
  renderPrimary,
  renderDetailAside,
  renderPrimaryDone,
  onReturned: onReturnedExternal,
  onRejected: onRejectedExternal,
}: StageWorkScreenProps) {
  const returnRejectTestIdPrefix = returnRejectPrefixProp ?? testIdPrefix;
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();
  const [returned, setReturned] = useState<StageReturnReceipt | null>(null);
  const [rejected, setRejected] = useState<StageRejectReceipt | null>(null);

  const onReturned = (receipt: StageReturnReceipt) => {
    if (onReturnedExternal) {
      onReturnedExternal(receipt);
    } else {
      setReturned(receipt);
    }
    revalidation.refresh();
  };
  const onRejected = (receipt: StageRejectReceipt) => {
    if (onRejectedExternal) {
      onRejectedExternal(receipt);
    } else {
      setRejected(receipt);
    }
    revalidation.refresh();
  };

  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  const helpers: StageWorkHelpers = { reload: revalidation.refresh };

  const customAside = selectedId && renderDetailAside ? renderDetailAside(selectedId) : undefined;

  return (
    <ScreenChrome module={module} screen={screen} subtitle={subtitle} implemented={runtimeRouteFor(route)?.implemented}>
      <div className="space-y-space-md" data-testid={screenTestId}>
        <IdentityStrip identity={identity} testId={`${testIdPrefix}-identity`} />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title={copy.listTitle}
              read={list}
              loadingText={copy.loading}
              loadingTestId={`${testIdPrefix}-queue-loading`}
              errorTestId={`${testIdPrefix}-queue-error`}
              signInReturnTo={route}
              isEmpty={(r) => r.list.count === 0}
              emptyText={copy.empty}
              emptyTestId={`${testIdPrefix}-queue-empty`}
              resultAction={(r) => (
                <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>
              )}
            >
              {(r) => <StageQueueTable route={route} testIdPrefix={testIdPrefix} items={r.list.items} selectedId={selectedId} />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2" data-testid={`${testIdPrefix}-detail`} data-selected-id={selectedId}>
              {customAside !== undefined && customAside !== null ? (
                customAside
              ) : (
                <DefaultDetailAside
                  route={route}
                  testIdPrefix={testIdPrefix}
                  selectedId={selectedId}
                  copy={copy}
                  detailFieldsTestId={detailFieldsTestId}
                  historyTestIdPrefix={historyTestIdPrefix}
                  showReturnPanel={showReturnPanel}
                  returnRejectTestIdPrefix={returnRejectTestIdPrefix}
                  detailRows={detailRows}
                  renderExtraDetail={renderExtraDetail}
                  renderPrimary={renderPrimary}
                  renderPrimaryDone={renderPrimaryDone}
                  detail={detail}
                  returned={returned}
                  rejected={rejected}
                  onReturned={onReturned}
                  onRejected={onRejected}
                  useInternalReturnReject={!onReturnedExternal && !onRejectedExternal}
                  helpers={helpers}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

function StageQueueTable({
  route,
  testIdPrefix,
  items,
  selectedId,
}: {
  route: string;
  testIdPrefix: string;
  items: ModelApplication[];
  selectedId: string | null;
}) {
  const columns: DataTableColumn<ModelApplication>[] = [
    {
      key: "reference",
      header: "Reference",
      sortValue: (a) => a.reference,
      render: (a) => (
        <span className="font-mono" data-testid={`${testIdPrefix}-ref-${a.reference}`}>
          {a.reference}
        </span>
      ),
    },
    { key: "organisation", header: "Organisation", sortValue: (a) => a.organisation, render: (a) => a.organisation },
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
    { key: "category", header: "Category", sortValue: (a) => a.category, render: (a) => a.category },
    {
      key: "open",
      header: "",
      render: (a) => (
        <Link
          href={`${route}?id=${encodeURIComponent(a.id)}`}
          className={`font-label-sm text-label-sm inline-flex items-center gap-1 ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
          data-testid={`${testIdPrefix}-open-${a.reference}`}
        >
          {a.id === selectedId ? "Selected" : "Review"} <Icon name="arrow_forward" size={14} />
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(a) => a.id}
      pageSize={TABLE_PAGE_SIZE}
      tableTestId={`${testIdPrefix}-queue-table`}
      filterTestId={`${testIdPrefix}-queue-filter`}
    />
  );
}

function DefaultDetailAside({
  route,
  testIdPrefix,
  selectedId,
  copy,
  detailFieldsTestId,
  historyTestIdPrefix,
  showReturnPanel,
  returnRejectTestIdPrefix,
  detailRows,
  renderExtraDetail,
  renderPrimary,
  renderPrimaryDone,
  detail,
  returned,
  rejected,
  onReturned,
  onRejected,
  useInternalReturnReject,
  helpers,
}: {
  route: string;
  testIdPrefix: string;
  selectedId: string;
  copy: StageWorkCopy;
  detailFieldsTestId: string;
  historyTestIdPrefix: string;
  showReturnPanel: boolean;
  returnRejectTestIdPrefix: string | ((application: ModelApplication) => string);
  detailRows: (application: ModelApplication) => Parameters<typeof DescriptionList>[0]["rows"];
  renderExtraDetail?: (application: ModelApplication) => ReactNode;
  renderPrimary: (application: ModelApplication, helpers: StageWorkHelpers) => ReactNode;
  renderPrimaryDone?: (selectedId: string) => ReactNode | null;
  detail: DetailRead | null;
  returned: StageReturnReceipt | null;
  rejected: StageRejectReceipt | null;
  onReturned: (receipt: StageReturnReceipt) => void;
  onRejected: (receipt: StageRejectReceipt) => void;
  useInternalReturnReject: boolean;
  helpers: StageWorkHelpers;
}) {
  if (useInternalReturnReject && rejected && rejected.applicationId === selectedId) {
    return <RejectedNote receipt={rejected} backHref={route} testIdPrefix={testIdPrefix} />;
  }
  if (useInternalReturnReject && returned && returned.applicationId === selectedId) {
    return <ReturnedNote receipt={returned} backHref={route} testIdPrefix={testIdPrefix} />;
  }
  const primaryDone = renderPrimaryDone?.(selectedId);
  if (primaryDone) {
    return primaryDone;
  }

  return (
    <ReadPanel
      title="Application and evidence"
      read={detail}
      loadingText={copy.loadingDetail}
      errorTestId={`${testIdPrefix}-detail-error`}
      signInReturnTo={route}
      action={
        <Link
          href={route}
          className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1"
          data-testid={`${testIdPrefix}-detail-close`}
        >
          Close <Icon name="close" size={14} />
        </Link>
      }
    >
      {(r) => (
        <StageDetailBody
          application={r.application}
          copy={copy}
          detailFieldsTestId={detailFieldsTestId}
          historyTestIdPrefix={historyTestIdPrefix}
          showReturnPanel={showReturnPanel}
          returnRejectTestIdPrefix={returnRejectTestIdPrefix}
          detailRows={detailRows}
          renderExtraDetail={renderExtraDetail}
          renderPrimary={renderPrimary}
          route={route}
          onReturned={onReturned}
          onRejected={onRejected}
          helpers={helpers}
        />
      )}
    </ReadPanel>
  );
}

function StageDetailBody({
  application,
  copy,
  detailFieldsTestId,
  historyTestIdPrefix,
  showReturnPanel,
  returnRejectTestIdPrefix,
  detailRows,
  renderExtraDetail,
  renderPrimary,
  route,
  onReturned,
  onRejected,
  helpers,
}: {
  application: ModelApplication;
  copy: StageWorkCopy;
  detailFieldsTestId: string;
  historyTestIdPrefix: string;
  showReturnPanel: boolean;
  returnRejectTestIdPrefix: string | ((application: ModelApplication) => string);
  detailRows: (application: ModelApplication) => Parameters<typeof DescriptionList>[0]["rows"];
  renderExtraDetail?: (application: ModelApplication) => ReactNode;
  renderPrimary: (application: ModelApplication, helpers: StageWorkHelpers) => ReactNode;
  route: string;
  onReturned: (receipt: StageReturnReceipt) => void;
  onRejected: (receipt: StageRejectReceipt) => void;
  helpers: StageWorkHelpers;
}) {
  const panelPrefix = resolvePrefix(application, returnRejectTestIdPrefix);
  return (
    <div>
      <DescriptionList testId={detailFieldsTestId} rows={detailRows(application)} />
      {renderExtraDetail?.(application)}
      <h3 className="font-label-md text-label-md text-on-surface mt-space-md">Test reports</h3>
      <ApplicationDocuments key={application.id} applicationId={application.id} />
      <h3 className="font-label-md text-label-md text-on-surface mt-space-md">History</h3>
      <ApplicationHistory key={application.id} applicationId={application.id} testIdPrefix={historyTestIdPrefix} />
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">{copy.provisional}</p>
      {renderPrimary(application, helpers)}
      {showReturnPanel ? (
        <ReturnToApplicant
          application={application}
          testIdPrefix={panelPrefix}
          signInReturnTo={route}
          onReturned={onReturned}
          onReload={helpers.reload}
        />
      ) : null}
      <RejectApplication
        application={application}
        testIdPrefix={panelPrefix}
        signInReturnTo={route}
        onRejected={onRejected}
        onReload={helpers.reload}
      />
    </div>
  );
}
