"use client";

import { useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { ProposalList } from "@/components/app/admin/ProposalPanels";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import {
  type FeeConfirmationRow,
  type FeeCorrectionProposal,
  decideCorrectionSignature,
  proposeCorrectionSignature,
  readFeeCorrections,
  runDecideCorrection,
  runProposeCorrection,
} from "@/lib/client/runtimeFeeCorrections";
import { gateRead } from "@/lib/client/runtimeHttp";
import { stateLabel } from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * Corrections to a fee confirmation (the owner's assumption B11, not a BEE decision). A confirmation is never edited. If the receipt
 * reference or the date received is wrong, a person who holds the correction permission proposes the right values with a reason and a
 * DIFFERENT holder approves; neither may belong to the paying organisation or have acted at another stage of the application. The
 * proposer may withdraw. Spring decides who may do what; this screen carries the request and shows the answer.
 */
const ROUTE = "/app/finance/receipt";
const LIST_TARGET = "list";
const loadCorrections = () => readFeeCorrections();

export const FEE_CORRECTIONS_COPY = {
  title: "Fee confirmations",
  loading: "Loading fee confirmations…",
  rule: "A fee confirmation is never edited. To fix the receipt reference or the date received, propose a correction with a reason; a different person who holds the permission approves it. Neither of you may belong to the paying organisation or have acted at another stage of the application.",
  inputRequired: "Enter the right receipt reference (letters, numbers, space . / _ -), the date received (not after today) and the reason.",
} as const;

const RECEIPT = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$/;
const money = (v: string) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const effective = (c: FeeConfirmationRow) => ({ receipt: c.correction?.receiptReference ?? c.receiptReference, on: c.correction?.receivedOn ?? c.receivedOn });

export function FeeCorrections({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadCorrections, revalidation));
  // A decided proposal leaves the pending list when the list reloads, so the answer is shown here, above the lists.
  const [notice, setNotice] = useState<FeeCorrectionProposal | null>(null);
  const [selected, setSelected] = useState<FeeConfirmationRow | null>(null);
  // The form closes once a correction is proposed, so the answer is shown here too.
  const [proposed, setProposed] = useState<FeeCorrectionProposal | null>(null);
  const decided = (p: FeeCorrectionProposal) => {
    setNotice(p);
    revalidation.refresh();
  };
  const listProps = {
    onDone: decided,
    onReload: revalidation.refresh,
    commandPrefix: "correction",
    signInReturnTo: ROUTE,
    runDecide: runDecideCorrection,
    decideSignature: decideCorrectionSignature,
    approveLabel: "Approve the correction",
    renderSummary: (p: FeeCorrectionProposal) => (
      <>
        <strong>{p.reference}</strong> · {p.previousReceiptReference} ({p.previousReceivedOn}) → {p.receiptReference} ({p.receivedOn})
      </>
    ),
    formatDecidedSuffix: (p: FeeCorrectionProposal) =>
      p.state !== "pending" ? ` · ${p.state}${p.decidedBy ? ` by ${p.decidedBy}` : ""}${p.decisionNote ? ` · ${p.decisionNote}` : ""}` : "",
  };

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Correct a receipt reference or date" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="corrections-screen">
        <IdentityStrip identity={identity} testId="corrections-identity" />
        <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="corrections-notes">{FEE_CORRECTIONS_COPY.rule}</p>
        {notice ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`correction-decided-${notice.id}`}>
            {notice.state === "approved"
              ? `Approved: ${notice.reference} now shows ${notice.receiptReference}, received on ${notice.receivedOn}.`
              : `Correction for ${notice.reference}: ${notice.state}.`}
          </p>
        ) : null}
        {proposed ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="correction-propose-success">
            Proposed for {proposed.reference}: {proposed.receiptReference}, received on {proposed.receivedOn}. A different person must approve it before it takes effect.
          </p>
        ) : null}
        <ReadPanel
          title={FEE_CORRECTIONS_COPY.title}
          read={read}
          loadingText={FEE_CORRECTIONS_COPY.loading}
          loadingTestId="corrections-loading"
          errorTestId="corrections-error"
          signInReturnTo={ROUTE}
          isEmpty={(r) => r.admin.confirmations.length === 0}
          emptyText="No fee has been confirmed yet."
          emptyTestId="corrections-empty"
        >
          {(r) => <ConfirmationsTable rows={r.admin.confirmations} selectedId={selected?.applicationId ?? null} onSelect={setSelected} />}
        </ReadPanel>
        {selected && read && read.ok ? (
          <CorrectionForm
            key={selected.applicationId}
            row={selected}
            today={read.admin.today}
            onProposed={(p) => {
              setProposed(p);
              setSelected(null);
              revalidation.refresh();
            }}
            onReload={revalidation.refresh}
          />
        ) : null}
        {read && read.ok ? (
          <>
            <ProposalList title="Waiting for a second person" testId="corrections-pending" proposals={read.admin.pending} decidable {...listProps} />
            <ProposalList title="Recently decided" testId="corrections-decided" proposals={read.admin.decided} {...listProps} />
          </>
        ) : null}
      </div>
    </ScreenChrome>
  );
}

