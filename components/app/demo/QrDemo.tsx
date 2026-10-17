"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pill } from "./DemoShell";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath, demoPost, type DemoResult } from "@/lib/client/runtimeDemo";
import { csvFileName, datedFileName, saveBytes, saveCsv, toCsv } from "@/lib/client/csv";
import { buildXlsx, XLSX_TYPE } from "@/lib/client/xlsx";
import { istStamp } from "@/lib/client/istTime";

type Counts = { allocated: number; bound: number; void: number; remaining: number };
export type QrBatch = Counts & {
  id: string; reference: string; brandName: string; modelNumber: string; organisation: string; registrationId: string; quantity: number; status: string; createdAt: string;
};
type Eligible = { applicationId: string; reference: string; brandName: string; modelNumber: string; registrationId: string };
type Serial = { serial: string; state: "allocated" | "bound" | "void"; allocatedAt: string; boundAt: string | null; voidedAt: string | null; voidReason: string | null };
type BatchDetail = QrBatch & { serials: Serial[]; total: number; offset: number; limit: number };
type ListBody = { canWrite: boolean; items: QrBatch[]; eligible: Eligible[] };

const PAGE = 25;
const SERIAL = /^BEEQ-[0-9A-HJKMNP-TV-Z]{10}$/;

/** The serial text as the verify page takes it: /verify?reg=<serial> (the public check resolves a bound serial to its certificate). */
export const verifyHref = (serial: string) => `/verify?reg=${encodeURIComponent(serial)}`;

/**
 * QR batches and serials for an approved model with a certificate. Spring decides who may do what; this screen shows what it answers.
 * Local demonstration on provisional rules, not BEE rules.
 */
