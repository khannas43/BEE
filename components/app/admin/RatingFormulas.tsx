"use client";

import { useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type RatingScheme,
  type RatingSchemeAdmin,
  type RatingSchemeProposal,
  type SchemeDecision,
  decideSchemeSignature,
  proposeSchemeSignature,
  readRatingSchemes,
  runDecideScheme,
  runProposeScheme,
} from "@/lib/client/runtimeRatingSchemes";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * Star-rating scheme administration (the owner's assumption A2, not a BEE decision). A scheme is the lowest efficiency figure
 * (ISEER) that earns each of 1 to 5 stars. A person who holds the rating-scheme permission proposes one from a date that is not
 * in the past; a DIFFERENT person who holds it approves or rejects; the proposer may withdraw. The rating step uses the scheme
 * with the latest start on or before the day it computes. Whatever is entered here is a LOCAL DEMONSTRATION, not a BEE-approved
 * formula, and every rating computed from it says so. Spring decides who may do what and when.
 */
const ROUTE = "/app/administration/rating-formula";
const LIST_TARGET = "list";
const loadSchemes = () => readRatingSchemes();

export const RATING_FORMULA_COPY = {
  title: "Rating schemes",
  loading: "Loading rating schemes…",
  how: "A scheme says the lowest efficiency figure that earns each star. The scheme with the latest start date on or before the day a rating is computed applies; earlier ratings keep the scheme they were computed with.",
  twoPeople: "A new scheme starts only after a different person approves it, never from a date in the past, and never on a day another scheme of the category starts.",
  provisional: "Local demonstration: nothing entered here is a BEE-approved formula, and every rating computed from it says so.",
  inputRequired: "Choose the category, a start date from today, five efficiency figures with up to two decimals (each higher than the one before), and the source and reason.",
} as const;

const FIGURE = /^\d{1,2}(\.\d{1,2})?$/;
const bandsText = (bands: { stars: number; minIseer: string }[]) => bands.map((b) => `${b.stars}★ ${b.minIseer}`).join(" · ");

export function RatingFormulas({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadSchemes, revalidation));
  // A decided proposal leaves the pending list when the list reloads, so the answer is shown here, above the lists.
  const [notice, setNotice] = useState<RatingSchemeProposal | null>(null);
  const decided = (p: RatingSchemeProposal) => {
    setNotice(p);
    revalidation.refresh();
  };

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Efficiency figure for each star" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="schemes-screen">
        <IdentityStrip identity={identity} testId="schemes-identity" />
        <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="schemes-notes">
          {RATING_FORMULA_COPY.how} {RATING_FORMULA_COPY.twoPeople} {RATING_FORMULA_COPY.provisional}
        </p>
        <ReadPanel
          title={RATING_FORMULA_COPY.title}
          read={read}
          loadingText={RATING_FORMULA_COPY.loading}
          loadingTestId="schemes-loading"
          errorTestId="schemes-error"
          signInReturnTo={ROUTE}
          isEmpty={(r) => r.admin.schemes.length === 0}
          emptyText="No rating scheme exists yet."
          emptyTestId="schemes-empty"
        >
          {(r) => <SchemeTable schemes={r.admin.schemes} today={r.admin.today} />}
        </ReadPanel>
        {notice ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`scheme-decided-${notice.id}`}>
            {notice.state === "approved"
              ? `Approved: scheme ${notice.appliedScheme} applies from ${notice.effectiveFrom}.`
              : `Scheme proposal for ${notice.categoryCode} from ${notice.effectiveFrom}: ${notice.state}.`}
          </p>
        ) : null}
        {read && read.ok ? (
          <>
            <ProposeForm admin={read.admin} onDone={revalidation.refresh} />
            <ProposalList title="Waiting for a second person" testId="schemes-pending" proposals={read.admin.pending} onDone={decided} onReload={revalidation.refresh} decidable />
            <ProposalList title="Recently decided" testId="schemes-decided" proposals={read.admin.decided} onDone={decided} onReload={revalidation.refresh} />
          </>
        ) : null}
      </div>
    </ScreenChrome>
  );
}

