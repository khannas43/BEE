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
import { ReturnToApplicant, ReturnedNote } from "@/components/app/lifecycle/ReturnToApplicant";
import { RejectApplication, RejectedNote } from "@/components/app/lifecycle/RejectApplication";
import type { StageRejectReceipt } from "@/lib/client/runtimeStageReject";
import type { StageReturnReceipt } from "@/lib/client/runtimeStageReturn";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type ReviewerForwardReceipt,
  reviewerForwardSignature,
  runReviewerForward,
} from "@/lib/client/runtimeReviewerForward";
import {
  type ModelApplication,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * First slice step 4: the assigned Reviewer verifies the application and forwards it to rating (bee_scrutiny to rating).
 * Spring decides which applications the reviewer may see (only those assigned at this stage) and whether a forward is
 * allowed; this screen only shows the result. Provisional local rules, not BEE rules.
 */
const ROUTE = "/app/model-label/bee-scrutiny";
const RETURN_TO = ROUTE;
const LIST_TARGET = "list";
const NOTE_MAX = 500;
/** All assigned rows stay visible; paging and filtering here are display only. */
const TABLE_PAGE_SIZE = 100;

// Stable loaders: useRuntimeRead takes them as effect dependencies.
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export const REVIEWER_COPY = {
  listTitle: "Applications assigned to you for BEE scrutiny",
  loading: "Loading applications…",
  loadingDetail: "Loading application…",
  empty: "No application is assigned to you for BEE scrutiny.",
  provisional: "These checks are provisional local rules, not BEE rules. The IAME officer's finding is not shown here yet; the system makes no accreditation, authenticity or malware claim about a report.",
  separation: "Only the assigned reviewer who took no other part in this application can forward it, and never someone from its own organisation.",
  forwardNote: "Forwarding sends the application to the Programme team for the rating. Returning an application is a later step.",
  noteLabel: "Note for the Programme team",
  inputRequired: "Write a note of up to 500 characters.",
} as const;

export function ReviewerScrutiny({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();
  const [receipt, setReceipt] = useState<ReviewerForwardReceipt | null>(null);
  const [returned, setReturned] = useState<StageReturnReceipt | null>(null);
  const [rejected, setRejected] = useState<StageRejectReceipt | null>(null);

  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Verify the application and forward it to rating"
      implemented={runtimeRouteFor(ROUTE)?.implemented}
    >
      <div className="space-y-space-md" data-testid="reviewer-scrutiny">
        <IdentityStrip identity={identity} testId="reviewer-identity" />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title={REVIEWER_COPY.listTitle}
              read={list}
              loadingText={REVIEWER_COPY.loading}
              loadingTestId="reviewer-queue-loading"
              errorTestId="reviewer-queue-error"
              signInReturnTo={RETURN_TO}
              isEmpty={(r) => r.list.count === 0}
              emptyText={REVIEWER_COPY.empty}
              emptyTestId="reviewer-queue-empty"
              resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>}
            >
              {(r) => <QueueTable items={r.list.items} selectedId={selectedId} />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2" data-testid="reviewer-detail" data-selected-id={selectedId}>
              {rejected && rejected.applicationId === selectedId ? (
                <RejectedNote receipt={rejected} backHref={ROUTE} testIdPrefix="reviewer" />
              ) : returned && returned.applicationId === selectedId ? (
                <ReturnedNote receipt={returned} backHref={ROUTE} testIdPrefix="reviewer" />
              ) : receipt && receipt.applicationId === selectedId ? (
                <ForwardedNote receipt={receipt} />
              ) : (
                <ReadPanel
                  title="Application and evidence"
                  read={detail}
                  loadingText={REVIEWER_COPY.loadingDetail}
                  errorTestId="reviewer-detail-error"
                  signInReturnTo={RETURN_TO}
                  action={
                    <Link href={ROUTE} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="reviewer-detail-close">
                      Close <Icon name="close" size={14} />
                    </Link>
                  }
                >
                  {(r) => (
                    <DetailAndForward
                      application={r.application}
                      onForwarded={(done) => {
                        setReceipt(done);
                        revalidation.refresh();
                      }}
                      onReturned={(done) => {
                        setReturned(done);
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
        <span className="font-mono" data-testid={`reviewer-ref-${a.reference}`}>
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
          data-testid={`reviewer-open-${a.reference}`}
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
      tableTestId="reviewer-queue-table"
      filterTestId="reviewer-queue-filter"
    />
  );
}

function ForwardedNote({ receipt }: { receipt: ReviewerForwardReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reviewer-forward-success">
      <p className="font-body-md text-body-md">
        Forwarded <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        Version {receipt.version}.
      </p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="reviewer-forward-back">
        Back to the queue
      </Link>
    </div>
  );
}

function DetailAndForward({
  application,
  onForwarded,
  onReturned,
  onRejected,
  onReload,
}: {
  application: ModelApplication;
  onForwarded: (receipt: ReviewerForwardReceipt) => void;
  onReturned: (receipt: StageReturnReceipt) => void;
  onRejected: (receipt: StageRejectReceipt) => void;
  onReload: () => void;
}) {
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runReviewerForward, reviewerForwardSignature);

  async function forward() {
    const text = note.trim();
    if (!text || text.length > NOTE_MAX) {
      setInputError(REVIEWER_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, note: text });
    if (result?.ok) onForwarded(result.value);
  }

  return (
    <div>
      <DescriptionList
        testId="reviewer-detail-fields"
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
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">{REVIEWER_COPY.provisional}</p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{REVIEWER_COPY.separation}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void forward()}
        runLabel="Forward to rating"
        busyLabel="Forwarding…"
        runTestId="reviewer-forward-run"
        errorTestId="reviewer-forward-error"
        reloadTestId="reviewer-forward-reload"
        onReload={onReload}
        signInReturnTo={RETURN_TO}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {REVIEWER_COPY.noteLabel}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid="reviewer-forward-note"
          />
        </label>
        <p className="font-label-sm text-label-sm text-on-surface-variant">{REVIEWER_COPY.forwardNote}</p>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="reviewer-forward-input-error">{inputError}</p>
      ) : null}
      <ReturnToApplicant application={application} testIdPrefix="reviewer" signInReturnTo={RETURN_TO} onReturned={onReturned} onReload={onReload} />
      <RejectApplication application={application} testIdPrefix="reviewer" signInReturnTo={RETURN_TO} onRejected={onRejected} onReload={onReload} />
    </div>
  );
}
