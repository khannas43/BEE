"use client";

import { useCallback, useEffect, useState } from "react";
import { ListPager, SortableTh, useListTools } from "@/components/app/kit/listTools";
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
/** Left out of the demonstration screen: Helpdesk assist has nothing AI-specific to show. The back end still serves it. */
export const DEFAULT_HIDDEN_USE_CASES: readonly string[] = ["helpdesk-assist"];

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

/** Business wording for an evidence source. The technical table or column name stays available as the cell's tooltip. */
const SOURCE_LABELS: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/^model_application_return$/, "Application history: returned applications"],
  [/^model_application_rejection$/, "Application history: rejected applications"],
  [/^model_application_rating \(declared_iseer, verified_iseer\)$/, "Rating records: declared against verified efficiency"],
  [/^model_application_fee_confirmation/, "Fee records: payment received to fee confirmed"],
  [/^model_application_resubmission$/, "Application history: resubmissions"],
  [/^production_row/, "Quarterly production submissions"],
  [/^ai_demo_production/, "Sample production data (synthetic)"],
  [/^ai_demo_entity/, "Sample manufacturer profile (synthetic)"],
  [/^model_application_rating\.verified_iseer/, "Rating records: verified efficiency (live and sample)"],
  [/^model_application_rating\.stars/, "Rating records: awarded stars (live and sample)"],
  [/^ai_kb\.id (\d+)/, (m) => `Helpdesk knowledge base, article ${m[1]}`],
  [/^report text: laboratory$/, "Test report: laboratory name"],
  [/^report text: testDate$/, "Test report: test date"],
  [/^report text: efficiency$/, "Test report: efficiency"],
  [/^model_application_document_version\.laboratory_name/, "Application: declared laboratory"],
  [/^model_application\.tested_on$/, "Application: declared test date"],
  [/^model_application\.declared_iseer$/, "Application: declared efficiency (ISEER)"],
];
export function businessSource(source: string): string {
  for (const [re, label] of SOURCE_LABELS) {
    const m = source.match(re);
    if (m) return typeof label === "function" ? label(m) : label;
  }
  const plain = source.replace(/\(.*?\)/g, "").replace(/[._]+/g, " ").trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
/** Notes written by the service mention sample tables by name; show them in business words. */
const plainNote = (t: string) =>
  t.replaceAll("ai_demo_entity", "the sample manufacturer profiles").replaceAll("ai_demo_production", "the sample production data").replaceAll("ai_demo_rating", "the sample rating data").replaceAll("ai_kb", "the helpdesk knowledge base");
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

export function AiDemo({ hidden = DEFAULT_HIDDEN_USE_CASES }: { hidden?: readonly string[] } = {}) {
  const SHOWN_USE_CASES = USE_CASES.filter((u) => !hidden.includes(u.id));
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
  const ctl = useUseCase(model);

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-ai">
      <div className="flex items-center justify-between gap-space-md">
        <h1 className="flex-1 min-w-0">AI use cases</h1>
        {models ? <RunButton model={model} ctl={ctl} /> : null}
      </div>
      <p className="ai-lead">{SHOWN_USE_CASES.length === 4 ? "Four" : "Five"} transparent models read the live portal data. Each run keeps its evidence, model version and data version, and a person records the decision.</p>
      {denied ? <p role="alert" className="text-error" data-testid="ai-error">{denied}</p> : null}
      {models === null && !denied ? <p role="status">Loading models…</p> : null}
      {models ? (
        <>
          <div role="tablist" aria-label="AI use cases" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SHOWN_USE_CASES.map((u) => (
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
            {model ? <UseCasePanel key={tab} model={model} ctl={ctl} /> : <p role="alert">You may not use this area.</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** A box that starts closed; the header is the button. The body stays in the page (hidden) so nothing is lost when it is closed. */
function Collapsible({ title, icon, testId, aside, children, hint }: { title: string; icon: string; testId: string; aside?: React.ReactNode; children: React.ReactNode; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-outline-variant bg-surface p-space-md" data-testid={testId}>
      <button type="button" className="w-full flex items-center justify-between gap-space-sm text-left" aria-expanded={open} aria-controls={`${testId}-body`} onClick={() => setOpen(!open)} data-testid={`${testId}-toggle`}>
        <h3 className="font-title-sm text-title-sm text-on-surface flex items-center gap-2">
          <Icon name={icon} size={18} className="text-[#254e9e]" />
          {title}
          <span className="font-label-md text-on-surface-variant font-normal">{open ? "Hide details" : hint ?? "Show details"}</span>
        </h3>
        <span className="flex flex-wrap items-center gap-2">
          {aside}
          <Icon name={open ? "expand_less" : "expand_more"} size={20} className="text-on-surface-variant" />
        </span>
      </button>
      <div id={`${testId}-body`} hidden={!open} className="mt-space-sm">{children}</div>
    </section>
  );
}

function ModelCardBox({ model }: { model: ModelCard }) {
  const rules = model.kind === "rules" || model.kind === "statistical" || model.kind === "retrieval" || model.kind === "extraction";
  return (
    <Collapsible title="Model card" icon="neurology" testId="ai-model-card"
      aside={<><Chip>{model.kind}{rules ? " · not machine learning" : ""}</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">{model.id}@{model.version}</Chip></>}>
      <p className="text-[14px] leading-6 text-[#181c20]"><span className="sr-only">Model {model.name} ({model.id}@{model.version}). Kind {model.kind}{rules ? " (rules or statistics, not machine learning)" : ""}. </span><strong className="text-[#14315E]">{model.name}.</strong> {model.description}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#f3dc9c] bg-[#fffaf0] p-3"><div className="text-[11px] font-bold uppercase tracking-wider text-[#8a4b00] mb-1">Limitations</div><div className="text-[13px] leading-5">{model.limitations}</div></div>
        <div className="rounded-lg border border-[#c9d9f7] bg-[#f4f8ff] p-3"><div className="text-[11px] font-bold uppercase tracking-wider text-[#14315E] mb-1">Trained on</div><div className="text-[13px] leading-5">{model.trainedOn}</div></div>
      </div>
    </Collapsible>
  );
}

/** Everything one use case needs: its stored runs, the selected run, the inputs and the Run action (shown at the top of the page). */
function useUseCase(model: ModelCard | null) {
  const uc = model?.useCase ?? null;
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("How do I pay the application fee?");
  const [appRef, setAppRef] = useState("LOCAL-MA-0004");
  const [category, setCategory] = useState("");
  const [seenUc, setSeenUc] = useState(uc);
  if (seenUc !== uc) {
    setSeenUc(uc);
    setRuns(null);
    setSelected(null);
    setError(null);
  }

  const loadRuns = useCallback(async () => {
    if (!uc) return;
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
    if (!uc) return;
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

  return { runs, selected, error, busy, question, setQuestion, appRef, setAppRef, category, setCategory, loadRuns, open, run };
}
type UseCaseController = ReturnType<typeof useUseCase>;

/** The Run button, at the top of the page beside the introduction. */
function RunButton({ model, ctl }: { model: ModelCard | null; ctl: UseCaseController }) {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button className="ai-run ai-run-round bg-primary text-on-primary" disabled={!model?.canRun || ctl.busy} onClick={() => void ctl.run()} data-testid="ai-run" aria-label={ctl.busy ? "Running" : "Run"}>
        <Icon name={ctl.busy ? "hourglass_top" : "play_arrow"} size={22} /> {ctl.busy ? "Running" : "Run"}
      </button>
      {model && !model.canRun ? <span className="font-label-sm text-on-surface-variant">Read only for your role</span> : null}
    </div>
  );
}

const HISTORY_SORT = (r: RunSummary, k: string): string | number =>
  k === "when" ? r.createdAt : k === "by" ? r.createdBy : k === "confidence" ? r.confidence : k === "data" ? `${r.dataVersion} ${r.inputRef ?? ""}` : r.dispositionCount === 0 ? "" : r.latestDecision ?? "";

function HistoryTable({ runs, selectedId, onOpen }: { runs: RunSummary[]; selectedId: string | undefined; onOpen: (id: string) => void }) {
  const tools = useListTools({
    rows: runs,
    text: (r) => `${r.createdBy} ${r.dataVersion} ${r.inputRef ?? ""} ${r.latestDecision ?? ""}`,
    sortValue: HISTORY_SORT,
    pageSize: 5,
  });
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full font-body-sm" data-testid="ai-history-table">
          <caption className="sr-only">Stored runs of this use case</caption>
          <thead>
            <tr>
              <SortableTh tools={tools} k="when" className={cell}>When</SortableTh>
              <SortableTh tools={tools} k="by" className={cell}>Run by</SortableTh>
              <SortableTh tools={tools} k="confidence" className={cell}>Confidence</SortableTh>
              <SortableTh tools={tools} k="data" className={cell}>Data version</SortableTh>
              <SortableTh tools={tools} k="decision" className={cell}>Decision</SortableTh>
              <th scope="col" className={cell}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {tools.paged.pageRows.map((r) => (
              <tr key={r.id} className={`border-t border-outline-variant ${selectedId === r.id ? "bg-[#f4f8ff]" : ""}`}>
                <td className={cell}>{when(r.createdAt)}</td>
                <td className={cell}>{r.createdBy}</td>
                <td className={cell}>{pct(r.confidence)}</td>
                <td className={cell}>{r.dataVersion}{r.inputRef ? ` · ${r.inputRef}` : ""}</td>
                <td className={cell}>{r.dispositionCount === 0 ? <Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">no disposition yet</Chip> : <Chip tone={r.latestDecision === "reject" ? "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]" : r.latestDecision === "override" ? "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" : "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]"}>{r.latestDecision}</Chip>}</td>
                <td className={cell}><button type="button" className="text-primary underline" onClick={() => onOpen(r.id)} data-testid="ai-history-item" aria-label={`Open the run of ${when(r.createdAt)}`}>{selectedId === r.id ? "Selected" : "Open"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}

function EvidenceTable({ evidence }: { evidence: Evidence[] }) {
  const valueText = (e: Evidence) => `${typeof e.value === "object" ? JSON.stringify(e.value) : String(e.value)}${e.rows ? ` (${e.rows})` : ""}`;
  const tools = useListTools({
    rows: evidence,
    text: (e) => `${businessSource(e.source)} ${e.field} ${valueText(e)}`,
    sortValue: (e, k) => (k === "source" ? businessSource(e.source) : k === "field" ? e.field : valueText(e)),
    pageSize: 5,
  });
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full font-body-sm">
          <thead><tr><SortableTh tools={tools} k="source" className={cell}>Source</SortableTh><SortableTh tools={tools} k="field" className={cell}>Field</SortableTh><SortableTh tools={tools} k="value" className={cell}>Value</SortableTh></tr></thead>
          <tbody>
            {tools.paged.pageRows.map((e, i) => (
              <tr key={i} className="border-t border-outline-variant">
                <td className={cell} title={`Technical source: ${e.source}`}>{businessSource(e.source)}</td><td className={cell}>{e.field}</td>
                <td className={cell}>{valueText(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}

function UseCasePanel({ model, ctl }: { model: ModelCard; ctl: UseCaseController }) {
  const uc = model.useCase;
  const { runs, selected, error } = ctl;
  const hasInput = uc === "helpdesk-assist" || uc === "document-extraction" || uc === "rating-trends";

  return (
    <div className="space-y-space-md mt-space-md" data-testid={`ai-panel-${uc}`}>
      <ModelCardBox model={model} />
      {error ? <p role="alert" className="text-error" data-testid="ai-error">{error}</p> : null}
      {hasInput ? (
        <Box title="Input for the next run" icon="tune">
          {uc === "helpdesk-assist" ? (
            <label className="block font-label-md">Question
              <textarea className="mt-1 w-full rounded-lg border border-outline-variant p-space-xs" rows={2} value={ctl.question} maxLength={500} onChange={(e) => ctl.setQuestion(e.target.value)} data-testid="ai-input" />
            </label>
          ) : null}
          {uc === "document-extraction" ? (
            <label className="font-label-md">Application reference
              <input className="mt-1 block rounded-lg border border-outline-variant p-space-xs" value={ctl.appRef} onChange={(e) => ctl.setAppRef(e.target.value)} data-testid="ai-input" />
            </label>
          ) : null}
          {uc === "rating-trends" ? (
            <label className="font-label-md">Category (blank for all)
              <input className="mt-1 block rounded-lg border border-outline-variant p-space-xs" value={ctl.category} onChange={(e) => ctl.setCategory(e.target.value)} data-testid="ai-input" />
            </label>
          ) : null}
        </Box>
      ) : null}
      <Collapsible title="History (stored, survives reload)" icon="history" testId="ai-history" hint="Show past runs">
        {runs === null ? <p role="status">Loading…</p> : runs.length === 0 ? <p className="font-body-sm">No runs yet.</p> : <HistoryTable runs={runs} selectedId={selected?.id} onOpen={(id) => void ctl.open(id)} />}
      </Collapsible>
      {selected ? <RunView key={selected.id} run={selected} canRun={model.canRun} onChanged={() => { void ctl.open(selected.id); void ctl.loadRuns(); }} /> : null}
    </div>
  );
}

type ConfidenceWhy = { meaning: string; steps: string[]; table?: { head: string[]; rows: string[][] }; calc: string; example?: string };
const GENERIC_MEANING = "How much data the model had to go on for this run. It is not the chance that the result is right, and a person still decides.";

const p1 = (v: number) => `${Math.round(v * 100)}%`;

/** Why the run's confidence is what it is: the same rule the service used, worked out from this run's own output. */
function confidenceWhy(run: RunDetail): ConfidenceWhy {
  const o = run.output as Record<string, unknown>;
  if (run.useCase === "compliance-risk") {
    const ents = (o.entities as RiskEntity[]) ?? [];
    const conf = (apps: number) => (apps > 0 ? Math.min(0.95, 0.3 + 0.12 * apps) : 0.3);
    const groups = new Map<number, number>();
    ents.forEach((e) => { const k = Math.min(e.applications, 6); groups.set(k, (groups.get(k) ?? 0) + 1); }); // 6 or more all reach the 95% cap
    const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    const total = sorted.reduce((t, [apps, n]) => t + conf(apps) * n, 0);
    const exApps = sorted.find(([a]) => a >= 1 && a <= 4)?.[0] ?? sorted[0]?.[0] ?? 0;
    return {
      meaning: "How much evidence stands behind the scores in this run. A manufacturer with many applications on record has a score built on more evidence than one with few. It is not the chance that a manufacturer is non-compliant.",
      steps: [
        "Every manufacturer gets its own confidence: it starts at 30% and gains 12% for each application on record, and never goes above 95%. So 1 application = 42%, 3 = 66%, 5 = 90%, and 6 or more = 95%. A manufacturer with no applications stays at 30%.",
        `The run's confidence is the plain average of those ${ents.length} figures: add them up and divide by ${ents.length}.`,
      ],
      table: { head: ["Applications on record", "Manufacturers", "Confidence of each", "Subtotal"], rows: sorted.map(([apps, n]) => [apps >= 6 ? "6 or more" : String(apps), String(n), p1(conf(apps)), `${(conf(apps) * n * 100).toFixed(0)} points`]) },
      calc: `Total ${(total * 100).toFixed(0)} points ÷ ${ents.length} manufacturers = ${(total / Math.max(1, ents.length) * 100).toFixed(1)}%, shown as ${p1(run.confidence)}.`,
      example: sorted.length ? `Example: a manufacturer with ${exApps} application${exApps === 1 ? "" : "s"} gets 30% + ${exApps} × 12% = ${p1(conf(exApps))}.` : undefined,
    };
  }
  if (run.useCase === "production-anomaly") {
    const series = (o.series as SeriesRow[]) ?? [];
    const conf = (q: number) => Math.min(0.9, 0.3 + 0.1 * q);
    const groups = new Map<number, number>();
    series.forEach((x) => { const k = Math.min(x.quarters.length, 6); groups.set(k, (groups.get(k) ?? 0) + 1); }); // 6 or more all reach the 90% cap
    const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    const total = sorted.reduce((t, [q, n]) => t + conf(q) * n, 0);
    const exQ = sorted.find(([q]) => q >= 1 && q <= 5)?.[0] ?? sorted[0]?.[0] ?? 0;
    return {
      meaning: "How much production history stands behind the checks in this run. To decide whether a quarter looks unusual, the model compares it with the series' other quarters, so a series with a long history gives a firmer answer, flagged or not. It is not the chance that a flag is a real problem.",
      steps: [
        "Every production series (one model of one manufacturer) gets its own confidence: it starts at 30% and gains 10% for each quarter of history, and never goes above 90%. So 2 quarters = 50%, 4 = 70%, and 6 or more = 90%.",
        `The run's confidence is the plain average of those ${series.length} figures: add them up and divide by ${series.length}.`,
      ],
      table: { head: ["Quarters of history", "Series", "Confidence of each", "Subtotal"], rows: sorted.map(([q, n]) => [q >= 6 ? "6 or more" : String(q), String(n), p1(conf(q)), `${(conf(q) * n * 100).toFixed(0)} points`]) },
      calc: `Total ${(total * 100).toFixed(0)} points ÷ ${series.length} series = ${(total / Math.max(1, series.length) * 100).toFixed(1)}%, shown as ${p1(run.confidence)}.`,
      example: sorted.length ? `Example: a series with ${exQ} quarter${exQ === 1 ? "" : "s"} of history gets 30% + ${exQ} × 10% = ${p1(conf(exQ))}.` : undefined,
    };
  }
  if (run.useCase === "rating-trends") {
    const cats = (o.categories as TrendCat[]) ?? [];
    const rows = cats.map((c) => {
      const conf = Math.max(0, Math.min(1, 0.6 * c.rSquared + 0.4 * Math.min(c.months.length, 8) / 8));
      return [c.category, c.rSquared.toFixed(2), String(c.months.length), p1(conf)];
    });
    return {
      meaning: GENERIC_MEANING,
      steps: ["Each category's confidence is 60% of its R² (how closely the monthly averages follow a straight line, 0 to 1) plus 40% of its months of data (8 months or more counts as full).", `The run's confidence is the plain average over the ${cats.length} categories.`],
      table: { head: ["Category", "R² (line fit)", "Months of data", "Confidence"], rows },
      calc: `Average over ${cats.length} categories = ${p1(run.confidence)}.`,
    };
  }
  if (run.useCase === "helpdesk-assist") {
    const top = (o.topAnswers as Answer[]) ?? [];
    const best = top[0]?.score ?? 0;
    const threshold = Number(o.escalateThreshold ?? 0.45);
    return {
      meaning: GENERIC_MEANING,
      steps: ["The model compares the question with every FAQ article by shared keywords (a score from 0 to 1).", "Confidence is twice the best score, up to 95%. Below the escalation limit it does not draft an answer and asks a person."],
      table: { head: ["Best matching article", "Match score", "Confidence (2 × score)", "Escalation limit"], rows: [[top[0]?.title ?? "none", best.toFixed(3), p1(run.confidence), p1(threshold)]] },
      calc: `${p1(run.confidence)} is ${run.confidence < threshold ? "below" : "at or above"} the ${p1(threshold)} limit, so ${run.confidence < threshold ? "the question goes to a person" : "a draft reply is offered for an officer to review"}.`,
    };
  }
  const fields = (o.fields as ExField[]) ?? [];
  const found = fields.filter((f) => f.extracted !== null);
  const minConf = found.length ? Math.min(...found.map((f) => f.confidence)) : 0;
  return {
    meaning: GENERIC_MEANING,
    steps: ["Each field is read from the report text by a pattern, and each pattern has its own confidence.", "The run's confidence is the weakest found field's confidence, scaled by how many of the fields were found at all."],
    table: { head: ["Field", "Found in report", "Field confidence"], rows: fields.map((f) => [f.field, f.extracted !== null ? "yes" : "no", f.extracted !== null ? p1(f.confidence) : "n/a"]) },
    calc: found.length === 0 ? "No field was found, so the confidence is the 10% floor." : `Lowest found field ${p1(minConf)} × ${found.length} of ${fields.length} found = ${p1(run.confidence)}.`,
  };
}

/** The run's confidence figure, closed by default; open it to see why it is this number. */
function ConfidenceBox({ run }: { run: RunDetail }) {
  const why = confidenceWhy(run);
  return (
    <Collapsible title="Confidence" icon="speed" testId="ai-confidence-box" hint={`Why ${pct(run.confidence)}?`}
      aside={<><span className="text-[22px] leading-6 font-extrabold text-[#14315E]" data-testid="ai-confidence">{pct(run.confidence)}</span><div className="w-24"><Meter value={run.confidence} /></div></>}>
      <div className="space-y-3 font-body-sm" data-testid="ai-confidence-why">
        <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">What it means</div><p>{why.meaning}</p></div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">How it is worked out</div>
          <ol className="list-decimal pl-5 space-y-1">{why.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </div>
        {why.table ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{why.table.head.map((h) => <th key={h} scope="col" className={cell}>{h}</th>)}</tr></thead>
              <tbody>{why.table.rows.map((r, i) => <tr key={i} className="border-t border-outline-variant">{r.map((c, j) => <td key={j} className={cell}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
        <p className="font-semibold text-[#14315E]">{why.calc}</p>
        {why.example ? <p className="text-on-surface-variant">{why.example}</p> : null}
        <p className="text-[12px] text-[#475569]">model {run.modelVersion} · data version <code data-testid="ai-data-version">{run.dataVersion}</code></p>
      </div>
    </Collapsible>
  );
}

function RunView({ run, canRun, onChanged }: { run: RunDetail; canRun: boolean; onChanged: () => void }) {
  const out = run.output;
  const isRisk = run.useCase === "compliance-risk";
  const isAnomaly = run.useCase === "production-anomaly";
  // The results that can be selected, as (key, name used in the evidence field): the evidence of one result starts with "<name>: " (risk) or "<name> " (anomaly).
  const choices: { key: string; name: string; sep: string }[] = isRisk
    ? ((out.entities as RiskEntity[]) ?? []).map((e) => ({ key: e.key, name: e.name, sep: ": " }))
    : isAnomaly ? ((out.series as SeriesRow[]) ?? []).map((x) => ({ key: x.series, name: x.series, sep: " " })) : [];
  const [selKey, setSelKey] = useState<string | null>(isAnomaly ? (((out.series as SeriesRow[]) ?? []).find((x) => x.flags.length > 0) ?? ((out.series as SeriesRow[]) ?? [])[0])?.series ?? null : choices[0]?.key ?? null);
  const [showAll, setShowAll] = useState(false);
  const selChoice = choices.find((c) => c.key === selKey) ?? null;
  const prefix = selChoice ? `${selChoice.name}${selChoice.sep}` : "";
  const evidence = selChoice && !showAll
    ? out.evidence.filter((e) => e.field.startsWith(prefix)).map((e) => ({ ...e, field: e.field.slice(prefix.length) }))
    : out.evidence;
  const what = isAnomaly ? "series" : "manufacturers";
  return (
    <div className="space-y-space-md" data-testid="ai-run-view">
      <Box title="Result" icon="insights" testId="ai-result" aside={<Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">run {when(run.createdAt)} by {run.createdBy}</Chip>}>
        <ConfidenceBox run={run} />
        <p role="status" className="ai-summary mt-space-md" data-testid="ai-summary">{String(out.summary ?? "")}</p>
        <Output run={run} selKey={selKey} onSelect={(k) => { setSelKey(k); setShowAll(false); }} />
        {out.note ? <p className="mt-space-sm font-body-sm text-on-surface-variant">{plainNote(String(out.note))}</p> : null}
      </Box>
      <Box title={selChoice && !showAll ? `Evidence for ${selChoice.name}` : "Evidence for this run"} icon="fact_check" testId="ai-evidence"
        aside={selChoice ? <button type="button" className="font-label-md text-primary underline" onClick={() => setShowAll(!showAll)} data-testid="ai-evidence-all">{showAll ? `Show only ${selChoice.name}` : `Show evidence for all ${what}`}</button> : undefined}>
        {isAnomaly && selChoice && !showAll && evidence.length === 0 ? <p className="font-body-sm mb-space-sm" data-testid="ai-evidence-none">This series was not flagged, so there is no anomaly evidence for it. The chart above shows its quarters.</p> : null}
        <EvidenceTable key={`${selKey}-${showAll}`} evidence={evidence} />
      </Box>
      <DispositionPanel run={run} canRun={canRun} onChanged={onChanged} />
      <Collapsible title="Audit" icon="receipt_long" testId="ai-audit" hint="Show audit trail">
        <ol className="ai-timeline font-body-sm">
          {run.audit.map((a, i) => <li key={i}><span className="font-semibold text-[#14315E]">{when(a.at)}</span> · {a.actor} ({a.role}) · {a.detail}</li>)}
        </ol>
      </Collapsible>
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
interface RiskEntity { key: string; name: string; synthetic: boolean; applications: number; score: number; band: string; confidence: number; features: Feature[] }
interface Quarter { quarter: string; units: number; zVsOthers: number }
interface SeriesRow { series: string; organisation?: string; model?: string; quarters: Quarter[]; boundSerials: number | null; flags: { type: string; quarter: string; detail: string }[]; status: string }
interface TrendCat { category: string; ratings: number; starDistribution: number[]; months: { month: string; meanIseer: number; count: number }[]; slopePerMonth: number; rSquared: number; forecast: { nextMonthMeanIseer: number; low95: number; high95: number } | null }
interface Answer { articleId: number; title: string; category: string; score: number }
interface ExField { field: string; extracted: string | null; declared: string | null; status: string; confidence: number }

const FIELD_CLS = "rounded-lg border border-outline-variant px-3 !h-10 !py-0 box-border font-body-sm bg-surface-card";

/** One row of filters; every control is 40px high. "Clear filters" appears when any filter is set. */
function FilterBar({ children, active, onClear, testId }: { children: React.ReactNode; active: boolean; onClear: () => void; testId: string }) {
  return (
    <div className="flex flex-wrap items-end gap-space-sm" data-testid={testId}>
      {children}
      {active ? <button type="button" className="font-label-md text-primary underline pb-2" onClick={onClear} data-testid={`${testId}-clear`}>Clear filters</button> : null}
    </div>
  );
}
function FSearch({ label = "Search", value, onChange, placeholder, testId }: { label?: string; value: string; onChange: (v: string) => void; placeholder: string; testId: string }) {
  return (
    <label className="font-label-md">{label}
      <input className={`${FIELD_CLS} mt-1 block`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}
function FSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testId: string }) {
  return (
    <label className="font-label-md">{label}
      <select className={`${FIELD_CLS} mt-1 block`} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

const RISK_SORT = (e: RiskEntity & { rank: number }, k: string): string | number =>
  k === "rank" ? e.rank : k === "name" ? e.name : k === "apps" ? e.applications : k === "score" ? e.score : k === "band" ? e.band : e.confidence;

/** The scored manufacturers: sortable, paged, and one row is selected; the evidence below is for that row only. */
function RiskTable({ entities, selKey, onSelect }: { entities: RiskEntity[]; selKey: string | null; onSelect: (key: string) => void }) {
  const ranked = entities.map((e, i) => ({ ...e, rank: i + 1 }));
  const [band, setBand] = useState("");
  const [factor, setFactor] = useState("");
  const [data, setData] = useState("");
  const factors = [...new Set(entities.flatMap((e) => e.features.filter((f) => f.contribution > 0).map((f) => f.feature)))].sort();
  const filtered = ranked.filter((e) => (!band || e.band === band) && (!factor || e.features.some((f) => f.feature === factor && f.contribution > 0)) && (!data || (data === "synthetic") === e.synthetic));
  const tools = useListTools({
    rows: filtered,
    text: (e) => `${e.name} ${e.band}`,
    sortValue: RISK_SORT,
    pageSize: 8,
  });
  const sel = ranked.find((e) => e.key === selKey) ?? null;
  const top = sel ? sel.features.filter((f) => f.contribution > 0).sort((x, y) => y.contribution - x.contribution) : [];
  return (
    <div className="mt-4 space-y-3" data-testid="ai-output-risk">
      <p className="font-body-sm text-on-surface-variant">{entities.length} manufacturers scored. Click a row to select it: the evidence below is shown for the selected manufacturer only.</p>
      <FilterBar testId="ai-risk-filters" active={Boolean(tools.query || band || factor || data)} onClear={() => { tools.clear(); setBand(""); setFactor(""); setData(""); }}>
        <FSearch value={tools.query} onChange={tools.setQuery} placeholder="Manufacturer name" testId="ai-risk-search" />
        <FSelect label="Risk band" value={band} onChange={(v) => { setBand(v); tools.setPage(1); }} testId="ai-risk-band" options={[["", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]} />
        <FSelect label="Contributing factor" value={factor} onChange={(v) => { setFactor(v); tools.setPage(1); }} testId="ai-risk-factor" options={[["", "Any"], ...factors.map((f): [string, string] => [f, f])]} />
        <FSelect label="Data" value={data} onChange={(v) => { setData(v); tools.setPage(1); }} testId="ai-risk-data" options={[["", "All"], ["live", "Live portal data"], ["synthetic", "Synthetic sample"]]} />
      </FilterBar>
      <div className="overflow-x-auto">
        <table className="w-full font-body-sm" data-testid="ai-risk-table">
          <caption className="sr-only">Scored manufacturers, highest review priority first</caption>
          <thead>
            <tr>
              <SortableTh tools={tools} k="rank" className={cell}>Rank</SortableTh>
              <SortableTh tools={tools} k="name" className={cell}>Manufacturer</SortableTh>
              <SortableTh tools={tools} k="apps" className={cell}>Applications</SortableTh>
              <SortableTh tools={tools} k="score" className={cell}>Score</SortableTh>
              <SortableTh tools={tools} k="band" className={cell}>Risk band</SortableTh>
              <SortableTh tools={tools} k="confidence" className={cell}>Confidence</SortableTh>
              <th scope="col" className={cell}><span className="sr-only">Select</span></th>
            </tr>
          </thead>
          <tbody>
            {tools.paged.pageRows.map((e) => {
              const band = BAND[e.band] ?? BAND.low;
              const on = e.key === selKey;
              return (
                <tr key={e.key} className={`border-t border-outline-variant cursor-pointer ${on ? "bg-[#e7effb]" : "hover:bg-[#f4f8ff]"}`} onClick={() => onSelect(e.key)} aria-selected={on} data-testid="ai-risk-row">
                  <td className={cell}>{e.rank}</td>
                  <td className={`${cell} font-semibold text-[#14315E]`}>{e.name}{e.synthetic ? " [synthetic]" : ""}</td>
                  <td className={cell}>{e.applications}</td>
                  <td className={cell}>
                    <span className="inline-flex items-center gap-2"><span className="inline-block h-2 w-16 rounded-full bg-[#e7edf6] overflow-hidden"><span className={`block h-full ${band.bar}`} style={{ width: `${Math.min(100, e.score)}%` }} /></span><strong>{e.score}</strong></span>
                  </td>
                  <td className={cell}><span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${band.pill}`}>{e.band}</span></td>
                  <td className={cell}>{pct(e.confidence)}</td>
                  <td className={cell}><button type="button" className="text-primary underline" onClick={(ev) => { ev.stopPropagation(); onSelect(e.key); }} aria-label={`Select ${e.name}`}>{on ? "Selected" : "Select"}</button></td>
                </tr>
              );
            })}
            {tools.paged.total === 0 ? <tr><td className={cell} colSpan={7}>No manufacturers match these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
      {sel ? (
        <div className="rounded-xl border border-[#dbe6f7] bg-[#f4f8ff] p-3" data-testid="ai-risk-selected">
          <div className="font-semibold text-[#14315E]">{sel.name}: score {sel.score} ({sel.band})</div>
          <div className="pt-2 flex flex-wrap gap-1.5">
            {top.length ? top.map((f) => <Chip key={f.feature}>{f.feature}: {f.value} → {f.contribution}/{f.weight}</Chip>) : <span className="text-[13px] text-[#64748b]">No contributing factors.</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ANOMALY_SORT = (s: SeriesRow, k: string): string | number => {
  const last = s.quarters[s.quarters.length - 1];
  return k === "series" ? s.series : k === "org" ? s.organisation ?? "" : k === "status" ? s.status : k === "flags" ? s.flags.length : k === "latest" ? last?.units ?? 0 : s.boundSerials ?? -1;
};
const FLAG_WORD: Record<string, string> = { iqr_fence: "Outside the usual range (IQR)", z_score_vs_own_history: "Jump against its own history (z-score)", units_exceed_bound_serials: "More units than QR serials bound" };

/** Production series: filter by search, status and kind of flag; sortable and paged. One row is selected; the evidence below is for it only. */
function AnomalyTable({ series, synthetic, selKey, onSelect }: { series: SeriesRow[]; synthetic: boolean; selKey: string | null; onSelect: (key: string) => void }) {
  const [status, setStatus] = useState("");
  const [flagType, setFlagType] = useState("");
  const [quarter, setQuarter] = useState("");
  const flagTypes = [...new Set(series.flatMap((s) => s.flags.map((f) => f.type)))].sort();
  const quarters = [...new Set(series.flatMap((s) => s.flags.map((f) => f.quarter)))].sort();
  const rows = series.filter((s) => (!status || s.status === status) && (!flagType || s.flags.some((f) => f.type === flagType)) && (!quarter || s.flags.some((f) => f.quarter === quarter)));
  const tools = useListTools({
    rows,
    text: (s) => `${s.series} ${s.organisation ?? ""} ${s.model ?? ""}`,
    sortValue: ANOMALY_SORT,
    pageSize: 6,
  });
  const sel = series.find((s) => s.series === selKey) ?? null;
  const flaggedIdx = sel ? sel.quarters.map((q, i) => (sel.flags.some((f) => f.quarter === q.quarter) ? i : -1)).filter((i) => i >= 0) : [];
  const fieldCls = "rounded-lg border border-outline-variant px-3 !h-10 !py-0 box-border font-body-sm bg-surface-card";
  return (
    <div className="mt-4 space-y-3" data-testid="ai-output-anomaly">
      {synthetic ? <p className="font-body-sm font-semibold">Sample production data is shown because there are no live production submissions yet.</p> : null}
      <p className="font-body-sm text-on-surface-variant">{series.length} production series checked. Click a row to select it: the evidence below is shown for the selected series only.</p>
      <div className="flex flex-wrap items-end gap-space-sm" data-testid="ai-anomaly-filters">
        <label className="font-label-md">Search
          <input className={`${fieldCls} mt-1 block`} value={tools.query} placeholder="Series, organisation or model" onChange={(e) => tools.setQuery(e.target.value)} data-testid="ai-anomaly-search" />
        </label>
        <label className="font-label-md">Status
          <select className={`${fieldCls} mt-1 block`} value={status} onChange={(e) => { setStatus(e.target.value); tools.setPage(1); }} data-testid="ai-anomaly-status">
            <option value="">All</option><option value="flagged">Flagged</option><option value="normal">Normal</option>
          </select>
        </label>
        <label className="font-label-md">Kind of flag
          <select className={`${fieldCls} mt-1 block`} value={flagType} onChange={(e) => { setFlagType(e.target.value); tools.setPage(1); }} data-testid="ai-anomaly-type">
            <option value="">Any</option>{flagTypes.map((t) => <option key={t} value={t}>{FLAG_WORD[t] ?? t}</option>)}
          </select>
        </label>
        <label className="font-label-md">Quarter flagged
          <select className={`${fieldCls} mt-1 block`} value={quarter} onChange={(e) => { setQuarter(e.target.value); tools.setPage(1); }} data-testid="ai-anomaly-quarter">
            <option value="">Any</option>{quarters.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </label>
        {(tools.query || status || flagType || quarter) ? (
          <button type="button" className="font-label-md text-primary underline pb-2" onClick={() => { tools.clear(); setStatus(""); setFlagType(""); setQuarter(""); }} data-testid="ai-anomaly-clear">Clear filters</button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-body-sm" data-testid="ai-anomaly-table">
          <caption className="sr-only">Production series and their flags</caption>
          <thead>
            <tr>
              <SortableTh tools={tools} k="series" className={cell}>Series</SortableTh>
              <SortableTh tools={tools} k="org" className={cell}>Organisation</SortableTh>
              <SortableTh tools={tools} k="status" className={cell}>Status</SortableTh>
              <SortableTh tools={tools} k="flags" className={cell}>Flags</SortableTh>
              <SortableTh tools={tools} k="latest" className={cell}>Latest quarter units</SortableTh>
              <SortableTh tools={tools} k="bound" className={cell}>Serials bound</SortableTh>
              <th scope="col" className={cell}><span className="sr-only">Select</span></th>
            </tr>
          </thead>
          <tbody>
            {tools.paged.pageRows.map((s) => {
              const on = s.series === selKey;
              const last = s.quarters[s.quarters.length - 1];
              return (
                <tr key={s.series} className={`border-t border-outline-variant cursor-pointer ${on ? "bg-[#e7effb]" : "hover:bg-[#f4f8ff]"}`} onClick={() => onSelect(s.series)} aria-selected={on} data-testid="ai-anomaly-row">
                  <td className={`${cell} font-semibold text-[#14315E]`}>{s.series}</td>
                  <td className={cell}>{s.organisation ?? ""}</td>
                  <td className={cell}><span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${s.flags.length ? BAND.high.pill : BAND.low.pill}`}>{s.status}</span></td>
                  <td className={cell}>{s.flags.length}</td>
                  <td className={cell}>{last ? `${last.units} (${last.quarter})` : ""}</td>
                  <td className={cell}>{s.boundSerials ?? "n/a"}</td>
                  <td className={cell}><button type="button" className="text-primary underline" onClick={(ev) => { ev.stopPropagation(); onSelect(s.series); }} aria-label={`Select ${s.series}`}>{on ? "Selected" : "Select"}</button></td>
                </tr>
              );
            })}
            {tools.paged.total === 0 ? <tr><td className={cell} colSpan={7}>No series match these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
      {sel ? (
        <div className={`rounded-xl border p-3 ${sel.flags.length ? "border-[#f5c2c0] bg-[#fffafa]" : "border-[#dbe6f7] bg-[#f4f8ff]"}`} data-testid="ai-anomaly-selected">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#14315E]">{sel.series}</span>
            {sel.boundSerials !== null ? <Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">{sel.boundSerials} serials bound</Chip> : null}
          </div>
          <div className="mt-2"><MiniBars values={sel.quarters.map((q) => q.units)} labels={sel.quarters.map((q) => q.quarter)} flagged={flaggedIdx} /></div>
          <div className="mt-1 text-[11px] text-[#64748b]">{sel.quarters.map((q) => `${q.quarter}: z ${q.zVsOthers}`).join(" · ")}</div>
          {sel.flags.map((f, i) => <p key={i} className="mt-2 flex gap-1.5 text-[13px] text-[#93000a]"><Icon name="flag" size={16} /> Flag {f.type} ({f.quarter}): {f.detail}</p>)}
        </div>
      ) : null}
    </div>
  );
}

const TREND_SORT: Record<string, (c: TrendCat) => string | number> = {
  category: (c) => c.category, slope: (c) => c.slopePerMonth, fit: (c) => c.rSquared, ratings: (c) => c.ratings,
};

/** Rating categories: filter by name, direction of the trend, whether a forecast exists and how well the line fits; sort and page. */
function TrendCards({ cats, realRatings, syntheticRatings }: { cats: TrendCat[]; realRatings: string; syntheticRatings: string }) {
  const [trend, setTrend] = useState("");
  const [forecast, setForecast] = useState("");
  const [fit, setFit] = useState("");
  const [sortKey, setSortKey] = useState("category");
  const filtered = cats
    .filter((c) => (!trend || (trend === "rising" ? c.slopePerMonth >= 0 : c.slopePerMonth < 0)) && (!forecast || (forecast === "yes") === (c.forecast !== null)) && (!fit || (fit === "strong" ? c.rSquared >= 0.7 : c.rSquared < 0.7)))
    .sort((x, y) => { const a = TREND_SORT[sortKey](x), b = TREND_SORT[sortKey](y); return typeof a === "string" ? String(a).localeCompare(String(b)) : Number(b) - Number(a); });
  const tools = useListTools({ rows: filtered, text: (c) => c.category, sortValue: () => 0, pageSize: 3 });
  return (
    <div className="mt-4 space-y-3" data-testid="ai-output-trends">
      <div className="flex gap-2"><Chip>{realRatings} real ratings</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">{syntheticRatings} synthetic</Chip></div>
      <FilterBar testId="ai-trend-filters" active={Boolean(tools.query || trend || forecast || fit)} onClear={() => { tools.clear(); setTrend(""); setForecast(""); setFit(""); }}>
        <FSearch label="Search" value={tools.query} onChange={tools.setQuery} placeholder="Category" testId="ai-trend-search" />
        <FSelect label="Trend" value={trend} onChange={(v) => { setTrend(v); tools.setPage(1); }} testId="ai-trend-direction" options={[["", "Any"], ["rising", "Rising or flat"], ["falling", "Falling"]]} />
        <FSelect label="Forecast" value={forecast} onChange={(v) => { setForecast(v); tools.setPage(1); }} testId="ai-trend-forecast" options={[["", "Any"], ["yes", "Available"], ["no", "Too few months"]]} />
        <FSelect label="Line fit (R²)" value={fit} onChange={(v) => { setFit(v); tools.setPage(1); }} testId="ai-trend-fit" options={[["", "Any"], ["strong", "Strong (0.7 or more)"], ["weak", "Weak (under 0.7)"]]} />
        <FSelect label="Sort by" value={sortKey} onChange={(v) => { setSortKey(v); tools.setPage(1); }} testId="ai-trend-sort" options={[["category", "Category"], ["slope", "Slope per month"], ["fit", "Line fit (R²)"], ["ratings", "Number of ratings"]]} />
      </FilterBar>
      <p className="font-body-sm text-on-surface-variant">{tools.paged.total} of {cats.length} categories shown.</p>
      {tools.paged.total === 0 ? <p className="font-body-sm">No categories match these filters.</p> : null}
        {tools.paged.pageRows.map((c) => (
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
      <ListPager tools={tools} />
    </div>
  );
}

function Output({ run, selKey, onSelect }: { run: RunDetail; selKey: string | null; onSelect: (key: string) => void }) {
  const o = run.output as Record<string, unknown>;
  if (run.useCase === "compliance-risk") {
    return <RiskTable entities={(o.entities as RiskEntity[]) ?? []} selKey={selKey} onSelect={onSelect} />;
  }
  if (run.useCase === "production-anomaly") {
    return <AnomalyTable series={(o.series as SeriesRow[]) ?? []} synthetic={Boolean(o.synthetic)} selKey={selKey} onSelect={onSelect} />;
  }
  if (run.useCase === "rating-trends") {
    return <TrendCards cats={(o.categories as TrendCat[]) ?? []} realRatings={String(o.realRatings)} syntheticRatings={String(o.syntheticRatings)} />;
  }
  if (run.useCase === "helpdesk-assist") {
    const top = (o.topAnswers as Answer[]) ?? [];
    const best = Math.max(0.0001, ...top.map((a) => a.score));
    return <HelpdeskResult o={o} top={top} best={best} />;
  }
  return <ExtractionTable o={o} fields={(o.fields as ExField[]) ?? []} />;
}

function HelpdeskResult({ o, top, best }: { o: Record<string, unknown>; top: Answer[]; best: number }) {
  const [category, setCategory] = useState("");
  const [strength, setStrength] = useState("");
  const [query, setQuery] = useState("");
  const categories = [...new Set(top.map((a) => a.category))].sort();
  const shown = top.filter((a) => (!category || a.category === category) && (!strength || (strength === "strong" ? a.score >= 0.7 * best : a.score < 0.7 * best)) && (!query || a.title.toLowerCase().includes(query.toLowerCase())));
  return (
      <div className="mt-4 space-y-3 font-body-sm" data-testid="ai-output-helpdesk">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[#64748b]">Suggested category</span>
          <Chip>{String(o.suggestedCategory)}</Chip>
          {o.escalateToHuman ? <Chip tone={BAND.high.pill}><Icon name="support_agent" size={14} /> ESCALATE TO A PERSON (confidence under the threshold)</Chip> : null}
        </div>
        <FilterBar testId="ai-help-filters" active={Boolean(query || category || strength)} onClear={() => { setQuery(""); setCategory(""); setStrength(""); }}>
          <FSearch label="Search" value={query} onChange={setQuery} placeholder="Article title" testId="ai-help-search" />
          <FSelect label="Category" value={category} onChange={setCategory} testId="ai-help-category" options={[["", "All"], ...categories.map((c): [string, string] => [c, c])]} />
          <FSelect label="Match strength" value={strength} onChange={setStrength} testId="ai-help-strength" options={[["", "Any"], ["strong", "Strong (70% of the best or more)"], ["weak", "Weaker"]]} />
        </FilterBar>
        <p className="text-on-surface-variant">{shown.length} of {top.length} matching articles shown.</p>
        <ol className="space-y-2">
          {shown.length === 0 ? <li>No articles match these filters.</li> : null}
          {shown.map((a, i) => (
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

const STATUS_WORD: Record<string, string> = { match: "Matches", differs: "Differs", not_found_in_report: "Not found in report", not_declared: "Not declared" };

/** The extracted fields against the declared ones: filter by status and confidence, sort every column. */
function ExtractionTable({ o, fields }: { o: Record<string, unknown>; fields: ExField[] }) {
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const statuses = [...new Set(fields.map((f) => f.status))].sort();
  const rows = fields.filter((f) => (!status || f.status === status) && (!level || (level === "high" ? f.confidence >= 0.75 : level === "medium" ? f.confidence >= 0.45 && f.confidence < 0.75 : f.confidence < 0.45)));
  const tools = useListTools({
    rows,
    text: (f) => `${f.field} ${f.extracted ?? ""} ${f.declared ?? ""}`,
    sortValue: (f, k) => (k === "field" ? f.field : k === "extracted" ? f.extracted ?? "" : k === "declared" ? f.declared ?? "" : k === "status" ? f.status : f.confidence),
    pageSize: 10,
  });
  return (
    <div className="mt-4 space-y-3 font-body-sm" data-testid="ai-output-extraction">
      <div className="flex flex-wrap gap-2"><Chip>Application {String(o.applicationReference)}</Chip><Chip tone="bg-[#eef2f7] text-[#475569] border-[#d8e0ea]">text from: {String(o.textSource)}</Chip></div>
      <FilterBar testId="ai-extract-filters" active={Boolean(tools.query || status || level)} onClear={() => { tools.clear(); setStatus(""); setLevel(""); }}>
        <FSearch value={tools.query} onChange={tools.setQuery} placeholder="Field, extracted or declared value" testId="ai-extract-search" />
        <FSelect label="Status" value={status} onChange={(v) => { setStatus(v); tools.setPage(1); }} testId="ai-extract-status" options={[["", "All"], ...statuses.map((x): [string, string] => [x, STATUS_WORD[x] ?? x])]} />
        <FSelect label="Confidence" value={level} onChange={(v) => { setLevel(v); tools.setPage(1); }} testId="ai-extract-level" options={[["", "Any"], ["high", "High (75% or more)"], ["medium", "Medium (45% to 74%)"], ["low", "Low (under 45%)"]]} />
      </FilterBar>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr>
            <SortableTh tools={tools} k="field" className={cell}>Field</SortableTh><SortableTh tools={tools} k="extracted" className={cell}>Extracted</SortableTh>
            <SortableTh tools={tools} k="declared" className={cell}>Declared</SortableTh><SortableTh tools={tools} k="status" className={cell}>Status</SortableTh>
            <SortableTh tools={tools} k="confidence" className={cell}>Confidence</SortableTh>
          </tr></thead>
          <tbody>
            {tools.paged.pageRows.map((f) => {
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
            {tools.paged.total === 0 ? <tr><td className={cell} colSpan={5}>No fields match these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}