export function QrDemo() {
  const [list, setList] = useState<ListBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    void demoGet<ListBody>(demoPath("qr")).then((r) => {
      if (!live) return;
      if (r.ok) {
        setList(r.value);
        setError(null);
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [tick]);

  const report = useCallback(
    (r: DemoResult<unknown>, ok: string): boolean => {
      if (r.ok) {
        setError(null);
        setNotice(ok);
        load();
        return true;
      }
      setNotice(null);
      setError(r.message);
      return false;
    },
    [load],
  );

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-qr">
      <h1 className="font-headline-md text-headline-md text-on-surface">QR batches and serials</h1>
      {error ? <p role="alert" className="rounded-lg border border-error/40 bg-error/5 p-space-sm font-body-md" data-testid="qr-error">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-space-sm font-body-md" data-testid="qr-notice">{notice}</p> : null}

      {list === null && !error ? <p role="status" data-testid="qr-loading">Loading batches…</p> : null}
      {list?.canWrite ? <CreateBatch eligible={list.eligible} onDone={(r) => report(r, "Batch created.")} /> : null}
      {list ? <BatchTable items={list.items} selected={selected} onSelect={setSelected} /> : null}
      {selected && list ? (
        <BatchPanel key={selected} id={selected} canWrite={list.canWrite} report={report} />
      ) : null}
    </div>
  );
}

function CreateBatch({ eligible, onDone }: { eligible: Eligible[]; onDone: (r: DemoResult<unknown>) => boolean }) {
  const [app, setApp] = useState("");
  const [quantity, setQuantity] = useState("100");
  const chosen = app || eligible[0]?.applicationId || "";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(quantity);
    if (onDone(await demoPost(demoPath("qr"), { applicationId: chosen, quantity: n }))) setQuantity("100");
  }
  return (
    <form onSubmit={submit} className="rounded-xl bg-surface-card shadow-md p-space-md flex flex-wrap gap-space-sm items-end" aria-label="Create a batch" data-testid="qr-create">
      <h2 className="font-title-md text-title-md w-full">Create a batch</h2>
      {eligible.length === 0 ? (
        <p className="font-body-md" data-testid="qr-no-eligible">No approved model with an issued certificate in your organisation.</p>
      ) : (
        <>
          <label className="flex flex-col font-label-md">
            Approved model
            <select value={chosen} onChange={(e) => setApp(e.target.value)} className="px-3 py-2 rounded-lg bg-surface-container-low" data-testid="qr-app">
              {eligible.map((a) => (
                <option key={a.applicationId} value={a.applicationId}>{a.brandName} {a.modelNumber} ({a.registrationId})</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col font-label-md">
            Quantity (1 to 5000)
            <input type="number" min={1} max={5000} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="px-3 py-2 rounded-lg bg-surface-container-low w-32" data-testid="qr-quantity" />
          </label>
          <button type="submit" className="bg-primary text-on-primary px-space-md py-2 rounded-lg font-label-lg" data-testid="qr-create-run">Create batch</button>
        </>
      )}
    </form>
  );
}

function BatchTable({ items, selected, onSelect }: { items: QrBatch[]; selected: string | null; onSelect: (id: string) => void }) {
  const tools = useListTools({
    rows: items,
    text: (b) => `${b.brandName} ${b.modelNumber} ${b.registrationId} ${b.status}`,
    date: (b) => b.createdAt?.slice(0, 10),
    sortValue: (b, k) => (k === "model" ? `${b.brandName} ${b.modelNumber}` : k === "registration" ? b.registrationId : k === "status" ? b.status : k === "created" ? b.createdAt : Number(b[k as "quantity" | "allocated" | "bound" | "void"])),
  });
  if (items.length === 0) return <p data-testid="qr-empty">No batches yet.</p>;
  return (
    <div className="rounded-xl bg-surface-card shadow-md p-space-md overflow-x-auto space-y-space-sm">
      <h2 className="font-title-md text-title-md mb-space-sm">Batches</h2>
      <ListToolbar tools={tools} searchLabel="Search by model or registration" placeholder="Model, brand or registration" dateLabel="Created"
        exportCsv={{ filename: "qr-batches", header: ["Reference", "Brand", "Model", "Registration ID", "Organisation", "Quantity", "Allocated", "Bound", "Void", "Status", "Created"],
          rows: tools.visible.map((b) => [b.reference, b.brandName, b.modelNumber, b.registrationId, b.organisation, b.quantity, b.allocated, b.bound, b.void, b.status, istStamp(b.createdAt)]) }} />
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No batches match.</p> : (
      <>
      <table className="w-full text-left font-body-sm" data-testid="qr-batches">
        <thead>
          <tr>
            <SortableTh tools={tools} k="model">Model</SortableTh><SortableTh tools={tools} k="registration">Registration</SortableTh><SortableTh tools={tools} k="quantity">Quantity</SortableTh>
            <SortableTh tools={tools} k="allocated">Allocated</SortableTh><SortableTh tools={tools} k="bound">Bound</SortableTh><SortableTh tools={tools} k="void">Void</SortableTh>
            <SortableTh tools={tools} k="status">Status</SortableTh><SortableTh tools={tools} k="created">Created</SortableTh><th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {tools.paged.pageRows.map((b) => (
            <tr key={b.id} data-testid="qr-batch-row" aria-selected={selected === b.id}>
              <td>{b.brandName} {b.modelNumber}</td>
              <td className="font-mono">{b.registrationId}</td>
              <td>{b.quantity}</td>
              <td>{b.allocated}</td>
              <td>{b.bound}</td>
              <td>{b.void}</td>
              <td><Pill>{b.status}</Pill></td>
              <td>{b.createdAt ? b.createdAt.slice(0, 10) : ""}</td>
              <td><button type="button" onClick={() => onSelect(b.id)} className="text-primary underline" data-testid="qr-open">Open {b.modelNumber}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ListPager tools={tools} />
      </>
      )}
    </div>
  );
}

function BatchPanel({ id, canWrite, report }: { id: string; canWrite: boolean; report: (r: DemoResult<unknown>, ok: string) => boolean }) {
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState("");
  const [bindText, setBindText] = useState("");
  const [bindMsg, setBindMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [voidSerial, setVoidSerial] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    void demoGet<BatchDetail>(`${demoPath("qr", id)}?offset=${offset}&limit=${PAGE}`).then((r) => {
      if (!live) return;
      if (r.ok) setDetail(r.value);
      else report(r, "");
    });
    return () => {
      live = false;
    };
  }, [id, offset, tick, report]);

  async function act(path: string, body: object, ok: (v: Record<string, unknown>) => string) {
    const r = await demoPost<Record<string, unknown>>(path, body);
    if (report(r, r.ok ? ok(r.value) : "")) {
      refresh();
    }
  }

  /** Every serial of the batch (the service gives 200 at a time) as one CSV: what a print shop needs for the labels. */
  async function exportSerials(excel = false) {
    const rows: Serial[] = [];
    for (let at = 0; at < 20000; at += 200) {
      const r = await demoGet<BatchDetail>(`${demoPath("qr", id)}?offset=${at}&limit=200`);
      if (!r.ok) {
        report(r, "");
        return;
      }
      rows.push(...r.value.serials);
      if (r.value.serials.length < 200) break;
    }
    const origin = window.location.origin;
    const header = ["Serial", "State", "Allocated", "Bound", "Voided", "Void reason", "Public check link"];
    const body = rows.map((x) => [x.serial, x.state, istStamp(x.allocatedAt), istStamp(x.boundAt), istStamp(x.voidedAt), x.voidReason, `${origin}${verifyHref(x.serial)}`]);
    const stem = `qr-serials-${detail?.registrationId.replace(/\//g, "-") ?? id}`;
    if (excel) saveBytes(datedFileName(stem, "xlsx"), buildXlsx("QR serials", header, body), XLSX_TYPE);
    else saveCsv(csvFileName(stem), toCsv(header, body));
  }

  async function copy(serial: string) {
    try {
      await navigator.clipboard.writeText(serial);
      setCopied(serial);
    } catch {
      setCopied(null);
    }
  }

  if (!detail) return <p role="status">Loading batch…</p>;
  const bindable = detail.serials.filter((s) => s.state === "allocated").map((s) => s.serial);
  const typed = bindText.split(/[\s,]+/).filter(Boolean);

  return (
    <section className="rounded-xl bg-surface-card shadow-md p-space-md space-y-space-md" aria-labelledby="qr-batch-h" data-testid="qr-detail">
      <h2 id="qr-batch-h" className="font-title-md text-title-md">Batch: {detail.brandName} {detail.modelNumber}</h2>
      <p className="font-body-sm" data-testid="qr-counts">
        Quantity {detail.quantity}: {detail.allocated} allocated, {detail.bound} bound, {detail.void} void, {detail.remaining} still to allocate. Certificate {detail.registrationId}.
      </p>
      {canWrite ? (
        <div className="grid gap-space-md md:grid-cols-3">
          <form className="flex flex-col gap-space-xs" onSubmit={(e) => { e.preventDefault(); void act(demoPath("qr", id, "serials"), count.trim() ? { count: Number(count) } : {}, (v) => `${v.newSerialCount} serials allocated.`); setCount(""); }} aria-label="Allocate serials">
            <label className="font-label-md" htmlFor="qr-count">Serials to allocate (blank = all remaining)</label>
            <input id="qr-count" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} className="px-3 py-2 rounded-lg bg-surface-container-low" data-testid="qr-count" />
            <button type="submit" className="bg-primary text-on-primary px-space-md py-2 rounded-lg" data-testid="qr-allocate">Allocate</button>
          </form>
          <form className="flex flex-col gap-space-xs" onSubmit={(e) => { e.preventDefault(); const list = typed.length ? typed : bindable; void act(demoPath("qr", id, "bind"), { serials: list }, (v) => {
            const dup = Array.isArray(v.alreadyBoundSerials) ? (v.alreadyBoundSerials as string[]) : [];
            const msg = `${v.newlyBound} newly bound, ${v.alreadyBound} already bound.${dup.length ? ` Already bound earlier, nothing changed: ${dup.join(", ")}${Number(v.alreadyBound) > dup.length ? " and more" : ""}.` : ""}`;
            setBindMsg({ text: msg, warn: dup.length > 0 });
            return msg;
          }); setBindText(""); }} aria-label="Bind serials">
            <label className="font-label-md" htmlFor="qr-bind">Serials to bind (blank = allocated serials on this page)</label>
            <textarea id="qr-bind" rows={2} value={bindText} onChange={(e) => setBindText(e.target.value)} className="px-3 py-2 rounded-lg bg-surface-container-low font-mono" data-testid="qr-bind-text" />
            <button type="submit" className="bg-primary text-on-primary px-space-md py-2 rounded-lg" data-testid="qr-bind">Bind to certificate</button>
            {bindMsg ? <p role="status" className={`font-body-sm ${bindMsg.warn ? "text-error font-semibold" : "text-on-surface"}`} data-testid="qr-bind-result">{bindMsg.text}</p> : null}
          </form>
          <form className="flex flex-col gap-space-xs" onSubmit={(e) => { e.preventDefault(); void act(demoPath("qr", id, "void"), { serial: voidSerial, reason: voidReason }, () => "Serial voided."); setVoidReason(""); }} aria-label="Void a serial">
            <label className="font-label-md" htmlFor="qr-void-serial">Serial to void</label>
            <input id="qr-void-serial" value={voidSerial} onChange={(e) => setVoidSerial(e.target.value)} className="px-3 py-2 rounded-lg bg-surface-container-low font-mono" data-testid="qr-void-serial" />
            <label className="font-label-md" htmlFor="qr-void-reason">Reason</label>
            <input id="qr-void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={200} className="px-3 py-2 rounded-lg bg-surface-container-low" data-testid="qr-void-reason" />
            <button type="submit" className="bg-error text-on-error px-space-md py-2 rounded-lg" disabled={!SERIAL.test(voidSerial.trim().toUpperCase()) || !voidReason.trim()} data-testid="qr-void">Void</button>
          </form>
        </div>
      ) : (
        <p className="font-body-sm text-on-surface-variant">Read only for your role.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-body-sm" data-testid="qr-serials">
          <thead><tr><th scope="col">Serial</th><th scope="col">State</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {detail.serials.map((s) => (
              <tr key={s.serial} data-testid="qr-serial-row">
                <td className="font-mono">{s.serial}</td>
                <td><Pill>{s.state}</Pill></td>
                <td>{s.voidReason ?? ""}</td>
                <td className="space-x-space-sm">
                  <button type="button" onClick={() => void copy(s.serial)} className="text-primary underline" aria-label={`Copy ${s.serial}`}>{copied === s.serial ? "Copied" : "Copy"}</button>
                  <Link href={verifyHref(s.serial)} className="text-primary underline" target="_blank">Verify this serial</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-space-sm font-body-sm">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="underline disabled:opacity-40">Previous</button>
        <span data-testid="qr-page">{detail.total === 0 ? "No serials yet" : `${offset + 1} to ${Math.min(offset + PAGE, detail.total)} of ${detail.total}`}</span>
        <button type="button" disabled={offset + PAGE >= detail.total} onClick={() => setOffset(offset + PAGE)} className="underline disabled:opacity-40">Next</button>
        <button type="button" disabled={detail.total === 0} onClick={() => void exportSerials()} className="ml-auto text-primary underline disabled:opacity-40" data-testid="qr-export-serials">Download all serials (CSV)</button>
        <button type="button" disabled={detail.total === 0} onClick={() => void exportSerials(true)} className="text-primary underline disabled:opacity-40" data-testid="qr-export-serials-xlsx">Download all serials (Excel)</button>
      </div>
      <p className="font-label-sm text-on-surface-variant">A serial answers on the public check only once it is bound; a void or unbound serial is shown as not found.</p>
    </section>
  );
}
