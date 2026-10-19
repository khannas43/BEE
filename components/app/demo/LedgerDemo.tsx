"use client";

import { Pill } from "./DemoShell";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { demoGet, demoPath, demoPost, type DemoResult } from "@/lib/client/runtimeDemo";
import { istStamp } from "@/lib/client/istTime";

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

const certStatusText = (c: Row) => `${STATUS_LABEL[c.ledgerStatus] ?? c.ledgerStatus}${c.pendingKind && c.ledgerStatus !== "pending" ? ` (${c.pendingKind} pending)` : ""}`;

const card = "rounded-xl border border-[#dbe6f7] bg-white";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";

function Stat({ icon, label, value, tone = "text-[#14315E]", note, onClick, on }: { icon: string; label: string; value: number | string; tone?: string; note?: string; onClick?: () => void; on?: boolean }) {
  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#64748b]"><Icon name={icon} size={16} />{label}</span>
      <span className={`mt-1 block text-[28px] font-extrabold leading-8 ${tone}`}>{value}</span>
      {note ? <span className="block text-[12px] text-[#64748b]">{note}</span> : null}
    </>
  );
  const cls = `${card} p-4 text-left ${on ? "border-[#254e9e] ring-2 ring-[#c9d9f7]" : ""}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:border-[#9dbdec]`} aria-pressed={on}>{inner}</button> : <div className={cls}>{inner}</div>;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{label}</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{value}</div></div>;
}

function CertsTable({ rows, onOpen }: { rows: Row[]; onOpen: (c: Row) => void }) {
  const tools = useListTools({
    rows,
    text: (c) => `${c.registrationId} ${c.brandName} ${c.modelNumber} ${c.manufacturer} ${certStatusText(c)}`,
    date: (c) => c.validTo?.slice(0, 10),
    sortValue: (c, k) => (k === "reg" ? c.registrationId : k === "model" ? `${c.brandName} ${c.modelNumber}` : k === "mfr" ? c.manufacturer : k === "status" ? certStatusText(c) : k === "valid" ? c.validTo ?? "" : c.lastTx ? `${c.lastTx.kind} ${c.lastTx.state}` : ""),
  });
  return (
    <div className="space-y-space-sm">
      <ListToolbar tools={tools} searchLabel="Search by registration or model" placeholder="Registration, model or manufacturer" dateLabel="Valid to"
        exportCsv={{ filename: "ledger-certificates", header: ["Registration ID", "Brand", "Model", "Manufacturer", "Ledger status", "Valid to", "Last transaction"],
          rows: tools.visible.map((c) => [c.registrationId, c.brandName, c.modelNumber, c.manufacturer, certStatusText(c), c.validTo?.slice(0, 10), c.lastTx ? `${c.lastTx.kind} ${c.lastTx.state}` : "none"]) }} />
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No certificates match.</p> : (
        <>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-[13px]" data-testid="ledger-certs">
              <caption className="sr-only">Certificates and their simulated ledger status</caption>
              <thead><tr className="bg-[#eef3fb]">
                <SortableTh tools={tools} k="reg" className={th}>Registration ID</SortableTh><SortableTh tools={tools} k="model" className={th}>Model</SortableTh>
                <SortableTh tools={tools} k="mfr" className={th}>Manufacturer</SortableTh><SortableTh tools={tools} k="status" className={th}>Ledger status</SortableTh>
                <SortableTh tools={tools} k="valid" className={th}>Valid to</SortableTh><SortableTh tools={tools} k="last" className={th}>Last transaction</SortableTh>
                <th className={th}><span className="sr-only">Open</span></th>
              </tr></thead>
              <tbody>
                {tools.paged.pageRows.map((c) => (
                  <tr key={c.certificateId} className="border-t border-[#e7edf6] cursor-pointer hover:bg-[#f4f8ff]" onClick={() => onOpen(c)}>
                    <td className={`${td} font-semibold text-[#14315E]`}>{c.registrationId}</td>
                    <td className={td}>{c.brandName} {c.modelNumber}</td>
                    <td className={td}>{c.manufacturer}</td>
                    <td className={td} data-testid={`ledger-status-${c.registrationId}`}><Pill>{certStatusText(c)}</Pill></td>
                    <td className={td}>{c.validTo?.slice(0, 10)}</td>
                    <td className={td}>{c.lastTx ? `${c.lastTx.kind} · ${c.lastTx.state}` : "none"}</td>
                    <td className={td}><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(c); }} className="inline-flex items-center gap-1 font-semibold text-primary" aria-label={`Open ledger panel for ${c.registrationId}`}>Open <Icon name="arrow_forward" size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager tools={tools} />
        </>
      )}
    </div>
  );
}

