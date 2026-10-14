"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { useCommand, type CommandState } from "@/components/app/kit/CommandPanel";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { commandAdvice, gateRead } from "@/lib/client/runtimeHttp";
import {
  type RegisterAuthorisationEntry,
  type RegisterBrandEntry,
  type RegisterRevocationProposal,
  type RegisterRevocations,
  type RevocationAction,
  readRegisterRevocations,
  registerHref,
  runDecideRevocation,
  runProposeRevocation,
  decideRevocationSignature,
  proposeRevocationSignature,
} from "@/lib/client/runtimeRegisterRevocations";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadRegister = () => readRegisterRevocations();

const BRAND_STATUS: Record<string, string> = { active: "Active", suspended: "Suspended", revoked: "Revoked" };
const AUTH_STATUS: Record<string, string> = { active: "Active", revoked: "Revoked" };
const PROPOSAL_STATE: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };
const ACTION_WORD: Record<string, string> = { revoke: "Revoke", close: "Close" };

function words(table: Record<string, string>, code: string): string {
  return table[code] ?? code;
}

/**
 * The register Spring returns, and the proposals to close or revoke an entry. Programme proposes; the Director decides;
 * the proposer withdraws. The screen shows canPropose, canDecide and proposedByYou. Provisional local rules, not BEE rules.
 */
