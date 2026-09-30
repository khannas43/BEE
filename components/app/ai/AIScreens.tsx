"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { Module, Screen } from "@/lib/screens";
import { Card, ScreenChrome, Status, OK, WARN, BAD } from "@/components/app/ScreenScaffold";
import { ADVISORY_TEXT, AI_MODELS, AIModelState, modelLabel } from "@/lib/mock/certificate";
import { previewRoleOf, useRole } from "@/components/app/RoleContext";

/** The mandatory advisory-only disclaimer shown on every AI screen. */
export function AIDisclaimer() {
  return (
    <div className="flex items-start gap-space-sm bg-solar-gold-light/50 border border-solar-gold/40 rounded-xl p-space-sm" role="note">
      <Icon name="gavel" size={18} className="text-solar-gold-dark shrink-0 mt-0.5" />
      <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">Advisory decision support.</span> {ADVISORY_TEXT.replace("AI output is advisory decision support. ", "")}</p>
    </div>
  );
}

/* ================================================================== *
 * Shared AI primitives & mock data (Phase 2 — the five committed AI
 * use cases + model governance, each clearly differentiated).
 * ================================================================== */

export type ModelHealth = "healthy" | "monitor" | "retrain";

export interface AIUseCase {
  id: string;
  href: string;
  icon: string;
  title: string;
  purpose: string;
  recordsAnalysed: number;
  exceptions: number;
  awaitingReview: number;
  modelKey: string;              // → AI_MODELS (single source of state/version/lastRun)
  get lastRun(): string;
  get model(): string;
  get state(): string;           // Approved / Shadow / Retired
  status: ModelHealth;
}

/** Build a use case, deriving version/state/lastRun from the shared fixture. */
function useCase(u: Omit<AIUseCase, "lastRun" | "model" | "state" | "status">): AIUseCase {
  const m = AI_MODELS[u.modelKey];
  return {
    ...u,
    get lastRun() { return m.lastRun; },
    get model() { return modelLabel(m); },
    get state() { return m.state; },
    status: m.health,
  };
}

export const AI_USECASES: AIUseCase[] = [
  useCase({ id: "risk", href: "/app/mis-ai/risk-scoring", icon: "target", title: "Compliance Risk Scoring", purpose: "Prioritise manufacturers and models for enforcement attention.", recordsAnalysed: 1284, exceptions: 37, awaitingReview: 12, modelKey: "risk-rank" }),
  useCase({ id: "anomaly", href: "/app/mis-ai/production-anomaly", icon: "readiness_score", title: "Production Anomaly Detection", purpose: "Identify suspicious or statistically unusual production submissions.", recordsAnalysed: 9640, exceptions: 54, awaitingReview: 21, modelKey: "anomaly-iforest" }),
  useCase({ id: "document", href: "/app/mis-ai/extraction-review", icon: "document_scanner", title: "Document Intelligence", purpose: "Compare uploaded certificates and reports with entered data.", recordsAnalysed: 2170, exceptions: 88, awaitingReview: 30, modelKey: "doc-extract" }),
  useCase({ id: "helpdesk", href: "/app/mis-ai/chatbot-review", icon: "smart_toy", title: "Helpdesk Assistant", purpose: "Answer common questions and assist ticket routing.", recordsAnalysed: 5312, exceptions: 19, awaitingReview: 7, modelKey: "assist-rag" }),
  useCase({ id: "trends", href: "/app/mis-ai/rating-trends", icon: "trending_up", title: "Star-Rating Trend Analytics", purpose: "Support policy and star-threshold revision decisions.", recordsAnalysed: 41200, exceptions: 0, awaitingReview: 0, modelKey: "trend-stats" }),
];

export const HEALTH_META: Record<ModelHealth, { label: string; tone: string; icon: string }> = {
  healthy: { label: "Healthy", tone: OK, icon: "check_circle" },
  monitor: { label: "Monitor", tone: WARN, icon: "monitoring" },
  retrain: { label: "Retrain due", tone: BAD, icon: "warning" },
};

function AdvisoryBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-space-sm bg-solar-gold-light/60 border border-solar-gold/40 rounded-xl p-space-sm">
      <Icon name="info" size={18} className="text-solar-gold-dark shrink-0 mt-0.5" />
      <p className="font-body-sm text-body-sm text-on-surface">{text}</p>
    </div>
  );
}

