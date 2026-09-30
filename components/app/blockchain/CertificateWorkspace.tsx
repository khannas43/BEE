"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/app/ScreenScaffold";
import { previewRoleOf, useRole } from "@/components/app/RoleContext";
import { PRIMARY_CERT, FABRIC_META, correlationForVersion } from "@/lib/mock/certificate";
import { useCert } from "./CertificateStore";
import {
  BlockchainSimulationNotice, CertificateStatusBadge, IssuanceProgress, LedgerProof,
  CertificateVersionHistory, LifecycleTimeline,
} from "./kit";

/* ================================================================== *
 * Certificate & Ledger workspace — the interactive issuance state
 * machine + lifecycle actions, driven by the central CertificateStore.
 * ================================================================== */

const SEED = PRIMARY_CERT;
const V1 = SEED.versions[0];

export function CertificateWorkspace({ view }: { view?: "ledger" | "history" | "actions" } = {}) {
  const { role } = useRole();
  const officer = previewRoleOf(role);
  const { state, current, dispatch } = useCert();
  const [localTab, setTab] = useState<"ledger" | "history" | "actions">("ledger");
  const tab = view ?? localTab;   // controlled when the parent supplies a view
  // Version-specific ledger proof defaults to the CURRENT version, so a revoked
  // certificate opens on its v3 revocation proof — not the v1 issuance.
  const [verSel, setVerSel] = useState<number | null>(null);
  const selVer = verSel ?? state.currentVersion;
  const selVersion = state.versions.find((v) => v.version === selVer) ?? state.versions[state.versions.length - 1];

  const s = state.issuance;
  const hashed = ["HASH_CALCULATED", "LEDGER_SUBMITTED", "RETRYING", "FAILED", "LEDGER_CONFIRMED", "ACTIVE"].includes(s);
  const submitted = ["LEDGER_SUBMITTED", "RETRYING", "FAILED", "LEDGER_CONFIRMED", "ACTIVE"].includes(s);
  const confirmed = ["LEDGER_CONFIRMED", "ACTIVE"].includes(s);
  const active = s === "ACTIVE";
  const failing = s === "RETRYING" || s === "FAILED";

  function runSuccess() {
    dispatch({ t: "RESET" });
    const acts = [() => dispatch({ t: "GENERATE" }), () => dispatch({ t: "HASH" }), () => dispatch({ t: "SUBMIT" }), () => dispatch({ t: "CONFIRM" }), () => dispatch({ t: "ACTIVATE", officer: officer.name })];
    acts.forEach((fn, i) => setTimeout(fn, 650 * (i + 1)));
  }
  function runFailure() {
    dispatch({ t: "RESET" });
    setTimeout(() => dispatch({ t: "GENERATE" }), 650);
    setTimeout(() => dispatch({ t: "HASH" }), 1300);
    setTimeout(() => dispatch({ t: "SUBMIT" }), 1950);
    setTimeout(() => dispatch({ t: "FAIL" }), 2600);
  }
  function retry() {
    dispatch({ t: "RETRY" });
    setTimeout(() => dispatch({ t: "CONFIRM" }), 650);
    setTimeout(() => dispatch({ t: "ACTIVATE", officer: officer.name }), 1300);
  }

  return (
    <div className="space-y-space-md">
      {!view && <BlockchainSimulationNotice />}

      {/* sub-tabs (only when self-navigating; hidden when the parent controls the view) */}
      {!view && (
      <div className="flex gap-1 border-b border-border-subtle">
        {([["ledger", "Ledger & issuance", "account_tree"], ["history", "Version history", "manage_history"], ["actions", "Lifecycle actions", "gavel"]] as const).map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-space-sm py-2.5 font-label-md text-label-md whitespace-nowrap border-b-2 transition-colors ${tab === id ? "border-primary text-primary font-semibold" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}>
            <Icon name={icon} size={16} fill={tab === id} /> {label}
          </button>
        ))}
      </div>
      )}

      {tab === "ledger" && (
        <div className="space-y-space-md">
          {/* Version-specific ledger proof — opens on the CURRENT version */}
          {selVersion && (
            <Card title="Ledger proof (version-specific)" action={<CertificateStatusBadge status={selVersion.status} />}>
              <div className="flex flex-wrap gap-1.5 mb-space-md">
                {state.versions.map((v) => (
                  <button key={v.version} type="button" onClick={() => setVerSel(v.version)}
                    className={`px-space-sm py-1.5 rounded-lg font-label-sm text-label-sm border transition-colors ${selVer === v.version ? "bg-primary text-on-primary border-primary" : "bg-surface-container-low text-on-surface border-border-subtle hover:bg-forest-light"}`}>
                    v{v.version} · {v.event}{v.version === state.currentVersion ? " · current" : ""}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-space-md gap-y-space-sm">
                <KV k="Version / event" v={`v${selVersion.version} · ${selVersion.event}`} />
                <KV k="Lifecycle status" v={selVersion.status} />
                <KV k="Effective date" v={selVersion.effectiveDate} />
                <KV k="Correlation ID" v={selVersion.correlationId} />
                <KV k="Transaction ID" v={selVersion.txId} mono />
                <KV k="Block number" v={`#${selVersion.block.toLocaleString("en-IN")}`} />
                <KV k="Ledger timestamp" v={fmt(selVersion.ledgerTs)} />
                <KV k="Audit reference" v={selVersion.auditRef} />
              </div>
              <div className="mt-space-sm">
                <div className="font-label-sm text-label-sm text-on-surface-variant">Certificate document SHA-256 (anchored, v{selVersion.version})</div>
                <div className="font-mono text-label-sm break-all text-on-surface bg-surface-container-low rounded p-space-sm mt-1">{selVersion.hash}</div>
              </div>
              <div className="mt-space-md"><LedgerProof portalHash={selVersion.hash} anchoredHash={selVersion.hash} txId={selVersion.txId} block={selVersion.block} ledgerTs={selVersion.ledgerTs} mode="authorised" defaultOpen={false} /></div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm flex items-start gap-1"><Icon name="info" size={13} className="mt-0.5" /> The label artefact for this version embeds this same anchored certificate hash — the label and the certificate document are one file, so they share one hash.</p>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
            {/* Stage 1 — certificate identity */}
            <Card title="Certificate" action={<CertificateStatusBadge status={active ? (current?.status ?? "Active") : s} />}>
              <div className="space-y-space-sm">
                <KV k="Certificate ID" v={SEED.certId} mono />
                <KV k="Registration ID" v={SEED.regId} mono />
                <KV k="Version" v={active && current ? `v${current.version} · ${current.event}` : "v1 (draft)"} />
                <KV k="Manufacturer" v={SEED.manufacturer} />
                <KV k="Model / category" v={`${SEED.model} · ${SEED.category}`} />
                <KV k="Star rating" v={`${SEED.stars}★`} />
                <KV k="Valid" v={`${SEED.validFrom} → ${SEED.validTo}`} />
                <KV k="Issuing authority" v="Bureau of Energy Efficiency" />
                <KV k="Document" v={hashed ? `BEE_CERT_RAC_2026_10016_v${active && current ? current.version : 1}.pdf` : "pending generation"} />
              </div>
            </Card>

            {/* Issuance progress + actions */}
            <Card title="Initial issuance (v1) · simulation">
              <IssuanceProgress state={s} error={state.error} />
              <div className="flex flex-wrap gap-space-sm mt-space-md">
                {failing ? (
                  <button type="button" onClick={retry} className="flex items-center gap-1.5 bg-error-container text-on-error-container font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-error hover:text-on-error"><Icon name="refresh" size={16} /> Retry transaction</button>
                ) : (
                  <>
                    <button type="button" onClick={runSuccess} className="flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="play_arrow" size={16} /> Run successful issuance</button>
                    <button type="button" onClick={runFailure} className="flex items-center gap-1.5 bg-solar-gold-light text-solar-gold-dark font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-solar-gold hover:text-on-primary"><Icon name="cloud_off" size={16} /> Simulate ledger failure</button>
                  </>
                )}
                <button type="button" onClick={() => dispatch({ t: "RESET" })} className="flex items-center gap-1.5 bg-surface-container text-on-surface font-label-md text-label-md py-2 px-space-md rounded-lg hover:bg-forest-light"><Icon name="restart_alt" size={16} /> Reset</button>
              </div>
              {failing && state.error && (
                <div className="mt-space-md bg-error-container/40 rounded-lg p-space-sm space-y-1">
                  <div className="flex items-center gap-space-sm"><CertificateStatusBadge status="RETRYING" /><span className="font-label-sm text-label-sm text-error">Certificate remains inactive</span></div>
                  <KV k="Error code" v={state.error.code} />
                  <KV k="Error message" v={state.error.message} />
                  <KV k="Retry count" v={String(state.error.retries)} />
                  <KV k="Last attempt" v={fmt(state.error.lastAttempt)} />
                  <KV k="Next retry" v={fmt(state.error.nextRetry)} />
                </div>
              )}
            </Card>
          </div>

          {/* Stage 2 — hash */}
          <div className="flex items-center gap-space-sm pt-space-xs">
            <Icon name="play_circle" size={16} className="text-on-surface-variant" />
            <span className="font-label-md text-label-md text-on-surface-variant">Initial issuance record (v1) — how the certificate was first anchored</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
            <Card title="Hash calculation" action={<CertificateStatusBadge status={hashed ? "HASH_CALCULATED" : "DRAFT"} />}>
              {hashed ? (
                <div className="space-y-space-sm">
                  <KV k="Algorithm" v="SHA-256" />
                  <KV k="Artifact" v="BEE_CERT_RAC_2026_10016_v1.pdf" />
                  <KV k="Correlation ID" v={correlationForVersion(1)} />
                  <KV k="Calculated at" v={fmt(state.stages.hashedAt)} />
                  <div><div className="font-label-sm text-label-sm text-on-surface-variant">SHA-256 hash</div><div className="font-mono text-label-sm break-all text-on-surface bg-surface-container-low rounded p-space-sm mt-1">{V1.hash}</div></div>
                </div>
              ) : <Pending label="Hash is calculated after the certificate is generated." />}
            </Card>

            {/* Stage 3 — submission */}
            <Card title="Fabric submission" action={<CertificateStatusBadge status={submitted ? (confirmed ? "LEDGER_CONFIRMED" : "LEDGER_SUBMITTED") : "DRAFT"} />}>
              {submitted ? (
                <div className="space-y-space-sm">
                  <KV k="Channel" v={FABRIC_META.channel} />
                  <KV k="Chaincode" v={`${FABRIC_META.chaincode} ${FABRIC_META.chaincodeVersion}`} />
                  <KV k="Function" v="IssueCertificate" />
                  <KV k="Correlation ID" v={correlationForVersion(1)} />
                  <KV k="Submitted at" v={fmt(state.stages.submittedAt)} />
                  <KV k="Endorsement" v={confirmed ? "3/3 endorsed" : failing ? "1/3 — policy failure" : "pending"} />
                  <KV k="Transaction status" v={confirmed ? "Confirmed" : failing ? "Retrying" : "Submitted"} />
                </div>
              ) : <Pending label="Submitted to Fabric after the hash is calculated." />}
            </Card>
          </div>

          {/* Stage 4 — confirmation */}
          <Card title="Ledger confirmation" action={<CertificateStatusBadge status={confirmed ? "LEDGER_CONFIRMED" : "DRAFT"} />}>
            {confirmed ? (
              <div className="space-y-space-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                  <KV k="Transaction ID" v={V1.tx.txId} mono />
                  <KV k="Block number" v={`#${V1.tx.blockNumber.toLocaleString("en-IN")}`} />
                  <KV k="Ledger timestamp" v={fmt(V1.tx.timestamp)} />
                  <KV k="Endorsement result" v="3/3 endorsed · VALID (0)" />
                  <KV k="Commit result" v="Committed" />
                </div>
                <LedgerProof portalHash={V1.hash} anchoredHash={V1.hash} txId={V1.tx.txId} block={V1.tx.blockNumber} ledgerTs={V1.tx.timestamp} mode="authorised" defaultOpen={false} />
              </div>
            ) : <Pending label="Anchored hash + transaction ID appear once the transaction is confirmed." />}
          </Card>

          {/* Stage 5 — activation */}
          <Card title="Certificate & QR activation" action={<CertificateStatusBadge status={active ? "ACTIVE" : "DRAFT"} />}>
            {active ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                <KV k="Status at activation" v="Active" />
                <KV k="Current lifecycle status" v={current?.status ?? "Active"} />
                <KV k="QR batch ID" v={state.qrBatchId} />
                <KV k="QR allocation" v={fmt(state.stages.activatedAt)} />
                <KV k="Activated at" v={fmt(state.stages.activatedAt)} />
                <KV k="Activating officer" v={current?.officer ?? officer.name} />
                <KV k="Public verification" v={`/verify?reg=${SEED.regId}`} />
                <KV k="Audit reference" v={current?.auditRef ?? "AUD-CERT-ACT"} />
              </div>
            ) : (
              <div className="flex items-start gap-space-sm bg-solar-gold-light/40 rounded-lg p-space-sm">
                <Icon name="lock" size={16} className="text-solar-gold-dark shrink-0 mt-0.5" />
                <p className="font-body-sm text-body-sm text-on-surface">The certificate and QR are activated <span className="font-semibold">only after ledger confirmation</span> — never while Submitted, Retrying or Failed.</p>
              </div>
            )}
          </Card>

          <DataBoundary />
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-space-md">
          <Card title="Certificate version history">
            <CertificateVersionHistory versions={state.versions} certId={SEED.certId} />
          </Card>
          <Card title="Lifecycle timeline">
            {state.versions.length ? <LifecycleTimeline versions={state.versions} /> : <Pending label="Run issuance to create v1." />}
          </Card>
        </div>
      )}

      {tab === "actions" && <LifecycleActions />}
    </div>
  );
}

/* ---- Lifecycle actions (amend / revoke, maker-checker) ---- */
function LifecycleActions() {
  const { role } = useRole();
  const maker = previewRoleOf(role);
  const { state, current, dispatch } = useCert();
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [fields, setFields] = useState("Annual energy consumption 820 → 835 kWh");

  const canAmend = state.issuance === "ACTIVE" && current?.status === "Active" && state.currentVersion === 1 && !state.pending;
  const canRevoke = state.issuance === "ACTIVE" && current?.status === "Active" && !state.pending;

  if (state.pending) {
    const p = state.pending;
    return (
      <Card title={`${p.kind === "amend" ? "Amendment" : "Revocation"} — awaiting checker`}>
        <div className="bg-solar-gold-light/50 border border-solar-gold/40 rounded-lg p-space-md space-y-1.5">
          <div className="flex items-center gap-space-sm mb-1"><Icon name="hourglass_top" size={18} className="text-solar-gold-dark" /><span className="font-title-sm text-title-sm text-on-surface font-semibold">Maker submitted — checker approval required</span></div>
          <KV k="Requested by (maker)" v={p.maker} />
          <KV k="Effective date" v={p.effectiveDate} />
          <KV k="Fields changed" v={p.fields} />
          <div><div className="font-label-sm text-label-sm text-on-surface-variant">Reason</div><div className="font-body-sm text-body-sm text-on-surface">{p.reason}</div></div>
          <div className="flex gap-space-sm mt-space-sm">
            <button type="button" onClick={() => dispatch(p.kind === "amend" ? { t: "AMEND_APPROVE", checker: "Director (BEE)" } : { t: "REVOKE_APPROVE", checker: "Director (BEE)" })} className="flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="how_to_reg" size={16} /> Approve as checker (Director)</button>
            <button type="button" onClick={() => dispatch({ t: "CANCEL_PENDING" })} className="font-label-md text-label-md text-on-surface bg-surface-container py-2 px-space-sm rounded-lg hover:bg-forest-light">Withdraw</button>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">A different authorised officer approves as checker. Prior ledger records are retained — a new version is created.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
      <Card title="Amend certificate" action={<CertificateStatusBadge status={current?.status ?? "—"} />}>
        {canAmend ? (
          <div className="space-y-space-sm">
            <label className="font-label-sm text-label-sm text-on-surface-variant">Fields being changed</label>
            <input value={fields} onChange={(e) => setFields(e.target.value)} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" />
            <input value={effective} onChange={(e) => setEffective(e.target.value)} placeholder="Effective date e.g. 5 Oct 2026" className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" />
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Amendment reason (required)…" rows={2} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none resize-none" />
            <button type="button" disabled={!reason.trim() || !effective.trim()} onClick={() => dispatch({ t: "AMEND_SUBMIT", reason: reason.trim(), maker: maker.name, effectiveDate: effective.trim(), fields })}
              className={`w-full flex items-center justify-center gap-1.5 font-label-md text-label-md font-semibold py-2 rounded-lg ${reason.trim() && effective.trim() ? "bg-primary text-on-primary hover:bg-forest-dark" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}><Icon name="edit" size={16} /> Submit amendment (maker)</button>
            <p className="font-label-sm text-label-sm text-on-surface-variant">Creates v2; v1 is retained and marked Superseded. A new hash + Fabric transaction are anchored.</p>
          </div>
        ) : <Pending label={state.currentVersion >= 2 ? "Already amended — see version history." : "Amendment is available for an active v1 certificate."} />}
      </Card>

      <Card title="Revoke certificate" action={<CertificateStatusBadge status={current?.status ?? "—"} />}>
        {canRevoke ? (
          <div className="space-y-space-sm">
            <input value={effective} onChange={(e) => setEffective(e.target.value)} placeholder="Effective date e.g. 18 Oct 2026" className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" />
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Revocation reason + supporting reference (required)…" rows={2} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none resize-none" />
            <button type="button" disabled={!reason.trim() || !effective.trim()} onClick={() => dispatch({ t: "REVOKE_SUBMIT", reason: reason.trim(), maker: maker.name, effectiveDate: effective.trim() })}
              className={`w-full flex items-center justify-center gap-1.5 font-label-md text-label-md font-semibold py-2 rounded-lg ${reason.trim() && effective.trim() ? "bg-error-container text-on-error-container hover:bg-error hover:text-on-error" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}><Icon name="cancel" size={16} /> Submit revocation (maker)</button>
            <p className="font-label-sm text-label-sm text-on-surface-variant">Creates a v3 Revoked event; the current version is marked Superseded. Public verification will immediately show Revoked. Prior records are retained.</p>
          </div>
        ) : <Pending label={current?.status === "Revoked" ? "Certificate already revoked." : "Revocation is available for an active certificate."} />}
      </Card>
    </div>
  );
}

function DataBoundary() {
  return (
    <Card title="On-chain vs off-chain">
      <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-sm mb-space-md">
        <Icon name="info" size={16} className="text-primary shrink-0 mt-0.5" />
        <p className="font-body-sm text-body-sm text-on-surface">Only cryptographic hashes and minimal certificate metadata are written to the permissioned ledger. Documents and personal/business data remain in the secured portal repositories.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
        <div>
          <div className="font-label-sm text-label-sm text-success font-semibold mb-1 flex items-center gap-1"><Icon name="link" size={14} /> On-chain</div>
          <ul className="space-y-0.5 font-label-sm text-label-sm text-on-surface-variant">{["Certificate / permission ID", "Certificate version", "SHA-256 hash", "Issuer", "Issue timestamp", "Lifecycle status", "Previous-version reference", "Transaction metadata"].map((x) => <li key={x} className="flex gap-1"><Icon name="lens" size={7} className="mt-1.5 text-success" />{x}</li>)}</ul>
        </div>
        <div>
          <div className="font-label-sm text-label-sm text-error font-semibold mb-1 flex items-center gap-1"><Icon name="block" size={14} /> Off-chain (secured portal)</div>
          <ul className="space-y-0.5 font-label-sm text-label-sm text-on-surface-variant">{["Certificate PDF", "Applicant contact information", "Test reports", "Supporting documents", "Personally identifiable information", "Commercial / financial information"].map((x) => <li key={x} className="flex gap-1"><Icon name="lens" size={7} className="mt-1.5 text-error" />{x}</li>)}</ul>
        </div>
      </div>
    </Card>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant shrink-0">{k}</span><span className={`font-label-md text-label-md text-on-surface font-medium text-right ${mono ? "font-mono break-all" : ""}`}>{v}</span></div>;
}
function Pending({ label }: { label: string }) {
  return <div className="flex items-center gap-space-sm text-on-surface-variant"><Icon name="hourglass_empty" size={18} /> <span className="font-body-sm text-body-sm">{label}</span></div>;
}
function fmt(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return iso; }
}
