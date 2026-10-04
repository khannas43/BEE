"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { stateLabel } from "@/lib/client/runtimeModelApplications";
import { type StageRejectReceipt, runStageReject, stageRejectSignature } from "@/lib/client/runtimeStageReject";

/**
 * The stage owner's way to end an application permanently, with a reason (FIRST_SLICE.md section 4). Shared by the IAME,
 * Reviewer, Programme, Director and Secretary screens. Rejection cannot be undone and a new application is needed to try
 * again, so the officer must tick a confirmation. Spring decides whether this officer may reject from the stage the
 * application is in; this only collects the reason and shows the result. Provisional local rules, not BEE rules.
 */
export const REJECT_COPY = {
  heading: "Reject permanently",
  help: "This ends the application. It cannot be undone, and the applicant must start a new application to try again. The applicant sees your reason.",
  reasonLabel: "Reason for rejecting",
  confirmLabel: "I understand this ends the application and cannot be undone.",
  inputRequired: "Write the reason (up to 500 characters) and tick the confirmation.",
} as const;

const REASON_MAX = 500;

export function RejectApplication({
  application,
  testIdPrefix,
  signInReturnTo,
  onRejected,
  onReload,
}: {
  application: { id: string; version: number };
  /** For example "iame" gives iame-reject-run, iame-reject-reason, iame-reject-confirm, iame-reject-error. */
  testIdPrefix: string;
  signInReturnTo: string;
  onRejected: (receipt: StageRejectReceipt) => void;
  onReload: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runStageReject, stageRejectSignature);

  async function reject() {
    const text = reason.trim();
    if (!text || text.length > REASON_MAX || !confirmed) {
      setInputError(REJECT_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, reason: text });
    if (result?.ok) onRejected(result.value);
  }

  return (
    <section className="mt-space-md pt-space-md border-t border-error/40" data-testid={`${testIdPrefix}-reject`}>
      <h3 className="font-label-md text-label-md text-error">{REJECT_COPY.heading}</h3>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{REJECT_COPY.help}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void reject()}
        runLabel="Reject permanently"
        busyLabel="Rejecting…"
        runTestId={`${testIdPrefix}-reject-run`}
        errorTestId={`${testIdPrefix}-reject-error`}
        reloadTestId={`${testIdPrefix}-reject-reload`}
        onReload={onReload}
        signInReturnTo={signInReturnTo}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          {REJECT_COPY.reasonLabel}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX}
            rows={3}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid={`${testIdPrefix}-reject-reason`}
          />
        </label>
        <label className="flex items-start gap-2 font-label-sm text-label-sm text-on-surface-variant">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid={`${testIdPrefix}-reject-confirm`} />
          {REJECT_COPY.confirmLabel}
        </label>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid={`${testIdPrefix}-reject-input-error`}>{inputError}</p>
      ) : null}
    </section>
  );
}

export function RejectedNote({ receipt, backHref, testIdPrefix }: { receipt: StageRejectReceipt; backHref: string; testIdPrefix: string }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`${testIdPrefix}-reject-success`}>
      <p className="font-body-md text-body-md">
        <strong>{receipt.reference}</strong> was rejected. It is now <strong>{stateLabel(receipt.toState)}</strong> and cannot be changed.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        The applicant sees your reason. A new application is needed to try again. Version {receipt.version}.
      </p>
      <Link href={backHref} className="inline-flex mt-space-md text-primary font-label-md" data-testid={`${testIdPrefix}-reject-back`}>
        Back to the queue
      </Link>
    </div>
  );
}
