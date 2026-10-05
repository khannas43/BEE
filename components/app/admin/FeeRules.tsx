"use client";

import { useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import {
  type Decision,
  type FeeRule,
  type FeeRuleAdmin,
  type FeeRuleProposal,
  decideFeeRuleSignature,
  proposeFeeRuleSignature,
  readFeeRules,
  runDecideFeeRule,
  runProposeFeeRule,
} from "@/lib/client/runtimeFeeRules";
import { gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * Fee-rule administration (the owner's assumptions A1 and C1, not BEE's decisions). A person who holds the fee-rule permission
 * proposes a rule from a date that is not in the past; a DIFFERENT person who holds it approves or rejects, and only then does
 * the new rule take over from its date. The proposer may withdraw their own proposal. Tax is a separate line, recorded and
 * shown; it is not yet added to the fee an applicant pays. Spring decides who may do what and when; this screen carries the
 * request and shows the answer.
 */
const ROUTE = "/app/administration/fee-rules";
const LIST_TARGET = "list";
const loadRules = () => readFeeRules();

export const FEE_RULES_COPY = {
  title: "Fee rules",
  loading: "Loading fee rules…",
  notPermitted: "Only a person who holds the fee-rule permission can see or change fee rules.",
  taxNote: "Tax is a separate line: the rate is added on top of the fee, rounded to the paisa, and the applicant and Finance see the fee, the tax and the total. A rate of 0 means no tax is set.",
  twoPeople: "A new rule starts only after a different person approves it, and never from a date in the past. An application keeps the fee it was given when it was submitted.",
  provisional: "Provisional local rules: no fee here has been confirmed by BEE.",
  inputRequired: "Choose the category and type, enter the fee as a number with up to two decimals, the tax rate between 0 and 100, a start date from today, and the source and reason.",
} as const;

const money = (v: string) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FeeRules({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadRules, revalidation));
  // A decided proposal leaves the pending list when the list reloads, so the answer is shown here, above the lists.
  const [notice, setNotice] = useState<FeeRuleProposal | null>(null);
  const decided = (p: FeeRuleProposal) => {
    setNotice(p);
    revalidation.refresh();
  };

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Fees by category and application type" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="feerules-screen">
        <IdentityStrip identity={identity} testId="feerules-identity" />
        <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="feerules-notes">
          {FEE_RULES_COPY.twoPeople} {FEE_RULES_COPY.taxNote} {FEE_RULES_COPY.provisional}
        </p>
        <ReadPanel
          title={FEE_RULES_COPY.title}
          read={read}
          loadingText={FEE_RULES_COPY.loading}
          loadingTestId="feerules-loading"
          errorTestId="feerules-error"
          signInReturnTo={ROUTE}
          isEmpty={(r) => r.admin.rules.length === 0}
          emptyText="No fee rule exists yet."
          emptyTestId="feerules-empty"
        >
          {(r) => (
            <div className="space-y-space-md">
              {r.admin.rules.map((rule) => (
                <RuleTable key={rule.ruleKey} rule={rule} />
              ))}
            </div>
          )}
        </ReadPanel>
        {notice ? (
          <p className="font-body-sm text-body-sm bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`feerule-decided-${notice.id}`}>
            {notice.state === "approved"
              ? `Approved: ${notice.ruleKey} version ${notice.appliedVersion} now applies from ${notice.effectiveFrom}.`
              : `Proposal for ${notice.ruleKey} from ${notice.effectiveFrom}: ${notice.state}.`}
          </p>
        ) : null}
        {read && read.ok ? (
          <>
            <ProposeForm admin={read.admin} onDone={revalidation.refresh} />
            <ProposalList title="Waiting for a second person" testId="feerules-pending" proposals={read.admin.pending} onDone={decided} onReload={revalidation.refresh} decidable />
            <ProposalList title="Recently decided" testId="feerules-decided" proposals={read.admin.decided} onDone={decided} onReload={revalidation.refresh} />
          </>
        ) : null}
      </div>
    </ScreenChrome>
  );
}

