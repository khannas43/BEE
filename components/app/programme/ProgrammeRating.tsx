"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { stageDetailRows } from "@/components/app/lifecycle/stageDetailRows";
import { StageWorkScreen } from "@/components/app/lifecycle/StageWorkScreen";
import { type ModelApplication, stateLabel } from "@/lib/client/runtimeModelApplications";
import { type RatingReceipt, ratingSignature, runRating } from "@/lib/client/runtimeRating";
import { Module, Screen } from "@/lib/screens";

const ROUTE = "/app/model-label/rating-calculation";

export const PROGRAMME_TESTID_TEMPLATES = ["programme-open-${a.reference}", "programme-ref-${a.reference}"] as const;

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
  const [receipt, setReceipt] = useState<RatingReceipt | null>(null);

  return (
    <StageWorkScreen
      module={module}
      screen={screen}
      route={ROUTE}
      subtitle="Compute and record the star rating"
      screenTestId="programme-scrutiny"
      testIdPrefix="programme"
      copy={RATING_COPY}
      detailFieldsTestId="programme-detail-fields"
      historyTestIdPrefix="programme-history"
      showReturnPanel={false}
      returnRejectTestIdPrefix="programme"
      detailRows={(application) => stageDetailRows(application)}
      renderPrimary={(application, helpers) => (
        <ProgrammePrimaryCommand
          application={application}
          onRated={(done) => {
            setReceipt(done);
            helpers.reload();
          }}
          onReload={helpers.reload}
        />
      )}
      renderPrimaryDone={(selectedId) =>
        receipt && receipt.applicationId === selectedId ? <RatedNote receipt={receipt} /> : null
      }
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

function ProgrammePrimaryCommand({
  application,
  onRated,
  onReload,
}: {
  application: ModelApplication;
  onRated: (receipt: RatingReceipt) => void;
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
    <>
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
        signInReturnTo={ROUTE}
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
    </>
  );
}
