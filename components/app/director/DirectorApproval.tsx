"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { ReturnedNote } from "@/components/app/lifecycle/ReturnToApplicant";
import { RejectedNote } from "@/components/app/lifecycle/RejectApplication";
import { stageDetailRows } from "@/components/app/lifecycle/stageDetailRows";
import { StageWorkScreen } from "@/components/app/lifecycle/StageWorkScreen";
import type { StageRejectReceipt } from "@/lib/client/runtimeStageReject";
import type { StageReturnReceipt } from "@/lib/client/runtimeStageReturn";
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
import { type ModelApplication, stateLabel } from "@/lib/client/runtimeModelApplications";
import { Module, Screen } from "@/lib/screens";

const ROUTE = "/app/model-label/director-approval";
const NOTE_MAX = 500;

export const APPROVAL_TESTID_TEMPLATES = ["approval-open-${a.reference}", "approval-ref-${a.reference}"] as const;

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

type DoneState =
  | { kind: "director"; receipt: DirectorRecommendationReceipt }
  | { kind: "secretary"; receipt: SecretaryApprovalReceipt }
  | { kind: "returned"; receipt: StageReturnReceipt }
  | { kind: "rejected"; receipt: StageRejectReceipt };

export function DirectorApproval({ module, screen }: { module: Module; screen: Screen }) {
  const [done, setDone] = useState<DoneState | null>(null);

  return (
    <StageWorkScreen
      module={module}
      screen={screen}
      route={ROUTE}
      subtitle="Review the rating and recommend approval"
      screenTestId="approval-scrutiny"
      testIdPrefix="approval"
      copy={DIRECTOR_COPY}
      detailFieldsTestId="approval-detail-fields"
      historyTestIdPrefix="approval-history"
      returnRejectTestIdPrefix="approval"
      detailRows={(application) => stageDetailRows(application, { includeStage: true })}
      renderExtraDetail={(application) => <RatingBlock application={application} />}
      renderPrimary={(application, helpers) =>
        application.state === "secretary_approval" ? (
          <SecretaryPrimaryCommand
            application={application}
            onApproved={(receipt) => {
              setDone({ kind: "secretary", receipt });
              helpers.reload();
            }}
            onReload={helpers.reload}
          />
        ) : (
          <DirectorPrimaryCommand
            application={application}
            onRecommended={(receipt) => {
              setDone({ kind: "director", receipt });
              helpers.reload();
            }}
            onReload={helpers.reload}
          />
        )
      }
      onReturned={(receipt) => setDone({ kind: "returned", receipt })}
      onRejected={(receipt) => setDone({ kind: "rejected", receipt })}
      renderDetailAside={(selectedId) => {
        if (!done || done.receipt.applicationId !== selectedId) return undefined;
        if (done.kind === "director") return <RecommendedNote receipt={done.receipt} />;
        if (done.kind === "secretary") return <ApprovedNote receipt={done.receipt} />;
        if (done.kind === "returned") return <ReturnedNote receipt={done.receipt} backHref={ROUTE} testIdPrefix="approval" />;
        return <RejectedNote receipt={done.receipt} backHref={ROUTE} testIdPrefix="approval" />;
      }}
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

function DirectorPrimaryCommand({
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
        signInReturnTo={ROUTE}
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

function SecretaryPrimaryCommand({
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
        signInReturnTo={ROUTE}
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
    <div className="mt-space-md" data-testid="approval-rating">
      <h3 className="font-label-md text-label-md text-on-surface">Rating</h3>
      {rating ? (
        <>
          <p className="font-body-md text-body-md" data-testid="approval-rating-stars">
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
