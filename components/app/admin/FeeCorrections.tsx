"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { filterRows, paginate, sortRows, type SortDirection } from "@/components/app/kit/dataTableLogic";
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
  type FeeReversalProposal,
  decideCorrectionSignature,
  decideReversalSignature,
  proposeCorrectionSignature,
  proposeReversalSignature,
  readFeeCorrections,
  runDecideCorrection,
  runDecideReversal,
  runProposeCorrection,
  runProposeReversal,
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
  reversalRule: "If a fee was confirmed in error (no money was received), propose reversing the confirmation with a reason; a different person approves it. It is possible only while nothing has happened to the application since the confirmation: the application goes back to fee due, the applicant is told, and Finance confirms the fee again when it is received. Once work has started, a reversal is refused and needs a manual decision.",
  reversalInputRequired: "Enter the reason for the reversal (up to 500 characters).",
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
  const [reversing, setReversing] = useState<FeeConfirmationRow | null>(null);
  const [reversalProposed, setReversalProposed] = useState<FeeReversalProposal | null>(null);
  const [reversalNotice, setReversalNotice] = useState<FeeReversalProposal | null>(null);
  const reversalDecided = (p: FeeReversalProposal) => {
    setReversalNotice(p);
    revalidation.refresh();
  };
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

  const reversalListProps = {
    onDone: reversalDecided,
    onReload: revalidation.refresh,
    commandPrefix: "reversal",
    signInReturnTo: ROUTE,
    runDecide: runDecideReversal,
    decideSignature: decideReversalSignature,
    approveLabel: "Approve the reversal",
    renderSummary: (p: FeeReversalProposal) => (
      <>
        <strong>{p.reference}</strong> · reverse the fee confirmation
      </>
    ),
    formatDecidedSuffix: (p: FeeReversalProposal) =>
      p.state !== "pending" ? ` · ${p.state}${p.decidedBy ? ` by ${p.decidedBy}` : ""}${p.decisionNote ? ` · ${p.decisionNote}` : ""}` : "",
  };

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Correct or reverse a fee confirmation" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="corrections-screen">
        <IdentityStrip identity={identity} testId="corrections-identity" />
        <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="corrections-notes">{FEE_CORRECTIONS_COPY.rule}</p>
        <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="reversal-notes">{FEE_CORRECTIONS_COPY.reversalRule}</p>
        {reversalNotice ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`reversal-decided-${reversalNotice.id}`}>
            {reversalNotice.state === "approved"
              ? `Approved: ${reversalNotice.reference} is back at fee due and the applicant has been told. Finance confirms the fee again when it is received.`
              : `Reversal for ${reversalNotice.reference}: ${reversalNotice.state}.`}
          </p>
        ) : null}
        {reversalProposed ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reversal-propose-success">
            Proposed reversing the fee confirmation of {reversalProposed.reference}. A different person must approve it before anything changes.
          </p>
        ) : null}
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
          {(r) => <ConfirmationsTable rows={r.admin.confirmations} selectedId={selected?.applicationId ?? null} onSelect={(c) => { setSelected(c); setReversing(null); }} reversingId={reversing?.applicationId ?? null} onReverse={(c) => { setReversing(c); setSelected(null); }} />}
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
        {reversing && read && read.ok ? (
          <ReversalForm
            key={reversing.applicationId}
            row={reversing}
            onProposed={(p) => {
              setReversalProposed(p);
              setReversing(null);
              revalidation.refresh();
            }}
            onReload={revalidation.refresh}
          />
        ) : null}
        {read && read.ok ? (
          <>
            <ProposalList title="Reversals waiting for a second person" testId="reversals-pending" proposals={read.admin.reversalsPending} decidable {...reversalListProps} />
            <ProposalList title="Reversals recently decided" testId="reversals-decided" proposals={read.admin.reversalsDecided} {...reversalListProps} />
            <ProposalList title="Waiting for a second person" testId="corrections-pending" proposals={read.admin.pending} decidable {...listProps} />
            <ProposalList title="Recently decided" testId="corrections-decided" proposals={read.admin.decided} {...listProps} />
          </>
        ) : null}
      </div>
    </ScreenChrome>
  );
}