function RuleTable({ rule }: { rule: FeeRule }) {
  return (
    <section data-testid={`feerules-rule-${rule.ruleKey}`}>
      <h3 className="font-label-md text-label-md text-on-surface">
        {rule.categoryCode} · {rule.applicationType.replaceAll("_", " ")}
      </h3>
      <table className="w-full mt-1 font-body-sm text-body-sm">
        <thead>
          <tr className="text-left text-on-surface-variant font-label-sm">
            <th className="py-1 pr-3">Version</th>
            <th className="py-1 pr-3">From</th>
            <th className="py-1 pr-3">Until</th>
            <th className="py-1 pr-3">Fee</th>
            <th className="py-1 pr-3">Tax</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1">Source</th>
          </tr>
        </thead>
        <tbody>
          {rule.versions.map((v) => (
            <tr key={v.version} data-testid={`feerules-version-${rule.ruleKey}-${v.version}`} data-in-force={v.inForce ? "true" : "false"}>
              <td className="py-1 pr-3">{v.version}</td>
              <td className="py-1 pr-3">{v.effectiveFrom}</td>
              <td className="py-1 pr-3">{v.effectiveTo ?? "open"}</td>
              <td className="py-1 pr-3">{money(v.amountInr)}</td>
              <td className="py-1 pr-3">{v.taxRatePercent === "0.00" ? "not set" : `${v.taxRatePercent}%`}</td>
              <td className="py-1 pr-3">{v.inForce ? "In force" : v.effectiveTo ? "Ended" : "Starts later"}</td>
              <td className="py-1">{v.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProposeForm({ admin, onDone }: { admin: FeeRuleAdmin; onDone: () => void }) {
  const [category, setCategory] = useState(admin.categories[0]?.code ?? "");
  const [type, setType] = useState(admin.applicationTypes[0]?.code ?? "");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("0");
  const [from, setFrom] = useState(admin.today);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [done, setDone] = useState<FeeRuleProposal | null>(null);
  const command = useCommand(runProposeFeeRule, proposeFeeRuleSignature);

  async function propose() {
    const a = amount.trim();
    const t = tax.trim() || "0";
    if (!category || !type || !/^\d{1,10}(\.\d{1,2})?$/.test(a) || !/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(from) || from < admin.today || !source.trim() || !reason.trim()) {
      setInputError(FEE_RULES_COPY.inputRequired);
      return;
    }
    setInputError(null);
    const result = await command.execute({ categoryCode: category, applicationType: type, amountInr: a, taxRatePercent: t, effectiveFrom: from, sourceReference: source.trim(), reason: reason.trim() });
    if (result?.ok) {
      setDone(result.value);
      setAmount("");
      setSource("");
      setReason("");
      onDone();
    }
  }

  const field = "mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm";
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="feerule-propose">
      <h2 className="font-title-md text-title-md text-on-surface">Propose a fee rule</h2>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void propose()}
        runLabel="Propose rule"
        busyLabel="Proposing…"
        runTestId="feerule-propose-run"
        errorTestId="feerule-propose-error"
        reloadTestId="feerule-propose-reload"
        onReload={onDone}
        signInReturnTo={ROUTE}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field} data-testid="feerule-category">
              {admin.categories.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
              ))}
            </select>
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Application type
            <select value={type} onChange={(e) => setType(e.target.value)} className={field} data-testid="feerule-type">
              {admin.applicationTypes.map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Fee (₹)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} data-testid="feerule-amount" />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Tax rate (%), a separate line
            <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className={field} data-testid="feerule-tax" />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Starts on
            <input type="date" min={admin.today} value={from} onChange={(e) => setFrom(e.target.value)} className={field} data-testid="feerule-from" />
          </label>
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Source (circular, order or note)
            <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} className={field} data-testid="feerule-source" />
          </label>
        </div>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className={field} data-testid="feerule-reason" />
        </label>
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="feerule-propose-input-error">{inputError}</p> : null}
      {done ? (
        <p className="font-body-sm text-body-sm mt-space-sm" data-testid="feerule-propose-success">
          Proposed {done.ruleKey} at {money(done.amountInr)} from {done.effectiveFrom}. A different person must approve it before it takes effect.
        </p>
      ) : null}
    </section>
  );
}

