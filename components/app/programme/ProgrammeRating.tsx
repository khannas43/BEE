"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { DataTable, type DataTableColumn } from "@/components/app/kit/DataTable";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { DescriptionList, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { ApplicationDocuments } from "@/components/app/lifecycle/ApplicationDocuments";
import { ApplicationHistory } from "@/components/app/lifecycle/ApplicationHistory";
import { RejectApplication, RejectedNote } from "@/components/app/lifecycle/RejectApplication";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import type { StageRejectReceipt } from "@/lib/client/runtimeStageReject";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type RatingReceipt,
  ratingSignature,
  runRating,
} from "@/lib/client/runtimeRating";
import {
  type ModelApplication,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * First slice step 5: Programme computes and records the star rating (rating to director_review). PROVISIONAL LOCAL
 * DEMONSTRATION: the stars come from a local demonstration scheme, not a BEE-approved formula (decision A2 is
 * unanswered), and the screen says so. Spring decides which applications Programme may see (only the rating stage) and
 * whether a computation is allowed; this screen only shows the result.
 */
const ROUTE = "/app/model-label/rating-calculation";
const RETURN_TO = ROUTE;
const LIST_TARGET = "list";
/** All assigned rows stay visible; paging and filtering here are display only. */
const TABLE_PAGE_SIZE = 100;

// Stable loaders: useRuntimeRead takes them as effect dependencies.
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export const RATING_COPY = {
  listTitle: "Applications waiting for a rating",
  loading: "Loading applications…",
  loadingDetail: "Loading application…",
  empty: "No application is waiting for a rating.",
  provisional: "Local demonstration rating. The stars come from placeholder bands, not from a BEE-approved formula, and the result is not a BEE rating.",
  separation: "Only Programme staff who took no other part in this application can rate it, and never someone from its own organisation.",
  keepsBoth: "The applicant's declared figure is kept beside the figure you enter; neither replaces the other.",
  verifiedLabel: "Efficiency figure you verified from the test report (ISEER)",
  inputRequired: "Enter the verified efficiency figure: up to two digits and two decimals, for example 4.62.",
} as const;

const ISEER_FORMAT = /^\d{1,2}(\.\d{1,2})?$/;

export function ProgrammeRating({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();
  const [receipt, setReceipt] = useState<RatingReceipt | null>(null);
  const [rejected, setRejected] = useState<StageRejectReceipt | null>(null);

  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Compute and record the star rating"
      implemented={runtimeRouteFor(ROUTE)?.implemented}
    >
      <div className="space-y-space-md" data-testid="programme-scrutiny">
        <IdentityStrip identity={identity} testId="programme-identity" />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title={RATING_COPY.listTitle}
              read={list}
              loadingText={RATING_COPY.loading}
              loadingTestId="programme-queue-loading"
              errorTestId="programme-queue-error"
              signInReturnTo={RETURN_TO}
              isEmpty={(r) => r.list.count === 0}
              emptyText={RATING_COPY.empty}
              emptyTestId="programme-queue-empty"
              resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>}
            >
              {(r) => <QueueTable items={r.list.items} selectedId={selectedId} />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2" data-testid="programme-detail" data-selected-id={selectedId}>
              {rejected && rejected.applicationId === selectedId ? (
                <RejectedNote receipt={rejected} backHref={ROUTE} testIdPrefix="programme" />
              ) : receipt && receipt.applicationId === selectedId ? (
                <RatedNote receipt={receipt} />
              ) : (
                <ReadPanel
                  title="Application and evidence"
                  read={detail}
                  loadingText={RATING_COPY.loadingDetail}
                  errorTestId="programme-detail-error"
                  signInReturnTo={RETURN_TO}
                  action={
                    <Link href={ROUTE} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="programme-detail-close">
                      Close <Icon name="close" size={14} />
                    </Link>
                  }
                >
                  {(r) => (
                    <DetailAndRate
                      application={r.application}
                      onRated={(done) => {
                        setReceipt(done);
                        revalidation.refresh();
                      }}
                      onRejected={(done) => {
                        setRejected(done);
                        revalidation.refresh();
                      }}
                      onReload={revalidation.refresh}
                    />
                  )}
                </ReadPanel>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

function QueueTable({ items, selectedId }: { items: ModelApplication[]; selectedId: string | null }) {
  const columns: DataTableColumn<ModelApplication>[] = [
    {
      key: "reference",
      header: "Reference",
      sortValue: (a) => a.reference,
      render: (a) => (
        <span className="font-mono" data-testid={`programme-ref-${a.reference}`}>
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
          href={`${ROUTE}?id=${encodeURIComponent(a.id)}`}
          className={`font-label-sm text-label-sm inline-flex items-center gap-1 ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
          data-testid={`programme-open-${a.reference}`}
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
      tableTestId="programme-queue-table"
      filterTestId="programme-queue-filter"
    />
  );
}

function RatedNote({ receipt }: { receipt: RatingReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="programme-rate-success">
      <p className="font-body-md text-body-md">
        Rating recorded for <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-md text-body-md mt-space-sm" data-testid="programme-rate-stars">
        {"★".repeat(receipt.stars)}{"☆".repeat(5 - receipt.stars)} {receipt.stars} {receipt.stars === 1 ? "star" : "stars"}
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        Declared {receipt.declaredIseer}, verified {receipt.verifiedIseer} · rating version {receipt.ratingVersion} · version {receipt.version}.
      </p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">{RATING_COPY.provisional}</p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="programme-rate-back">
        Back to the queue
      </Link>
    </div>
  );
}

function DetailAndRate({
  application,
  onRated,
  onRejected,
  onReload,
}: {
  application: ModelApplication;
  onRated: (receipt: RatingReceipt) => void;
  onRejected: (receipt: StageRejectReceipt) => void;
  onReload: () => void;
}) {
  const [figure, setFigure] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runRating, ratingSignature);

  async function rate() {
    const text = figure.trim();
    if (!ISEER_FORMAT.test(text) || Number(text) <= 0) {
      setInputError(RATING_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, verifiedIseer: text });
    if (result?.ok) onRated(result.value);
  }

  return (
    <div>
      <DescriptionList
        testId="programme-detail-fields"
        rows={[
          { label: "Reference", value: application.reference, mono: true },
          { label: "Organisation", value: application.organisation },
          { label: "Brand", value: application.brandName },
          { label: "Model number", value: application.modelNumber },
          { label: "Laboratory", value: application.laboratoryCode ?? "—" },
          { label: "Test date", value: application.testedOn ?? "—" },
          { label: "Declared efficiency", value: application.declaredIseer === undefined ? "—" : String(application.declaredIseer) },
          { label: "Version", value: String(application.version) },
        ]}
      />
      <h3 className="font-label-md text-label-md text-on-surface mt-space-md">Test reports</h3>
      <ApplicationDocuments key={application.id} applicationId={application.id} />
      <h3 className="font-label-md text-label-md text-on-surface mt-space-md">History</h3>
      <ApplicationHistory key={application.id} applicationId={application.id} testIdPrefix="programme-history" />
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">{RATING_COPY.provisional}</p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{RATING_COPY.separation}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void rate()}
        runLabel="Compute and record rating"
        busyLabel="Computing…"
        runTestId="programme-rate-run"
        errorTestId="programme-rate-error"
        reloadTestId="programme-rate-reload"
        onReload={onReload}
        signInReturnTo={RETURN_TO}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {RATING_COPY.verifiedLabel}
          <input
            inputMode="decimal"
            value={figure}
            onChange={(e) => setFigure(e.target.value)}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid="programme-rate-iseer"
          />
        </label>
        <p className="font-label-sm text-label-sm text-on-surface-variant">{RATING_COPY.keepsBoth}</p>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="programme-rate-input-error">{inputError}</p>
      ) : null}
      <RejectApplication application={application} testIdPrefix="programme" signInReturnTo={RETURN_TO} onRejected={onRejected} onReload={onReload} />
    </div>
  );
}