function ExplorerTable({ blocks, onOpen }: { blocks: Tx[]; onOpen: (certificateId: string) => void }) {
  const tools = useListTools({
    rows: blocks,
    text: (t) => `${t.blockNo} ${t.registrationId} ${t.kind} ${t.state} ${t.submittedBy}`,
    date: (t) => t.createdAt?.slice(0, 10),
    sortValue: (t, k) => (k === "block" ? t.blockNo : k === "cert" ? t.registrationId : k === "kind" ? t.kind : k === "state" ? t.state : k === "hash" ? t.hash : k === "prev" ? t.prevHash : t.createdAt),
  });
  return (
    <div className="space-y-space-sm">
      {blocks.length > 0 ? <ListToolbar tools={tools} searchLabel="Search by certificate" placeholder="Certificate, kind or state" dateLabel="Created"
        exportCsv={{ filename: "ledger-transactions", header: ["Block", "Certificate", "Kind", "Attempt", "State", "Hash", "Previous hash", "Submitted by", "Created"],
          rows: tools.visible.map((t) => [t.blockNo, t.registrationId, t.kind, t.attempt, t.state, t.hash, t.prevHash, t.submittedBy, istStamp(t.createdAt)]) }} /> : null}
      {blocks.length > 0 && tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No transactions match.</p> : (
        <>
          <p className="text-[13px] text-[#64748b]">Select a transaction to open its certificate and verify the chain.</p>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-[13px]" data-testid="ledger-explorer">
              <caption className="sr-only">All transactions by block number, newest first</caption>
              <thead><tr className="bg-[#eef3fb]">
                <SortableTh tools={tools} k="block" className={th}>Block</SortableTh><SortableTh tools={tools} k="cert" className={th}>Certificate</SortableTh>
                <SortableTh tools={tools} k="kind" className={th}>Kind</SortableTh><SortableTh tools={tools} k="state" className={th}>State</SortableTh>
                <SortableTh tools={tools} k="hash" className={th}>Hash</SortableTh><SortableTh tools={tools} k="prev" className={th}>Previous hash</SortableTh>
                <SortableTh tools={tools} k="created" className={th}>Created</SortableTh>
              </tr></thead>
              <tbody>
                {tools.paged.pageRows.map((t) => (
                  <tr key={t.id} className="border-t border-[#e7edf6] cursor-pointer hover:bg-[#f4f8ff]" onClick={() => onOpen(t.certificateId)}>
                    <td className={`${td} font-semibold`}>{t.blockNo}</td>
                    <td className={td}><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(t.certificateId); }} className="font-semibold text-primary underline">{t.registrationId}</button></td>
                    <td className={td}>{t.kind}{t.attempt > 1 ? ` #${t.attempt}` : ""}</td>
                    <td className={td}><Pill>{t.state}</Pill></td><td className={td}><Hash value={t.hash} /></td><td className={td}><Hash value={t.prevHash} /></td>
                    <td className={td}>{istStamp(t.createdAt)}</td>
                  </tr>
                ))}
                {blocks.length === 0 ? <tr><td colSpan={7} className={td}>No transactions yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {blocks.length > 0 ? <ListPager tools={tools} /> : null}
        </>
      )}
    </div>
  );
}

type ChainProps = { detail: Detail };