function SchemeTable({ schemes, today }: { schemes: RatingScheme[]; today: string }) {
  return (
    <table className="w-full font-body-sm text-body-sm" data-testid="schemes-table">
      <thead>
        <tr className="text-left text-on-surface-variant font-label-sm">
          <th className="py-1 pr-3">Scheme</th>
          <th className="py-1 pr-3">Category</th>
          <th className="py-1 pr-3">From</th>
          <th className="py-1 pr-3">Status</th>
          <th className="py-1">Lowest efficiency figure for each star</th>
        </tr>
      </thead>
      <tbody>
        {schemes.map((s) => (
          <tr key={s.schemeKey} data-testid={`schemes-row-${s.schemeKey}`} data-in-force={s.inForce ? "true" : "false"}>
            <td className="py-1 pr-3 font-mono">{s.schemeKey}</td>
            <td className="py-1 pr-3">{s.categoryCode}</td>
            <td className="py-1 pr-3">{s.effectiveFrom}</td>
            <td className="py-1 pr-3">{s.inForce ? "In force" : s.effectiveFrom > today ? "Starts later" : "Replaced"}</td>
            <td className="py-1">{bandsText(s.bands)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProposeForm({ admin, onDone }: { admin: RatingSchemeAdmin; onDone: () => void }) {
  const [category, setCategory] = useState(admin.categories[0]?.code ?? "");
  const [from, setFrom] = useState(admin.today);
  const [figures, setFigures] = useState(["", "", "", "", ""]);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [done, setDone] = useState<RatingSchemeProposal | null>(null);
  const command = useCommand(runProposeScheme, proposeSchemeSignature);

  async function propose() {
    const f = figures.map((x) => x.trim());
    const rising = f.every((x, i) => FIGURE.test(x) && Number(x) > 0 && (i === 0 || Number(x) > Number(f[i - 1])));
    if (!category || !rising || !/^\d{4}-\d{2}-\d{2}$/.test(from) || from < admin.today || !source.trim() || !reason.trim()) {
      setInputError(RATING_FORMULA_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ categoryCode: category, effectiveFrom: from, minIseer: f, sourceReference: source.trim(), reason: reason.trim() });
    if (result?.ok) {
      setDone(result.value);
      setFigures(["", "", "", "", ""]);
      setSource("");
      setReason("");
      onDone();
    }
  }

  const field = "mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm";
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="scheme-propose">
      <h2 className="font-title-md text-title-md text-on-surface">Propose a rating scheme</h2>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void propose()}
        runLabel="Propose scheme"
        busyLabel="Proposing…"
        runTestId="scheme-propose-run"
        errorTestId="scheme-propose-error"
        reloadTestId="scheme-propose-reload"
        onReload={onDone}
        signInReturnTo={ROUTE}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field} data-testid="scheme-category">
              {admin.categories.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
              ))}
            </select>
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Starts on
            <input type="date" min={admin.today} value={from} onChange={(e) => setFrom(e.target.value)} className={field} data-testid="scheme-from" />
          </label>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-space-sm">
          {figures.map((v, i) => (
            <label key={i} className="block font-label-sm text-label-sm text-on-surface-variant">
              {i + 1} {i === 0 ? "star" : "stars"}: lowest figure
              <input inputMode="decimal" value={v} onChange={(e) => setFigures(figures.map((x, j) => (j === i ? e.target.value : x)))} className={field} data-testid={`scheme-min-${i + 1}`} />
            </label>
          ))}
        </div>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Source (circular, order or note)
          <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} className={field} data-testid="scheme-source" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className={field} data-testid="scheme-reason" />
        </label>
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="scheme-propose-input-error">{inputError}</p> : null}
      {done ? (
        <p className="font-body-sm text-body-sm mt-space-sm" data-testid="scheme-propose-success">
          Proposed a scheme for {done.categoryCode} from {done.effectiveFrom}. A different person must approve it before it takes effect.
        </p>
      ) : null}
    </section>
  );
}