function ProposalList({ title, testId, proposals, onDone, onReload, decidable }: { title: string; testId: string; proposals: FeeRuleProposal[]; onDone: (p: FeeRuleProposal) => void; onReload: () => void; decidable?: boolean }) {
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={testId}>
      <h2 className="font-title-md text-title-md text-on-surface">{title}</h2>
      {proposals.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1" data-testid={`${testId}-empty`}>Nothing here.</p>
      ) : (
        <ul className="mt-space-sm space-y-space-md">
          {proposals.map((p) => (
            <ProposalItem key={p.id} p={p} testId={testId} onDone={onDone} onReload={onReload} decidable={decidable === true} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProposalItem({ p, testId, onDone, onReload, decidable }: { p: FeeRuleProposal; testId: string; onDone: (p: FeeRuleProposal) => void; onReload: () => void; decidable: boolean }) {
  return (
    <li className="border-t border-border-subtle pt-space-sm" data-testid={`${testId}-${p.id}`} data-state={p.state} data-proposed-by-you={p.proposedByYou ? "true" : "false"}>
      <p className="font-body-sm text-body-sm">
        <strong>{p.ruleKey}</strong> · {money(p.amountInr)} + tax {p.taxRatePercent}% · from {p.effectiveFrom}
      </p>
      <p className="font-label-sm text-label-sm text-on-surface-variant">
        Source: {p.sourceReference} · Reason: {p.reason} · Proposed by {p.proposedByYou ? "you" : p.proposedBy}
        {p.state !== "pending" ? ` · ${p.state}${p.decidedBy ? ` by ${p.decidedBy}` : ""}${p.appliedVersion ? ` (now version ${p.appliedVersion})` : ""}${p.decisionNote ? ` · ${p.decisionNote}` : ""}` : ""}
      </p>
      {decidable ? <DecisionButtons p={p} onDone={onDone} onReload={onReload} /> : null}
    </li>
  );
}

function DecisionButtons({ p, onDone, onReload }: { p: FeeRuleProposal; onDone: (p: FeeRuleProposal) => void; onReload: () => void }) {
  const [note, setNote] = useState("");
  const approve = useCommand(runDecideFeeRule, decideFeeRuleSignature);
  const reject = useCommand(runDecideFeeRule, decideFeeRuleSignature);
  const withdraw = useCommand(runDecideFeeRule, decideFeeRuleSignature);

  async function decide(cmd: typeof approve, decision: Decision) {
    const out = await cmd.execute({ id: p.id, decision, note: note.trim() || undefined });
    if (out?.ok) onDone(out.value);
  }

  if (p.proposedByYou) {
    return (
      <div className="mt-1" data-testid={`feerule-own-${p.id}`}>
        <p className="font-label-sm text-on-surface-variant">You proposed this; a different person must approve or reject it.</p>
        <CommandPanel state={withdraw.state} onRun={() => void decide(withdraw, "withdraw")} runLabel="Withdraw my proposal" busyLabel="Withdrawing…"
          runTestId={`feerule-withdraw-run-${p.id}`} errorTestId={`feerule-withdraw-error-${p.id}`} reloadTestId={`feerule-withdraw-reload-${p.id}`} onReload={onReload} signInReturnTo={ROUTE} />
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-space-sm">
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid={`feerule-note-${p.id}`} />
      </label>
      <CommandPanel state={approve.state} onRun={() => void decide(approve, "approve")} runLabel="Approve and start the rule" busyLabel="Approving…"
        runTestId={`feerule-approve-run-${p.id}`} errorTestId={`feerule-approve-error-${p.id}`} reloadTestId={`feerule-approve-reload-${p.id}`} onReload={onReload} signInReturnTo={ROUTE} />
      <CommandPanel state={reject.state} onRun={() => void decide(reject, "reject")} runLabel="Reject" busyLabel="Rejecting…"
        runTestId={`feerule-reject-run-${p.id}`} errorTestId={`feerule-reject-error-${p.id}`} reloadTestId={`feerule-reject-reload-${p.id}`} onReload={onReload} signInReturnTo={ROUTE} />
    </div>
  );
}
