"use client";

import { useState, type ReactNode } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import type { CommandResult } from "@/lib/client/runtimeHttp";

/** Fields shared by fee-rule and rating-scheme proposals (and future administered rules). */
export type AdminProposal = {
  id: string;
  state: string;
  proposedByYou: boolean;
  proposedBy: string;
  decidedBy?: string | null;
  decisionNote?: string | null;
  sourceReference: string;
  reason: string;
};

export type ProposalDecision = "approve" | "reject" | "withdraw";

type DecidePayload = { id: string; decision: ProposalDecision; note?: string };

export type ProposalListProps<T extends AdminProposal> = {
  title: string;
  testId: string;
  proposals: T[];
  onDone: (p: T) => void;
  onReload: () => void;
  decidable?: boolean;
  /** For example `feerule` → `feerule-approve-run-{id}`. */
  commandPrefix: string;
  signInReturnTo: string;
  runDecide: (payload: DecidePayload, key: string) => Promise<CommandResult<T>>;
  decideSignature: (payload: DecidePayload) => readonly unknown[];
  renderSummary: (p: T) => ReactNode;
  formatDecidedSuffix: (p: T) => string;
  approveLabel: string;
};

export function ProposalList<T extends AdminProposal>({
  title,
  testId,
  proposals,
  onDone,
  onReload,
  decidable,
  commandPrefix,
  signInReturnTo,
  runDecide,
  decideSignature,
  renderSummary,
  formatDecidedSuffix,
  approveLabel,
}: ProposalListProps<T>) {
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={testId}>
      <h2 className="font-title-md text-title-md text-on-surface">{title}</h2>
      {proposals.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1" data-testid={`${testId}-empty`}>
          Nothing here.
        </p>
      ) : (
        <ul className="mt-space-sm space-y-space-md">
          {proposals.map((p) => (
            <li
              key={p.id}
              className="border-t border-border-subtle pt-space-sm"
              data-testid={`${testId}-${p.id}`}
              data-state={p.state}
              data-proposed-by-you={p.proposedByYou ? "true" : "false"}
            >
              <p className="font-body-sm text-body-sm">{renderSummary(p)}</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                Source: {p.sourceReference} · Reason: {p.reason} · Proposed by {p.proposedByYou ? "you" : p.proposedBy}
                {formatDecidedSuffix(p)}
              </p>
              {decidable ? (
                <DecisionButtons
                  p={p}
                  commandPrefix={commandPrefix}
                  signInReturnTo={signInReturnTo}
                  runDecide={runDecide}
                  decideSignature={decideSignature}
                  onDone={onDone}
                  onReload={onReload}
                  approveLabel={approveLabel}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DecisionButtons<T extends AdminProposal>({
  p,
  commandPrefix,
  signInReturnTo,
  runDecide,
  decideSignature,
  onDone,
  onReload,
  approveLabel,
}: {
  p: T;
  commandPrefix: string;
  signInReturnTo: string;
  runDecide: (payload: DecidePayload, key: string) => Promise<CommandResult<T>>;
  decideSignature: (payload: DecidePayload) => readonly unknown[];
  onDone: (p: T) => void;
  onReload: () => void;
  approveLabel: string;
}) {
  const [note, setNote] = useState("");
  const approve = useCommand(runDecide, decideSignature);
  const reject = useCommand(runDecide, decideSignature);
  const withdraw = useCommand(runDecide, decideSignature);

  async function decide(cmd: typeof approve, decision: ProposalDecision) {
    const out = await cmd.execute({ id: p.id, decision, note: note.trim() || undefined });
    if (out?.ok) onDone(out.value);
  }

  if (p.proposedByYou) {
    return (
      <div className="mt-1" data-testid={[commandPrefix, "own", p.id].join("-")}>
        <p className="font-label-sm text-on-surface-variant">You proposed this; a different person must approve or reject it.</p>
        <CommandPanel
          state={withdraw.state}
          onRun={() => void decide(withdraw, "withdraw")}
          runLabel="Withdraw my proposal"
          busyLabel="Withdrawing…"
          runTestId={`${commandPrefix}-withdraw-run-${p.id}`}
          errorTestId={`${commandPrefix}-withdraw-error-${p.id}`}
          reloadTestId={`${commandPrefix}-withdraw-reload-${p.id}`}
          onReload={onReload}
          signInReturnTo={signInReturnTo}
        />
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-space-sm">
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        Note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
          data-testid={[commandPrefix, "note", p.id].join("-")}
        />
      </label>
      <CommandPanel
        state={approve.state}
        onRun={() => void decide(approve, "approve")}
        runLabel={approveLabel}
        busyLabel="Approving…"
        runTestId={`${commandPrefix}-approve-run-${p.id}`}
        errorTestId={`${commandPrefix}-approve-error-${p.id}`}
        reloadTestId={`${commandPrefix}-approve-reload-${p.id}`}
        onReload={onReload}
        signInReturnTo={signInReturnTo}
      />
      <CommandPanel
        state={reject.state}
        onRun={() => void decide(reject, "reject")}
        runLabel="Reject"
        busyLabel="Rejecting…"
        runTestId={`${commandPrefix}-reject-run-${p.id}`}
        errorTestId={`${commandPrefix}-reject-error-${p.id}`}
        reloadTestId={`${commandPrefix}-reject-reload-${p.id}`}
        onReload={onReload}
        signInReturnTo={signInReturnTo}
      />
    </div>
  );
}
