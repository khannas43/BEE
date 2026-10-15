"use client";

import { useCallback, useEffect, useState } from "react";
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

const BANNER = "Local demonstration on synthetic/seeded data: advisory only, a person decides";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const pct = (c: number) => `${Math.round(c * 100)}%`;
const cell = "px-space-sm py-1 text-left align-top";

function Box({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface p-space-md" data-testid={testId}>
      <h3 className="font-title-sm text-title-sm text-on-surface mb-space-sm">{title}</h3>
      {children}
    </section>
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
      <div role="note" className="rounded-xl border border-solar-gold/40 bg-solar-gold-light/60 p-space-sm font-body-sm text-on-surface" data-testid="ai-banner">
        <strong>{BANNER}.</strong> Advisory: a person decides. Nothing here changes an application, certificate, fee or any decision record.
      </div>
      <h1 className="font-headline-md text-headline-md text-on-surface">AI use cases</h1>
      {denied ? <p role="alert" className="text-error" data-testid="ai-error">{denied}</p> : null}
      {models === null && !denied ? <p role="status">Loading models…</p> : null}
      {models ? (
        <>
          <div role="tablist" aria-label="AI use cases" className="flex flex-wrap gap-space-xs border-b border-outline-variant">
            {USE_CASES.map((u) => (
              <button
                key={u.id}
                role="tab"
                id={`ai-tab-${u.id}`}
                aria-selected={tab === u.id}
                aria-controls="ai-panel"
                onClick={() => setTab(u.id)}
                className={`px-space-md py-space-xs font-label-md ${tab === u.id ? "border-b-2 border-primary text-primary" : "text-on-surface-variant"}`}
                data-testid={`ai-tab-${u.id}`}
              >
                {u.label}
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
    <Box title="Model card" testId="ai-model-card">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-space-lg gap-y-space-xs font-body-sm">
        <div><dt className="text-on-surface-variant">Model</dt><dd>{model.name} ({model.id}@{model.version})</dd></div>
        <div><dt className="text-on-surface-variant">Kind</dt><dd>{model.kind}{rules ? " (rules or statistics, not machine learning)" : ""}</dd></div>
        <div className="sm:col-span-2"><dt className="text-on-surface-variant">What it does</dt><dd>{model.description}</dd></div>
        <div className="sm:col-span-2"><dt className="text-on-surface-variant">Limitations</dt><dd>{model.limitations}</dd></div>
        <div className="sm:col-span-2"><dt className="text-on-surface-variant">Trained on</dt><dd>{model.trainedOn}</dd></div>
      </dl>
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
      <Box title="Run">
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
          <button className="rounded-lg bg-primary px-space-md py-space-xs text-on-primary disabled:opacity-50" disabled={!model.canRun || busy} onClick={run} data-testid="ai-run">
            {busy ? "Running…" : "Run"}
          </button>
          {!model.canRun ? <span className="font-body-sm text-on-surface-variant">Your role can read this area but not run it.</span> : null}
        </div>
        {error ? <p role="alert" className="mt-space-sm text-error" data-testid="ai-error">{error}</p> : null}
      </Box>
      <Box title="History (stored, survives reload)" testId="ai-history">
        {runs === null ? <p role="status">Loading…</p> : runs.length === 0 ? <p className="font-body-sm">No runs yet.</p> : (
          <ul className="space-y-1">
            {runs.map((r) => (
              <li key={r.id}>
                <button className={`w-full text-left rounded-lg px-space-sm py-1 hover:bg-surface-container ${selected?.id === r.id ? "bg-surface-container" : ""}`} onClick={() => open(r.id)} data-testid="ai-history-item">
                  {when(r.createdAt)} · {r.createdBy} · confidence {pct(r.confidence)} · data {r.dataVersion}
                  {r.inputRef ? ` · ${r.inputRef}` : ""} · {r.dispositionCount === 0 ? "no disposition yet" : `latest: ${r.latestDecision}`}
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
      <Box title="Result" testId="ai-result">
        <p role="status" className="font-body-md" data-testid="ai-summary">{String(out.summary ?? "")}</p>
        <p className="mt-space-xs font-body-sm text-on-surface-variant">
          Confidence <strong data-testid="ai-confidence">{pct(run.confidence)}</strong> · model {run.modelVersion} · data version <code data-testid="ai-data-version">{run.dataVersion}</code> · run {when(run.createdAt)} by {run.createdBy}
        </p>
        <Output run={run} />
        {out.note ? <p className="mt-space-sm font-body-sm text-on-surface-variant">{String(out.note)}</p> : null}
      </Box>
      <Box title="Evidence" testId="ai-evidence">
        <table className="w-full font-body-sm">
          <thead><tr><th className={cell}>Source</th><th className={cell}>Field</th><th className={cell}>Value</th></tr></thead>
          <tbody>
            {out.evidence.map((e, i) => (
              <tr key={i} className="border-t border-outline-variant">
                <td className={cell}>{e.source}</td><td className={cell}>{e.field}</td>
                <td className={cell}>{typeof e.value === "object" ? JSON.stringify(e.value) : String(e.value)}{e.rows ? ` (${e.rows})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      <DispositionPanel run={run} canRun={canRun} onChanged={onChanged} />
      <Box title="Audit" testId="ai-audit">
        <ul className="font-body-sm space-y-1">
          {run.audit.map((a, i) => <li key={i}>{when(a.at)} · {a.actor} ({a.role}) · {a.detail}</li>)}
        </ul>
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
    <Box title="Human disposition (advisory: a person decides)" testId="ai-disposition">
      {run.dispositions.length > 0 ? (
        <ul className="mb-space-sm space-y-1 font-body-sm" data-testid="ai-dispositions">
          {run.dispositions.map((d) => (
            <li key={d.id}>
              {when(d.at)} · <strong>{d.actor}</strong> ({d.role}): {d.decision}
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
          <fieldset className="flex gap-space-md font-body-sm">
            <legend className="font-label-md">Decision</legend>
            {(["accept", "override", "reject"] as const).map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input type="radio" name={`decision-${run.id}`} checked={decision === d} onChange={() => setDecision(d)} data-testid={`ai-decision-${d}`} /> {d}
              </label>
            ))}
          </fieldset>
          {decision === "override" ? (
            <label className="block font-label-md">{run.useCase === "helpdesk-assist" ? "Your reply" : "Your value"}
              <textarea className="mt-1 w-full rounded-lg border border-outline-variant p-space-xs" rows={3} value={value} onChange={(e) => setValue(e.target.value)} data-testid="ai-override-value" />
            </label>
          ) : null}
          <label className="block font-label-md">Reason {decision === "accept" ? "(optional)" : "(required)"}
            <textarea className="mt-1 w-full rounded-lg border border-outline-variant p-space-xs" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ai-reason" />
          </label>
          <button className="rounded-lg bg-primary px-space-md py-space-xs text-on-primary" onClick={submit} data-testid="ai-submit-disposition">Record disposition</button>
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
      <div className="mt-space-sm overflow-x-auto" data-testid="ai-output-risk">
        <table className="w-full font-body-sm">
          <thead><tr><th className={cell}>Organisation / model</th><th className={cell}>Score</th><th className={cell}>Band</th><th className={cell}>Contributions (weight)</th></tr></thead>
          <tbody>
            {ents.map((e) => (
              <tr key={e.key} className="border-t border-outline-variant">
                <td className={cell}>{e.name}{e.synthetic ? " [synthetic]" : ""}</td>
                <td className={cell}>{e.score}</td><td className={cell}>{e.band}</td>
                <td className={cell}>{e.features.filter((f) => f.contribution > 0).map((f) => `${f.feature}: ${f.value} → ${f.contribution}/${f.weight}`).join("; ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (run.useCase === "production-anomaly") {
    const series = (o.series as SeriesRow[]) ?? [];
    return (
      <div className="mt-space-sm space-y-space-sm" data-testid="ai-output-anomaly">
        {o.synthetic ? <p className="font-body-sm font-semibold">Synthetic production rows are shown (ai_demo_production): the live production table is absent or empty.</p> : null}
        {series.map((s) => (
          <div key={s.series} className="rounded-lg border border-outline-variant p-space-sm font-body-sm">
            <p><strong>{s.series}</strong> · {s.status}{s.boundSerials !== null ? ` · ${s.boundSerials} serials bound` : ""}</p>
            <p>{s.quarters.map((q) => `${q.quarter}: ${q.units} (z ${q.zVsOthers})`).join(" · ")}</p>
            {s.flags.map((f, i) => <p key={i} className="text-error">Flag {f.type} ({f.quarter}): {f.detail}</p>)}
          </div>
        ))}
      </div>
    );
  }
  if (run.useCase === "rating-trends") {
    const cats = (o.categories as TrendCat[]) ?? [];
    return (
      <div className="mt-space-sm space-y-space-sm" data-testid="ai-output-trends">
        <p className="font-body-sm">{String(o.realRatings)} real and {String(o.syntheticRatings)} synthetic ratings.</p>
        {cats.map((c) => {
          const max = Math.max(1, ...c.starDistribution);
          return (
            <div key={c.category} className="rounded-lg border border-outline-variant p-space-sm font-body-sm">
              <p><strong>{c.category}</strong> · {c.ratings} ratings · slope {c.slopePerMonth} per month · R² {c.rSquared}</p>
              <div className="flex items-end gap-1 h-12 my-1" aria-label={`Star distribution for ${c.category}`}>
                {c.starDistribution.map((n, i) => (
                  <div key={i} className="flex flex-col items-center"><div className="w-6 bg-primary" style={{ height: `${Math.max(2, (n / max) * 40)}px` }} /><span>{i + 1}★ {n}</span></div>
                ))}
              </div>
              <p>{c.months.map((m) => `${m.month}: ${m.meanIseer}`).join(" · ")}</p>
              {c.forecast ? <p>Next month: {c.forecast.nextMonthMeanIseer} (95% band {c.forecast.low95} to {c.forecast.high95})</p> : <p>Too few months for a forecast band.</p>}
            </div>
          );
        })}
      </div>
    );
  }
  if (run.useCase === "helpdesk-assist") {
    const top = (o.topAnswers as Answer[]) ?? [];
    return (
      <div className="mt-space-sm space-y-space-sm font-body-sm" data-testid="ai-output-helpdesk">
        <p>Suggested category: <strong>{String(o.suggestedCategory)}</strong>{o.escalateToHuman ? " · ESCALATE TO A PERSON (confidence under the threshold)" : ""}</p>
        <ol className="list-decimal pl-space-md">
          {top.map((a) => <li key={a.articleId}>{a.title} <span className="text-on-surface-variant">({a.category}, score {a.score})</span></li>)}
        </ol>
        <p className="rounded-lg bg-surface-container p-space-sm whitespace-pre-wrap" data-testid="ai-draft">Draft reply (not sent): {String(o.draftReply)}</p>
      </div>
    );
  }
  const fields = (o.fields as ExField[]) ?? [];
  return (
    <div className="mt-space-sm font-body-sm" data-testid="ai-output-extraction">
      <p>Application {String(o.applicationReference)} · text from: {String(o.textSource)}</p>
      <table className="w-full">
        <thead><tr><th className={cell}>Field</th><th className={cell}>Extracted</th><th className={cell}>Declared</th><th className={cell}>Status</th><th className={cell}>Confidence</th></tr></thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.field} className="border-t border-outline-variant">
              <td className={cell}>{f.field}</td><td className={cell}>{f.extracted ?? "not found"}</td><td className={cell}>{f.declared ?? "not declared"}</td>
              <td className={cell}>{f.status.replaceAll("_", " ")}</td><td className={cell}>{pct(f.confidence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