/** The certificate's transactions one under the other, each pointing at the hash of the one before it. */
function Chain({ detail }: ChainProps) {
  const bad = detail.verification.result === "MISMATCH" ? detail.verification.firstBadSeq : null;
  if (detail.transactions.length === 0) return <p className="text-[13px] text-[#64748b]" data-testid="ledger-txs">Not submitted: no transactions yet.</p>;
  return (
    <ol className="space-y-3" data-testid="ledger-txs">
      {detail.transactions.map((t, i) => (
        <li key={t.id} className="relative pl-8">
          {i < detail.transactions.length - 1 ? <span className="absolute left-[11px] top-6 bottom-[-12px] w-0.5 bg-[#c9d9f7]" aria-hidden /> : null}
          <span className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${bad === t.seq ? "bg-[#ba1a1a]" : "bg-[#254e9e]"}`}>{t.seq}</span>
          <div className={`rounded-xl border p-3 ${bad === t.seq ? "border-[#f5c2c0] bg-[#fffafa]" : "border-[#dbe6f7] bg-[#f9fbff]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#14315E]">{t.kind}{t.attempt > 1 ? ` (attempt ${t.attempt})` : ""} <span className="font-normal text-[#64748b]">· block {t.blockNo}</span></span>
              <Pill>{t.state}</Pill>
            </div>
            <div className="mt-1 text-[12px] text-[#475569]">
              {istStamp(t.createdAt)} · submitted by {t.submittedBy}{t.decidedBy ? `, decided by ${t.decidedBy}` : ""}{t.committedAt ? ` · committed ${istStamp(t.committedAt)}` : ""}
            </div>
            {t.failureReason || t.reason ? <div className="mt-1 text-[13px] text-[#1e293b]">{t.failureReason ?? t.reason}</div> : null}
            {t.seededNote ? <div className="mt-1 text-[13px] font-semibold text-[#93000a]">Seeded mismatch</div> : null}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Hash</div><code className="block break-all rounded bg-white px-2 py-1 font-mono text-[11px] border border-[#e2e8f0]">{t.hash}</code></div>
              <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Previous hash</div><code className="block break-all rounded bg-white px-2 py-1 font-mono text-[11px] border border-[#e2e8f0]">{t.prevHash}</code></div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function LedgerDemo() {
  const fromUrl = useSearchParams()?.get("cert") ?? null;
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selected = picked !== undefined ? picked : fromUrl;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [blocks, setBlocks] = useState<Tx[]>([]);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [view, setView] = useState<"certs" | "explorer">("certs");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
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
    if (ex.ok) { setBlocks(ex.value.transactions); setBlocksError(null); } else setBlocksError(ex.message);
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
      if (ex.ok) { setBlocks(ex.value.transactions); setBlocksError(null); } else setBlocksError(ex.message);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    void demoGet<Detail>(demoPath("ledger", selected)).then((r) => {
      if (!live) return;
      if (r.ok) setDetail(r.value); else setError(r.message);
    });
    return () => { live = false; };
  }, [selected]);

  function openCert(id: string) {
    setDetail(null); setStatus(null); setError(null); setForm(null);
    setPicked(id);
    if (typeof window !== "undefined") { window.history.replaceState(null, "", `${window.location.pathname}?cert=${id}`); window.scrollTo?.({ top: 0 }); }
  }
  function closeCert() {
    setPicked(null); setDetail(null); setStatus(null); setError(null); setForm(null);
    if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
  }

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
  const count = (st: string) => (rows ?? []).filter((r) => r.ledgerStatus === st).length;
  const shown = (rows ?? []).filter((r) => !statusFilter || r.ledgerStatus === statusFilter);
  const notices = (
    <>
      {error ? <p role="alert" data-testid="ledger-error" className="rounded-lg bg-error-container text-on-error-container p-space-sm font-body-sm">{error}</p> : null}
      {status ? <p role="status" data-testid="ledger-status" className="rounded-lg border border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d] p-space-sm font-body-sm">{status}</p> : null}
    </>
  );

  if (selected) {
    return (
      <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-ledger">
        <button type="button" onClick={closeCert} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary" data-testid="ledger-back"><Icon name="arrow_back" size={16} /> All certificates</button>
        {notices}
        {!detail ? (error ? null : <p role="status" className="font-body-sm">Loading certificate…</p>) : (
          <>
            <div className={`${card} p-5`} data-testid="ledger-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div role="heading" aria-level={1} className="text-[22px] font-extrabold text-[#14315E]">{detail.registrationId}</div>
                  <div className="text-[14px] text-[#475569]">{detail.brandName} {detail.modelNumber} · {detail.manufacturer}</div>
                </div>
                <span data-testid="ledger-panel-status" className="text-[13px] text-[#475569]">Ledger status: <Pill>{STATUS_LABEL[detail.ledgerStatus] ?? detail.ledgerStatus}</Pill>{detail.pendingKind ? ` ${detail.pendingKind} waiting for a peer` : ""}</span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Fact label="Star rating" value={`${detail.stars} star`} />
                <Fact label="Valid from" value={detail.validFrom} />
                <Fact label="Valid to" value={detail.validTo} />
                <Fact label="Ledger valid to" value={<>{detail.ledgerValidTo}{detail.ledgerValidTo !== detail.validTo ? <span className="ml-1 text-[#8a4b00]">(differs)</span> : null}</>} />
                <Fact label="Transactions" value={detail.transactions.length} />
              </div>
              <div role="status" data-testid="ledger-verify" className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-[13px] ${detail.verification.result === "MATCH" ? "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" : "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]"}`}>
                <span className="flex items-center gap-1.5"><Icon name={detail.verification.result === "MATCH" ? "verified" : "gpp_bad"} size={18} />
                  <span>Chain verification: <strong>{detail.verification.result}</strong>{detail.verification.firstBadSeq ? ` at transaction ${detail.verification.firstBadSeq}` : ""}. {detail.verification.detail}</span></span>
                <button type="button" className="font-semibold underline" onClick={() => void loadDetail(detail.certificateId)}>Verify again</button>
              </div>
            </div>

            <div className={`${card} p-5`}>
              <div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Transaction chain</div>
              <Chain detail={detail} />
            </div>

            <div className={`${card} p-5`}>
              <div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Actions</div>
              <div className="flex flex-wrap gap-2" data-testid="ledger-actions">
                {detail.actions.map((a) => (
                  <button key={a.action} type="button" disabled={!a.allowed || busy} onClick={() => press(a)} aria-describedby={a.why ? `why-${detail.actions.find((x) => x.why === a.why)?.action}` : undefined}
                    className="border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid={`ledger-action-${a.action}`}>
                    {ACTION_LABEL[a.action] ?? a.action}
                  </button>
                ))}
              </div>
              {detail.actions.filter((a, i, all) => a.why && all.findIndex((x) => x.why === a.why) === i).map((a) => <p key={a.action} id={`why-${a.action}`} className="font-body-sm text-on-surface-variant mt-2">{a.why}</p>)}
              {detail.actions.length === 0 ? <p className="font-body-sm text-on-surface-variant">No action is available to you on this certificate now.</p> : null}
              {readOnly ? <p className="mt-2 text-[13px] text-[#64748b]">You can read this ledger but not change it.</p> : null}
              {form ? (
                <div className="mt-3 rounded-lg border border-[#dbe6f7] bg-[#f9fbff] p-3" data-testid="ledger-form">
                  <label className="block font-label-sm text-on-surface-variant">
                    Reason
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full py-2 px-3 rounded-lg bg-white border border-outline-variant font-body-sm" data-testid="ledger-reason" />
                  </label>
                  {form === "amend" ? (
                    <label className="block font-label-sm text-on-surface-variant mt-space-sm">
                      New valid-to date (the only field that can be amended)
                      <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="mt-1 block py-2 px-3 rounded-lg bg-white border border-outline-variant font-body-sm" data-testid="ledger-validto" />
                    </label>
                  ) : null}
                  <button type="button" disabled={!formReady || busy} onClick={sendForm} className="mt-space-sm border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50" data-testid="ledger-form-send">
                    Send: {ACTION_LABEL[form]}
                  </button>
                </div>
              ) : null}
            </div>

            <div className={`${card} p-5`}>
              <div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Audit trail ({detail.events.length})</div>
              {detail.events.length === 0 ? <p className="text-[13px] text-[#64748b]">No recorded actions yet.</p> : (
                <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">Actions recorded on this certificate</caption>
                    <thead><tr className="bg-[#eef3fb]"><th className={th}>When</th><th className={th}>Action</th><th className={th}>Transaction</th><th className={th}>By</th><th className={th}>Reason</th></tr></thead>
                    <tbody>
                      {detail.events.map((e, i) => (
                        <tr key={i} className="border-t border-[#e7edf6]"><td className={td}>{istStamp(e.at)}</td><td className={`${td} font-semibold`}>{e.action}</td><td className={td}>{e.seq} ({e.kind})</td><td className={td}>{e.actor}</td><td className={td}>{e.reason ?? ""}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-ledger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex-1 min-w-0">Certificate ledger</h1>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e0ea] bg-[#eef2f7] px-2.5 py-0.5 text-[12px] font-semibold text-[#475569]" title={SIMULATED_NOTICE}><Icon name="science" size={14} /> Simulated test network</span>
      </div>
      <p className="ai-lead">Each certificate has a chain of transactions; every hash is sha256 of the previous hash and the certificate fields. A second person must commit what the first submitted.{readOnly ? " You can read this ledger but not change it." : ""}</p>
      {notices}
      {rows === null && !error ? <p role="status" className="font-body-sm">Loading…</p> : null}
      {rows ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="ledger-summary">
            <Stat icon="verified_user" label="Active" value={count("active")} tone="text-[#14532d]" note="committed on the ledger" onClick={() => { setView("certs"); setStatusFilter(statusFilter === "active" ? null : "active"); }} on={statusFilter === "active"} />
            <Stat icon="hourglass_top" label="Pending" value={count("pending")} tone="text-[#8a4b00]" note="waiting for a second person" onClick={() => { setView("certs"); setStatusFilter(statusFilter === "pending" ? null : "pending"); }} on={statusFilter === "pending"} />
            <Stat icon="error" label="Failed" value={count("failed")} tone="text-[#93000a]" note="commit failed" onClick={() => { setView("certs"); setStatusFilter(statusFilter === "failed" ? null : "failed"); }} on={statusFilter === "failed"} />
            <Stat icon="block" label="Revoked" value={count("revoked")} tone="text-[#93000a]" note="no longer valid" onClick={() => { setView("certs"); setStatusFilter(statusFilter === "revoked" ? null : "revoked"); }} on={statusFilter === "revoked"} />
            <Stat icon="deployed_code" label="Transactions" value={blocks.length} note={`${rows.length} certificates, ${count("not_submitted")} not submitted`} />
          </div>
          <div role="tablist" aria-label="Ledger views" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button role="tab" aria-selected={view === "certs"} onClick={() => setView("certs")} className="ai-tile" data-testid="ledger-tab-certs">
              <Icon name="workspace_premium" size={22} /><span className="ai-tile-title">Certificates{statusFilter ? ` · ${STATUS_LABEL[statusFilter]}` : ""}</span><span className="ai-tile-blurb">Each certificate with its ledger status; open one to verify its chain</span>
            </button>
            <button role="tab" aria-selected={view === "explorer"} onClick={() => setView("explorer")} className="ai-tile" data-testid="ledger-tab-explorer">
              <Icon name="travel_explore" size={22} /><span className="ai-tile-title">Block explorer</span><span className="ai-tile-blurb">Every transaction, newest block first</span>
            </button>
          </div>
          {view === "certs" ? (
            shown.length === 0 && rows.length === 0 ? <p className="font-body-sm text-on-surface-variant">No certificates are visible to you.</p> : <CertsTable rows={shown} onOpen={(c) => openCert(c.certificateId)} />
          ) : (
            <>
              {blocksError ? <p role="alert" className="text-error font-body-md">The block explorer could not be loaded: {blocksError}</p> : null}
              <ExplorerTable blocks={blocks} onOpen={openCert} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