function Bar({ label, value, max = 100, tone = "bg-primary", suffix = "" }: { label: string; value: number; max?: number; tone?: string; suffix?: string }) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant mb-0.5">
        <span>{label}</span><span className="text-on-surface font-semibold">{value}{suffix}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Confidence({ pct }: { pct: number }) {
  const tone = pct >= 85 ? "bg-tertiary" : pct >= 65 ? "bg-solar-gold-dark" : "bg-error";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-14 h-1.5 rounded-full bg-surface-container overflow-hidden inline-block">
        <span className={`h-full block rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-label-sm text-label-sm text-on-surface-variant">{pct}%</span>
    </span>
  );
}

function riskBand(score: number) {
  if (score >= 70) return { label: "High", tone: BAD };
  if (score >= 40) return { label: "Medium", tone: WARN };
  return { label: "Low", tone: OK };
}

function MiniKV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="font-label-sm text-label-sm text-on-surface-variant">{k}</div>
      <div className="font-label-md text-label-md text-on-surface font-semibold">{v}</div>
    </div>
  );
}

/* ================================================================== *
 * 1) COMPLIANCE RISK SCORING — ranks ENTITIES for enforcement.
 * ================================================================== */

interface RiskFactor { label: string; observed: string; direction: "up" | "down"; contribution: number; evidence: string; }
interface RiskEntity {
  id: string; name: string; kind: "Manufacturer" | "Model"; score: number; percentile: number; lastScored: string;
  factors: RiskFactor[];
  priorEnforcement: number; submissionDelays: number; qrAnomalies: number;
}

const RISK_ENTITIES: RiskEntity[] = [
  { id: "MFR-2231", name: "Nova Cool Appliances Ltd.", kind: "Manufacturer", score: 82, percentile: 98, lastScored: "24 Sep 2026, 06:15",
    factors: [
      { label: "QR verification anomalies", observed: "41 in 90 days", direction: "up", contribution: 28, evidence: "View events" },
      { label: "Delayed submissions", observed: "3 of last 3 quarters", direction: "up", contribution: 21, evidence: "View submissions" },
      { label: "Prior enforcement", observed: "2 confirmed cases", direction: "up", contribution: 18, evidence: "View cases" },
      { label: "Production mismatch", observed: "17.4% variance", direction: "up", contribution: 15, evidence: "View comparison" },
    ], priorEnforcement: 2, submissionDelays: 3, qrAnomalies: 41 },
  { id: "MDL-10233", name: "FrostMax 1.5T (5★)", kind: "Model", score: 74, percentile: 94, lastScored: "24 Sep 2026, 06:15",
    factors: [
      { label: "Cross-model ISEER outlier", observed: "2.1σ from peers", direction: "up", contribution: 30, evidence: "View comparison" },
      { label: "QR verification anomalies", observed: "27 in 90 days", direction: "up", contribution: 28, evidence: "View events" },
      { label: "Production spike", observed: "+286% QoQ", direction: "up", contribution: 22, evidence: "View comparison" },
      { label: "Late quarterly filing", observed: "2 of last 3 quarters", direction: "up", contribution: 20, evidence: "View submissions" },
    ], priorEnforcement: 1, submissionDelays: 2, qrAnomalies: 27 },
  { id: "MFR-1188", name: "Sunrise Electra Pvt. Ltd.", kind: "Manufacturer", score: 58, percentile: 81, lastScored: "24 Sep 2026, 06:15",
    factors: [
      { label: "Delayed submissions", observed: "3 of last 3 quarters", direction: "up", contribution: 40, evidence: "View submissions" },
      { label: "Document mismatch rate", observed: "9.2%", direction: "up", contribution: 32, evidence: "View comparison" },
      { label: "QR anomalies", observed: "12 in 90 days", direction: "up", contribution: 28, evidence: "View events" },
    ], priorEnforcement: 0, submissionDelays: 3, qrAnomalies: 12 },
  { id: "MDL-10871", name: "AquaBreeze 2T (3★)", kind: "Model", score: 37, percentile: 62, lastScored: "24 Sep 2026, 06:15",
    factors: [
      { label: "Minor label variance", observed: "1.1% variance", direction: "up", contribution: 55, evidence: "View comparison" },
      { label: "One late filing", observed: "1 of last 3 quarters", direction: "up", contribution: 45, evidence: "View submissions" },
    ], priorEnforcement: 0, submissionDelays: 1, qrAnomalies: 3 },
  { id: "MFR-3012", name: "GreenVolt Industries", kind: "Manufacturer", score: 24, percentile: 40, lastScored: "24 Sep 2026, 06:15",
    factors: [
      { label: "Isolated QR mismatch", observed: "2 in 90 days", direction: "up", contribution: 60, evidence: "View events" },
      { label: "Data completeness", observed: "99.1%", direction: "down", contribution: 40, evidence: "View submissions" },
    ], priorEnforcement: 0, submissionDelays: 0, qrAnomalies: 2 },
];

interface RecordedDisposition { officer: string; role: string; timestamp: string; decision: string; comments: string; auditRef: string; }
const DECISION_LABEL: Record<string, string> = {
  assess: "Open enforcement assessment (draft case)", monitor: "Keep under monitoring", dismiss: "Dismiss — false positive",
};

/* Entity-specific evidence behind each "View …" control. Rows are derived
 * deterministically from the selected entity so the same entity always shows
 * the same underlying events, and the scoring period is carried through. */
interface EvidenceTable { kind: string; note: string; columns: string[]; rows: string[][]; }

/* Demo "today". All evidence dates are on or before this — nothing in the
 * future. The current Indian-FY quarter (Jul–Sep 2026) is Q2 of FY2026-27. */
const DEMO_TODAY = new Date("2026-09-24T00:00:00");
const EV_PERIOD = "Q2 FY27 · Jul–Sep 2026";
const MS_DAY = 86_400_000;
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS_DAY);
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / MS_DAY);

/* Indian FY quarters ending on/before the demo date. The current quarter
 * (Q2 FY27) is still open. Filing is due 15 days after quarter close. */
const FY_QUARTERS = [
  { q: "Q3 FY26", period: "Oct–Dec 2025", due: new Date("2026-01-15T00:00:00"), open: false },
  { q: "Q4 FY26", period: "Jan–Mar 2026", due: new Date("2026-04-15T00:00:00"), open: false },
  { q: "Q1 FY27", period: "Apr–Jun 2026", due: new Date("2026-07-15T00:00:00"), open: false },
  { q: "Q2 FY27", period: "Jul–Sep 2026", due: new Date("2026-10-15T00:00:00"), open: true },
];

function evidenceFor(entity: RiskEntity, factor: RiskFactor): EvidenceTable {
  const seed = Number(entity.id.replace(/\D/g, "")) || 1;
  const pick = <T,>(arr: T[], i: number) => arr[(seed + i * 7) % arr.length];
  const locs = ["Pune", "Chennai", "Noida", "Ahmedabad", "Kochi", "Indore", "Jaipur", "Guwahati"];

  if (factor.evidence === "View events") {
    const total = entity.qrAnomalies;
    const shown = Math.min(total, 6);
    const verdicts = ["Duplicate serial", "Revoked-QR scan", "Serial not on ledger", "Region mismatch"];
    // Dates spread across the 90-day window, most-recent first, none in the future.
    const dates = Array.from({ length: shown }, (_, i) => addDays(DEMO_TODAY, -(2 + ((seed + i * 13) % 86))))
      .sort((a, b) => b.getTime() - a.getTime());
    const from = fmtDate(addDays(DEMO_TODAY, -90));
    return {
      kind: "QR verification anomalies",
      note: `${total} anomalous scans in the 90-day window (${from} – ${fmtDate(DEMO_TODAY)}). Each row below is a scan record — an anomaly flagged for review, not a confirmed violation.`,
      columns: ["Scan record", "Date", "QR serial", "Scan location", "Verdict"],
      rows: dates.map((d, i) => [
        `EV-${entity.id.replace(/\D/g, "")}-${100 + i}`,
        fmtDate(d),
        `QR-${(seed * 31 + i * 97) % 900000 + 100000}`,
        pick(locs, i),
        pick(verdicts, i),
      ]),
    };
  }
  if (factor.evidence === "View submissions") {
    // Late = filed after due; every "late by" is the real day difference and the
    // summary counts the late rows, so numbers can't contradict the records.
    const closed = FY_QUARTERS.filter((q) => !q.open).length;
    const lateWanted = Math.min(entity.submissionDelays, closed);
    let closedSeen = 0;
    const rows = FY_QUARTERS.map((qq) => {
      if (qq.open) return [`${qq.q} · ${qq.period}`, fmtDate(qq.due), "Not yet due", "Open"];
      const idx = closedSeen++;
      const isLate = idx >= closed - lateWanted;   // the most recent closed quarters are the late ones
      if (isLate) {
        const lateDays = ((seed + idx * 5) % 16) + 4;   // 4–19 days
        const filed = addDays(qq.due, lateDays);
        return [`${qq.q} · ${qq.period}`, fmtDate(qq.due), fmtDate(filed), `Late by ${daysBetween(filed, qq.due)} days`];
      }
      const early = ((seed + idx) % 6) + 1;
      return [`${qq.q} · ${qq.period}`, fmtDate(qq.due), fmtDate(addDays(qq.due, -early)), "On time"];
    });
    const lateActual = rows.filter((r) => r[3].startsWith("Late")).length;
    return {
      kind: "Quarterly production submissions",
      note: `${lateActual} of the last ${closed} due filings were late (the current quarter is not yet due). Filing is due 15 days after each quarter close.`,
      columns: ["Quarter", "Due date", "Filed on", "Status"],
      rows,
    };
  }
  if (factor.evidence === "View cases") {
    const n = entity.priorEnforcement;
    if (n === 0) return { kind: "Prior enforcement cases", note: "No confirmed enforcement cases on record for this entity.", columns: ["Case", "Opened", "Type", "Outcome"], rows: [] };
    const types = ["Label misuse", "Undeclared production", "Test-report discrepancy"];
    const outcomes = ["Penalty settled", "Corrective action closed"];
    return {
      kind: "Prior enforcement cases",
      note: `${n} confirmed case${n > 1 ? "s" : ""} closed in the previous 24 months. Historical context only — not part of the current period's score.`,
      columns: ["Case", "Opened", "Type", "Outcome"],
      rows: Array.from({ length: n }, (_, i) => [
        `ENF-2025-${(seed * 3 + i * 41) % 900 + 100}`,
        fmtDate(new Date(2025, [1, 4, 10][(seed + i) % 3], ((seed + i * 7) % 26) + 1)),
        pick(types, i),
        pick(outcomes, i),
      ]),
    };
  }
  // View comparison
  const declUnits = (seed * 137) % 40 + 10;
  const obsUnits = declUnits + (seed % 9) + 2;
  return {
    kind: "Declared vs observed comparison",
    note: `Portal-declared figures reconciled against ledger and test-lab records for ${EV_PERIOD}.`,
    columns: ["Metric", "Declared", "Observed", "Variance"],
    rows: [
      ["Units produced", `${declUnits}k`, `${obsUnits}k`, `+${Math.round(((obsUnits - declUnits) / declUnits) * 100)}%`],
      ["ISEER (rated vs test)", `${(3.6 + (seed % 5) / 10).toFixed(2)}`, `${(3.4 + (seed % 4) / 10).toFixed(2)}`, "Below rated"],
      ["QR activations vs units", `${declUnits}k`, `${declUnits - ((seed % 4) + 1)}k`, "Shortfall"],
    ],
  };
}

