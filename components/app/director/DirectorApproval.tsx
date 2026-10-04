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
import type { StageReturnReceipt } from "@/lib/client/runtimeStageReturn";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type DirectorRecommendationReceipt,
  directorRecommendationSignature,
  runDirectorRecommendation,
} from "@/lib/client/runtimeDirectorRecommendation";
import {
  type SecretaryApprovalReceipt,
  secretaryApprovalSignature,
  runSecretaryApproval,
} from "@/lib/client/runtimeSecretaryApproval";
import {
  type ModelApplication,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * First slice steps 6 and 7 on one screen, as the matrix lays it out. The Program Director reviews the rating and
 * recommends approval (director_review to secretary_approval, or straight to approved where the recommendation is final
 * for the category; PROVISIONAL LOCAL ASSUMPTION on decision D1, chosen by the owner and not by BEE). The Secretary then
 * gives final approval (secretary_approval to approved, the end of the first slice). Each role sees only its own stage,
 * and the action offered follows the application's state. The rating shown is a local demonstration, never a BEE rating.
 * Spring decides what each role may see and whether an action is allowed; this screen only shows the result.
 */
const ROUTE = "/app/model-label/director-approval";
const RETURN_TO = ROUTE;
const LIST_TARGET = "list";
const NOTE_MAX = 500;
/** All assigned rows stay visible; paging and filtering here are display only. */
const TABLE_PAGE_SIZE = 100;

// Stable loaders: useRuntimeRead takes them as effect dependencies.
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export const DIRECTOR_COPY = {
  listTitle: "Applications waiting for your decision",
  loading: "Loading applications…",
  loadingDetail: "Loading application…",
  empty: "No application is waiting for your decision.",
  provisional: "Provisional local rules, not BEE rules. The rating shown is a local demonstration, not a BEE rating.",
  separation: "Only the Director who took no other part in this application can recommend, and never someone from its own organisation.",
  finalNote: "For some categories the Director's recommendation is final and the application is approved without the Secretary (an owner assumption on decision D1, not a BEE rule). The receipt says which applied.",
  noteLabel: "Note for the record",
  inputRequired: "Write a note of up to 500 characters.",
  noRating: "No rating has been recorded for this application.",
  secretarySeparation: "Only the Secretary who took no other part in this application can approve it (so not the Director who recommended it), and never someone from its own organisation.",
  secretaryNote: "Approval is the end of the first slice. Label, QR code and certificate follow in later work packages.",
} as const;

export function DirectorApproval({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();
  const [done, setDone] = useState<{ kind: "director"; receipt: DirectorRecommendationReceipt } | { kind: "secretary"; receipt: SecretaryApprovalReceipt } | { kind: "returned"; receipt: StageReturnReceipt } | null>(null);

  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Review the rating and recommend approval"
      implemented={runtimeRouteFor(ROUTE)?.implemented}
    >
      <div className="space-y-space-md" data-testid="director-scrutiny">
        <IdentityStrip identity={identity} testId="director-identity" />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title={DIRECTOR_COPY.listTitle}
              read={list}
              loadingText={DIRECTOR_COPY.loading}
              loadingTestId="director-queue-loading"
              errorTestId="director-queue-error"
              signInReturnTo={RETURN_TO}
              isEmpty={(r) => r.list.count === 0}
              emptyText={DIRECTOR_COPY.empty}
              emptyTestId="director-queue-empty"
              resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>}
            >
              {(r) => <QueueTable items={r.list.items} selectedId={selectedId} />}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2" data-testid="director-detail" data-selected-id={selectedId}>
              {done && done.receipt.applicationId === selectedId ? (
                done.kind === "director" ? <RecommendedNote receipt={done.receipt} />
                  : done.kind === "secretary" ? <ApprovedNote receipt={done.receipt} />
                  : <ReturnedNote receipt={done.receipt} backHref={ROUTE} testIdPrefix="director" />
              ) : (
                <ReadPanel
                  title="Application and evidence"
                  read={detail}
                  loadingText={DIRECTOR_COPY.loadingDetail}
                  errorTestId="director-detail-error"
                  signInReturnTo={RETURN_TO}
                  action={
                    <Link href={ROUTE} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="director-detail-close">
                      Close <Icon name="close" size={14} />
                    </Link>
                  }
                >
                  {(r) => (
                    <DetailAndDecide
                      application={r.application}
                      onRecommended={(receipt) => {
                        setDone({ kind: "director", receipt });
                        revalidation.refresh();
                      }}
                      onApproved={(receipt) => {
                        setDone({ kind: "secretary", receipt });
                        revalidation.refresh();
                      }}
                      onReturned={(receipt) => {
                        setDone({ kind: "returned", receipt });
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
        <span className="font-mono" data-testid={`director-ref-${a.reference}`}>
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
          data-testid={`director-open-${a.reference}`}
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
      tableTestId="director-queue-table"
      filterTestId="director-queue-filter"
    />
  );
}

function RecommendedNote({ receipt }: { receipt: DirectorRecommendationReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="director-recommend-success">
      <p className="font-body-md text-body-md">
        Recommendation recorded for <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        {receipt.directorFinal ? "Final for this category: approved without the Secretary." : "Sent to the Secretary for final approval."} · version {receipt.version}.
      </p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="director-recommend-back">
        Back to the queue
      </Link>
    </div>
  );
}

function ApprovedNote({ receipt }: { receipt: SecretaryApprovalReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="secretary-approve-success">
      <p className="font-body-md text-body-md">
        Final approval recorded for <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        Version {receipt.version}. This is the end of the first slice; label, QR code and certificate follow in later work packages.
      </p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="secretary-approve-back">
        Back to the queue
      </Link>
    </div>
  );
}

function DetailAndDecide({
  application,
  onRecommended,
  onApproved,
  onReturned,
  onReload,
}: {
  application: ModelApplication;
  onRecommended: (receipt: DirectorRecommendationReceipt) => void;
  onApproved: (receipt: SecretaryApprovalReceipt) => void;
  onReturned: (receipt: StageReturnReceipt) => void;
  onReload: () => void;
}) {
  return (
    <div>
      <DescriptionList
        testId="director-detail-fields"
        rows={[
          { label: "Reference", value: application.reference, mono: true },
          { label: "Organisation", value: application.organisation },
          { label: "Brand", value: application.brandName },
          { label: "Model number", value: application.modelNumber },
          { label: "Laboratory", value: application.laboratoryCode ?? "—" },
          { label: "Test date", value: application.testedOn ?? "—" },
          { label: "Declared efficiency", value: application.declaredIseer === undefined ? "—" : String(application.declaredIseer) },
          { label: "Stage", value: stateLabel(application.state) },
          { label: "Version", value: String(application.version) },
        ]}
      />
      <RatingBlock application={application} />
      <h3 className="font-label-md text-label-md text-on-surface mt-space-md">Test reports</h3>
      <ApplicationDocuments key={application.id} applicationId={application.id} />
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">{DIRECTOR_COPY.provisional}</p>
      {application.state === "secretary_approval" ? (
        <SecretaryActions application={application} onApproved={onApproved} onReload={onReload} />
      ) : (
        <DirectorActions application={application} onRecommended={onRecommended} onReload={onReload} />
      )}
      <ReturnToApplicant application={application} testIdPrefix={application.state === "secretary_approval" ? "secretary" : "director"} signInReturnTo={RETURN_TO} onReturned={onReturned} onReload={onReload} />
    </div>
  );
}

function DirectorActions({
  application,
  onRecommended,
  onReload,
}: {
  application: ModelApplication;
  onRecommended: (receipt: DirectorRecommendationReceipt) => void;
  onReload: () => void;
}) {
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runDirectorRecommendation, directorRecommendationSignature);

  async function recommend() {
    const text = note.trim();
    if (!text || text.length > NOTE_MAX) {
      setInputError(DIRECTOR_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, note: text });
    if (result?.ok) onRecommended(result.value);
  }

  return (
    <>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{DIRECTOR_COPY.separation}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void recommend()}
        runLabel="Recommend approval"
        busyLabel="Recording…"
        runTestId="director-recommend-run"
        errorTestId="director-recommend-error"
        reloadTestId="director-recommend-reload"
        onReload={onReload}
        signInReturnTo={RETURN_TO}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {DIRECTOR_COPY.noteLabel}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid="director-recommend-note"
          />
        </label>
        <p className="font-label-sm text-label-sm text-on-surface-variant">{DIRECTOR_COPY.finalNote}</p>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="director-recommend-input-error">{inputError}</p>
      ) : null}
    </>
  );
}

function SecretaryActions({
  application,
  onApproved,
  onReload,
}: {
  application: ModelApplication;
  onApproved: (receipt: SecretaryApprovalReceipt) => void;
  onReload: () => void;
}) {
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runSecretaryApproval, secretaryApprovalSignature);

  async function approve() {
    const text = note.trim();
    if (!text || text.length > NOTE_MAX) {
      setInputError(DIRECTOR_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, note: text });
    if (result?.ok) onApproved(result.value);
  }

  return (
    <>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{DIRECTOR_COPY.secretarySeparation}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void approve()}
        runLabel="Give final approval"
        busyLabel="Approving…"
        runTestId="secretary-approve-run"
        errorTestId="secretary-approve-error"
        reloadTestId="secretary-approve-reload"
        onReload={onReload}
        signInReturnTo={RETURN_TO}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {DIRECTOR_COPY.noteLabel}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid="secretary-approve-note"
          />
        </label>
        <p className="font-label-sm text-label-sm text-on-surface-variant">{DIRECTOR_COPY.secretaryNote}</p>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="secretary-approve-input-error">{inputError}</p>
      ) : null}
    </>
  );
}

function RatingBlock({ application }: { application: ModelApplication }) {
  const rating = application.rating;
  return (
    <div className="mt-space-md" data-testid="director-rating">
      <h3 className="font-label-md text-label-md text-on-surface">Rating</h3>
      {rating ? (
        <>
          <p className="font-body-md text-body-md" data-testid="director-rating-stars">
            {"★".repeat(rating.stars)}{"☆".repeat(5 - rating.stars)} {rating.stars} {rating.stars === 1 ? "star" : "stars"}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Declared {rating.declaredIseer}, verified {rating.verifiedIseer} · scheme {rating.schemeKey} · rating version {rating.ratingVersion}.
          </p>
          <p className="font-label-sm text-label-sm text-on-surface-variant">Local demonstration rating, not a BEE rating.</p>
        </>
      ) : (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{DIRECTOR_COPY.noRating}</p>
      )}
    </div>
  );
}
