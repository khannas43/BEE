"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { Pill } from "@/components/app/demo/DemoShell";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { useCommand, type CommandState } from "@/components/app/kit/CommandPanel";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { commandAdvice, type CommandFailure, gateRead } from "@/lib/client/runtimeHttp";
import {
  type Delegation,
  type Delegations as DelegationsView,
  type DelegableRole,
  decideDelegationSignature,
  delegationsHref,
  readDelegations,
  requestDelegationSignature,
  runDecideDelegation,
  runRequestDelegation,
} from "@/lib/client/runtimeDelegations";
import { istStamp } from "@/lib/client/istTime";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadDelegations = () => readDelegations();

const card = "rounded-xl border border-[#dbe6f7] bg-white p-5";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const field = "mt-1 block w-full py-2 px-3 rounded-lg bg-white border border-outline-variant font-body-sm";
const primaryBtn = "bg-[#1f3c88] text-white border border-[#1f3c88] py-2 px-4 rounded-lg font-label-md hover:bg-[#14315E] disabled:opacity-50";
const outlineBtn = "border border-primary text-primary bg-white py-1.5 px-3 rounded-lg font-label-sm disabled:opacity-50";
const dangerBtn = "border border-[#ba1a1a] text-[#93000a] bg-white py-1.5 px-3 rounded-lg font-label-sm disabled:opacity-50";

function SectionTitle({ icon, children, note }: { icon: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <div role="heading" aria-level={2} className="flex items-center gap-2 text-[16px] font-bold text-[#14315E]"><Icon name={icon} size={20} className="text-[#254e9e]" />{children}</div>
      {note ? <p className="mt-1 text-[13px] text-[#64748b]">{note}</p> : null}
    </div>
  );
}