export function ComplianceRiskScoring({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const officer = previewRoleOf(role);
  const [selId, setSelId] = useState(RISK_ENTITIES[0].id);
  const [disposition, setDisposition] = useState("monitor");
  const [note, setNote] = useState("");
  // Dispositions persist across selections so the queue reflects officer work:
  // once an entity is dispositioned it leaves the "awaiting disposition" count.
  const [dispositions, setDispositions] = useState<Record<string, RecordedDisposition>>({});
  const [evidence, setEvidence] = useState<RiskFactor | null>(null);
  const sel = RISK_ENTITIES.find((e) => e.id === selId)!;
  const band = riskBand(sel.score);
  const recorded = dispositions[selId] ?? null;
  const awaiting = Math.max(0, 12 - Object.keys(dispositions).length);

  function select(id: string) { setSelId(id); setNote(""); setDisposition("monitor"); setEvidence(null); }
  function record() {
    if (!note.trim()) return;
    setDispositions((d) => ({
      ...d,
      [sel.id]: {
        officer: officer.name, role: officer.short, timestamp: new Date().toLocaleString("en-IN"),
        decision: DECISION_LABEL[disposition], comments: note.trim(),
        auditRef: `AUD-RISK-${sel.id}-${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    }));
    setNote(""); setDisposition("monitor");
  }
  function clearDisposition(id: string) { setDispositions((d) => { const n = { ...d }; delete n[id]; return n; }); }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Risk ranking of entities · model risk-rank v2.3">
      <AIDisclaimer />
      <AdvisoryBanner text="Scores rank entities for officer attention only. Opening an enforcement assessment creates a DRAFT case — it never initiates enforcement automatically." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
        {[
          { label: "Entities scored", value: "1,284", icon: "target", tone: "text-primary" },
          { label: "High-risk band", value: "37", icon: "priority_high", tone: "text-error" },
          { label: "Awaiting disposition", value: String(awaiting), icon: "how_to_reg", tone: "text-solar-gold-dark" },
          { label: "Data period", value: "Q2 FY27", icon: "calendar_month", tone: "text-success" },
        ].map((k) => (
          <div key={k.label} className="bg-surface-card rounded-xl shadow-sm p-space-md">
            <div className="flex items-center justify-between"><span className="font-label-sm text-label-sm text-on-surface-variant">{k.label}</span><Icon name={k.icon} size={18} className={k.tone} /></div>
            <div className={`font-headline-md text-headline-md font-bold ${k.tone} mt-1`}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-space-md">
        {/* Ranking */}
        <div className="lg:col-span-3">
          <Card title="Risk ranking">
            <div className="space-y-1.5">
              {RISK_ENTITIES.map((e, i) => {
                const b = riskBand(e.score);
                const active = e.id === selId;
                const done = dispositions[e.id];
                return (
                  <button key={e.id} type="button" onClick={() => select(e.id)}
                    className={`w-full flex items-center gap-space-sm p-space-sm rounded-lg text-left transition-colors ${active ? "bg-primary-container/40 ring-1 ring-primary" : "bg-surface-container-low hover:bg-surface-container"}`}>
                    <span className="font-headline-sm text-headline-sm font-bold text-on-surface-variant w-6 text-center">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-title-sm text-title-sm text-on-surface truncate">{e.name}</div>
                      <div className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
                        <span>{e.kind} · {e.id}</span>
                        {done && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-success-light text-success font-label-sm text-label-sm"><Icon name="check_circle" size={11} fill /> Dispositioned</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-headline-sm text-headline-sm font-bold text-on-surface">{e.score}</div>
                      <Status label={done ? "Cleared" : b.label} tone={done ? OK : b.tone} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Selected assessment */}
        <div className="lg:col-span-2 space-y-space-md">
          <Card title={sel.name} action={<Status label={`${band.label} · ${sel.score}`} tone={band.tone} />}>
            <div className="grid grid-cols-2 gap-x-space-md gap-y-1.5 mb-space-md">
              <MiniKV k="Entity type" v={sel.kind} />
              <MiniKV k="Entity ID" v={sel.id} />
              <MiniKV k="Risk score" v={`${sel.score} / 100`} />
              <MiniKV k="Population percentile" v={`${sel.percentile}th`} />
              <MiniKV k="Scoring period" v="Q2 FY27" />
              <MiniKV k="Last scored" v={sel.lastScored} />
              <MiniKV k="Model / version" v="risk-rank v2.3" />
              <MiniKV k="Data freshness" v="Refreshed 24 Sep, 06:15" />
            </div>
            <div className="flex items-center gap-space-sm mb-space-md font-label-sm text-label-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">Thresholds:</span>
              <span className="px-1.5 py-0.5 rounded bg-success-light text-success">Low &lt; 40</span>
              <span className="px-1.5 py-0.5 rounded bg-solar-gold-light text-solar-gold-dark">Medium 40–69</span>
              <span className="px-1.5 py-0.5 rounded bg-error-container text-on-error-container">High ≥ 70</span>
            </div>

            <div className="font-label-md text-label-md text-on-surface font-semibold mb-space-sm">Score explanation</div>
            <div className="overflow-x-auto app-scroll">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-subtle">
                    {["Factor", "Observed", "Impact", "Contribution", "Evidence"].map((h) => <th key={h} className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide py-1.5 pr-space-sm whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sel.factors.map((f) => (
                    <tr key={f.label} className="border-b border-border-subtle/60">
                      <td className="py-2 pr-space-sm font-body-sm text-body-sm text-on-surface">{f.label}</td>
                      <td className="py-2 pr-space-sm font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">{f.observed}</td>
                      <td className="py-2 pr-space-sm"><span className={`inline-flex items-center gap-0.5 font-label-sm text-label-sm ${f.direction === "up" ? "text-error" : "text-success"}`}><Icon name={f.direction === "up" ? "arrow_upward" : "arrow_downward"} size={13} /> {f.direction === "up" ? "Increases" : "Reduces"}</span></td>
                      <td className="py-2 pr-space-sm font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap">{f.direction === "up" ? "+" : "−"}{f.contribution}</td>
                      <td className="py-2 pr-space-sm"><button type="button" onClick={() => setEvidence(f)} className="inline-flex items-center gap-0.5 font-label-sm text-label-sm text-primary hover:underline"><Icon name="open_in_new" size={13} /> {f.evidence}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {recorded ? (
            <Card title="Recorded disposition" action={<Status label="Logged" tone={OK} />}>
              <div className="space-y-1.5">
                <MiniKV k="Officer" v={recorded.officer} />
                <MiniKV k="Role" v={recorded.role} />
                <MiniKV k="Timestamp" v={recorded.timestamp} />
                <MiniKV k="Decision" v={recorded.decision} />
                <div><div className="font-label-sm text-label-sm text-on-surface-variant">Comments</div><div className="font-body-sm text-body-sm text-on-surface">{recorded.comments}</div></div>
                <MiniKV k="Audit reference" v={recorded.auditRef} />
              </div>
              {recorded.decision.startsWith("Open enforcement") && (
                <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-sm mt-space-sm">
                  <Icon name="draft" size={16} className="text-solar-gold-dark shrink-0 mt-0.5" />
                  <p className="font-body-sm text-body-sm text-on-surface">A <span className="font-semibold">draft</span> enforcement case was created for officer review. Enforcement is not initiated automatically. <Link href="/app/enforcement/case" className="text-primary hover:underline">Open case workspace</Link>.</p>
                </div>
              )}
              <button type="button" onClick={() => clearDisposition(selId)} className="mt-space-sm font-label-sm text-label-sm text-primary hover:underline">Reopen — record a different disposition</button>
            </Card>
          ) : (
            <Card title="Officer disposition">
              <label className="font-label-sm text-label-sm text-on-surface-variant">Decision</label>
              <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className="w-full mt-1 mb-space-sm px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none">
                <option value="assess">Open enforcement assessment</option>
                <option value="monitor">Keep under monitoring</option>
                <option value="dismiss">Dismiss — false positive</option>
              </select>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comments are required and recorded in the audit trail…" rows={3} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none resize-none" />
              <button type="button" onClick={record} disabled={!note.trim()}
                className={`w-full mt-space-sm flex items-center justify-center gap-1.5 font-label-md text-label-md font-semibold py-2 rounded-lg ${note.trim() ? "bg-primary text-on-primary hover:bg-forest-dark" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}>
                <Icon name="assignment_turned_in" size={16} /> Record disposition
              </button>
              {!note.trim() && <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">Comments are required before a disposition can be recorded.</p>}
            </Card>
          )}
        </div>
      </div>

      {evidence && <EvidenceDrawer entity={sel} factor={evidence} onClose={() => setEvidence(null)} />}
    </ScreenChrome>
  );
}

function EvidenceDrawer({ entity, factor, onClose }: { entity: RiskEntity; factor: RiskFactor; onClose: () => void }) {
  const ev = evidenceFor(entity, factor);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card shadow-2xl h-full overflow-y-auto app-scroll">
        <div className="sticky top-0 bg-surface-card border-b border-border-subtle p-space-md flex items-start justify-between gap-space-sm">
          <div>
            <div className="font-label-sm text-label-sm text-on-surface-variant">{ev.kind}</div>
            <h3 className="font-title-lg text-title-lg text-on-surface">{factor.label}</h3>
            <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">{entity.name} · {entity.id} · {EV_PERIOD}</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center shrink-0"><Icon name="close" size={18} /></button>
        </div>
        <div className="p-space-md space-y-space-md">
          <div className="grid grid-cols-3 gap-space-sm">
            <MiniKV k="Observed" v={factor.observed} />
            <MiniKV k="Impact" v={factor.direction === "up" ? "Increases score" : "Reduces score"} />
            <MiniKV k="Contribution" v={`${factor.direction === "up" ? "+" : "−"}${factor.contribution}`} />
          </div>
          <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-sm">
            <Icon name="info" size={16} className="text-primary shrink-0 mt-0.5" />
            <p className="font-body-sm text-body-sm text-on-surface-variant">{ev.note}</p>
          </div>
          {ev.rows.length > 0 ? (
            <div className="overflow-x-auto app-scroll rounded-lg border border-border-subtle">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low">
                    {ev.columns.map((h) => <th key={h} className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide py-2 px-space-sm whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ev.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border-subtle/60">
                      {r.map((cell, j) => <td key={j} className={`py-2 px-space-sm font-body-sm text-body-sm whitespace-nowrap ${j === 0 ? "font-mono text-on-surface" : "text-on-surface-variant"} ${/late|below|shortfall|mismatch|duplicate|revoked|not on ledger/i.test(cell) ? "text-error" : ""} ${/on time|settled|closed/i.test(cell) ? "text-success" : ""}`}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-space-lg text-on-surface-variant"><Icon name="inventory_2" size={28} /><p className="font-body-sm text-body-sm mt-1">{ev.note}</p></div>
          )}
          <p className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1"><Icon name="shield" size={13} /> Evidence is advisory context for officer review. It is not a confirmed violation and does not change the entity’s status.</p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * 2) PRODUCTION ANOMALY DETECTION — investigates unusual RECORDS.
 * ================================================================== */

type AnomalyType = "Duplicate pattern" | "Quantity deviation" | "Cross-model similarity" | "Period spike";

interface Anomaly {
  id: string; model: string; manufacturer: string; category: string; type: AnomalyType; confidence: number; period: string;
  observed: number; expected: number; peerAvg: number; execId: string; note: string; records: string[];
}

const ANOMALIES: Anomaly[] = [
  { id: "PRD-88213", model: "FrostMax 1.5T (5★)", manufacturer: "Nova Cool Appliances Ltd.", category: "Room Air Conditioner", type: "Period spike", confidence: 92, period: "Q2 FY27", observed: 48200, expected: 12500, peerAvg: 13800, execId: "EXE-2026-0731", note: "286% above trailing 4-quarter mean.", records: ["PROD-Q2-88213", "SER-10016-4xxx"] },
  { id: "PRD-88190", model: "CoolWave 1T (4★)", manufacturer: "Sunrise Electra Pvt. Ltd.", category: "Room Air Conditioner", type: "Duplicate pattern", confidence: 88, period: "Q2 FY27", observed: 15000, expected: 15000, peerAvg: 9200, execId: "EXE-2026-0731", note: "Identical serial batch submitted twice.", records: ["PROD-Q2-88190", "PROD-Q1-88041"] },
  { id: "PRD-88155", model: "AquaBreeze 2T (3★)", manufacturer: "GreenVolt Industries", category: "Room Air Conditioner", type: "Cross-model similarity", confidence: 76, period: "Q2 FY27", observed: 9800, expected: 6100, peerAvg: 6400, execId: "EXE-2026-0731", note: "Serial ranges overlap a different model family.", records: ["PROD-Q2-88155", "SER-10041-2xxx"] },
  { id: "PRD-88122", model: "PolarPro 2T (5★)", manufacturer: "PolarPro Appliances", category: "Room Air Conditioner", type: "Quantity deviation", confidence: 69, period: "Q2 FY27", observed: 300, expected: 8200, peerAvg: 7600, execId: "EXE-2026-0731", note: "96% below expected — possible under-reporting.", records: ["PROD-Q2-88122"] },
];

const ANO_TONE: Record<AnomalyType, string> = {
  "Period spike": "bg-error-container text-on-error-container",
  "Duplicate pattern": "bg-navy-subtle text-navy-dark",
  "Cross-model similarity": "bg-solar-gold-light text-solar-gold-dark",
  "Quantity deviation": "bg-secondary-fixed text-on-secondary-fixed",
};

interface AnomalyOutcome { status: string; officer: string; timestamp: string; reason: string; assignee: string; dueDate: string; auditRef: string; linkedCase?: string; }

export function ProductionAnomalyDetection({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const officer = previewRoleOf(role);
  const [selId, setSelId] = useState(ANOMALIES[0].id);
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState("IAME North — A. Kapoor");
  const [dueDate, setDueDate] = useState("30 Sep 2026");
  const [outcome, setOutcome] = useState<AnomalyOutcome | null>(null);
  const sel = ANOMALIES.find((a) => a.id === selId)!;
  const max = Math.max(sel.observed, sel.expected, sel.peerAvg);

  function select(id: string) { setSelId(id); setReason(""); setOutcome(null); }
  function dispatch(status: string) {
    if (!reason.trim()) return;
    setOutcome({
      status, officer: officer.name, timestamp: new Date().toLocaleString("en-IN"), reason: reason.trim(),
      assignee, dueDate, auditRef: `AUD-ANOM-${sel.id}-${Math.floor(Math.random() * 9000 + 1000)}`,
      linkedCase: status === "Confirmed exception" ? "ENF-2026-0431 (draft)" : status === "Assigned for investigation" ? "INV-2026-0208" : undefined,
    });
  }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Anomaly queue · model anomaly-iforest v1.8">
      <AIDisclaimer />
      <AdvisoryBanner text="Flagged records are statistically unusual, not proven violations. Each anomaly must be investigated and marked valid or confirmed by an officer before any action." />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-space-md">
        {/* Queue */}
        <div className="lg:col-span-2">
          <Card title={`Anomaly queue · ${ANOMALIES.length}`}>
            <div className="space-y-1.5">
              {ANOMALIES.map((a) => {
                const active = a.id === selId;
                return (
                  <button key={a.id} type="button" onClick={() => select(a.id)}
                    className={`w-full text-left p-space-sm rounded-lg transition-colors ${active ? "bg-primary-container/40 ring-1 ring-primary" : "bg-surface-container-low hover:bg-surface-container"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-label-sm text-label-sm text-on-surface-variant">{a.id}</span>
                      <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${ANO_TONE[a.type]}`}>{a.type}</span>
                    </div>
                    <div className="font-title-sm text-title-sm text-on-surface mt-0.5">{a.model}</div>
                    <div className="mt-1"><Confidence pct={a.confidence} /></div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Investigation */}
        <div className="lg:col-span-3 space-y-space-md">
          <Card title={`Record ${sel.id}`} action={<span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${ANO_TONE[sel.type]}`}>{sel.type}</span>}>
            <div className="font-title-md text-title-md text-on-surface">{sel.model}</div>
            <div className="font-label-sm text-label-sm text-on-surface-variant mb-space-md">{sel.manufacturer} · statistical confidence {sel.confidence}%</div>
            <div className="grid grid-cols-2 gap-x-space-md gap-y-1.5 mb-space-md">
              <MiniKV k="Manufacturer" v={sel.manufacturer} />
              <MiniKV k="Appliance category" v={sel.category} />
              <MiniKV k="Reporting period" v={sel.period} />
              <MiniKV k="Anomaly type" v={sel.type} />
              <MiniKV k="Detection execution ID" v={sel.execId} />
              <MiniKV k="Model / version" v="anomaly-iforest v1.8" />
            </div>

            <div className="font-label-md text-label-md text-on-surface font-semibold mb-space-sm">Observed vs expected vs peers</div>
            <div className="space-y-space-sm">
              <Bar label="This submission" value={sel.observed} max={max} tone="bg-error" />
              <Bar label="Expected (4-qtr trend)" value={sel.expected} max={max} tone="bg-primary" />
              <Bar label="Category peer average" value={sel.peerAvg} max={max} tone="bg-tertiary" />
            </div>
            <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-sm mt-space-md">
              <Icon name="lightbulb" size={16} className="text-solar-gold-dark shrink-0 mt-0.5" />
              <p className="font-body-sm text-body-sm text-on-surface">{sel.note}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-space-sm">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Affected records:</span>
              {sel.records.map((r) => <button key={r} type="button" className="font-label-sm text-label-sm text-primary bg-surface-container-low px-2 py-0.5 rounded hover:underline">{r}</button>)}
            </div>
          </Card>

          {outcome ? (
            <Card title="Disposition recorded" action={<Status label={outcome.status} tone={outcome.status.includes("exception") ? BAD : outcome.status.includes("valid") ? OK : WARN} />}>
              <div className="grid grid-cols-2 gap-1.5">
                <MiniKV k="Officer" v={outcome.officer} />
                <MiniKV k="Timestamp" v={outcome.timestamp} />
                <MiniKV k="Assignee" v={outcome.assignee} />
                <MiniKV k="Due date" v={outcome.dueDate} />
                <MiniKV k="Investigation status" v={outcome.status} />
                <MiniKV k="Audit reference" v={outcome.auditRef} />
              </div>
              <div className="mt-space-sm"><div className="font-label-sm text-label-sm text-on-surface-variant">Reason</div><div className="font-body-sm text-body-sm text-on-surface">{outcome.reason}</div></div>
              {outcome.linkedCase && <p className="font-label-sm text-label-sm text-on-surface mt-space-sm flex items-center gap-1"><Icon name="link" size={14} className="text-primary" /> Linked case: <span className="font-semibold">{outcome.linkedCase}</span></p>}
              <button type="button" onClick={() => setOutcome(null)} className="mt-space-sm font-label-sm text-label-sm text-primary hover:underline">Record a different disposition</button>
            </Card>
          ) : (
            <Card title="Disposition">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm mb-space-sm">
                <div><label className="font-label-sm text-label-sm text-on-surface-variant">Assignee</label><input value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full mt-0.5 px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" /></div>
                <div><label className="font-label-sm text-label-sm text-on-surface-variant">Due date</label><input value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full mt-0.5 px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none" /></div>
              </div>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Disposition reason (required, recorded in audit trail)…" rows={2} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none resize-none" />
              <div className="flex flex-wrap gap-space-sm mt-space-sm">
                <button type="button" disabled={!reason.trim()} onClick={() => dispatch("Assigned for investigation")} className={`flex items-center gap-1.5 font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg ${reason.trim() ? "bg-primary text-on-primary hover:bg-forest-dark" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}><Icon name="person_search" size={16} /> Assign for investigation</button>
                <button type="button" disabled={!reason.trim()} onClick={() => dispatch("Marked valid")} className={`flex items-center gap-1.5 font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg ${reason.trim() ? "bg-success-light text-success hover:bg-tertiary hover:text-on-primary" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}><Icon name="check_circle" size={16} /> Mark valid</button>
                <button type="button" disabled={!reason.trim()} onClick={() => dispatch("Confirmed exception")} className={`flex items-center gap-1.5 font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg ${reason.trim() ? "bg-error-container text-on-error-container hover:bg-error hover:text-on-error" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}><Icon name="report" size={16} /> Confirm exception</button>
              </div>
              {!reason.trim() && <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">A reason is required for every disposition.</p>}
            </Card>
          )}
        </div>
      </div>
    </ScreenChrome>
  );
}

/* ================================================================== *
 * 3) DOCUMENT INTELLIGENCE — split screen doc vs extracted fields.
 * ================================================================== */

interface ExtractedField { field: string; entered: string; extracted: string; ocr: number; confidence: number; page: number; }

const DOC_FIELDS: ExtractedField[] = [
  { field: "Brand / manufacturer", entered: "Nova Cool Appliances Ltd.", extracted: "Nova Cool Appliances Ltd.", ocr: 99, confidence: 98, page: 1 },
  { field: "Model number", entered: "FM-15TC5", extracted: "FM-15TC5", ocr: 98, confidence: 97, page: 1 },
  { field: "Declared ISEER", entered: "5.10", extracted: "4.90", ocr: 93, confidence: 88, page: 2 },
  { field: "Cooling capacity (W)", entered: "5000", extracted: "5000", ocr: 97, confidence: 96, page: 2 },
  { field: "Test laboratory", entered: "NABL-DEL-002", extracted: "NABL-DEL-020", ocr: 82, confidence: 71, page: 3 },
  { field: "Test report date", entered: "01 Sep 2026", extracted: "01 Sep 2026", ocr: 95, confidence: 94, page: 3 },
];

const DOC_META = { filename: "TEST-REPORT-FM15TC5.pdf", version: "v1 (uploaded)", sha256: "5b2d1f8a3c94e07b6d15aef2839c40b71e6a5d9c2f83b04e7a1c6d59f2b83a10", simulated: true };
type Dispo = "accept" | "correct" | "clarify";

export function DocumentIntelligence({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const officer = previewRoleOf(role);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [dispo, setDispo] = useState<Record<string, Dispo>>({});
  const [done, setDone] = useState<null | { reviewer: string; ts: string; corrections: number; clarifications: number; auditRef: string }>(null);

  const mismatches = DOC_FIELDS.filter((f) => f.entered !== f.extracted);
  const allDispositioned = mismatches.every((f) => dispo[f.field]);

  function setField(field: string, page: number) { setSel(field); setPage(page); }
  function complete() {
    if (!allDispositioned) return;
    const vals = Object.values(dispo);
    setDone({
      reviewer: officer.name, ts: new Date().toLocaleString("en-IN"),
      corrections: vals.filter((d) => d === "correct").length,
      clarifications: vals.filter((d) => d === "clarify").length,
      auditRef: `AUD-DOC-${Math.floor(Math.random() * 9000 + 1000)}`,
    });
  }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Certificate vs entered data · model doc-extract v3.1">
      <AIDisclaimer />
      <div className="flex flex-wrap items-center gap-space-md">
        <div className="flex items-center gap-1.5 font-label-md text-label-md"><span className="w-2.5 h-2.5 rounded-full bg-error inline-block" /> {mismatches.length} field mismatches</div>
        <div className="flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant"><span className="w-2.5 h-2.5 rounded-full bg-tertiary inline-block" /> {DOC_FIELDS.length - mismatches.length} matched</div>
        <span className="font-label-sm text-label-sm text-on-surface-variant">{DOC_META.filename} · {DOC_META.version}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        {/* Left: document preview */}
        <Card title="Uploaded document" action={
          <div className="flex items-center gap-space-sm font-label-sm text-label-sm">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} className="text-on-surface-variant hover:text-primary" aria-label="Previous page"><Icon name="chevron_left" size={18} /></button>
            <span>Page {page} / 3</span>
            <button type="button" onClick={() => setPage((p) => Math.min(3, p + 1))} className="text-on-surface-variant hover:text-primary" aria-label="Next page"><Icon name="chevron_right" size={18} /></button>
          </div>
        }>
          <div className="aspect-[3/4] bg-surface-container-low rounded-lg border border-border-subtle p-space-md overflow-hidden">
            <div className="h-full flex flex-col">
              <div className="text-center border-b border-border-subtle pb-space-sm mb-space-sm">
                <div className="font-title-md text-title-md text-on-surface">TEST REPORT</div>
                <div className="font-label-sm text-label-sm text-on-surface-variant">NABL-accredited laboratory · Page {page}</div>
              </div>
              <div className="space-y-2 flex-1">
                {DOC_FIELDS.filter((f) => f.page === page).map((f) => {
                  const mm = f.entered !== f.extracted;
                  const active = sel === f.field;
                  return (
                    <div key={f.field} className={`p-space-sm rounded-lg transition-all ${active ? "ring-2 ring-primary bg-primary-container/30" : mm ? "bg-error-container/50 ring-1 ring-error/40" : "bg-surface-card"}`}>
                      <div className="font-label-sm text-label-sm text-on-surface-variant">{f.field}</div>
                      <div className="font-body-md text-body-md text-on-surface font-semibold">{f.extracted}</div>
                    </div>
                  );
                })}
                {DOC_FIELDS.filter((f) => f.page === page).length === 0 && (
                  <div className="text-center font-label-sm text-label-sm text-on-surface-variant pt-space-lg">No extracted fields on this page.</div>
                )}
              </div>
              <div className="text-center font-label-sm text-label-sm text-on-surface-variant/60 border-t border-border-subtle pt-space-sm">Selecting a field highlights its source region.</div>
            </div>
          </div>
          <div className="mt-space-sm space-y-1">
            <div className="flex items-start justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant">Document version</span><span className="font-label-md text-label-md text-on-surface">{DOC_META.version}</span></div>
            <div><div className="font-label-sm text-label-sm text-on-surface-variant">SHA-256 <span className="text-solar-gold-dark">· simulated fixture</span></div><div className="font-mono text-label-sm break-all text-on-surface-variant">{DOC_META.sha256}</div></div>
          </div>
        </Card>

        {/* Right: extracted fields */}
        <Card title="Extracted vs entered">
          <div className="space-y-space-sm">
            {DOC_FIELDS.map((f) => {
              const mismatch = f.entered !== f.extracted;
              const d = dispo[f.field];
              return (
                <button type="button" key={f.field} onClick={() => setField(f.field, f.page)} className={`w-full text-left rounded-lg p-space-sm transition-all ${sel === f.field ? "ring-2 ring-primary" : ""} ${mismatch ? "bg-error-container/40" : "bg-surface-container-low"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-md text-label-md text-on-surface font-semibold">{f.field}</span>
                    <span className="font-label-sm text-label-sm text-primary">p.{f.page}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-space-sm">
                    <div><div className="font-label-sm text-label-sm text-on-surface-variant">Entered</div><div className={`font-body-sm text-body-sm ${mismatch ? "text-error font-semibold" : "text-on-surface"}`}>{f.entered}</div></div>
                    <div><div className="font-label-sm text-label-sm text-on-surface-variant">Extracted</div><div className={`font-body-sm text-body-sm ${mismatch ? "text-error font-semibold" : "text-on-surface"}`}>{f.extracted}</div></div>
                  </div>
                  <div className="flex items-center gap-space-md mt-space-sm">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">OCR</span><Confidence pct={f.ocr} />
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Extract</span><Confidence pct={f.confidence} />
                  </div>
                  {mismatch ? (
                    <div className="flex flex-wrap gap-1.5 mt-space-sm">
                      {([["accept", "Accept entered"], ["correct", "Correct"], ["clarify", "Request clarification"]] as [Dispo, string][]).map(([key, lbl]) => (
                        <span key={key} onClick={(e) => { e.stopPropagation(); setDispo((m) => ({ ...m, [f.field]: key })); }}
                          className={`font-label-sm text-label-sm px-2 py-1 rounded cursor-pointer ${d === key ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface hover:bg-forest-light"}`}>{lbl}</span>
                      ))}
                      {d && <span className="font-label-sm text-label-sm text-success flex items-center gap-1"><Icon name="check" size={13} /> set</span>}
                    </div>
                  ) : (
                    <span className="font-label-sm text-label-sm text-success flex items-center gap-1 mt-space-sm"><Icon name="check" size={14} /> Match</span>
                  )}
                </button>
              );
            })}
          </div>

          {done ? (
            <div className="mt-space-md bg-forest-light/50 rounded-lg p-space-md">
              <div className="flex items-center gap-space-sm mb-space-sm"><Icon name="task_alt" size={20} className="text-success" /><span className="font-title-sm text-title-sm text-on-surface font-semibold">Review complete</span></div>
              <div className="grid grid-cols-2 gap-1.5">
                <MiniKV k="Reviewer" v={done.reviewer} />
                <MiniKV k="Reviewed at" v={done.ts} />
                <MiniKV k="Corrections made" v={String(done.corrections)} />
                <MiniKV k="Clarifications requested" v={String(done.clarifications)} />
                <MiniKV k="Model / version" v="doc-extract v3.1" />
                <MiniKV k="Audit reference" v={done.auditRef} />
              </div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">Corrections are stored only as <span className="font-semibold">candidate supervised feedback pending governance approval</span> — they are not used for model retraining automatically.</p>
            </div>
          ) : (
            <div className="mt-space-md border-t border-border-subtle pt-space-sm">
              <button type="button" onClick={complete} disabled={!allDispositioned}
                className={`w-full flex items-center justify-center gap-1.5 font-label-md text-label-md font-semibold py-2 rounded-lg ${allDispositioned ? "bg-primary text-on-primary hover:bg-forest-dark" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}>
                <Icon name="fact_check" size={16} /> Complete review
              </button>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{allDispositioned ? "All mismatches have a disposition." : `Disposition all ${mismatches.length} mismatches to enable completion.`} Extraction model doc-extract v3.1.</p>
            </div>
          )}
        </Card>
      </div>
    </ScreenChrome>
  );
}

/* ================================================================== *
 * 4) HELPDESK AI ASSISTANT — conversation + routing assist.
 * ================================================================== */

const THRESHOLD = 70;

export function HelpdeskAssistant({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const agent = previewRoleOf(role);
  const [reply, setReply] = useState(
    "You can verify a BEE star label by scanning the QR code on the appliance, or by entering the registration number at bee-portal /verify. A genuine label returns the brand, model and star rating."
  );
  const model = AI_MODELS["assist-rag"];
  const [simLow, setSimLow] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sent, setSent] = useState(false);
  const [liveMode, setLiveMode] = useState(model.live);  // Shadow model → sending disabled by default
  const canAuthorise = GOV_ACTORS.has(role);             // only model admins may promote to live
  const confidence = simLow ? 58 : 82;
  const lowConf = confidence < THRESHOLD;
  const canSend = liveMode;

  const transcript = [
    { who: "user", text: "How do I check if a star label on my new AC is genuine?" },
    { who: "ai", text: "You can scan the QR code on the label to verify it instantly." },
    { who: "user", text: "There is no QR, only a registration number BEE/RAC/2026/10016. Call me on +91 98•••••210." },
  ];

  return (
    <ScreenChrome module={module} screen={screen} subtitle={`Conversation + routing assist · ${modelLabel(model)} · ${model.state}`}>
      <AIDisclaimer />
      {!liveMode && (
        <div className="flex flex-wrap items-center gap-space-sm bg-navy-subtle border border-navy-dark/20 rounded-xl p-space-sm" role="note">
          <Icon name="science" size={18} className="text-navy-dark shrink-0" />
          <p className="font-body-sm text-body-sm text-on-surface flex-1"><span className="font-semibold">Shadow model ({modelLabel(model)}).</span> Evaluation and feedback only — the assistant cannot send a response to a user until it is promoted to Live in model governance.</p>
          {canAuthorise ? (
            <label className="flex items-center gap-1.5 font-label-sm text-label-sm text-navy-dark cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} className="accent-primary" /> Authorise live (demo)
            </label>
          ) : (
            <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-navy-dark whitespace-nowrap"><Icon name="lock" size={13} /> Only a model administrator can promote this model</span>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-space-md">
        {/* Transcript */}
        <div className="lg:col-span-3">
          <Card title="Conversation transcript" action={
            <label className="flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant cursor-pointer">
              <input type="checkbox" checked={simLow} onChange={(e) => { setSimLow(e.target.checked); setPreview(false); setSent(false); }} className="accent-primary" /> Simulate low confidence
            </label>
          }>
            <div className="space-y-space-sm">
              {transcript.map((m, i) => (
                <div key={i} className={`flex ${m.who === "user" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[80%] p-space-sm rounded-xl font-body-sm text-body-sm ${m.who === "user" ? "bg-surface-container-low text-on-surface rounded-tl-none" : "bg-primary-container/50 text-on-surface rounded-tr-none"}`}>
                    <div className="font-label-sm text-label-sm text-on-surface-variant mb-0.5">{m.who === "user" ? "Citizen" : "AI assistant"}</div>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm flex items-center gap-1"><Icon name="visibility_off" size={13} /> Personal information is masked in the transcript and audit log.</p>

            <div className="mt-space-md border-t border-border-subtle pt-space-md">
              {lowConf ? (
                <div className="bg-solar-gold-light/50 border border-solar-gold/40 rounded-lg p-space-md">
                  <div className="flex items-center gap-space-sm mb-1"><Icon name="warning" size={18} className="text-solar-gold-dark" /><span className="font-title-sm text-title-sm text-on-surface font-semibold">Confidence is insufficient</span><Confidence pct={confidence} /></div>
                  <p className="font-body-sm text-body-sm text-on-surface">No authoritative response is generated below the {THRESHOLD}% threshold. Escalation to a human agent is recommended.</p>
                  <button type="button" className="mt-space-sm flex items-center gap-1.5 bg-solar-gold-light text-solar-gold-dark font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-solar-gold hover:text-on-primary"><Icon name="support_agent" size={16} /> Escalate to human</button>
                </div>
              ) : sent ? (
                <div className="bg-forest-light/50 rounded-lg p-space-md">
                  <div className="flex items-center gap-space-sm"><Icon name="mark_email_read" size={20} className="text-success" /><span className="font-title-sm text-title-sm text-on-surface font-semibold">Sent by {agent.name}</span></div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">The helpdesk agent is the sender of record. AI assisted with the draft only.</p>
                </div>
              ) : preview ? (
                <div className="border border-primary/40 rounded-lg p-space-md bg-primary-container/20">
                  <div className="font-label-md text-label-md text-on-surface font-semibold mb-space-sm">Confirm &amp; send — editable preview</div>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} className="w-full px-space-sm py-2 rounded-lg bg-surface-card font-body-sm text-body-sm outline-none resize-none" />
                  <div className="flex items-center justify-between mt-space-sm">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Sender of record: <span className="font-semibold text-on-surface">{agent.name}</span></span>
                    <div className="flex gap-space-sm">
                      <button type="button" onClick={() => setPreview(false)} className="font-label-md text-label-md text-on-surface bg-surface-container py-1.5 px-space-sm rounded-lg hover:bg-forest-light">Cancel</button>
                      <button type="button" onClick={() => setSent(true)} className="flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-1.5 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="send" size={16} /> Confirm send</button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-space-sm">
                    <span className="font-label-md text-label-md text-on-surface font-semibold">Suggested response</span>
                    <Confidence pct={confidence} />
                  </div>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none resize-none" />
                  <div className="flex flex-wrap gap-space-sm mt-space-sm">
                    <button type="button" disabled={!canSend} onClick={() => canSend && setPreview(true)} title={canSend ? "" : "Shadow model — cannot send to a user"} className={`flex items-center gap-1.5 font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg ${canSend ? "bg-primary text-on-primary hover:bg-forest-dark" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}><Icon name={canSend ? "send" : "lock"} size={16} /> Accept &amp; send</button>
                    <button type="button" className="flex items-center gap-1.5 bg-surface-container text-on-surface font-label-md text-label-md py-2 px-space-md rounded-lg hover:bg-forest-light"><Icon name="edit" size={16} /> Edit</button>
                    <button type="button" className="flex items-center gap-1.5 bg-surface-container text-on-surface font-label-md text-label-md py-2 px-space-md rounded-lg hover:bg-error-container"><Icon name="block" size={16} /> Reject</button>
                    <button type="button" className="flex items-center gap-1.5 bg-solar-gold-light text-solar-gold-dark font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg ml-auto hover:bg-solar-gold hover:text-on-primary"><Icon name="support_agent" size={16} /> Escalate to human</button>
                  </div>
                  {!canSend && <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">In Shadow mode the draft can be evaluated and edited, but not sent. Escalate to a human agent instead.</p>}
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Assist panel */}
        <div className="lg:col-span-2 space-y-space-md">
          <Card title="Routing assist">
            <div className="space-y-space-sm">
              <Row label="Detected intent" value="Label authenticity check" />
              <Row label="Recommended category" value="Verification / QR" />
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-on-surface-variant">Recommended priority</span>
                <Status label="Normal" tone={OK} />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-on-surface-variant">Intent confidence</span>
                <Confidence pct={confidence} />
              </div>
            </div>
          </Card>

          <Card title="Knowledge sources &amp; excerpts">
            <div className="space-y-1.5">
              {[
                { s: "KB-114 · Verifying a genuine star label", ex: "“Scan the QR code or enter the registration number at the BEE verification portal.”" },
                { s: "KB-090 · Registration number format", ex: "“BEE registration numbers follow BEE/<category>/<year>/<serial>.”" },
                { s: "FAQ · What if there is no QR code?", ex: "“Enter the printed registration number to confirm the model and rating.”" },
              ].map((k) => (
                <div key={k.s} className="bg-surface-container-low rounded-lg p-space-sm">
                  <div className="flex items-start gap-space-sm"><Icon name="menu_book" size={16} className="text-primary shrink-0 mt-0.5" /><span className="font-label-md text-label-md text-on-surface font-semibold">{k.s}</span></div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 pl-6 italic">{k.ex}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Quality &amp; feedback">
            <div className="flex items-center gap-space-sm">
              <button type="button" className="flex-1 flex items-center justify-center gap-1.5 bg-surface-container-low text-on-surface font-label-md text-label-md py-2 rounded-lg hover:bg-forest-light"><Icon name="thumb_up" size={16} /> Helpful</button>
              <button type="button" className="flex-1 flex items-center justify-center gap-1.5 bg-surface-container-low text-on-surface font-label-md text-label-md py-2 rounded-lg hover:bg-error-container"><Icon name="thumb_down" size={16} /> Not helpful</button>
            </div>
            <button type="button" className="w-full mt-space-sm flex items-center justify-center gap-1.5 border border-error/40 text-error font-label-md text-label-md py-2 rounded-lg hover:bg-error-container/40">
              <Icon name="flag" size={16} /> Report unsupported / hallucinated answer
            </button>
          </Card>
        </div>
      </div>
    </ScreenChrome>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
      <span className="font-label-md text-label-md text-on-surface font-semibold">{value}</span>
    </div>
  );
}

/* ================================================================== *
 * 5) STAR-RATING TREND ANALYTICS — policy / threshold support.
 * ================================================================== */

const DIST_BEFORE = [6, 14, 28, 34, 18]; // 1..5 star %
const DIST_AFTER = [2, 9, 22, 37, 30];
const TREND = [
  { q: "Q1'25", avg: 3.4 }, { q: "Q2'25", avg: 3.5 }, { q: "Q3'25", avg: 3.7 },
  { q: "Q4'25", avg: 3.8 }, { q: "Q1'26", avg: 4.0 }, { q: "Q2'26", avg: 4.1 },
];

export function StarRatingTrends({ module, screen }: { module: Module; screen: Screen }) {
  const [category, setCategory] = useState("Room ACs");
  const maxTrend = 5;

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Distribution & thresholds · model trend-stats v2.0">
      <AIDisclaimer />
      <div className="flex flex-wrap items-center gap-space-sm">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-space-sm py-2 rounded-lg bg-surface-card shadow-sm font-body-sm text-body-sm outline-none">
          {["Room ACs", "Refrigerators", "Ceiling Fans", "LED Lamps", "Water Heaters"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="px-space-sm py-2 rounded-lg bg-surface-card shadow-sm font-body-sm text-body-sm outline-none">
          {["Last 6 quarters", "FY 2025-26", "Last 3 years"].map((d) => <option key={d}>{d}</option>)}
        </select>
        <button type="button" className="ml-auto flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md font-semibold py-2 px-space-md rounded-lg hover:bg-forest-dark"><Icon name="download" size={16} /> Export analysis</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        <Card title={`Star distribution — ${category}`} action={<span className="px-2 py-0.5 rounded-full bg-success-light text-success font-label-sm text-label-sm font-semibold">Observed</span>}>
          <div className="flex items-end justify-around h-48 gap-space-sm pt-space-md">
            {DIST_AFTER.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="font-label-sm text-label-sm text-on-surface font-semibold mb-1">{v}%</span>
                <div className="w-full rounded-t-md bg-primary" style={{ height: `${(v / 40) * 100}%` }} />
                <div className="flex items-center gap-0.5 mt-1"><span className="font-label-sm text-label-sm text-on-surface-variant">{i + 1}</span><Icon name="star" size={12} className="text-solar-gold-dark" /></div>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-space-sm bg-solar-gold-light/50 rounded-lg p-space-sm mt-space-sm">
            <Icon name="join_inner" size={16} className="text-solar-gold-dark shrink-0 mt-0.5" />
            <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">Clustering alert:</span> 30% of models sit just above the 5★ ISEER cut-off — a threshold revision would reclassify many to 4★.</p>
          </div>
        </Card>

        <Card title="Average rating over time" action={<span className="px-2 py-0.5 rounded-full bg-success-light text-success font-label-sm text-label-sm font-semibold">Observed</span>}>
          <div className="flex items-end justify-around h-48 gap-space-sm pt-space-md relative">
            {TREND.map((t) => (
              <div key={t.q} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="font-label-sm text-label-sm text-on-surface font-semibold mb-1">{t.avg}</span>
                <div className="w-full rounded-t-md bg-tertiary" style={{ height: `${(t.avg / maxTrend) * 100}%` }} />
                <span className="font-label-sm text-label-sm text-on-surface-variant mt-1">{t.q}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-space-sm mt-space-sm font-label-sm text-label-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-error inline-block" /> Threshold revision (Q3'25)</span>
          </div>
        </Card>
      </div>

      <Card title="Before / after policy comparison" action={<span className="px-2 py-0.5 rounded-full bg-solar-gold-light text-solar-gold-dark font-label-sm text-label-sm font-semibold">Simulated — threshold revision</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
          {[{ label: "Before revision", data: DIST_BEFORE, tone: "bg-outline" }, { label: "After revision", data: DIST_AFTER, tone: "bg-primary" }].map((block) => (
            <div key={block.label}>
              <div className="font-label-md text-label-md text-on-surface font-semibold mb-space-sm">{block.label}</div>
              <div className="space-y-1.5">
                {block.data.map((v, i) => (
                  <div key={i} className="flex items-center gap-space-sm">
                    <span className="w-10 flex items-center gap-0.5 font-label-sm text-label-sm text-on-surface-variant">{i + 1}<Icon name="star" size={11} className="text-solar-gold-dark" /></span>
                    <div className="flex-1 h-3 rounded-full bg-surface-container overflow-hidden"><div className={`h-full rounded-full ${block.tone}`} style={{ width: `${(v / 40) * 100}%` }} /></div>
                    <span className="w-9 text-right font-label-sm text-label-sm text-on-surface">{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </ScreenChrome>
  );
}

/* ================================================================== *
 * 6) AI MODEL GOVERNANCE — restricted registry & controls.
 * ================================================================== */

/* Registry is the SAME shared fixture the insight screens and landing cards
 * read from — one source of truth for state, version, accuracy and drift. */
const GOV_MODELS = Object.values(AI_MODELS);

/* Only model administrators may request maker-checker operations. Auditors
 * and other authorised viewers get read-only access to the governance view. */
const GOV_ACTORS = new Set(["admin", "director"]);

const DRIFT_TONE: Record<AIModelState["drift"], string> = { Low: OK, Rising: WARN, High: BAD };
const GOV_STATUS_TONE: Record<AIModelState["state"], string> = { Approved: OK, Shadow: WARN, Retired: "bg-surface-container text-on-surface-variant" };

export function AIModelGovernance({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const maker = previewRoleOf(role);
  const canAct = GOV_ACTORS.has(role);
  const [selName, setSelName] = useState(GOV_MODELS[0].name);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<null | { action: string; reason: string; maker: string }>(null);
  const sel = GOV_MODELS.find((m) => m.name === selName)!;

  function submitMaker() {
    if (!canAct || !action || !reason.trim()) return;
    setPending({ action, reason: reason.trim(), maker: maker.name });
    setAction(""); setReason("");
  }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Model registry & controls · restricted">
      <AIDisclaimer />
      <div className="flex items-start gap-space-sm bg-navy-subtle border border-navy-dark/20 rounded-xl p-space-sm">
        <Icon name="shield" size={18} className="text-navy-dark shrink-0 mt-0.5" />
        <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">Restricted view.</span> AI model governance is separate from business insights and limited to authorised model owners, administrators and auditors.</p>
      </div>

      <Card title="Model registry">
        <div className="overflow-x-auto app-scroll">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-subtle">
                {["Model", "Version", "Status", "Accuracy", "Drift", "Last retrain", "Override rate", ""].map((c) => (
                  <th key={c} className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide py-2 pr-space-md whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GOV_MODELS.map((m) => (
                <tr key={m.name} className={`border-b border-border-subtle/60 cursor-pointer hover:bg-surface-container-low ${m.name === selName ? "bg-primary-container/25" : ""}`} onClick={() => setSelName(m.name)}>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface font-semibold whitespace-nowrap">{m.name}</td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface-variant">{m.version}</td>
                  <td className="py-2.5 pr-space-md"><Status label={m.state} tone={GOV_STATUS_TONE[m.state]} /></td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface">{m.accuracy}%</td>
                  <td className="py-2.5 pr-space-md"><Status label={m.drift} tone={DRIFT_TONE[m.drift]} /></td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">{m.retrained}</td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface">{m.override}%</td>
                  <td className="py-2.5 pr-space-md"><Icon name="chevron_right" size={16} className="text-outline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        <Card title={`${sel.name} ${sel.version}`} action={<Status label={sel.state} tone={GOV_STATUS_TONE[sel.state]} />}>
          <div className="space-y-space-sm">
            <Row label="Business owner" value={sel.owner} />
            <Row label="Technical owner" value="BEE Data Platform team" />
            <Row label="Deployment status" value={sel.state === "Approved" ? "Production" : sel.state === "Shadow" ? "Shadow (challenger)" : "Retired"} />
            <Row label="Training-data period" value={sel.trained} />
            <Row label="Dataset / lineage" value={`ds-${sel.name}-2026Q2 · lineage tracked`} />
            <Row label="Last validation" value={sel.retrained === "—" ? "Not validated" : sel.retrained} />
            <Row label="Last retraining" value={sel.retrained} />
            <div className="flex items-center justify-between"><span className="font-label-sm text-label-sm text-on-surface-variant">Model drift (threshold 5%)</span><Status label={sel.drift} tone={DRIFT_TONE[sel.drift]} /></div>
            <Bar label="Accuracy" value={sel.accuracy} tone="bg-tertiary" suffix="%" />
            <Bar label="Human override rate" value={sel.override} tone={sel.override > 25 ? "bg-error" : "bg-solar-gold-dark"} suffix="%" />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["Validation report", "Fairness assessment", "Explainability report"].map((r) => (
                <button key={r} type="button" className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary bg-surface-container-low px-2 py-1 rounded hover:bg-forest-light"><Icon name="description" size={13} /> {r}</button>
              ))}
            </div>
          </div>
        </Card>

        <div className="space-y-space-md">
          <Card title="Deployment history">
            <div className="space-y-space-sm">
              {[
                { v: sel.version, when: "Current · production", tone: OK },
                { v: "v" + (parseFloat(sel.version.slice(1)) - 0.1).toFixed(1), when: "Previous · retired", tone: "bg-surface-container text-on-surface-variant" },
                { v: "v" + (parseFloat(sel.version.slice(1)) - 0.2).toFixed(1), when: "Archived", tone: "bg-surface-container text-on-surface-variant" },
              ].map((d) => (
                <div key={d.v} className="flex items-center justify-between bg-surface-container-low rounded-lg p-space-sm">
                  <span className="font-body-sm text-body-sm text-on-surface font-semibold">{sel.name} {d.v}</span>
                  <Status label={d.when} tone={d.tone} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Controls — maker / checker" action={canAct ? undefined : <Status label="Read-only" tone="bg-surface-container text-on-surface-variant" />}>
            {!canAct ? (
              <div className="flex items-start gap-space-sm bg-surface-container-low rounded-lg p-space-md">
                <Icon name="visibility" size={18} className="text-on-surface-variant shrink-0 mt-0.5" />
                <div>
                  <p className="font-body-sm text-body-sm text-on-surface"><span className="font-semibold">You are viewing as {maker.name}.</span> This role has read-only access to model governance.</p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">Pause, roll back and deploy operations are limited to model administrators. Auditors and other authorised viewers can review the registry, drift and history but cannot request changes.</p>
                </div>
              </div>
            ) : pending ? (
              <div className="bg-solar-gold-light/50 border border-solar-gold/40 rounded-lg p-space-md">
                <div className="flex items-center gap-space-sm mb-1"><Icon name="hourglass_top" size={18} className="text-solar-gold-dark" /><span className="font-title-sm text-title-sm text-on-surface font-semibold">Awaiting checker approval</span></div>
                <div className="space-y-1 mt-space-sm">
                  <MiniKV k="Requested action" v={pending.action} />
                  <MiniKV k="Requested by (maker)" v={pending.maker} />
                  <div><div className="font-label-sm text-label-sm text-on-surface-variant">Reason</div><div className="font-body-sm text-body-sm text-on-surface">{pending.reason}</div></div>
                </div>
                <div className="flex items-center gap-space-sm mt-space-md">
                  <button type="button" disabled title="A different authorised user must approve" className="flex items-center gap-1.5 bg-surface-container text-on-surface-variant font-label-md text-label-md py-2 px-space-md rounded-lg cursor-not-allowed"><Icon name="lock" size={16} /> Approve as checker</button>
                  <button type="button" onClick={() => setPending(null)} className="font-label-md text-label-md text-on-surface bg-surface-container py-2 px-space-sm rounded-lg hover:bg-forest-light">Withdraw</button>
                </div>
                <p className="font-label-sm text-label-sm text-error mt-space-sm flex items-start gap-1"><Icon name="info" size={13} className="mt-0.5" /> The maker cannot approve their own request. A second authorised administrator must confirm before the change is applied.</p>
              </div>
            ) : (
              <>
                <label className="font-label-sm text-label-sm text-on-surface-variant">Operation (requires maker-checker approval)</label>
                <select value={action} onChange={(e) => setAction(e.target.value)} className="w-full mt-1 mb-space-sm px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none">
                  <option value="">Select an operation…</option>
                  <option value="Pause model">Pause model</option>
                  <option value="Roll back to previous version">Roll back to previous version</option>
                  <option value="Deploy new version">Deploy new version</option>
                </select>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, recorded in audit trail)…" rows={2} className="w-full px-space-sm py-2 rounded-lg bg-surface-container-low font-body-sm text-body-sm outline-none resize-none" />
                <button type="button" onClick={submitMaker} disabled={!action || !reason.trim()}
                  className={`w-full mt-space-sm flex items-center justify-center gap-1.5 font-label-md text-label-md font-semibold py-2 rounded-lg ${action && reason.trim() ? "bg-primary text-on-primary hover:bg-forest-dark" : "bg-surface-container text-on-surface-variant cursor-not-allowed"}`}>
                  <Icon name="how_to_reg" size={16} /> Submit for approval
                </button>
                <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">A single administrator cannot pause or roll back a production model — every change needs a second checker and an audit entry.</p>
              </>
            )}
          </Card>
        </div>
      </div>
    </ScreenChrome>
  );
}
