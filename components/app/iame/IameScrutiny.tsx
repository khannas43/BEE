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
  type IameRecommendationReceipt,
  type IameVerification,
  iameRecommendationSignature,
  runIameRecommendation,
} from "@/lib/client/runtimeIameRecommendation";
import {
  type ModelApplication,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * First slice step 3: the assigned IAME officer records a verification finding on the uploaded test report and recommends
 * forwarding the application to BEE scrutiny (iame_scrutiny to bee_scrutiny). Spring decides which applications the officer
 * may see (only those assigned at this stage) and whether a recommendation is allowed; this screen only shows the result.
 * Provisional local rules, not BEE rules (decision B8).
 */
const ROUTE = "/app/model-label/iame-scrutiny";
const RETURN_TO = ROUTE;
const LIST_TARGET = "list";
const NOTE_MAX = 500;
/** All assigned rows stay visible; paging and filtering here are display only. */
const TABLE_PAGE_SIZE = 100;

// Stable loaders: useRuntimeRead takes them as effect dependencies.
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export const IAME_COPY = {
  listTitle: "Applications assigned to you for scrutiny",
  loading: "Loading applications…",
  loadingDetail: "Loading application…",
  empty: "No application is assigned to you for scrutiny.",
  provisional: "These checks are provisional local rules, not BEE rules. The system makes no accreditation, authenticity or malware claim about a report; the finding below is yours.",
  separation: "Only the assigned officer who took no other part in this application can record the recommendation, and never someone from its own organisation.",
  forwardNote: "Either finding forwards the application to BEE scrutiny with your note. Returning an application to the applicant is a later step.",
  verifiedLabel: "Verified: the report is complete and matches the application",
  notVerifiedLabel: "Not verified: the report is incomplete or does not match",
  noteLabel: "Note for the reviewer",
  inputRequired: "Choose a finding and write a note of up to 500 characters.",
} as const;

export function IameScrutiny({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();
  const [receipt, setReceipt] = useState<IameRecommendationReceipt | null>(null);
  const [returned, setReturned] = useState<StageReturnReceipt | null>(null);
  const [rejected, setRejected] = useState<StageRejectReceipt | null>(null);

  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Record your finding and recommend forwarding"
      implemented={runtimeRouteFor(ROUTE)?.implemented}
    >
      <div className="space-y-space-md" data-testid="iame-scrutiny">
        <IdentityStrip identity={identity} testId="iame-identity" />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title={IAME_COPY.listTitle}
              read={list}
              loadingText={IAME_COPY.loading}
              loadingTestId="iame-queue-loading"
              errorTestId="iame-queue-error"
              signInReturnTo={RETURN_TO}
              isEmpty={(r) => r.list.count === 0}
              emptyText={IAME_COPY.empty}
              emptyTestId="iame-queue-empty"
              resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>}
            >
              {(r) => <QueueTable items={r.list.items} selectedId={selectedId} />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2" data-testid="iame-detail" data-selected-id={selectedId}>
              {rejected && rejected.applicationId === selectedId ? (
                <RejectedNote receipt={rejected} backHref={ROUTE} testIdPrefix="iame" />
              ) : returned && returned.applicationId === selectedId ? (
                <ReturnedNote receipt={returned} backHref={ROUTE} testIdPrefix="iame" />
              ) : receipt && receipt.applicationId === selectedId ? (
                <RecommendedNote receipt={receipt} />
              ) : (
                <ReadPanel
                  title="Application and evidence"
                  read={detail}
                  loadingText={IAME_COPY.loadingDetail}
                  errorTestId="iame-detail-error"
                  signInReturnTo={RETURN_TO}
                  action={
                    <Link href={ROUTE} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="iame-detail-close">
                      Close <Icon name="close" size={14} />
                    </Link>
                  }
                >
                  {(r) => (
                    <DetailAndRecommend
                      application={r.application}
                      onRecommended={(done) => {
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
        <span className="font-mono" data-testid={`iame-ref-${a.reference}`}>
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
          data-testid={`iame-open-${a.reference}`}
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
      tableTestId="iame-queue-table"
      filterTestId="iame-queue-filter"
    />
  );
}

function RecommendedNote({ receipt }: { receipt: IameRecommendationReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="iame-recommend-success">
      <p className="font-body-md text-body-md">
        Recommendation recorded for <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        Finding: {receipt.verification === "verified" ? "verified" : "not verified"} · version {receipt.version}.
      </p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="iame-recommend-back">
        Back to the queue
      </Link>
    </div>
  );
}

function DetailAndRecommend({
  application,
  onRecommended,
  onReturned,
  onRejected,
  onReload,
}: {
  application: ModelApplication;
  onRecommended: (receipt: IameRecommendationReceipt) => void;
  onReturned: (receipt: StageReturnReceipt) => void;
  onRejected: (receipt: StageRejectReceipt) => void;
  onReload: () => void;
}) {
  const [verification, setVerification] = useState<IameVerification | "">("");
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runIameRecommendation, iameRecommendationSignature);

  async function recommend() {
    const text = note.trim();
    if (!verification || !text || text.length > NOTE_MAX) {
      setInputError(IAME_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, verification, note: text });
    if (result?.ok) onRecommended(result.value);
  }

  return (
    <div>
      <DescriptionList
        testId="iame-detail-fields"
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
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">{IAME_COPY.provisional}</p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{IAME_COPY.separation}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void recommend()}
        runLabel="Record finding and forward"
        busyLabel="Recording…"
        runTestId="iame-recommend-run"
        errorTestId="iame-recommend-error"
        reloadTestId="iame-recommend-reload"
        onReload={onReload}
        signInReturnTo={RETURN_TO}
      >
        <fieldset className="space-y-1">
          <legend className="font-label-sm text-label-sm text-on-surface-variant">Finding on the test report</legend>
          <label className="flex items-start gap-2 font-body-sm">
            <input type="radio" name="iame-verification" checked={verification === "verified"} onChange={() => setVerification("verified")} data-testid="iame-verification-verified" />
            {IAME_COPY.verifiedLabel}
          </label>
          <label className="flex items-start gap-2 font-body-sm">
            <input type="radio" name="iame-verification" checked={verification === "not_verified"} onChange={() => setVerification("not_verified")} data-testid="iame-verification-not-verified" />
            {IAME_COPY.notVerifiedLabel}
          </label>
        </fieldset>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {IAME_COPY.noteLabel}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid="iame-recommend-note"
          />
        </label>
        <p className="font-label-sm text-label-sm text-on-surface-variant">{IAME_COPY.forwardNote}</p>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="iame-recommend-input-error">{inputError}</p>
      ) : null}
      <ReturnToApplicant application={application} testIdPrefix="iame" signInReturnTo={RETURN_TO} onReturned={onReturned} onReload={onReload} />
      <RejectApplication application={application} testIdPrefix="iame" signInReturnTo={RETURN_TO} onRejected={onRejected} onReload={onReload} />
    </div>
  );
}
