"use client";

import { useCallback, useEffect, useState } from "react";
import { demoGet, demoPath, demoPost, type DemoResult } from "@/lib/client/runtimeDemo";

/** Simulated certificate ledger (demo slice S3). A local test network, not Hyperledger Fabric and not a BEE system. */

type Tx = {
  id: string; certificateId: string; registrationId: string; blockNo: number; seq: number; attempt: number; kind: string; state: string;
  prevHash: string; hash: string; validTo: string; reason: string | null; failureReason: string | null; submittedBy: string; decidedBy: string | null;
  seededNote: string | null; createdAt: string; committedAt: string | null;
};
type Row = {
  certificateId: string; registrationId: string; manufacturer: string; brandName: string; modelNumber: string; validTo: string; ledgerValidTo: string;
  ledgerStatus: string; pendingKind: string | null; lastTx: Tx | null;
};
type Verification = { result: "MATCH" | "MISMATCH"; firstBadSeq: number | null; detail: string; transactions: number };
type Action = { action: string; allowed: boolean; why: string | null };
type Detail = Row & {
  stars: number; validFrom: string; transactions: Tx[]; events: { action: string; actor: string; reason: string | null; at: string; seq: number; kind: string }[];
  verification: Verification; actions: Action[];
};

export const SIMULATED_NOTICE = "Simulated Fabric test network: not Hyperledger Fabric, not a BEE system. Local demonstration with synthetic data.";

const STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted", pending: "Pending", active: "Active", failed: "Failed", revoked: "Revoked", amended: "Amended",
};
const ACTION_LABEL: Record<string, string> = {
  submit: "Submit to ledger", commit: "Commit (peer)", fail: "Fail commit (simulate)", retry: "Retry", amend: "Amend valid-to", revoke: "Revoke",
};

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function Hash({ value }: { value: string }) {
  return <code title={value} className="font-mono text-xs break-all">{short(value)}</code>;
}

