"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { type StageReturnReceipt, runStageReturn, stageReturnSignature } from "@/lib/client/runtimeStageReturn";
import { stateLabel } from "@/lib/client/runtimeModelApplications";

/**
 * The stage owner's way to send an application back to the applicant with a reason (FIRST_SLICE.md section 4). Shared by
 * the IAME, Reviewer, Director and Secretary screens. Spring decides whether this officer may return from the stage the
 * application is in; this only collects the reason and shows the result. Provisional local rules, not BEE rules.
 */
export const RETURN_COPY = {
  heading: "Return to the applicant instead",
  help: "The applicant sees your reason, edits the application and resubmits it. It then comes back to this stage.",
  reasonLabel: "Reason for returning",
  inputRequired: "Write the reason, up to 500 characters.",
} as const;

const REASON_MAX = 500;

export function ReturnToApplicant({
  application,
  testIdPrefix,
  signInReturnTo,
  onReturned,
  onReload,
}: {
  application: { id: string; version: number };
  /** For example "iame" gives iame-return-run, iame-return-reason, iame-return-error. */
  testIdPrefix: string;
  signInReturnTo: string;
  onReturned: (receipt: StageReturnReceipt) => void;
  onReload: () => void;
}) {
  const [reason, setReason] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runStageReturn, stageReturnSignature);

  async function giveBack() {
    const text = reason.trim();
    if (!text || text.length > REASON_MAX) {
      setInputError(RETURN_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, reason: text });
    if (result?.ok) onReturned(result.value);
  }

  return (
    <section className="mt-space-md pt-space-md border-t border-border-subtle" data-testid={`${testIdPrefix}-return`}>
      <h3 className="font-label-md text-label-md text-on-surface">{RETURN_COPY.heading}</h3>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{RETURN_COPY.help}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void giveBack()}
        runLabel="Return to applicant"
        busyLabel="Returning…"
        runTestId={`${testIdPrefix}-return-run`}
        errorTestId={`${testIdPrefix}-return-error`}
        reloadTestId={`${testIdPrefix}-return-reload`}
        onReload={onReload}
        signInReturnTo={signInReturnTo}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {RETURN_COPY.reasonLabel}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX}
            rows={3}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid={`${testIdPrefix}-return-reason`}
          />
        </label>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid={`${testIdPrefix}-return-input-error`}>{inputError}</p>
      ) : null}
    </section>
  );
}

export function ReturnedNote({ receipt, backHref, testIdPrefix }: { receipt: StageReturnReceipt; backHref: string; testIdPrefix: string }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`${testIdPrefix}-return-success`}>
      <p className="font-body-md text-body-md">
        <strong>{receipt.reference}</strong> was returned to the applicant. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        The applicant sees your reason and can edit and resubmit; it then comes back to {stateLabel(receipt.fromState)}. Version {receipt.version}.
      </p>
      <Link href={backHref} className="inline-flex mt-space-md text-primary font-label-md" data-testid={`${testIdPrefix}-return-back`}>
        Back to the queue
      </Link>
    </div>
  );
}
