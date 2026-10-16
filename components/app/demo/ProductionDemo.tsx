"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill } from "./DemoShell";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";

type Submission = {
  id: string;
  organisationName?: string;
  quarter: string;
  state: string;
  rowCount?: number;
  totalUnits?: number;
  evidenceCount?: number;
  reviewNote?: string | null;
  createdAt?: string;
  submittedAt?: string | null;
};
type RowResult = { line: number; ok: boolean; message: string; registrationId?: string };
type Validation = { mode: string; committed: boolean; stored: number; rowCount: number; errorCount: number; message: string; results: RowResult[] };
type Detail = Submission & {
  rows: { id: string; registrationId: string; modelNumber: string; units: number; periodStart: string; periodEnd: string }[];
  evidence: { id: string; fileName: string; sizeBytes: number; sha256: string; caName: string; caMembershipNo: string; statement: string; label: string }[];
  events: { action: string; actor: string; actorRole: string; note?: string | null; occurredAt: string; toState?: string | null }[];
  evidenceLabel: string;
};
type Reconciliation = {
  qrAvailable: boolean;
  marginPercent: number;
  declaredTotal: number;
  boundTotal: number | null;
  message: string;
  models: { modelApplicationId: string; modelNumber: string; registrationId: string; declaredUnits: number; boundSerials: number | null; flag: string }[];
};

const CSV_SAMPLE = "registration_id,units,period_start,period_end\nBEE/RAC/2026/10101,4200,2026-10-01,2026-10-31\nBEE/RAC/2026/10102,2600,2026-10-01,2026-10-31\n";
const STATE_WORD: Record<string, string> = { draft: "Draft", submitted: "Submitted", accepted: "Accepted", query: "Query raised" };
const inputCls = "w-full rounded border border-outline-variant bg-surface px-space-sm py-space-xs font-body-md text-on-surface";
const btnCls = "rounded bg-primary px-space-md py-space-xs font-label-md text-on-primary disabled:opacity-50";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-outline-variant p-space-md space-y-space-sm">
      <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
      {children}
    </section>
  );
}