function Tile({ icon, label, value, note, tone = "text-[#14315E]" }: { icon: string; label: string; value: number; note: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#dbe6f7] bg-white p-4">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#64748b]"><Icon name={icon} size={16} />{label}</span>
      <span className={`mt-1 block text-[28px] font-extrabold leading-8 ${tone}`}>{value}</span>
      <span className="block text-[12px] text-[#64748b]">{note}</span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="mr-2 inline-flex items-center rounded-full border border-[#c9d9f7] bg-[#e7effb] px-2 py-0.5 text-[12px] font-semibold text-[#14315E]">{children}</span>;
}

const ROLE_WORD: Record<string, string> = { programme: "Programme", director: "Director", finance: "Finance", officer: "BEE Officer", manufacturer: "Manufacturer", admin: "Administrator" };

function roleWord(role: string): string {
  return ROLE_WORD[role] ?? role;
}

function stateWord(item: Delegation): string {
  if (item.state === "pending") return "Waiting";
  if (item.state === "approved") return item.inForce ? "In force" : "Approved, not in force today";
  if (item.state === "rejected") return "Rejected";
  if (item.state === "withdrawn") return "Withdrawn";
  if (item.state === "revoked") return "Revoked";
  return item.state;
}

function outOfDate(failure: CommandFailure): boolean {
  if (failure.kind === "not_found") return true;
  return failure.kind === "conflict" && (failure.code === "proposal_not_pending" || failure.code === "delegation_not_active" || failure.code === "effective_date_passed");
}

/**
 * Clears a failure that means the screen is out of date, once a fresh read has arrived.
 * The message stays until that read, then the command resets so it does not sit beside the new data.
 */
function useClearStale(data: DelegationsView, command: { state: CommandState<unknown>; reset: () => void }) {
  const seen = useRef(data);
  useEffect(() => {
    const failure = command.state.phase === "failed" ? command.state.failure : null;
    if (seen.current !== data && failure && outOfDate(failure)) command.reset();
    seen.current = data;
  }, [data, command]);
}

/**
 * Ask to delegate a stage role, see what you hold or have given, and let an approver decide.
 * Controls follow delegableRoles, colleagues, canApprove, asDelegator, asDelegate, state and inForce.
 * Provisional local rules, not BEE rules.
 */
export function Delegations({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("delegations", loadDelegations, revalidation));
  const [formKey, setFormKey] = useState(0);

  function changed() {
    setFormKey((n) => n + 1);
    revalidation.refresh();
  }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Delegations" implemented={runtimeRouteFor(delegationsHref())?.implemented}>
      <div className="space-y-space-md" data-testid="del-screen">
        <IdentityStrip identity={identity} testId="del-identity" />
        <p role="note" className="text-[12px] text-[#64748b] rounded-lg bg-[#eef2f7] px-3 py-1.5 inline-block" data-testid="del-provisional">Provisional local rules, not BEE rules.</p>
        <ReadPanel
          title="Delegations"
          read={read}
          loadingText="Loading delegations…"
          loadingTestId="del-loading"
          errorTestId="del-error"
          signInReturnTo={delegationsHref()}
        >
          {(r) => <DelegationsBody data={r.delegations} formKey={formKey} onChanged={changed} onRefresh={revalidation.refresh} />}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

function DelegationsBody({
  data,
  formKey,
  onChanged,
  onRefresh,
}: {
  data: DelegationsView;
  formKey: number;
  onChanged: () => void;
  onRefresh: () => void;
}) {
  const inForce = data.mine.filter((d) => d.state === "approved" && d.inForce).length;
  const waitingMine = data.mine.filter((d) => d.state === "pending").length;
  return (
    <div className="space-y-space-md">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="del-summary">
        <Tile icon="verified_user" label="In force today" value={inForce} note="delegations active now" tone="text-[#14532d]" />
        <Tile icon="hourglass_top" label="My waiting requests" value={waitingMine} note="not yet decided" tone="text-[#8a4b00]" />
        <Tile icon="inbox" label="For your approval" value={data.canApprove ? data.pending.length : 0} note={data.canApprove ? "waiting for you to decide" : "you are not an approver"} />
        <Tile icon="history" label="Decided" value={data.canApprove ? data.decided.length : 0} note="approved, rejected or revoked" />
      </div>
      {data.delegableRoles.length > 0 ? (
        <AskForm key={formKey} data={data} onChanged={onChanged} onRefresh={onRefresh} />
      ) : (
        <p className={`${card} font-body-sm text-on-surface-variant`} data-testid="del-none">You do not hold a role that can be delegated, or you hold more than one stage role</p>
      )}
      <Mine data={data} onChanged={onChanged} onRefresh={onRefresh} />
      {data.canApprove ? <Pending data={data} onChanged={onChanged} onRefresh={onRefresh} /> : null}
      {data.canApprove ? <History data={data} /> : null}
    </div>
  );
}

function AskForm({ data, onChanged, onRefresh }: { data: DelegationsView; onChanged: () => void; onRefresh: () => void }) {
  const [role, setRole] = useState<DelegableRole>(data.delegableRoles[0]);
  const [delegateId, setDelegateId] = useState(data.colleagues[0]?.id ?? "");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [reason, setReason] = useState("");
  const command = useCommand(runRequestDelegation, requestDelegationSignature);
  // The refusal stays beside the form until the person changes something; it is not cleared by the re-read it asks for.
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    if (command.state.phase === "failed") command.reset();
    set(value);
  };
  const text = reason.trim();
  const ready = text.length >= 1 && text.length <= 500 && validFrom.length > 0 && validTo.length > 0 && delegateId.length > 0 && data.delegableRoles.includes(role);

  async function submit() {
    if (!ready) return;
    const result = await command.execute({ delegateId, role, validFrom, validTo, reason: text });
    if (result?.ok) onChanged();
    else if (result && !result.ok && outOfDate(result.failure)) onRefresh();
  }

  return (
    <section className={card} data-testid="del-form">
      <SectionTitle icon="swap_horiz">Ask to delegate</SectionTitle>
      <p className="mt-1 rounded-lg bg-[#f4f8ff] border border-[#dbe6f7] px-3 py-2 text-[13px] text-[#475569]" data-testid="del-rules">
        The start is today or later. The end is after the start and at most 30 days later. The Secretary&apos;s final approval, administrative roles and registration review cannot be delegated. The approver is never the person who asks or the person who receives the role. A person who holds a second stage role cannot delegate.
      </p>
      <div className="mt-space-sm grid gap-4 md:grid-cols-2">
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        Role
        <select value={role} onChange={(e) => edit(setRole)(e.target.value as DelegableRole)} className={field} data-testid="del-role">
          {data.delegableRoles.map((item) => <option key={item} value={item}>{roleWord(item)}</option>)}
        </select>
      </label>
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        Colleague
        <select value={delegateId} onChange={(e) => edit(setDelegateId)(e.target.value)} className={field} data-testid="del-colleague">
          {data.colleagues.map((person) => (
            <option key={person.id} value={person.id}>{person.displayName} · {person.roles.map(roleWord).join(", ")}</option>
          ))}
        </select>
      </label>
      </div>
      <div className="mt-space-sm grid gap-4 md:grid-cols-2">
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        First day
        <input type="date" min={data.today} value={validFrom} onChange={(e) => edit(setValidFrom)(e.target.value)} className={field} data-testid="del-from" />
      </label>
      <label className="block font-label-sm text-label-sm text-on-surface-variant">
        Ends on
        <input type="date" min={validFrom || data.today} value={validTo} onChange={(e) => edit(setValidTo)(e.target.value)} className={field} data-testid="del-to" aria-describedby="del-to-help" />
      </label>
      </div>
      <p id="del-to-help" className="text-[12px] text-[#64748b] mt-1" data-testid="del-to-help">The delegation applies until the day before this date.</p>
      <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
        Reason
        <textarea value={reason} onChange={(e) => edit(setReason)(e.target.value)} maxLength={500} rows={3} className={field} data-testid="del-reason" aria-describedby="del-reason-help" />
      </label>
      <p id="del-reason-help" className="text-[12px] text-[#64748b] mt-1" data-testid="del-reason-help">{text.length < 1 ? "A reason of 1 to 500 characters is required." : "Reason entered."}</p>
      <CommandOutcome state={command.state} errorTestId="del-request-error" signInReturnTo={delegationsHref()} />
      <button type="button" disabled={!ready || command.state.phase === "busy"} onClick={() => void submit()} className={`mt-space-sm ${primaryBtn}`} aria-describedby="del-reason-help" data-testid="del-submit">
        {command.state.phase === "busy" ? "Sending…" : "Submit"}
      </button>
    </section>
  );
}

function Mine({ data, onChanged, onRefresh }: { data: DelegationsView; onChanged: () => void; onRefresh: () => void }) {
  return (
    <section className={card} data-testid="del-mine">
      <SectionTitle icon="badge" note="Delegations you gave, received or can see.">My delegations</SectionTitle>
      {data.mine.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">You have no delegations.</p> : (
        <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
        <table className="w-full text-[13px]">
          <caption className="sr-only">My delegations</caption>
          <thead>
            <tr className="bg-[#eef3fb]">
              <th className={th}>Role</th>
              <th className={th}>From</th>
              <th className={th}>Ends on (not included)</th>
              <th className={th}>Delegator</th>
              <th className={th}>Delegate</th>
              <th className={th}>State</th>
              <th className={th}>Uses</th>
              <th className={th}>Decided by</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.mine.map((item) => <MineRow key={item.id} item={item} data={data} onChanged={onChanged} onRefresh={onRefresh} />)}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

function MineRow({ item, data, onChanged, onRefresh }: { item: Delegation; data: DelegationsView; onChanged: () => void; onRefresh: () => void }) {
  const [note, setNote] = useState("");
  const command = useCommand(runDecideDelegation, decideDelegationSignature);
  useClearStale(data, command);
  const text = note.trim();
  const canWithdraw = item.state === "pending" && item.asDelegator;
  const canRevoke = item.state === "approved" && (item.asDelegator || data.canApprove);

  async function act(decision: "withdraw" | "revoke") {
    if (decision === "revoke" && text.length > 500) return;
    const result = await command.execute({ id: item.id, decision, ...(decision === "revoke" && text ? { note: text } : {}) });
    if (result?.ok) onChanged();
    else if (result && !result.ok && outOfDate(result.failure)) onRefresh();
  }

  return (
    <tr className="border-t border-[#e7edf6] align-top" data-testid={`del-row-${item.id}`}>
      <td className="px-3 py-2">{roleWord(item.role)}</td>
      <td className="px-3 py-2">{item.validFrom}</td>
      <td className="px-3 py-2">{item.validTo}</td>
      <td className="px-3 py-2">{item.delegator}</td>
      <td className="px-3 py-2">{item.delegate}</td>
      <td className="px-3 py-2" data-testid={`del-state-${item.id}`}><Pill>{stateWord(item)}</Pill></td>
      <td className="px-3 py-2">{item.uses}</td>
      <td className="px-3 py-2">{item.decidedBy ?? item.revokedBy ?? ""}</td>
      <td className="px-3 py-2">
        {item.asDelegator ? <Chip>You delegated this</Chip> : null}
        {item.asDelegate ? <Chip>Delegated to you</Chip> : null}
        {canRevoke ? (
          <label className="block font-label-sm text-on-surface-variant">
            Note for a revocation
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={field} data-testid={`del-revoke-note-${item.id}`} />
          </label>
        ) : null}
        <CommandOutcome state={command.state} errorTestId={`del-row-error-${item.id}`} signInReturnTo={delegationsHref()} />
        <div className="mt-1 flex flex-wrap gap-space-sm">
          {canWithdraw ? (
            <button type="button" disabled={command.state.phase === "busy"} onClick={() => void act("withdraw")} className={outlineBtn} data-testid={`del-withdraw-${item.id}`}>Withdraw</button>
          ) : null}
          {canRevoke ? (
            <button type="button" disabled={command.state.phase === "busy" || text.length > 500} onClick={() => void act("revoke")} className={dangerBtn} data-testid={`del-revoke-${item.id}`}>Revoke</button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function Pending({ data, onChanged, onRefresh }: { data: DelegationsView; onChanged: () => void; onRefresh: () => void }) {
  return (
    <section className={card} data-testid="del-pending">
      <SectionTitle icon="pending_actions" note="Approve or reject each request. You cannot decide your own.">Waiting for approval</SectionTitle>
      {data.pending.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">Nothing is waiting for approval.</p> : (
        <ul className="mt-space-sm space-y-space-sm">
          {data.pending.map((item) => <PendingRow key={item.id} item={item} data={data} onChanged={onChanged} onRefresh={onRefresh} />)}
        </ul>
      )}
    </section>
  );
}

function PendingRow({ item, data, onChanged, onRefresh }: { item: Delegation; data: DelegationsView; onChanged: () => void; onRefresh: () => void }) {
  const [note, setNote] = useState("");
  const command = useCommand(runDecideDelegation, decideDelegationSignature);
  useClearStale(data, command);
  const text = note.trim();

  async function act(decision: "approve" | "reject") {
    if (decision === "reject" && (text.length < 1 || text.length > 500)) return;
    const result = await command.execute({ id: item.id, decision, ...(decision === "reject" ? { note: text } : {}) });
    if (result?.ok) onChanged();
    else if (result && !result.ok && outOfDate(result.failure)) onRefresh();
  }

  return (
    <li className="font-body-sm border border-[#f3dc9c] rounded-xl p-4 bg-[#fffaf0]" data-testid={`del-pending-${item.id}`}>
      <p className="flex flex-wrap items-center gap-x-space-sm gap-y-1">
        <Pill>Waiting</Pill>
        <span className="font-title-md text-title-md text-on-surface">{item.delegator} → {item.delegate}</span>
        <span className="text-on-surface-variant">· {roleWord(item.role)} · from {item.validFrom}, ends on {item.validTo} (not included)</span>
      </p>
      <p className="mt-1 text-on-surface-variant">Reason: {item.reason}</p>
      <p className="mt-1" data-testid={`del-confirm-${item.id}`}>This lets {item.delegate} act as {roleWord(item.role)} from {item.validFrom} to the day before {item.validTo} for {item.delegator}.</p>
      <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
        Reason for a rejection
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={field} data-testid={`del-note-${item.id}`} aria-describedby={`del-note-help-${item.id}`} />
      </label>
      <p id={`del-note-help-${item.id}`} className="font-body-sm text-on-surface-variant mt-1">{text.length < 1 ? "A reason of 1 to 500 characters is needed to reject." : "Reason entered."}</p>
      <CommandOutcome state={command.state} errorTestId="del-decide-error" signInReturnTo={delegationsHref()} />
      <div className="mt-space-sm flex flex-wrap gap-space-sm">
        <button type="button" disabled={command.state.phase === "busy"} onClick={() => void act("approve")} className={primaryBtn} data-testid={`del-approve-${item.id}`}>Approve</button>
        <button type="button" disabled={command.state.phase === "busy" || text.length < 1 || text.length > 500} aria-describedby={`del-note-help-${item.id}`} onClick={() => void act("reject")} className={dangerBtn} data-testid={`del-reject-${item.id}`}>Reject</button>
      </div>
    </li>
  );
}

function History({ data }: { data: DelegationsView }) {
  return (
    <section className={card} data-testid="del-history">
      <SectionTitle icon="history" note="Every delegation that has been decided.">History</SectionTitle>
      {data.decided.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No delegation has been decided.</p> : (
        <ul className="mt-space-sm space-y-space-sm">
          {data.decided.map((item) => (
            <li key={item.id} className="font-body-sm rounded-lg border border-[#e2e8f0] bg-[#f9fbff] px-3 py-2" data-testid={`del-history-${item.id}`} data-state={item.state}>
              <span className="mr-space-sm"><Pill>{stateWord(item)}</Pill></span>
              {roleWord(item.role)} · {item.delegator} · {item.delegate} · from {item.validFrom}, ends on {item.validTo} (not included) · {item.decidedBy ?? item.revokedBy ?? ""} · {item.decidedAt || item.revokedAt ? `${istStamp(item.decidedAt ?? item.revokedAt)} IST` : ""}
              {item.decisionNote ? ` · ${item.decisionNote}` : ""}
              {item.revokeNote ? ` · ${item.revokeNote}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommandOutcome<T>({ state, errorTestId, signInReturnTo }: { state: CommandState<T>; errorTestId: string; signInReturnTo: string }) {
  if (state.phase !== "failed") return null;
  const failure = state.failure;
  const advice = commandAdvice(failure);
  return (
    <div className="mt-space-sm" role="alert" data-testid={errorTestId} data-failure-code={"code" in failure ? failure.code : failure.kind}>
      <p className="text-error font-body-sm">{failure.message}</p>
      {advice.signIn ? <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="mt-1 inline-block text-primary font-label-md">Sign in</Link> : null}
    </div>
  );
}
