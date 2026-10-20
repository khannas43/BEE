"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { useModelRegister } from "@/components/app/registrations/ModelsRegister";
import {
  createServiceRequest, KIND_WORD, readServiceRequests, respondToRequest, STATUS_TONE, STATUS_WORD,
  type RequestKind, type RequestList, type RequestStatus, type ServiceRequest,
} from "@/lib/client/runtimeServiceRequests";

/**
 * Renewals, withdrawals and helpdesk requests. A manufacturer raises a request and follows its answer; BEE staff see every request and answer it.
 * `?kind=renewal|withdrawal|helpdesk` picks the manufacturer's screen; staff see all kinds. Local demonstration, not BEE rules.
 */

const card = "rounded-xl border border-[#dbe6f7] bg-white";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const fieldCls = "mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
const labelCls = "block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]";
const CATEGORIES = ["Account and sign-in", "Application or model", "QR codes and labels", "Payments and receipts", "Quarterly submission", "Other"];

const COPY: Record<RequestKind, { title: string; icon: string; intro: string }> = {
  renewal: { title: "Renewals", icon: "autorenew", intro: "A certificate is valid for three years. Ask for a renewal before it ends; an expired certificate can no longer be shown as valid." },
  withdrawal: { title: "Withdrawals", icon: "cancel", intro: "Withdraw a certificate you no longer need. BEE records the reason and answers the request; a withdrawn certificate cannot be reinstated." },
  helpdesk: { title: "Helpdesk", icon: "support_agent", intro: "Ask BEE for help with your account, an application, QR codes, payments or the quarterly submission." },
};

function Box({ title, testId, children, defaultOpen = true }: { title: string; testId: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${card} p-5`} data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">{title}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={22} className="text-[#475569]" />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

const StatusChip = ({ s }: { s: RequestStatus }) => <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_TONE[s]}`}>{STATUS_WORD[s]}</span>;
const day = (iso: string) => iso.slice(0, 10);

function daysLeft(validTo: string | null): number | null {
  if (!validTo) return null;
  return Math.round((new Date(`${validTo}T00:00:00`).getTime() - Date.now()) / 864e5);
}

export function ServiceRequests() {
  const kindParam = useSearchParams()?.get("kind") ?? "";
  const kind: RequestKind | "" = kindParam === "renewal" || kindParam === "withdrawal" || kindParam === "helpdesk" ? kindParam : "";
  const [list, setList] = useState<RequestList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await readServiceRequests();
    if (r.ok) { setList(r.list); setError(null); } else setError(r.message);
  }, []);
  useEffect(() => {
    let live = true;
    void readServiceRequests().then((r) => { if (!live) return; if (r.ok) setList(r.list); else setError(r.message); });
    return () => { live = false; };
  }, []);

  if (!list && !error) return <p role="status" className="p-space-md font-body-sm" data-testid="requests-loading">Loading requests…</p>;
  if (!list) return <p role="alert" className="p-space-md text-error font-body-sm" data-testid="requests-error">{error}</p>;
  const staff = list.staff;
  const shown = list.requests.filter((r) => !kind || r.kind === kind);
  const copy = kind ? COPY[kind] : { title: "Service requests", icon: "inbox", intro: "Renewals, withdrawals and help requests from manufacturers. Acknowledge, resolve or decline each one with a note." };
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-requests">
      <h1 className="flex-1 min-w-0">{copy.title}</h1>
      <p className="ai-lead">{copy.intro}</p>
      {error ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-[#b7e0c6] bg-[#e2f3e8] px-3 py-2 text-[13px] font-semibold text-[#14532d]" data-testid="requests-notice">{notice}</p> : null}
      {staff ? <StaffView list={list} shown={shown} kind={kind} onChanged={() => { setNotice("Response saved."); void reload(); }} /> : kind ? <ManufacturerView kind={kind} list={list} shown={shown} onRaised={(ref) => { setNotice(`Request ${ref} was sent to BEE.`); void reload(); }} /> : <RequestsTable rows={shown} staff={false} />}
    </div>
  );
}