function ConfirmationsTable({ rows, selectedId, onSelect }: { rows: FeeConfirmationRow[]; selectedId: string | null; onSelect: (c: FeeConfirmationRow) => void }) {
  return (
    <table className="w-full font-body-sm text-body-sm" data-testid="corrections-table">
      <thead>
        <tr className="text-left text-on-surface-variant font-label-sm">
          <th className="py-1 pr-3">Application</th>
          <th className="py-1 pr-3">Stage</th>
          <th className="py-1 pr-3">Receipt reference</th>
          <th className="py-1 pr-3">Received on</th>
          <th className="py-1 pr-3">Amount</th>
          <th className="py-1 pr-3">Confirmed by</th>
          <th className="py-1" />
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const e = effective(c);
          return (
            <tr key={c.applicationId} data-testid={`corrections-row-${c.reference}`} data-corrected={c.correction ? "true" : "false"}>
              <td className="py-1 pr-3">
                <span className="font-mono">{c.reference}</span> · {c.brandName} {c.modelNumber}
              </td>
              <td className="py-1 pr-3">{stateLabel(c.state)}</td>
              <td className="py-1 pr-3">
                <span data-testid={`corrections-receipt-${c.reference}`}>{e.receipt}</span>
                {c.correction ? <span className="block font-label-sm text-on-surface-variant">corrected; first confirmed as {c.receiptReference}</span> : null}
              </td>
              <td className="py-1 pr-3">{e.on}</td>
              <td className="py-1 pr-3">{money(c.amountInr)}</td>
              <td className="py-1 pr-3">{c.confirmedBy}</td>
              <td className="py-1">
                {c.pendingProposalId ? (
                  <span className="text-on-surface-variant" data-testid={`corrections-pending-flag-${c.reference}`}>Correction waiting</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className={`font-label-sm text-label-sm ${c.applicationId === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
                    data-testid={`correction-propose-${c.reference}`}
                  >
                    {c.applicationId === selectedId ? "Selected" : "Propose a correction"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CorrectionForm({ row, today, onProposed, onReload }: { row: FeeConfirmationRow; today: string; onProposed: (p: FeeCorrectionProposal) => void; onReload: () => void }) {
  const e = effective(row);
  const [receipt, setReceipt] = useState(e.receipt);
  const [on, setOn] = useState(e.on);
  const [reason, setReason] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runProposeCorrection, proposeCorrectionSignature);

  async function propose() {
    const r = receipt.trim();
    if (!RECEIPT.test(r) || !/^\d{4}-\d{2}-\d{2}$/.test(on) || (today && on > today) || !reason.trim() || (r === e.receipt && on === e.on)) {
      setInputError(FEE_CORRECTIONS_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ applicationId: row.applicationId, receiptReference: r, receivedOn: on, reason: reason.trim() });
    if (result?.ok) onProposed(result.value);
  }

  const field = "mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm";
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="correction-form">
      <h2 className="font-title-md text-title-md text-on-surface">Propose a correction for {row.reference}</h2>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void propose()}
        runLabel="Propose correction"
        busyLabel="Proposing…"
        runTestId="correction-propose-run"
        errorTestId="correction-propose-error"
        reloadTestId="correction-propose-reload"
        onReload={onReload}
        signInReturnTo={ROUTE}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Receipt reference
            <input value={receipt} onChange={(ev) => setReceipt(ev.target.value)} maxLength={64} className={field} data-testid="correction-receipt" />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Received on
            <input type="date" max={today || undefined} value={on} onChange={(ev) => setOn(ev.target.value)} className={field} data-testid="correction-date" />
          </label>
        </div>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Reason
          <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} rows={2} className={field} data-testid="correction-reason" />
        </label>
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="correction-propose-input-error">{inputError}</p> : null}
    </section>
  );
}