function ProposalList({ title, testId, proposals, onDone, onReload, decidable }: { title: string; testId: string; proposals: RatingSchemeProposal[]; onDone: (p: RatingSchemeProposal) => void; onReload: () => void; decidable?: boolean }) {
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={testId}>
      <h2 className="font-title-md text-title-md text-on-surface">{title}</h2>
      {proposals.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1" data-testid={`${testId}-empty`}>Nothing here.</p>
      ) : (
        <ul className="mt-space-sm space-y-space-md">
          {proposals.map((p) => (
            <li key={p.id} className="border-t border-border-subtle pt-space-sm" data-testid={`${testId}-${p.id}`} data-state={p.state} data-proposed-by-you={p.proposedByYou ? "true" : "false"}>
              <p className="font-body-sm text-body-sm">
                <strong>{p.categoryCode}</strong> · from {p.effectiveFrom} · {bandsText(p.minIseer.map((m, i) => ({ stars: i + 1, minIseer: m })))}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                Source: {p.sourceReference} · Reason: {p.reason} · Proposed by {p.proposedByYou ? "you" : p.proposedBy}
                {p.state !== "pending" ? ` · ${p.state}${p.decidedBy ? ` by ${p.decidedBy}` : ""}${p.appliedScheme ? ` (scheme ${p.appliedScheme})` : ""}${p.decisionNote ? ` · ${p.decisionNote}` : ""}` : ""}
              </p>
              {decidable ? <DecisionButtons p={p} onDone={onDone} onReload={onReload} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DecisionButtons({ p, onDone, onReload }: { p: RatingSchemeProposal; onDone: (p: RatingSchemeProposal) => void; onReload: () => void }) {
  const [note, setNote] = useState("");
  const approve = useCommand(runDecideScheme, decideSchemeSignature);
  const reject = useCommand(runDecideScheme, decideSchemeSignature);
  const withdraw = useCommand(runDecideScheme, decideSchemeSignature);

  async function decide(cmd: typeof approve, decision: SchemeDecision) {
    const out = await cmd.execute({ id: p.id, decision, note: note.trim() || undefined });
    if (out?.ok) onDone(out.value);
  }

  if (p.proposedByYou) {
    return (
      <div className="mt-1" data-testid={`scheme-own-${p.id}`}>
        <p className="font-label-sm text-on-surface-variant">You proposed this; a different person must approve or reject it.</p>
        <CommandPanel state={withdraw.state} onRun={() => void decide(withdraw, "withdraw")} runLabel="Withdraw my proposal" busyLabel="Withdrawing…"
          runTestId={`scheme-withdraw-run-${p.id}`} errorTestId={`scheme-withdraw-error-${p.id}`} reloadTestId={`scheme-withdraw-reload-${p.id}`} onReload={onReload} signInReturnTo={ROUTE} />
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-space-sm">
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid={`scheme-note-${p.id}`} />
      </label>
      <CommandPanel state={approve.state} onRun={() => void decide(approve, "approve")} runLabel="Approve and start the scheme" busyLabel="Approving…"
        runTestId={`scheme-approve-run-${p.id}`} errorTestId={`scheme-approve-error-${p.id}`} reloadTestId={`scheme-approve-reload-${p.id}`} onReload={onReload} signInReturnTo={ROUTE} />
      <CommandPanel state={reject.state} onRun={() => void decide(reject, "reject")} runLabel="Reject" busyLabel="Rejecting…"
        runTestId={`scheme-reject-run-${p.id}`} errorTestId={`scheme-reject-error-${p.id}`} reloadTestId={`scheme-reject-reload-${p.id}`} onReload={onReload} signInReturnTo={ROUTE} />
    </div>
  );
}