function RequestsTable({ rows, staff, onRespond }: { rows: ServiceRequest[]; staff: boolean; onRespond?: (r: ServiceRequest) => ReactNode }) {
  const tools = useListTools({
    rows,
    text: (r) => `${r.reference} ${r.subject} ${r.organisation} ${KIND_WORD[r.kind]} ${STATUS_WORD[r.status]} ${r.message ?? ""}`,
    date: (r) => r.createdAt.slice(0, 10),
    sortValue: (r, k) => (k === "ref" ? r.reference : k === "kind" ? r.kind : k === "org" ? r.organisation : k === "subject" ? r.subject : k === "status" ? r.status : r.createdAt),
    pageSize: 8,
  });
  const [status, setStatus] = useState("");
  if (rows.length === 0) return <p className="text-[13px] text-[#64748b]" data-testid="requests-empty">No request yet.</p>;
  const visible = tools.paged.pageRows.filter((r) => !status || r.status === status);
  return (
    <div className="space-y-space-sm">
      <ListToolbar tools={tools} searchLabel="Search requests" placeholder="Reference, subject or status" dateLabel="Raised"
        exportCsv={{ filename: "service-requests", header: ["Reference", "Type", "Organisation", "Subject", "Status", "Raised", "Response"], rows: tools.visible.map((r) => [r.reference, KIND_WORD[r.kind], r.organisation, r.subject, STATUS_WORD[r.status], day(r.createdAt), r.responseNote ?? ""]) }} />
      <label className={labelCls}>Status
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldCls} w-auto`} data-testid="requests-status-filter"><option value="">All</option>{(Object.keys(STATUS_WORD) as RequestStatus[]).map((s) => <option key={s} value={s}>{STATUS_WORD[s]}</option>)}</select>
      </label>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]" data-testid="requests-table">
          <caption className="sr-only">Service requests</caption>
          <thead><tr className="bg-[#eef3fb]">
            <SortableTh tools={tools} k="ref" className={th}>Reference</SortableTh><SortableTh tools={tools} k="kind" className={th}>Type</SortableTh>
            {staff ? <SortableTh tools={tools} k="org" className={th}>Manufacturer</SortableTh> : null}
            <SortableTh tools={tools} k="subject" className={th}>Subject</SortableTh><SortableTh tools={tools} k="status" className={th}>Status</SortableTh>
            <SortableTh tools={tools} k="date" className={th}>Raised</SortableTh><th className={th}>BEE response</th>
          </tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-[#e7edf6]" data-testid={`request-row-${r.reference}`}>
                <td className={`${td} font-mono font-semibold text-[#14315E]`}>{r.reference}</td><td className={td}>{KIND_WORD[r.kind]}</td>
                {staff ? <td className={td}>{r.organisation.replace(/\s*\(synthetic[^)]*\)\s*$/, "")}</td> : null}
                <td className={td}><div className="font-semibold text-[#14315E]">{r.subject}</div>{r.message ? <div className="max-w-[320px] text-[12px] text-[#475569]">{r.message}</div> : null}{r.category ? <div className="text-[12px] text-[#64748b]">{r.category}</div> : null}</td>
                <td className={td}><StatusChip s={r.status} /></td><td className={td}>{day(r.createdAt)}<div className="text-[12px] text-[#64748b]">{r.createdBy ?? ""}</div></td>
                <td className={td}>{r.responseNote ? <div className="max-w-[260px]">{r.responseNote}<div className="text-[12px] text-[#64748b]">{r.respondedBy}{r.respondedAt ? ` · ${day(r.respondedAt)}` : ""}</div></div> : <span className="text-[#64748b]">{r.status === "submitted" ? "Waiting for BEE" : "-"}</span>}
                  {onRespond ? <div className="mt-1">{onRespond(r)}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}

function Respond({ r, onChanged }: { r: ServiceRequest; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Exclude<RequestStatus, "submitted">>(r.status === "submitted" ? "acknowledged" : (r.status as Exclude<RequestStatus, "submitted">));
  const [note, setNote] = useState(r.responseNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    const x = await respondToRequest(r.id, status, note.trim());
    setBusy(false);
    if (!x.ok) { setError(x.message); return; }
    setOpen(false); onChanged();
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`request-respond-${r.reference}`}><Icon name="reply" size={16} />{r.status === "submitted" ? "Respond" : "Update"}</button>
      {open ? (
        <div className="mt-2 w-[280px] space-y-2 rounded-lg border border-[#dbe6f7] bg-[#f9fbff] p-3">
          <label className={labelCls}>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Exclude<RequestStatus, "submitted">)} className={fieldCls} data-testid={`request-status-${r.reference}`}>
              {(["acknowledged", "resolved", "declined"] as const).map((s) => <option key={s} value={s}>{STATUS_WORD[s]}</option>)}
            </select>
          </label>
          <label className={labelCls}>Note to the manufacturer<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={fieldCls} data-testid={`request-note-${r.reference}`} /></label>
          {error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null}
          <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-lg !bg-[#1f3c88] px-3 py-2 text-[13px] font-semibold !text-white disabled:opacity-50" data-testid={`request-save-${r.reference}`}>{busy ? "Saving…" : "Save response"}</button>
        </div>
      ) : null}
    </div>
  );
}