const PAGE_SIZE = 10;
type SortKey = "application" | "stage" | "receipt" | "on" | "amount" | "by";

function ConfirmationsTable({ rows: allRows, selectedId, onSelect, reversingId, onReverse }: { rows: FeeConfirmationRow[]; selectedId: string | null; onSelect: (c: FeeConfirmationRow) => void; reversingId: string | null; onReverse: (c: FeeConfirmationRow) => void }) {
  // Search by application, a date-received range, sort on every column, and ten rows to a page.
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection } | null>(null);
  const [page, setPage] = useState(1);
  const sortValue = (c: FeeConfirmationRow, key: SortKey): string | number => {
    const e = effective(c);
    return key === "application" ? `${c.reference} ${c.brandName} ${c.modelNumber}` : key === "stage" ? stateLabel(c.state) : key === "receipt" ? e.receipt : key === "on" ? e.on : key === "amount" ? Number(c.amountInr) : c.confirmedBy;
  };
  const visible = useMemo(() => {
    const byText = filterRows(allRows, query, (c) => `${c.reference} ${c.brandName} ${c.modelNumber}`);
    const byDate = byText.filter((c) => {
      const on = effective(c).on;
      return (!from || on >= from) && (!to || on <= to);
    });
    return sort && sort.dir !== "none" ? sortRows(byDate, sort.dir, (c) => sortValue(c, sort.key)) : byDate;
  }, [allRows, query, from, to, sort]);
  const paged = paginate(visible, page, PAGE_SIZE);
  const rows = paged.pageRows;
  const sortBy = (key: SortKey) => {
    setSort((prev) => (!prev || prev.key !== key ? { key, dir: "asc" } : prev.dir === "asc" ? { key, dir: "desc" } : null));
    setPage(1);
  };
  const head = (k: SortKey, label: string) => {
    const on = sort?.key === k ? sort.dir : "none";
    return (
      <th key={k} className="py-1 pr-3" aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : "none"}>
        <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase tracking-wide" data-testid={`corrections-sort-${k}`}>
          {label}
          <Icon name={on === "asc" ? "arrow_upward" : on === "desc" ? "arrow_downward" : "unfold_more"} size={14} />
        </button>
      </th>
    );
  };
  const field = "rounded-lg border border-outline-variant px-3 py-1.5 font-body-sm text-body-sm bg-surface-card";
  return (
    <div className="space-y-space-sm">
      <div className="flex flex-wrap items-end gap-space-md" data-testid="corrections-filters">
        <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">Search by application
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Reference, brand or model" className={`${field} mt-1 w-64`} data-testid="corrections-search" />
        </label>
        <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">Received from
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={`${field} mt-1`} data-testid="corrections-from" />
        </label>
        <label className="flex flex-col font-label-sm text-label-sm text-on-surface-variant">Received to
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={`${field} mt-1`} data-testid="corrections-to" />
        </label>
        {query || from || to ? (
          <button type="button" className="font-label-md text-primary underline pb-2" onClick={() => { setQuery(""); setFrom(""); setTo(""); setPage(1); }} data-testid="corrections-clear">Clear filters</button>
        ) : null}
      </div>
      {visible.length === 0 ? <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid="corrections-none">No fee confirmations match.</p> : (
    <>
    <table className="w-full font-body-sm text-body-sm" data-testid="corrections-table">
      <thead>
        <tr className="text-left text-on-surface-variant font-label-sm">
          {head("application", "Application")}
          {head("stage", "Stage")}
          {head("receipt", "Receipt reference")}
          {head("on", "Received on")}
          {head("amount", "Amount")}
          {head("by", "Confirmed by")}
          <th className="py-1" />
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const e = effective(c);
          if (c.reversal) {
            // A reversed confirmation is history: kept as written, with no action.
            return (
              <tr key={`${c.applicationId}-${c.confirmedAt}`} data-testid={`corrections-reversed-row-${c.reference}`} data-reversed="true" className="text-on-surface-variant">
                <td className="py-1 pr-3"><span className="font-mono">{c.reference}</span> · {c.brandName} {c.modelNumber}</td>
                <td className="py-1 pr-3">{stateLabel(c.state)}</td>
                <td className="py-1 pr-3">{c.receiptReference}</td>
                <td className="py-1 pr-3">{c.receivedOn}</td>
                <td className="py-1 pr-3">{money(c.amountInr)}</td>
                <td className="py-1 pr-3">{c.confirmedBy}</td>
                <td className="py-1" data-testid={`reversed-flag-${c.reference}`}>Reversed by {c.reversal.reversedBy}</td>
              </tr>
            );
          }
          return (
            <tr key={`${c.applicationId}-${c.confirmedAt}`} data-testid={`corrections-row-${c.reference}`} data-corrected={c.correction ? "true" : "false"}>
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
                ) : c.pendingReversalId ? (
                  <span className="text-on-surface-variant" data-testid={`reversal-pending-flag-${c.reference}`}>Reversal waiting</span>
                ) : (
                  <>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className={`font-label-sm text-label-sm ${c.applicationId === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
                    data-testid={`correction-propose-${c.reference}`}
                  >
                    {c.applicationId === selectedId ? "Selected" : "Propose a correction"}
                  </button>
                  {c.state === "iame_scrutiny" ? (
                    <button
                      type="button"
                      onClick={() => onReverse(c)}
                      className={`ml-space-sm font-label-sm text-label-sm ${c.applicationId === reversingId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
                      data-testid={`reversal-propose-${c.reference}`}
                    >
                      {c.applicationId === reversingId ? "Selected" : "Reverse"}
                    </button>
                  ) : null}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <nav className="flex flex-wrap items-center justify-between gap-space-sm pt-space-sm" aria-label="Pagination" data-testid="corrections-pagination">
      <span className="font-label-sm text-label-sm text-on-surface-variant" aria-live="polite">{paged.total === 0 ? "Showing 0 of 0" : `Showing ${paged.start}–${paged.end} of ${paged.total}`}</span>
      <span className="flex items-center gap-space-sm">
        <button type="button" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} className="font-label-md text-primary disabled:opacity-40" data-testid="corrections-prev">Previous page</button>
        <span className="font-label-sm text-label-sm text-on-surface-variant">Page {paged.page} of {paged.totalPages}</span>
        <button type="button" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.page + 1)} className="font-label-md text-primary disabled:opacity-40" data-testid="corrections-next">Next page</button>
      </span>
    </nav>
    </>
      )}
    </div>
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

function ReversalForm({ row, onProposed, onReload }: { row: FeeConfirmationRow; onProposed: (p: FeeReversalProposal) => void; onReload: () => void }) {
  const [reason, setReason] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runProposeReversal, proposeReversalSignature);

  async function propose() {
    if (!reason.trim() || reason.trim().length > 500) {
      setInputError(FEE_CORRECTIONS_COPY.reversalInputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ applicationId: row.applicationId, reason: reason.trim() });
    if (result?.ok) onProposed(result.value);
  }

  const field = "mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm";
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reversal-form">
      <h2 className="font-title-md text-title-md text-on-surface">Propose reversing the fee confirmation of {row.reference}</h2>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void propose()}
        runLabel="Propose reversal"
        busyLabel="Proposing…"
        runTestId="reversal-propose-run"
        errorTestId="reversal-propose-error"
        reloadTestId="reversal-propose-reload"
        onReload={onReload}
        signInReturnTo={ROUTE}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Reason (an internal note for Finance; the applicant is only told the fee is due again)
          <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} rows={2} className={field} data-testid="reversal-reason" />
        </label>
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="reversal-propose-input-error">{inputError}</p> : null}
    </section>
  );
}