function toBase64(buffer: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function SubmissionsTable({ list, onOpen }: { list: Submission[]; onOpen: (id: string) => void }) {
  const tools = useListTools({
    rows: list,
    text: (x) => `${x.quarter} ${x.organisationName ?? ""} ${STATE_WORD[x.state] ?? x.state}`,
    date: (x) => (x.submittedAt ?? x.createdAt)?.slice(0, 10),
    sortValue: (x, k) => (k === "quarter" ? x.quarter : k === "org" ? x.organisationName ?? "" : k === "state" ? STATE_WORD[x.state] ?? x.state : k === "rows" ? x.rowCount ?? 0 : k === "units" ? x.totalUnits ?? 0 : k === "evidence" ? x.evidenceCount ?? 0 : (x.submittedAt ?? x.createdAt ?? "")),
  });
  if (list.length === 0) return <p className="font-body-md">No submissions yet.</p>;
  return (
    <div className="space-y-space-sm">
      <ListToolbar tools={tools} searchLabel="Search by quarter or organisation" placeholder="Quarter, organisation or state" dateLabel="Submitted"
        exportCsv={{ filename: "production-submissions", header: ["Quarter", "Organisation", "State", "Rows", "Units", "Evidence files", "Submitted"],
          rows: tools.visible.map((x) => [x.quarter, x.organisationName, STATE_WORD[x.state] ?? x.state, x.rowCount, x.totalUnits, x.evidenceCount, (x.submittedAt ?? x.createdAt)?.slice(0, 19).replace("T", " ")]) }} />
      {tools.visible.length === 0 ? <p className="font-body-md text-on-surface-variant">No submissions match.</p> : (
        <>
          <table className="w-full text-left font-body-md">
            <caption className="sr-only">Production submissions by quarter</caption>
            <thead>
              <tr>
                <SortableTh tools={tools} k="quarter">Quarter</SortableTh><SortableTh tools={tools} k="org">Organisation</SortableTh><SortableTh tools={tools} k="state">State</SortableTh>
                <SortableTh tools={tools} k="rows">Rows</SortableTh><SortableTh tools={tools} k="units">Units</SortableTh><SortableTh tools={tools} k="evidence">Evidence</SortableTh>
                <SortableTh tools={tools} k="date">Submitted</SortableTh><th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {tools.paged.pageRows.map((x) => (
                <tr key={x.id}>
                  <td>{x.quarter}</td>
                  <td>{x.organisationName}</td>
                  <td><Pill>{STATE_WORD[x.state] ?? x.state}</Pill></td>
                  <td>{x.rowCount}</td>
                  <td>{x.totalUnits}</td>
                  <td>{x.evidenceCount}</td>
                  <td>{(x.submittedAt ?? x.createdAt)?.slice(0, 10) ?? ""}</td>
                  <td>
                    <button type="button" className="underline" onClick={() => onOpen(x.id)} aria-label={`Open ${x.quarter}`}>
                      Open
                    </button>
                  </td>
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

/** Quarterly production submission: bulk validation, CA evidence, review and reconciliation. Local demonstration, provisional rules. */
export function ProductionDemo() {
  const [list, setList] = useState<Submission[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [quarter, setQuarter] = useState("2026-Q4");
  const [csv, setCsv] = useState(CSV_SAMPLE);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [ev, setEv] = useState({ caName: "", caMembershipNo: "", statement: "" });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const r = await demoGet<DemoBody & { submissions: Submission[]; canCreate: boolean; canReview: boolean }>(demoPath("production"));
    if (!r.ok) return setError(r.message);
    setList(r.value.submissions);
    setCanCreate(r.value.canCreate);
    setCanReview(r.value.canReview);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const [d, rc] = await Promise.all([demoGet<Detail & DemoBody>(demoPath("production", id)), demoGet<Reconciliation & DemoBody>(demoPath("production", id, "reconciliation"))]);
    if (!d.ok) return setError(d.message);
    setDetail(d.value);
    setRecon(rc.ok ? rc.value : null);
  }, []);

  useEffect(() => {
    let live = true;
    void demoGet<DemoBody & { submissions: Submission[]; canCreate: boolean; canReview: boolean }>(demoPath("production")).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.message);
      setList(r.value.submissions);
      setCanCreate(r.value.canCreate);
      setCanReview(r.value.canReview);
    });
    return () => {
      live = false;
    };
  }, []);
  const open = (id: string) => {
    setSelected(id);
    setValidation(null);
    setDetail(null);
    setRecon(null);
    void loadDetail(id);
  };

  async function run<T extends DemoBody>(path: string, payload: object, done: (v: T) => void) {
    setBusy(true);
    setError(null);
    setStatus(null);
    const r = await demoPost<T>(path, payload);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    done(r.value);
    await loadList();
    if (selected) await loadDetail(selected);
  }

  const editable = !!detail && canCreate && (detail.state === "draft" || detail.state === "query");

  async function createSubmission() {
    await run<DemoBody & { id: string }>(demoPath("production"), { quarter }, (v) => {
      setStatus(`Submission for ${quarter} created.`);
      open(v.id);
    });
  }

  async function validate(commit: boolean) {
    if (!selected) return;
    await run<DemoBody & Validation>(demoPath("production", selected, "rows"), { csv, commit }, (v) => {
      setValidation(v);
      setStatus(v.message);
    });
  }

  async function addEvidence() {
    if (!selected || !file) return setError("Choose a file (up to 1 MiB).");
    if (file.size > 1024 * 1024) return setError("The file is larger than 1 MiB.");
    const contentBase64 = toBase64(await file.arrayBuffer());
    await run(demoPath("production", selected, "evidence"), { fileName: file.name, mediaType: file.type || "application/octet-stream", contentBase64, ...ev }, () =>
      setStatus("Evidence recorded (not verified)."),
    );
  }

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-production">
      <h1 className="font-headline-md text-headline-md text-on-surface">Quarterly production</h1>
      {error && (
        <p role="alert" className="rounded bg-error-container p-space-sm text-on-error-container">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="rounded bg-surface-container p-space-sm text-on-surface">
          {status}
        </p>
      )}

      <Section title="Submissions">
        <SubmissionsTable list={list} onOpen={open} />
        {canCreate && (
          <div className="flex flex-wrap items-end gap-space-sm">
            <label className="block">
              <span className="font-label-md">New submission, quarter (for example 2026-Q4)</span>
              <input className={inputCls} value={quarter} onChange={(e) => setQuarter(e.target.value)} />
            </label>
            <button type="button" className={btnCls} disabled={busy} onClick={createSubmission}>
              Create submission
            </button>
          </div>
        )}
      </Section>

      {detail && (
        <>
          <Section title={`${detail.quarter}: ${STATE_WORD[detail.state] ?? detail.state}`}>
            {detail.reviewNote && <p>Reviewer note: {detail.reviewNote}</p>}
            <table className="w-full text-left font-body-md">
              <caption className="sr-only">Stored rows</caption>
              <thead>
                <tr>
                  <th scope="col">Registration ID</th>
                  <th scope="col">Model</th>
                  <th scope="col">Units</th>
                  <th scope="col">Period</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.registrationId}</td>
                    <td>{r.modelNumber}</td>
                    <td>{r.units}</td>
                    <td>
                      {r.periodStart} to {r.periodEnd}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {editable && (
            <Section title="Bulk rows (CSV)">
              <label className="block">
                <span className="font-label-md">CSV: registration_id,units,period_start,period_end</span>
                <textarea className={inputCls} rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} />
              </label>
              <label className="block">
                <span className="font-label-md">Or load a CSV file</span>
                <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
              </label>
              <div className="flex gap-space-sm">
                <button type="button" className={btnCls} disabled={busy} onClick={() => validate(false)}>
                  Validate (dry run)
                </button>
                <button type="button" className={btnCls} disabled={busy} onClick={() => validate(true)}>
                  Store rows (all or nothing)
                </button>
              </div>
              {validation && (
                <table className="w-full text-left font-body-md" data-testid="prod-results">
                  <caption className="text-left font-label-md">
                    {validation.rowCount} row(s), {validation.errorCount} error(s). {validation.message}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      <th scope="col">Result</th>
                      <th scope="col">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.results.map((r) => (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        <td>{r.ok ? "OK" : "Error"}</td>
                        <td>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}

          <Section title="CA evidence">
            <p className="font-body-md text-on-surface-variant">{detail.evidenceLabel}</p>
            <ul className="font-body-md">
              {detail.evidence.map((e) => (
                <li key={e.id}>
                  {e.fileName} ({e.sizeBytes} bytes), CA {e.caName} ({e.caMembershipNo}); sha256 <code className="break-all">{e.sha256}</code>
                </li>
              ))}
              {detail.evidence.length === 0 && <li>No evidence yet.</li>}
            </ul>
            {editable && (
              <div className="grid gap-space-sm md:grid-cols-2">
                <label className="block">
                  <span className="font-label-md">CA name</span>
                  <input className={inputCls} value={ev.caName} onChange={(e) => setEv({ ...ev, caName: e.target.value })} />
                </label>
                <label className="block">
                  <span className="font-label-md">CA membership number</span>
                  <input className={inputCls} value={ev.caMembershipNo} onChange={(e) => setEv({ ...ev, caMembershipNo: e.target.value })} />
                </label>
                <label className="block md:col-span-2">
                  <span className="font-label-md">CA statement</span>
                  <textarea className={inputCls} rows={3} value={ev.statement} onChange={(e) => setEv({ ...ev, statement: e.target.value })} />
                </label>
                <label className="block">
                  <span className="font-label-md">Evidence file (up to 1 MiB)</span>
                  <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <div>
                  <button type="button" className={btnCls} disabled={busy} onClick={addEvidence}>
                    Attach evidence
                  </button>
                </div>
              </div>
            )}
          </Section>

          {editable && (
            <Section title="Submit">
              <p className="font-body-md">Needs at least one stored row and the CA evidence. After this you cannot edit until a reviewer raises a query.</p>
              <button type="button" className={btnCls} disabled={busy} onClick={() => run(demoPath("production", detail.id, "submit"), {}, () => setStatus("Submitted for review."))}>
                Submit for review
              </button>
            </Section>
          )}

          {canReview && detail.state === "submitted" && (
            <Section title="Reviewer">
              <label className="block">
                <span className="font-label-md">Note (required for a query)</span>
                <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="flex gap-space-sm">
                <button type="button" className={btnCls} disabled={busy} onClick={() => run(demoPath("production", detail.id, "review"), { decision: "accepted", note }, () => setStatus("Accepted."))}>
                  Accept
                </button>
                <button type="button" className={btnCls} disabled={busy} onClick={() => run(demoPath("production", detail.id, "review"), { decision: "query", note }, () => setStatus("Query raised."))}>
                  Raise a query
                </button>
              </div>
            </Section>
          )}

          <Section title="Reconciliation against QR serials">
            {recon ? (
              <>
                <p className="font-body-md">{recon.message}</p>
                <table className="w-full text-left font-body-md" data-testid="prod-recon">
                  <caption className="text-left font-label-md">
                    Declared total {recon.declaredTotal}; bound serials {recon.boundTotal ?? "not available"}; margin {recon.marginPercent} percent
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Declared units</th>
                      <th scope="col">Bound serials</th>
                      <th scope="col">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.models.map((m) => (
                      <tr key={m.modelApplicationId}>
                        <td>{m.modelNumber}</td>
                        <td>{m.declaredUnits}</td>
                        <td>{m.boundSerials ?? "QR data not available"}</td>
                        <td>{m.flag === "review" ? "Review (a prompt, not a decision)" : m.flag === "ok" ? "Within margin" : "Not available"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p>Reconciliation not available.</p>
            )}
          </Section>

          <Section title="History">
            <ol className="font-body-md list-decimal pl-space-lg">
              {detail.events.map((e, i) => (
                <li key={i}>
                  {e.occurredAt.slice(0, 16).replace("T", " ")}: {e.action.replace(/_/g, " ")} by {e.actor} ({e.actorRole}){e.note ? `, ${e.note}` : ""}
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
    </div>
  );
}