function StaffView({ list, shown, kind, onChanged }: { list: RequestList; shown: ServiceRequest[]; kind: RequestKind | ""; onChanged: () => void }) {
  const n = (s: RequestStatus) => shown.filter((r) => r.status === s).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="requests-summary">
        {([["Waiting", n("submitted"), "text-[#8a4b00]", "hourglass_top"], ["Acknowledged", n("acknowledged"), "text-[#14315E]", "visibility"], ["Resolved", n("resolved"), "text-[#14532d]", "task_alt"], ["Declined", n("declined"), "text-[#93000a]", "block"]] as [string, number, string, string][]).map(([label, v, tone, icon]) => (
          <div key={label} className={`${card} p-4`}><span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#64748b]"><Icon name={icon} size={16} />{label}</span><span className={`mt-1 block text-[26px] font-extrabold leading-8 ${tone}`}>{v}</span></div>
        ))}
      </div>
      <div role="tablist" aria-label="Kind" className="flex flex-wrap gap-2">
        {([["", "All requests"], ["renewal", "Renewals"], ["withdrawal", "Withdrawals"], ["helpdesk", "Helpdesk"]] as [string, string][]).map(([k, label]) => (
          <a key={k || "all"} role="tab" aria-selected={kind === k} href={k ? `/app/demo/requests?kind=${k}` : "/app/demo/requests"} className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${kind === k ? "border-[#14315E] !bg-[#14315E] !text-white" : "border-[#dbe6f7] bg-white text-[#14315E]"}`}>{label}</a>
        ))}
      </div>
      <Box title="Requests" testId="requests-box-all"><RequestsTable rows={shown} staff onRespond={list.canRespond ? (r) => <Respond key={`${r.id}-${r.status}`} r={r} onChanged={onChanged} /> : undefined} /></Box>
    </>
  );
}

function ManufacturerView({ kind, list, shown, onRaised }: { kind: RequestKind; list: RequestList; shown: ServiceRequest[]; onRaised: (ref: string) => void }) {
  const reg = useModelRegister();
  const certs = reg.phase === "ready" ? reg.items.filter((i) => i.certificate) : [];
  const open = (ref: string) => list.requests.some((r) => r.subjectRef === ref && r.kind === kind && (r.status === "submitted" || r.status === "acknowledged"));
  return (
    <>
      {kind === "renewal" ? <RenewalDue certs={certs} loading={reg.phase === "loading"} open={open} onRaised={onRaised} /> : null}
      {kind === "withdrawal" ? <WithdrawalForm certs={certs} open={open} onRaised={onRaised} /> : null}
      {kind === "helpdesk" ? <HelpForm onRaised={onRaised} /> : null}
      <Box title={`My ${COPY[kind].title.toLowerCase()} requests`} testId="requests-box-mine"><RequestsTable rows={shown} staff={false} /></Box>
    </>
  );
}

type Cert = { key: string; certificate: string | null; model: string; validTo: string | null; status: string };

function RenewalDue({ certs, loading, open, onRaised }: { certs: Cert[]; loading: boolean; open: (ref: string) => boolean; onRaised: (ref: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const due = certs.filter((c) => c.status === "Expired" || c.status === "Expiring soon").sort((a, b) => (a.validTo ?? "").localeCompare(b.validTo ?? ""));
  async function ask(c: Cert) {
    setBusy(c.key); setError(null);
    const r = await createServiceRequest({ kind: "renewal", subject: `Renewal of ${c.certificate} (${c.model})`, subjectRef: c.certificate ?? undefined });
    setBusy(null);
    if (!r.ok) { setError(r.message); return; }
    onRaised(r.reference);
  }
  return (
    <Box title="Certificates that need renewal" testId="requests-box-due">
      {loading ? <p className="text-[13px] text-[#64748b]">Reading your certificates…</p> : due.length === 0 ? <p className="text-[13px] text-[#64748b]" data-testid="requests-nothing-due">None of your certificates has expired or ends within 90 days.</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {due.map((c) => {
            const d = daysLeft(c.validTo);
            const expired = c.status === "Expired";
            return (
              <div key={c.key} className={`rounded-xl border p-4 ${expired ? "border-[#f5c2c0] bg-[#fffafa]" : "border-[#f3dc9c] bg-[#fffaf0]"}`} data-testid={`renewal-card-${c.certificate}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#14315E]">{c.model}</span><span className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold ${expired ? "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]" : "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]"}`}>{expired ? "Expired" : "Expires soon"}</span></div>
                <div className="font-mono text-[12px] text-[#475569]">{c.certificate}</div>
                <div className="mt-1 text-[13px] text-[#1e293b]">Valid to {c.validTo}{d !== null ? (d < 0 ? ` (ended ${-d} days ago)` : ` (${d} days left)`) : ""}</div>
                <button type="button" disabled={busy === c.key || open(c.certificate ?? "")} onClick={() => void ask(c)} className="mt-3 w-full rounded-lg !bg-[#1f3c88] px-3 py-2 text-[13px] font-semibold !text-white disabled:opacity-50" data-testid={`renewal-ask-${c.certificate}`}>
                  {open(c.certificate ?? "") ? "Renewal requested" : busy === c.key ? "Sending…" : "Request renewal"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {error ? <p role="alert" className="mt-2 text-[13px] text-error">{error}</p> : null}
    </Box>
  );
}

function WithdrawalForm({ certs, open, onRaised }: { certs: Cert[]; open: (ref: string) => boolean; onRaised: (ref: string) => void }) {
  const [cert, setCert] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = certs.find((c) => c.certificate === cert);
  async function send() {
    if (!chosen) return;
    setBusy(true); setError(null);
    const r = await createServiceRequest({ kind: "withdrawal", subject: `Withdraw ${chosen.certificate} (${chosen.model})`, subjectRef: chosen.certificate ?? undefined, message: reason.trim() });
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setCert(""); setReason(""); onRaised(r.reference);
  }
  return (
    <Box title="Withdraw a certificate" testId="requests-box-form">
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelCls}>Certificate
          <select value={cert} onChange={(e) => setCert(e.target.value)} className={fieldCls} data-testid="withdrawal-cert"><option value="">Select a certificate</option>{certs.map((c) => <option key={c.key} value={c.certificate ?? ""} disabled={open(c.certificate ?? "")}>{c.certificate} · {c.model}{open(c.certificate ?? "") ? " (withdrawal requested)" : ""}</option>)}</select>
        </label>
        <label className={labelCls}>Reason (required)<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} className={fieldCls} data-testid="withdrawal-reason" placeholder="For example: model discontinued" /></label>
      </div>
      {error ? <p role="alert" className="mt-2 text-[13px] text-error">{error}</p> : null}
      <button type="button" disabled={busy || !chosen || reason.trim().length < 3} onClick={() => void send()} className="mt-3 rounded-lg !bg-[#1f3c88] px-4 py-2 text-[13px] font-semibold !text-white disabled:opacity-50" data-testid="withdrawal-send">{busy ? "Sending…" : "Send withdrawal request"}</button>
    </Box>
  );
}

function HelpForm({ onRaised }: { onRaised: (ref: string) => void }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true); setError(null);
    const r = await createServiceRequest({ kind: "helpdesk", subject: subject.trim(), message: message.trim(), category });
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setSubject(""); setMessage(""); onRaised(r.reference);
  }
  return (
    <Box title="Ask for help" testId="requests-box-form">
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelCls}>Topic<select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls} data-testid="help-category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className={labelCls}>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} className={fieldCls} data-testid="help-subject" placeholder="In a few words" /></label>
        <label className={`${labelCls} md:col-span-2`}>Message (required)<textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={4} className={fieldCls} data-testid="help-message" /></label>
      </div>
      {error ? <p role="alert" className="mt-2 text-[13px] text-error">{error}</p> : null}
      <button type="button" disabled={busy || subject.trim().length < 3 || message.trim().length < 3} onClick={() => void send()} className="mt-3 rounded-lg !bg-[#1f3c88] px-4 py-2 text-[13px] font-semibold !text-white disabled:opacity-50" data-testid="help-send">{busy ? "Sending…" : "Send to BEE"}</button>
    </Box>
  );
}
