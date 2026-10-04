"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { stageDetailRows } from "@/components/app/lifecycle/stageDetailRows";
import { StageWorkScreen } from "@/components/app/lifecycle/StageWorkScreen";
import { type ModelApplication, stateLabel } from "@/lib/client/runtimeModelApplications";
import {
  type ReviewerForwardReceipt,
  reviewerForwardSignature,
  runReviewerForward,
} from "@/lib/client/runtimeReviewerForward";
import { Module, Screen } from "@/lib/screens";

const ROUTE = "/app/model-label/bee-scrutiny";
const NOTE_MAX = 500;

export const REVIEWER_TESTID_TEMPLATES = ["reviewer-open-${a.reference}", "reviewer-ref-${a.reference}"] as const;

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
  const [receipt, setReceipt] = useState<ReviewerForwardReceipt | null>(null);

  return (
    <StageWorkScreen
      module={module}
      screen={screen}
      route={ROUTE}
      subtitle="Verify the application and forward it to rating"
      screenTestId="reviewer-scrutiny"
      testIdPrefix="reviewer"
      copy={REVIEWER_COPY}
      detailFieldsTestId="reviewer-detail-fields"
      historyTestIdPrefix="reviewer-history"
      detailRows={(application) => stageDetailRows(application)}
      renderPrimary={(application, helpers) => (
        <ReviewerPrimaryCommand
          application={application}
          onForwarded={(done) => {
            setReceipt(done);
            helpers.reload();
          }}
          onReload={helpers.reload}
        />
      )}
      renderPrimaryDone={(selectedId) =>
        receipt && receipt.applicationId === selectedId ? <ForwardedNote receipt={receipt} /> : null
      }
    />
  );
}

function ForwardedNote({ receipt }: { receipt: ReviewerForwardReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reviewer-forward-success">
      <p className="font-body-md text-body-md">
        Forwarded <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">Version {receipt.version}.</p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="reviewer-forward-back">
        Back to the queue
      </Link>
    </div>
  );
}

function ReviewerPrimaryCommand({
  application,
  onForwarded,
  onReload,
}: {
  application: ModelApplication;
  onForwarded: (receipt: ReviewerForwardReceipt) => void;
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
    <>
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
        signInReturnTo={ROUTE}
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
    </>
  );
}
