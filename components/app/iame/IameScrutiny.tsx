"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { stageDetailRows } from "@/components/app/lifecycle/stageDetailRows";
import { StageWorkScreen } from "@/components/app/lifecycle/StageWorkScreen";
import {
  type IameRecommendationReceipt,
  type IameVerification,
  iameRecommendationSignature,
  runIameRecommendation,
} from "@/lib/client/runtimeIameRecommendation";
import { type ModelApplication, stateLabel } from "@/lib/client/runtimeModelApplications";
import { Module, Screen } from "@/lib/screens";

const ROUTE = "/app/model-label/iame-scrutiny";
const NOTE_MAX = 500;

/** Live-check test ids for this screen (queue/detail shell ids are built from `testIdPrefix` in StageWorkScreen). */
export const IAME_TESTID_TEMPLATES = ["iame-open-${a.reference}", "iame-ref-${a.reference}"] as const;

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
  const [receipt, setReceipt] = useState<IameRecommendationReceipt | null>(null);

  return (
    <StageWorkScreen
      module={module}
      screen={screen}
      route={ROUTE}
      subtitle="Record your finding and recommend forwarding"
      screenTestId="iame-scrutiny"
      testIdPrefix="iame"
      copy={IAME_COPY}
      detailFieldsTestId="iame-detail-fields"
      historyTestIdPrefix="iame-history"
      detailRows={(application) => stageDetailRows(application)}
      renderPrimary={(application, helpers) => (
        <IamePrimaryCommand
          application={application}
          onRecommended={(done) => {
            setReceipt(done);
            helpers.reload();
          }}
          onReload={helpers.reload}
        />
      )}
      renderPrimaryDone={(selectedId) =>
        receipt && receipt.applicationId === selectedId ? <RecommendedNote receipt={receipt} /> : null
      }
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

function IamePrimaryCommand({
  application,
  onRecommended,
  onReload,
}: {
  application: ModelApplication;
  onRecommended: (receipt: IameRecommendationReceipt) => void;
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
    <>
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
        signInReturnTo={ROUTE}
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
    </>
  );
}