export function RegisterRevocations({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("register", loadRegister, revalidation));
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Register" implemented={runtimeRouteFor(registerHref())?.implemented}>
      <div className="space-y-space-md" data-testid="rvk-screen">
        <IdentityStrip identity={identity} testId="rvk-identity" />
        <p className="font-body-sm text-on-surface-variant" data-testid="rvk-provisional">Provisional local rules, not BEE rules.</p>
        <ReadPanel
          title="Register"
          read={read}
          loadingText="Loading the register…"
          loadingTestId="rvk-loading"
          errorTestId="rvk-error"
          signInReturnTo={registerHref()}
        >
          {(r) => (
            <RegisterBody register={r.register} openId={openId} onOpen={setOpenId} onChanged={() => { setOpenId(null); revalidation.refresh(); }} />
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}

function RegisterBody({
  register,
  openId,
  onOpen,
  onChanged,
}: {
  register: RegisterRevocations;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
}) {
  const openBrand = register.brands.find((b) => b.id === openId) ?? null;
  const openAuth = register.authorisations.find((a) => a.id === openId) ?? null;

  return (
    <div className="space-y-space-md">
      <section>
        <h2 className="font-title-md text-title-md text-on-surface">Brands</h2>
        {register.brands.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No brand is on the register.</p> : (
          <table className="w-full font-body-sm text-body-sm mt-space-sm" data-testid="rvk-brands">
            <thead>
              <tr className="text-left text-on-surface-variant font-label-sm">
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Owner</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Source</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {register.brands.map((brand) => (
                <tr key={brand.id} data-testid={`rvk-brand-${brand.id}`} data-status={brand.status}>
                  <td className="py-1 pr-3">{brand.name}</td>
                  <td className="py-1 pr-3">{brand.owner}</td>
                  <td className="py-1 pr-3">{words(BRAND_STATUS, brand.status)}</td>
                  <td className="py-1 pr-3">{brand.source}</td>
                  <td className="py-1">{proposeButton(register.canPropose, brand.status === "active", brand.id, openId, onOpen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {openBrand && register.canPropose ? <ProposeBrand brand={openBrand} onDone={onChanged} /> : null}
      </section>

      <section>
        <h2 className="font-title-md text-title-md text-on-surface">Agency authorisations</h2>
        {register.authorisations.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No agency authorisation is on the register.</p> : (
          <table className="w-full font-body-sm text-body-sm mt-space-sm" data-testid="rvk-auths">
            <thead>
              <tr className="text-left text-on-surface-variant font-label-sm">
                <th className="py-1 pr-3">Brand</th>
                <th className="py-1 pr-3">Agency</th>
                <th className="py-1 pr-3">Principal</th>
                <th className="py-1 pr-3">From</th>
                <th className="py-1 pr-3">To</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {register.authorisations.map((auth) => (
                <tr key={auth.id} data-testid={`rvk-auth-${auth.id}`} data-status={auth.status}>
                  <td className="py-1 pr-3">{auth.brandName}</td>
                  <td className="py-1 pr-3">{auth.agency}</td>
                  <td className="py-1 pr-3">{auth.principal}</td>
                  <td className="py-1 pr-3">{auth.validFrom}</td>
                  <td className="py-1 pr-3">{auth.validTo ?? "—"}</td>
                  <td className="py-1 pr-3">{words(AUTH_STATUS, auth.status)}</td>
                  <td className="py-1">{proposeButton(register.canPropose, auth.status === "active", auth.id, openId, onOpen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {openAuth && register.canPropose ? <ProposeAuthorisation auth={openAuth} onDone={onChanged} /> : null}
      </section>

      <section data-testid="rvk-pending">
        <h2 className="font-title-md text-title-md text-on-surface">Waiting for a decision</h2>
        {register.pending.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">Nothing is waiting for a decision.</p> : (
          <ul className="mt-space-sm space-y-space-sm">
            {register.pending.map((proposal) => (
              <PendingRow key={proposal.id} proposal={proposal} canPropose={register.canPropose} canDecide={register.canDecide} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>

      <section data-testid="rvk-history">
        <h2 className="font-title-md text-title-md text-on-surface">History</h2>
        {register.decided.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No proposal has been decided.</p> : (
          <ul className="mt-space-sm space-y-space-sm">
            {register.decided.map((proposal) => (
              <li key={proposal.id} className="font-body-sm" data-testid={`rvk-history-${proposal.id}`} data-state={proposal.state}>
                {words(PROPOSAL_STATE, proposal.state)} · {proposal.targetLabel} · {words(ACTION_WORD, proposal.action)}
                {proposal.closeOn ? ` · ${proposal.closeOn}` : ""} · {proposal.decidedBy ?? ""} · {proposal.decidedAt ?? ""}
                {proposal.decisionNote ? ` · ${proposal.decisionNote}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function proposeButton(canPropose: boolean, active: boolean, id: string, openId: string | null, onOpen: (id: string | null) => void) {
  if (!canPropose || !active) return null;
  const open = openId === id;
  return (
    <button type="button" className="text-primary font-label-sm" data-testid={`rvk-propose-${id}`} aria-expanded={open} onClick={() => onOpen(open ? null : id)}>
      Propose…
    </button>
  );
}

function ProposeBrand({ brand, onDone }: { brand: RegisterBrandEntry; onDone: () => void }) {
  return (
    <ProposeForm
      targetKind="brand"
      targetId={brand.id}
      intro="Revoke this brand (its authorisations will be revoked with it)"
      onDone={onDone}
    />
  );
}

function ProposeAuthorisation({ auth, onDone }: { auth: RegisterAuthorisationEntry; onDone: () => void }) {
  const [action, setAction] = useState<RevocationAction>("revoke");
  const [closeOn, setCloseOn] = useState("");
  return (
    <ProposeForm
      targetKind="authorisation"
      targetId={auth.id}
      action={action}
      closeOn={closeOn}
      intro={null}
      onDone={onDone}
      choice={
        <div className="mt-space-sm space-y-space-sm">
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Action
            <select value={action} onChange={(e) => setAction(e.target.value === "close" ? "close" : "revoke")} className="mt-1 block py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="rvk-action">
              <option value="revoke">Revoke</option>
              <option value="close">Close on a date</option>
            </select>
          </label>
          {action === "close" ? (
            <label className="block font-label-sm text-label-sm text-on-surface-variant">
              Closing date
              <input type="date" value={closeOn} onChange={(e) => setCloseOn(e.target.value)} className="mt-1 block py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="rvk-close-on" aria-describedby="rvk-close-rule" />
            </label>
          ) : null}
          {action === "close" ? (
            <p id="rvk-close-rule" className="font-body-sm text-on-surface-variant" data-testid="rvk-close-rule">
              A closing date is not before today, after the authorisation&apos;s start ({auth.validFrom}) and before its end ({auth.validTo ?? "no end date"}).
            </p>
          ) : null}
        </div>
      }
    />
  );
}

function ProposeForm({
  targetKind,
  targetId,
  action = "revoke",
  closeOn = "",
  intro,
  choice,
  onDone,
}: {
  targetKind: "brand" | "authorisation";
  targetId: string;
  action?: RevocationAction;
  closeOn?: string;
  intro: string | null;
  choice?: ReactNode;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const command = useCommand(runProposeRevocation, proposeRevocationSignature);
  const text = reason.trim();
  const needsDate = action === "close" && closeOn.trim().length === 0;
  const ready = text.length >= 1 && text.length <= 500 && !needsDate;

  async function submit() {
    if (!ready) return;
    const result = await command.execute({
      targetKind,
      targetId,
      action,
      reason: text,
      ...(action === "close" ? { closeOn } : {}),
    });
    if (result?.ok) onDone();
  }

  return (
    <div className="mt-space-sm bg-surface-ground rounded-lg p-space-sm" data-testid="rvk-panel">
      {intro ? <p className="font-body-sm">{intro}</p> : null}
      {choice}
      <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
        Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-card font-body-sm" data-testid="rvk-reason" aria-describedby="rvk-reason-help" />
      </label>
      {text.length < 1 ? <p id="rvk-reason-help" className="font-body-sm text-on-surface-variant mt-1" data-testid="rvk-reason-help">A reason of 1 to 500 characters is required.</p> : null}
      <CommandOutcome state={command.state} errorTestId="rvk-propose-error" signInReturnTo={registerHref()} />
      <button type="button" disabled={!ready || command.state.phase === "busy"} onClick={() => void submit()} className="mt-space-sm border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid="rvk-submit">
        {command.state.phase === "busy" ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}

function PendingRow({
  proposal,
  canPropose,
  canDecide,
  onChanged,
}: {
  proposal: RegisterRevocationProposal;
  canPropose: boolean;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const command = useCommand(runDecideRevocation, decideRevocationSignature);
  const text = note.trim();
  const yours = proposal.proposedByYou;
  const showDecision = canDecide && !yours;

  async function act(decision: "approve" | "reject" | "withdraw") {
    if (decision === "reject" && (text.length < 1 || text.length > 500)) return;
    const result = await command.execute({ id: proposal.id, decision, ...(decision === "reject" || text ? { note: text } : {}) });
    if (result?.ok) onChanged();
  }

  return (
    <li className="font-body-sm border border-outline-variant rounded-lg p-space-sm" data-testid={`rvk-pending-${proposal.id}`}>
      <p>
        {proposal.targetLabel} · {words(ACTION_WORD, proposal.action)}
        {proposal.closeOn ? ` · ${proposal.closeOn}` : ""} · {proposal.reason} · {proposal.proposedBy} · {proposal.proposedAt}
      </p>
      {yours ? <p className="mt-1" data-testid={`rvk-yours-${proposal.id}`}>You proposed this; another person decides</p> : null}
      {showDecision ? (
        <div className="mt-space-sm">
          <p data-testid={`rvk-confirm-${proposal.id}`}>{confirmLine(proposal)}</p>
          <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
            Reason for a rejection
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid={`rvk-note-${proposal.id}`} aria-describedby={`rvk-note-help-${proposal.id}`} />
          </label>
          {text.length < 1 ? <p id={`rvk-note-help-${proposal.id}`} className="font-body-sm text-on-surface-variant mt-1">A reason of 1 to 500 characters is needed to reject.</p> : null}
        </div>
      ) : null}
      <CommandOutcome state={command.state} errorTestId="rvk-decide-error" signInReturnTo={registerHref()} />
      <div className="mt-space-sm flex flex-wrap gap-space-sm">
        {showDecision ? (
          <>
            <button type="button" disabled={command.state.phase === "busy"} onClick={() => void act("approve")} className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`rvk-approve-${proposal.id}`}>Approve</button>
            <button type="button" disabled={command.state.phase === "busy" || text.length < 1 || text.length > 500} onClick={() => void act("reject")} className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`rvk-reject-${proposal.id}`}>Reject</button>
          </>
        ) : null}
        {canPropose && yours ? (
          <button type="button" disabled={command.state.phase === "busy"} onClick={() => void act("withdraw")} className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`rvk-withdraw-${proposal.id}`}>Withdraw</button>
        ) : null}
      </div>
    </li>
  );
}

function confirmLine(proposal: RegisterRevocationProposal): string {
  if (proposal.action === "close") return `This closes the authorisation on ${proposal.closeOn ?? ""}`;
  if (proposal.targetKind === "brand") return "This revokes the brand and its authorisations";
  return "This revokes the authorisation";
}

function CommandOutcome<T>({ state, errorTestId, signInReturnTo }: { state: CommandState<T>; errorTestId: string; signInReturnTo: string }) {
  if (state.phase !== "failed") return null;
  const failure = state.failure;
  const advice = commandAdvice(failure);
  return (
    <div className="mt-space-sm" data-testid={errorTestId} data-failure-code={"code" in failure ? failure.code : failure.kind}>
      <p className="text-error font-body-sm">{failure.message}</p>
      {advice.reload ? <button type="button" className="mt-1 text-primary font-label-md">Reload the latest version</button> : null}
      {advice.signIn ? <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="mt-1 inline-block text-primary font-label-md">Sign in</Link> : null}
    </div>
  );
}
