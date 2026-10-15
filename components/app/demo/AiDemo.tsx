"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { demoGet, demoPath, demoPost } from "@/lib/client/runtimeDemo";

/**
 * Demo slice S6: five advisory AI use cases with evidence, a model card, a data version and a persisted human disposition.
 * Local demonstration on synthetic or seeded data. Spring decides who may run or record; this screen shows what comes back.
 */

export const USE_CASES = [
  { id: "compliance-risk", label: "Compliance risk" },
  { id: "production-anomaly", label: "Production anomaly" },
  { id: "rating-trends", label: "Rating trends" },
  { id: "helpdesk-assist", label: "Helpdesk assist" },
  { id: "document-extraction", label: "Document extraction" },
] as const;
type UseCaseId = (typeof USE_CASES)[number]["id"];

export interface ModelCard {
  id: string;
  useCase: UseCaseId;
  name: string;
  version: string;
  kind: string;
  description: string;
  limitations: string;
  trainedOn: string;
  canRead: boolean;
  canRun: boolean;
}
export interface RunSummary {
  id: string;
  useCase: UseCaseId;
  modelVersion: string;
  dataVersion: string;
  inputRef: string | null;
  confidence: number;
  createdAt: string;
  createdBy: string;
  dispositionCount: number;
  latestDecision: string | null;
}
interface Evidence { source: string; field: string; value: unknown; rows?: string }
interface Disposition { id: string; actor: string; role: string; decision: string; reason: string | null; overrideValue: string | null; fieldDecisions: Record<string, string> | null; at: string }
interface AuditRow { action: string; actor: string; role: string; detail: string; at: string }
interface RunDetail extends RunSummary { output: Record<string, unknown> & { evidence: Evidence[]; summary?: string; note?: string }; dispositions: Disposition[]; audit: AuditRow[] }

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const pct = (c: number) => `${Math.round(c * 100)}%`;
const cell = "px-space-sm py-1 text-left align-top";