export function LedgerDemo() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [blocks, setBlocks] = useState<Tx[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<"fail" | "amend" | "revoke" | null>(null);
  const [reason, setReason] = useState("");
  const [validTo, setValidTo] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    const [list, ex] = await Promise.all([
      demoGet<{ certificates: Row[]; readOnly: boolean }>(demoPath("ledger")),
      demoGet<{ transactions: Tx[] }>(demoPath("ledger", "transactions")),
    ]);
    if (!list.ok) { setError(list.message); return; }
    setRows(list.value.certificates);
    setReadOnly(list.value.readOnly);
    if (ex.ok) setBlocks(ex.value.transactions);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const r = await demoGet<Detail>(demoPath("ledger", id));
    if (r.ok) setDetail(r.value); else setError(r.message);
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([
      demoGet<{ certificates: Row[]; readOnly: boolean }>(demoPath("ledger")),
      demoGet<{ transactions: Tx[] }>(demoPath("ledger", "transactions")),
    ]).then(([list, ex]) => {
      if (!live) return;
      if (!list.ok) { setError(list.message); return; }
      setRows(list.value.certificates);
      setReadOnly(list.value.readOnly);
      if (ex.ok) setBlocks(ex.value.transactions);
    });
    return () => { live = false; };
  }, []);

  async function act(name: string, payload: object = {}) {
    if (!selected) return;
    setBusy(true); setError(null); setStatus(null);
    const r: DemoResult = await demoPost(demoPath("ledger", selected, name), payload);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setStatus(`${ACTION_LABEL[name] ?? name}: done on the simulated ledger.`);
    setForm(null); setReason(""); setValidTo("");
    await Promise.all([loadAll(), loadDetail(selected)]);
  }

  function press(a: Action) {
    if (a.action === "fail" || a.action === "amend" || a.action === "revoke") { setForm(a.action); setError(null); return; }
    void act(a.action);
  }

  function sendForm() {
    if (form === "amend") void act("amend", { reason, validTo });
    else if (form) void act(form, { reason });
  }

  const formReady = reason.trim().length > 0 && (form !== "amend" || validTo.length > 0);

  return (
    <div className="p-space-md lg:p-space-lg" data-testid="demo-ledger">
      <div role="note" data-testid="ledger-notice" className="sticky top-0 z-10 rounded-lg bg-tertiary-container text-on-tertiary-container px-space-md py-2 font-label-md">
        {SIMULATED_NOTICE}
      </div>
      <h1 className="mt-space-md font-headline-md text-headline-md text-on-surface">Certificate ledger (simulated Fabric)</h1>
      <p className="mt-1 font-body-sm text-on-surface-variant">
        Each certificate has a chain of transactions; every hash is sha256 of the previous hash and the certificate fields. A second person must commit what the first submitted.
        {readOnly ? " You can read this ledger but not change it." : ""}
      </p>
      {error ? <p role="alert" data-testid="ledger-error" className="mt-space-sm rounded-lg bg-error-container text-on-error-container p-space-sm font-body-sm">{error}</p> : null}
      {status ? <p role="status" data-testid="ledger-status" className="mt-space-sm rounded-lg bg-surface-card p-space-sm font-body-sm">{status}</p> : null}

      <section className="mt-space-md" aria-labelledby="ledger-certs">
        <h2 id="ledger-certs" className="font-title-md text-title-md text-on-surface">Certificates</h2>
        {rows === null && !error ? <p className="font-body-sm">Loading…</p> : null}
        {rows && rows.length === 0 ? <p className="font-body-sm text-on-surface-variant">No certificates are visible to you.</p> : null}
        {rows && rows.length > 0 ? (
          <table className="w-full font-body-sm mt-space-sm" data-testid="ledger-certs">
            <caption className="sr-only">Certificates and their simulated ledger status</caption>
            <thead><tr className="text-left text-on-surface-variant font-label-sm">
              <th className="py-1 pr-3">Registration ID</th><th className="py-1 pr-3">Model</th><th className="py-1 pr-3">Manufacturer</th>
              <th className="py-1 pr-3">Ledger status</th><th className="py-1 pr-3">Last transaction</th><th className="py-1"><span className="sr-only">Open</span></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.certificateId} className="border-t border-outline-variant">
                  <td className="py-1 pr-3">{c.registrationId}</td>
                  <td className="py-1 pr-3">{c.brandName} {c.modelNumber}</td>
                  <td className="py-1 pr-3">{c.manufacturer}</td>
                  <td className="py-1 pr-3" data-testid={`ledger-status-${c.registrationId}`}>{STATUS_LABEL[c.ledgerStatus] ?? c.ledgerStatus}{c.pendingKind && c.ledgerStatus !== "pending" ? ` (${c.pendingKind} pending)` : ""}</td>
                  <td className="py-1 pr-3">{c.lastTx ? `${c.lastTx.kind} · ${c.lastTx.state}` : "none"}</td>
                  <td className="py-1"><button type="button" onClick={() => { setSelected(c.certificateId); setStatus(null); setError(null); setForm(null); void loadDetail(c.certificateId); }} className="text-primary underline" aria-label={`Open ledger panel for ${c.registrationId}`}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {detail ? (
        <section className="mt-space-lg bg-surface-card rounded-xl shadow-sm p-space-md" aria-labelledby="ledger-panel" data-testid="ledger-panel">
          <h2 id="ledger-panel" className="font-title-md text-title-md text-on-surface">Ledger panel: {detail.registrationId}</h2>
          <p className="font-body-sm mt-1">
            {detail.brandName} {detail.modelNumber} · {detail.stars} star · valid {detail.validFrom} to {detail.validTo}
            {detail.ledgerValidTo !== detail.validTo ? <> · <strong>ledger valid-to {detail.ledgerValidTo}</strong></> : null}
          </p>
          <p className="font-body-md mt-1" data-testid="ledger-panel-status">Ledger status: <strong>{STATUS_LABEL[detail.ledgerStatus]}</strong>{detail.pendingKind ? ` · ${detail.pendingKind} waiting for a peer` : ""}</p>

          <div role="status" data-testid="ledger-verify" className={`mt-space-sm rounded-lg p-space-sm font-body-sm ${detail.verification.result === "MATCH" ? "bg-surface-ground" : "bg-error-container text-on-error-container"}`}>
            Chain verification: <strong>{detail.verification.result}</strong>
            {detail.verification.firstBadSeq ? ` at transaction ${detail.verification.firstBadSeq}` : ""}. {detail.verification.detail}
            <button type="button" className="ml-3 underline" onClick={() => void loadDetail(detail.certificateId)}>Verify again</button>
          </div>

          <table className="w-full font-body-sm mt-space-sm" data-testid="ledger-txs">
            <caption className="sr-only">Transactions of this certificate</caption>
            <thead><tr className="text-left text-on-surface-variant font-label-sm">
              <th className="py-1 pr-3">Block</th><th className="py-1 pr-3">Seq</th><th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">State</th>
              <th className="py-1 pr-3">Hash</th><th className="py-1 pr-3">Previous hash</th><th className="py-1">Note</th>
            </tr></thead>
            <tbody>
              {detail.transactions.map((t) => (
                <tr key={t.id} className="border-t border-outline-variant align-top">
                  <td className="py-1 pr-3">{t.blockNo}</td><td className="py-1 pr-3">{t.seq}</td>
                  <td className="py-1 pr-3">{t.kind}{t.attempt > 1 ? ` (attempt ${t.attempt})` : ""}</td>
                  <td className="py-1 pr-3">{t.state}</td>
                  <td className="py-1 pr-3"><Hash value={t.hash} /></td><td className="py-1 pr-3"><Hash value={t.prevHash} /></td>
                  <td className="py-1">{t.failureReason ?? t.reason ?? ""}{t.seededNote ? <span className="block font-semibold">Seeded mismatch</span> : null}<span className="block text-on-surface-variant">by {t.submittedBy}{t.decidedBy ? `, decided by ${t.decidedBy}` : ""}</span></td>
                </tr>
              ))}
              {detail.transactions.length === 0 ? <tr><td colSpan={7} className="py-1">Not submitted: no transactions yet.</td></tr> : null}
            </tbody>
          </table>

          <div className="mt-space-sm flex flex-wrap gap-2" data-testid="ledger-actions">
            {detail.actions.map((a) => (
              <button key={a.action} type="button" disabled={!a.allowed || busy} onClick={() => press(a)} aria-describedby={a.why ? `why-${a.action}` : undefined}
                className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`ledger-action-${a.action}`}>
                {ACTION_LABEL[a.action] ?? a.action}
              </button>
            ))}
          </div>
          {detail.actions.filter((a) => a.why).map((a) => <p key={a.action} id={`why-${a.action}`} className="font-body-sm text-on-surface-variant mt-1">{a.why}</p>)}
          {detail.actions.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-space-sm">No action is available to you on this certificate now.</p> : null}

          {form ? (
            <div className="mt-space-sm" data-testid="ledger-form">
              <label className="block font-label-sm text-on-surface-variant">
                Reason
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="ledger-reason" />
              </label>
              {form === "amend" ? (
                <label className="block font-label-sm text-on-surface-variant mt-space-sm">
                  New valid-to date (the only field that can be amended)
                  <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="mt-1 block py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="ledger-validto" />
                </label>
              ) : null}
              <button type="button" disabled={!formReady || busy} onClick={sendForm} className="mt-space-sm border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid="ledger-form-send">
                Send: {ACTION_LABEL[form]}
              </button>
            </div>
          ) : null}

          {detail.events.length > 0 ? (
            <details className="mt-space-sm"><summary className="font-label-md cursor-pointer">Audit trail ({detail.events.length})</summary>
              <ul className="font-body-sm mt-1">{detail.events.map((e, i) => <li key={i}>{e.at.slice(0, 19).replace("T", " ")} · {e.action} · tx {e.seq} ({e.kind}) · {e.actor}{e.reason ? ` · ${e.reason}` : ""}</li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="mt-space-lg" aria-labelledby="ledger-explorer">
        <h2 id="ledger-explorer" className="font-title-md text-title-md text-on-surface">Block explorer (simulated)</h2>
        <table className="w-full font-body-sm mt-space-sm" data-testid="ledger-explorer">
          <caption className="sr-only">All transactions by block number, newest first</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm">
            <th className="py-1 pr-3">Block</th><th className="py-1 pr-3">Certificate</th><th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">State</th>
            <th className="py-1 pr-3">Hash</th><th className="py-1 pr-3">Previous hash</th><th className="py-1">Created</th>
          </tr></thead>
          <tbody>
            {blocks.map((t) => (
              <tr key={t.id} className="border-t border-outline-variant">
                <td className="py-1 pr-3">{t.blockNo}</td><td className="py-1 pr-3">{t.registrationId}</td><td className="py-1 pr-3">{t.kind}{t.attempt > 1 ? ` #${t.attempt}` : ""}</td>
                <td className="py-1 pr-3">{t.state}</td><td className="py-1 pr-3"><Hash value={t.hash} /></td><td className="py-1 pr-3"><Hash value={t.prevHash} /></td>
                <td className="py-1">{t.createdAt.slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}
            {blocks.length === 0 ? <tr><td colSpan={7} className="py-1">No transactions yet.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