function Box({ title, children, testId, icon, aside }: { title: string; children: React.ReactNode; testId?: string; icon?: string; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface p-space-md" data-testid={testId}>
      <div className="flex items-center justify-between gap-space-sm mb-space-sm">
        <h3 className="font-title-sm text-title-sm text-on-surface flex items-center gap-2">
          {icon ? <Icon name={icon} size={18} className="text-[#254e9e]" /> : null}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const CASE_META: Record<UseCaseId, { icon: string; blurb: string }> = {
  "compliance-risk": { icon: "shield_person", blurb: "Which manufacturers to look at first" },
  "production-anomaly": { icon: "monitoring", blurb: "Unusual production against the QR record" },
  "rating-trends": { icon: "star_half", blurb: "Star-rating drift and a forecast band" },
  "helpdesk-assist": { icon: "support_agent", blurb: "Draft answers from the knowledge base" },
  "document-extraction": { icon: "document_scanner", blurb: "Read test reports, compare to declared" },
};

const BAND: Record<string, { bar: string; pill: string }> = {
  high: { bar: "bg-[#ba1a1a]", pill: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]" },
  medium: { bar: "bg-[#f59e0b]", pill: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" },
  low: { bar: "bg-[#1c7c4a]", pill: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]" },
};

function Chip({ children, tone = "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold leading-4 ${tone}`}>{children}</span>;
}

/** Confidence as a labelled meter: the number is what the model reports, the colour only helps reading it. */
function Meter({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const tone = v >= 0.75 ? "bg-[#1c7c4a]" : v >= 0.45 ? "bg-[#f59e0b]" : "bg-[#ba1a1a]";
  return (
    <div className="min-w-[120px]">
      <div className="h-2 rounded-full bg-[#e7edf6] overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.round(v * 100)}%` }} /></div>
      {label ? <div className="mt-1 text-[11px] text-[#64748b]">{label}</div> : null}
    </div>
  );
}

/** A tiny bar chart: one bar per value; flagged positions are red. Accessible text is given by the caller's label. */
function MiniBars({ values, labels, flagged = [], height = 56 }: { values: number[]; labels: string[]; flagged?: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-2" style={{ height: height + 22 }}>
      {values.map((v, i) => (
        <div key={i} className="flex flex-col items-center justify-end gap-1" style={{ height: height + 22 }}>
          <span className="text-[10px] text-[#64748b]">{v}</span>
          <div className={`w-7 rounded-t ${flagged.includes(i) ? "bg-[#ba1a1a]" : "bg-[#254e9e]"}`} style={{ height: Math.max(3, (v / max) * height) }} title={`${labels[i]}: ${v}`} />
          <span className="text-[10px] text-[#64748b]">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Line of monthly means with an optional forecast point and 95 percent band. */
function TrendLine({ points, forecast }: { points: { label: string; v: number }[]; forecast: { v: number; low: number; high: number } | null }) {
  const W = 420, H = 110, pad = 18;
  const vals = points.map((p) => p.v).concat(forecast ? [forecast.low, forecast.high] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const n = points.length + (forecast ? 1 : 0);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, n - 1);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const fi = points.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[460px]" role="img" aria-label="Monthly mean rating with forecast">
      {forecast ? <rect x={x(fi) - 8} y={y(forecast.high)} width={16} height={Math.max(2, y(forecast.low) - y(forecast.high))} rx={4} fill="#c9d9f7" /> : null}
      <path d={path} fill="none" stroke="#254e9e" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={3} fill="#254e9e"><title>{`${p.label}: ${p.v}`}</title></circle>)}
      {forecast ? (
        <>
          <line x1={x(fi - 1)} y1={y(points[points.length - 1].v)} x2={x(fi)} y2={y(forecast.v)} stroke="#4ec4ef" strokeWidth={2} strokeDasharray="4 3" />
          <circle cx={x(fi)} cy={y(forecast.v)} r={4} fill="#4ec4ef"><title>{`Forecast: ${forecast.v}`}</title></circle>
        </>
      ) : null}
      <text x={pad} y={H - 3} fontSize={9} fill="#64748b">{points[0]?.label}</text>
      <text x={W - pad} y={H - 3} fontSize={9} fill="#64748b" textAnchor="end">{forecast ? "forecast" : points[points.length - 1]?.label}</text>
    </svg>
  );
}

export function AiDemo() {
  const [models, setModels] = useState<ModelCard[] | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [tab, setTab] = useState<UseCaseId>("compliance-risk");

  useEffect(() => {
    let live = true;
    demoGet<{ models: ModelCard[] }>(demoPath("ai", "models")).then((r) => {
      if (!live) return;
      if (r.ok) setModels(r.value.models);
      else setDenied(r.message);
    });
    return () => {
      live = false;
    };
  }, []);

  const model = models?.find((m) => m.useCase === tab) ?? null;

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-ai">
      <h1>AI use cases</h1>
      <p className="ai-lead">Five transparent models read the live portal data. Each run keeps its evidence, model version and data version, and a person records the decision.</p>
      {denied ? <p role="alert" className="text-error" data-testid="ai-error">{denied}</p> : null}
      {models === null && !denied ? <p role="status">Loading models…</p> : null}
      {models ? (
        <>
          <div role="tablist" aria-label="AI use cases" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {USE_CASES.map((u) => (
              <button
                key={u.id}
                role="tab"
                id={`ai-tab-${u.id}`}
                aria-selected={tab === u.id}
                aria-controls="ai-panel"
                onClick={() => setTab(u.id)}
                className="ai-tile"
                data-testid={`ai-tab-${u.id}`}
              >
                <Icon name={CASE_META[u.id].icon} size={22} />
                <span className="ai-tile-title">{u.label}</span>
                <span className="ai-tile-blurb">{CASE_META[u.id].blurb}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" id="ai-panel" aria-labelledby={`ai-tab-${tab}`}>
            {model ? <UseCasePanel key={tab} model={model} /> : <p role="alert">You may not use this area.</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ModelCardBox({ model }: { model: ModelCard }) {
  const rules = model.kind === "rules" || model.kind === "statistical" || model.kind === "retrieval" || model.kind === "extraction";
  return (
    <Box title="Model card" icon="neurology" testId="ai-model-card" aside={<div className="flex flex-wrap gap-2"><Chip>{model.kind}{rules ? " · not machine learning" : ""}</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">{model.id}@{model.version}</Chip></div>}>
      <p className="text-[14px] leading-6 text-[#181c20]"><span className="sr-only">Model {model.name} ({model.id}@{model.version}). Kind {model.kind}{rules ? " (rules or statistics, not machine learning)" : ""}. </span><strong className="text-[#14315E]">{model.name}.</strong> {model.description}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#f3dc9c] bg-[#fffaf0] p-3"><div className="text-[11px] font-bold uppercase tracking-wider text-[#8a4b00] mb-1">Limitations</div><div className="text-[13px] leading-5">{model.limitations}</div></div>
        <div className="rounded-lg border border-[#c9d9f7] bg-[#f4f8ff] p-3"><div className="text-[11px] font-bold uppercase tracking-wider text-[#14315E] mb-1">Trained on</div><div className="text-[13px] leading-5">{model.trainedOn}</div></div>
      </div>
    </Box>
  );
}

function UseCasePanel({ model }: { model: ModelCard }) {
  const uc = model.useCase;
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("How do I pay the application fee?");
  const [appRef, setAppRef] = useState("LOCAL-MA-0004");
  const [category, setCategory] = useState("");

  const loadRuns = useCallback(async () => {
    const r = await demoGet<{ runs: RunSummary[] }>(demoPath("ai", uc, "runs"));
    if (r.ok) setRuns(r.value.runs);
    else setError(r.message);
  }, [uc]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);

  async function open(id: string) {
    setError(null);
    const r = await demoGet<RunDetail>(demoPath("ai", id));
    if (r.ok) setSelected(r.value);
    else setError(r.message);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const body = uc === "helpdesk-assist" ? { question } : uc === "document-extraction" ? { applicationRef: appRef } : uc === "rating-trends" ? { category } : {};
    const r = await demoPost<RunDetail>(demoPath("ai", uc, "runs"), body);
    setBusy(false);
    if (r.ok) {
      setSelected(r.value);
      void loadRuns();
    } else setError(r.message);
  }

  return (
    <div className="space-y-space-md mt-space-md" data-testid={`ai-panel-${uc}`}>
      <ModelCardBox model={model} />
      <Box title="Run" icon="play_circle" aside={!model.canRun ? <Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">Read only for your role</Chip> : undefined}>
        <div className="flex flex-wrap items-end gap-space-sm">
          {uc === "helpdesk-assist" ? (
            <label className="flex-1 min-w-64 font-label-md">Question
              <textarea className="mt-1 w-full rounded-lg border border-outline-variant p-space-xs" rows={2} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} data-testid="ai-input" />
            </label>
          ) : null}
          {uc === "document-extraction" ? (
            <label className="font-label-md">Application reference
              <input className="mt-1 block rounded-lg border border-outline-variant p-space-xs" value={appRef} onChange={(e) => setAppRef(e.target.value)} data-testid="ai-input" />
            </label>
          ) : null}
          {uc === "rating-trends" ? (
            <label className="font-label-md">Category (blank for all)
              <input className="mt-1 block rounded-lg border border-outline-variant p-space-xs" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="ai-input" />
            </label>
          ) : null}
          <button className="ai-run bg-primary text-on-primary" disabled={!model.canRun || busy} onClick={run} data-testid="ai-run">
            <Icon name={busy ? "hourglass_top" : "play_arrow"} size={18} /> {busy ? "Running…" : "Run"}
          </button>
          {!model.canRun ? <span className="font-body-sm text-on-surface-variant">Your role can read this area but not run it.</span> : null}
        </div>
        {error ? <p role="alert" className="mt-space-sm text-error" data-testid="ai-error">{error}</p> : null}
      </Box>
      <Box title="History (stored, survives reload)" icon="history" testId="ai-history">
        {runs === null ? <p role="status">Loading…</p> : runs.length === 0 ? <p className="font-body-sm">No runs yet.</p> : (
          <ul className="space-y-1.5">
            {runs.map((r) => (
              <li key={r.id}>
                <button className={`ai-history-row ${selected?.id === r.id ? "is-selected" : ""}`} onClick={() => open(r.id)} data-testid="ai-history-item">
                  <span className="font-semibold text-[#14315E]">{when(r.createdAt)}</span>
                  <span className="text-[#475569]">{r.createdBy}</span>
                  <span className="text-[#475569]">confidence {pct(r.confidence)}</span>
                  <span className="text-[#64748b]">data {r.dataVersion}{r.inputRef ? ` · ${r.inputRef}` : ""}</span>
                  <span className="ml-auto">{r.dispositionCount === 0 ? <Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">no disposition yet</Chip> : <Chip tone={r.latestDecision === "reject" ? "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]" : r.latestDecision === "override" ? "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" : "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]"}>latest: {r.latestDecision}</Chip>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Box>
      {selected ? <RunView key={selected.id} run={selected} canRun={model.canRun} onChanged={() => { void open(selected.id); void loadRuns(); }} /> : null}
    </div>
  );
}

function RunView({ run, canRun, onChanged }: { run: RunDetail; canRun: boolean; onChanged: () => void }) {
  const out = run.output;
  return (
    <div className="space-y-space-md" data-testid="ai-run-view">
      <Box title="Result" icon="insights" testId="ai-result" aside={<Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">run {when(run.createdAt)} by {run.createdBy}</Chip>}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-[#f4f8ff] border border-[#dbe6f7] p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Confidence</div>
            <div className="text-[34px] leading-9 font-extrabold text-[#14315E]" data-testid="ai-confidence">{pct(run.confidence)}</div>
          </div>
          <div className="w-40"><Meter value={run.confidence} /></div>
          <div className="text-[12px] text-[#475569] leading-5">model {run.modelVersion}<br />data version <code data-testid="ai-data-version">{run.dataVersion}</code></div>
        </div>
        <p role="status" className="ai-summary mt-3" data-testid="ai-summary">{String(out.summary ?? "")}</p>
        <Output run={run} />
        {out.note ? <p className="mt-space-sm font-body-sm text-on-surface-variant">{String(out.note)}</p> : null}
      </Box>
      <Box title="Evidence" icon="fact_check" testId="ai-evidence">
        <table className="w-full font-body-sm">
          <thead><tr><th className={cell}>Source</th><th className={cell}>Field</th><th className={cell}>Value</th></tr></thead>
          <tbody>
            {out.evidence.map((e, i) => (
              <tr key={i} className="border-t border-outline-variant">
                <td className={cell}><code>{e.source}</code></td><td className={cell}>{e.field}</td>
                <td className={cell}>{typeof e.value === "object" ? JSON.stringify(e.value) : String(e.value)}{e.rows ? ` (${e.rows})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      <DispositionPanel run={run} canRun={canRun} onChanged={onChanged} />
      <Box title="Audit" icon="receipt_long" testId="ai-audit">
        <ol className="ai-timeline font-body-sm">
          {run.audit.map((a, i) => <li key={i}><span className="font-semibold text-[#14315E]">{when(a.at)}</span> · {a.actor} ({a.role}) · {a.detail}</li>)}
        </ol>
      </Box>
    </div>
  );
}

function DispositionPanel({ run, canRun, onChanged }: { run: RunDetail; canRun: boolean; onChanged: () => void }) {
  const out = run.output as Record<string, unknown>;
  const fields = (run.useCase === "document-extraction" ? (out.fields as { field: string; extracted: string | null; declared: string | null; status: string }[]) : []) ?? [];
  const [decision, setDecision] = useState<"accept" | "override" | "reject">("accept");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState(run.useCase === "helpdesk-assist" ? String(out.draftReply ?? "") : "");
  const [fieldDecisions, setFieldDecisions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setDone(null);
    const body: Record<string, unknown> = { decision, reason };
    if (decision === "override") body.overrideValue = value;
    if (fields.length > 0) body.fieldDecisions = fieldDecisions;
    const r = await demoPost(demoPath("ai", run.id, "disposition"), body);
    if (r.ok) {
      setDone("Your disposition is recorded beside the model's output. The output itself is not changed.");
      setReason("");
      onChanged();
    } else setError(r.message);
  }

  return (
    <Box title="Human disposition (advisory: a person decides)" icon="how_to_reg" testId="ai-disposition">
      {run.dispositions.length > 0 ? (
        <ul className="mb-space-sm space-y-1 font-body-sm" data-testid="ai-dispositions">
          {run.dispositions.map((d) => (
            <li key={d.id} className="rounded-lg border border-[#e2e8f0] bg-[#f8faff] px-3 py-2">
              {when(d.at)} · <strong>{d.actor}</strong> ({d.role}): <Chip tone={d.decision === "reject" ? "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]" : d.decision === "override" ? "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" : "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]"}>{d.decision}</Chip>
              {d.reason ? ` · reason: ${d.reason}` : ""}
              {d.overrideValue ? ` · human value: "${d.overrideValue}"` : ""}
              {d.fieldDecisions ? ` · fields: ${Object.entries(d.fieldDecisions).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      ) : <p className="mb-space-sm font-body-sm">No disposition recorded yet.</p>}
      {canRun ? (
        <div className="space-y-space-sm">
          {fields.length > 0 ? (
            <fieldset className="font-body-sm">
              <legend className="font-label-md">Confirm each field</legend>
              {fields.map((f) => (
                <label key={f.field} className="flex items-center gap-space-sm py-1">
                  <span className="w-28">{f.field}</span>
                  <select className="rounded border border-outline-variant p-1" value={fieldDecisions[f.field] ?? ""} onChange={(e) => setFieldDecisions({ ...fieldDecisions, [f.field]: e.target.value })} aria-label={`Decision for ${f.field}`}>
                    <option value="">(not decided)</option>
                    <option value="confirmed-extracted">use extracted: {f.extracted ?? "none"}</option>
                    <option value="confirmed-declared">keep declared: {f.declared ?? "none"}</option>
                  </select>
                </label>
              ))}
            </fieldset>
          ) : null}
          <fieldset className="font-body-sm">
            <legend className="font-label-md mb-1">Decision</legend>
            <div className="ai-segment">
              {(["accept", "override", "reject"] as const).map((d) => (
                <label key={d} className={decision === d ? "is-on" : ""} data-decision={d}>
                  <input type="radio" className="sr-only" name={`decision-${run.id}`} checked={decision === d} onChange={() => setDecision(d)} data-testid={`ai-decision-${d}`} />
                  <Icon name={d === "accept" ? "check_circle" : d === "override" ? "edit" : "cancel"} size={18} /> {d}
                </label>
              ))}
            </div>
          </fieldset>
          {decision === "override" ? (
            <label className="block font-label-md">{run.useCase === "helpdesk-assist" ? "Your reply" : "Your value"}
              <textarea className="mt-1 w-full rounded-lg border border-outline-variant p-space-xs" rows={3} value={value} onChange={(e) => setValue(e.target.value)} data-testid="ai-override-value" />
            </label>
          ) : null}
          <label className="block font-label-md">Reason {decision === "accept" ? "(optional)" : "(required)"}
            <textarea className="mt-1 w-full rounded-lg border border-outline-variant p-space-xs" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ai-reason" />
          </label>
          <button className="ai-run bg-primary text-on-primary" onClick={submit} data-testid="ai-submit-disposition"><Icon name="task_alt" size={18} /> Record disposition</button>
          {error ? <p role="alert" className="text-error" data-testid="ai-disposition-error">{error}</p> : null}
          {done ? <p role="status" data-testid="ai-disposition-done">{done}</p> : null}
        </div>
      ) : <p className="font-body-sm text-on-surface-variant">Your role can read but not record a disposition.</p>}
    </Box>
  );
}

// ---- per use case output ----------------------------------------------------------------------------------------------------

interface Feature { feature: string; value: number; weight: number; contribution: number }
interface RiskEntity { key: string; name: string; synthetic: boolean; score: number; band: string; confidence: number; features: Feature[] }
interface Quarter { quarter: string; units: number; zVsOthers: number }
interface SeriesRow { series: string; quarters: Quarter[]; boundSerials: number | null; flags: { type: string; quarter: string; detail: string }[]; status: string }
interface TrendCat { category: string; ratings: number; starDistribution: number[]; months: { month: string; meanIseer: number; count: number }[]; slopePerMonth: number; rSquared: number; forecast: { nextMonthMeanIseer: number; low95: number; high95: number } | null }
interface Answer { articleId: number; title: string; category: string; score: number }
interface ExField { field: string; extracted: string | null; declared: string | null; status: string; confidence: number }

function Output({ run }: { run: RunDetail }) {
  const o = run.output as Record<string, unknown>;
  if (run.useCase === "compliance-risk") {
    const ents = (o.entities as RiskEntity[]) ?? [];
    return (
      <div className="mt-4 space-y-2.5" data-testid="ai-output-risk">
        {ents.map((e, i) => {
          const band = BAND[e.band] ?? BAND.low;
          const top = e.features.filter((f) => f.contribution > 0).sort((x, y) => y.contribution - x.contribution);
          return (
            <details key={e.key} className="ai-entity" open={i < 3}>
              <summary>
                <span className="ai-rank">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[#14315E] truncate">{e.name}{e.synthetic ? " [synthetic]" : ""}</span>
                  <span className="mt-1 block h-2 rounded-full bg-[#e7edf6] overflow-hidden"><span className={`block h-full rounded-full ${band.bar}`} style={{ width: `${Math.min(100, e.score)}%` }} /></span>
                </span>
                <span className="w-14 text-right text-[20px] font-extrabold text-[#14315E]">{e.score}</span>
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${band.pill}`}>{e.band}</span>
              </summary>
              <div className="pt-2 pl-10 flex flex-wrap gap-1.5">
                {top.length ? top.map((f) => <Chip key={f.feature}>{f.feature}: {f.value} → {f.contribution}/{f.weight}</Chip>) : <span className="text-[13px] text-[#64748b]">No contributing factors.</span>}
              </div>
            </details>
          );
        })}
      </div>
    );
  }
  if (run.useCase === "production-anomaly") {
    const series = (o.series as SeriesRow[]) ?? [];
    return (
      <div className="mt-4 space-y-3" data-testid="ai-output-anomaly">
        {o.synthetic ? <p className="font-body-sm font-semibold">Synthetic production rows are shown (ai_demo_production): the live production table is absent or empty.</p> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          {series.map((s) => {
            const flaggedIdx = s.quarters.map((q, i) => (s.flags.some((f) => f.quarter === q.quarter) ? i : -1)).filter((i) => i >= 0);
            return (
              <div key={s.series} className={`rounded-xl border p-3 ${s.flags.length ? "border-[#f5c2c0] bg-[#fffafa]" : "border-[#e2e8f0] bg-white"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#14315E]">{s.series}</span>
                  <span className="flex gap-1.5">{s.boundSerials !== null ? <Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">{s.boundSerials} serials bound</Chip> : null}<Chip tone={s.flags.length ? BAND.high.pill : BAND.low.pill}>{s.status}</Chip></span>
                </div>
                <div className="mt-2"><MiniBars values={s.quarters.map((q) => q.units)} labels={s.quarters.map((q) => q.quarter)} flagged={flaggedIdx} /></div>
                <div className="mt-1 text-[11px] text-[#64748b]">{s.quarters.map((q) => `${q.quarter}: z ${q.zVsOthers}`).join(" · ")}</div>
                {s.flags.map((f, i) => <p key={i} className="mt-2 flex gap-1.5 text-[13px] text-[#93000a]"><Icon name="flag" size={16} /> Flag {f.type} ({f.quarter}): {f.detail}</p>)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (run.useCase === "rating-trends") {
    const cats = (o.categories as TrendCat[]) ?? [];
    return (
      <div className="mt-4 space-y-3" data-testid="ai-output-trends">
        <div className="flex gap-2"><Chip>{String(o.realRatings)} real ratings</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">{String(o.syntheticRatings)} synthetic</Chip></div>
        {cats.map((c) => (
          <div key={c.category} className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#14315E]">{c.category}</span>
              <span className="flex flex-wrap gap-1.5"><Chip>{c.ratings} ratings</Chip><Chip tone={c.slopePerMonth >= 0 ? BAND.low.pill : BAND.high.pill}>slope {c.slopePerMonth} per month</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">R² {c.rSquared}</Chip></span>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1">Star distribution</div>
                <div aria-label={`Star distribution for ${c.category}`}><MiniBars values={c.starDistribution} labels={c.starDistribution.map((_, i) => `${i + 1}★`)} /></div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1">Monthly mean rating</div>
                <TrendLine points={c.months.map((m) => ({ label: m.month, v: m.meanIseer }))} forecast={c.forecast ? { v: c.forecast.nextMonthMeanIseer, low: c.forecast.low95, high: c.forecast.high95 } : null} />
              </div>
            </div>
            <p className="mt-2 text-[13px] text-[#475569]">{c.forecast ? <>Next month: <strong className="text-[#14315E]">{c.forecast.nextMonthMeanIseer}</strong> (95% band {c.forecast.low95} to {c.forecast.high95})</> : "Too few months for a forecast band."} <span className="sr-only">{c.months.map((m) => `${m.month}: ${m.meanIseer}`).join(" · ")}</span></p>
          </div>
        ))}
      </div>
    );
  }
  if (run.useCase === "helpdesk-assist") {
    const top = (o.topAnswers as Answer[]) ?? [];
    const best = Math.max(0.0001, ...top.map((a) => a.score));
    return (
      <div className="mt-4 space-y-3 font-body-sm" data-testid="ai-output-helpdesk">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[#64748b]">Suggested category</span>
          <Chip>{String(o.suggestedCategory)}</Chip>
          {o.escalateToHuman ? <Chip tone={BAND.high.pill}><Icon name="support_agent" size={14} /> ESCALATE TO A PERSON (confidence under the threshold)</Chip> : null}
        </div>
        <ol className="space-y-2">
          {top.map((a, i) => (
            <li key={a.articleId} className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2">
              <span className="ai-rank">{i + 1}</span>
              <span className="flex-1 min-w-0"><span className="block font-semibold text-[#14315E]">{a.title}</span><span className="text-[12px] text-[#64748b]">{a.category}, score {a.score}</span></span>
              <div className="w-28"><Meter value={a.score / best} /></div>
            </li>
          ))}
        </ol>
        <div className="rounded-2xl rounded-tl-sm border border-[#c9d9f7] bg-[#f4f8ff] p-4 whitespace-pre-wrap leading-6" data-testid="ai-draft">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#254e9e]"><Icon name="mark_email_unread" size={14} /> Draft reply (not sent)</div>
          {String(o.draftReply)}
        </div>
      </div>
    );
  }
  const fields = (o.fields as ExField[]) ?? [];
  return (
    <div className="mt-4 font-body-sm" data-testid="ai-output-extraction">
      <div className="mb-2 flex flex-wrap gap-2"><Chip>Application {String(o.applicationReference)}</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">text from: {String(o.textSource)}</Chip></div>
      <table className="w-full">
        <thead><tr><th className={cell}>Field</th><th className={cell}>Extracted</th><th className={cell}>Declared</th><th className={cell}>Status</th><th className={cell}>Confidence</th></tr></thead>
        <tbody>
          {fields.map((f) => {
            const st = f.status.replaceAll("_", " ");
            const tone = /match|agree|same/i.test(st) && !/not|differ|mismatch/i.test(st) ? BAND.low.pill : /differ|mismatch|conflict/i.test(st) ? BAND.high.pill : "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]";
            return (
              <tr key={f.field} className="border-t border-outline-variant">
                <td className={cell}><strong>{f.field}</strong></td><td className={cell}>{f.extracted ?? "not found"}</td><td className={cell}>{f.declared ?? "not declared"}</td>
                <td className={cell}><span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${tone}`}>{st}</span></td>
                <td className={cell}><Meter value={f.confidence} label={pct(f.confidence)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
