"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { colourFor, DonutChart, formatNumber, GroupedBars, prettyLabel, TrendChart, type TwoPoint } from "./charts";
import { Pill } from "./DemoShell";
import { demoGet, demoPath } from "@/lib/client/runtimeDemo";
import { istStamp } from "@/lib/client/istTime";

/**
 * The executive dashboard for the Director and the Secretary (demonstration): headline figures and a grid of charts for one date range and,
 * optionally, one manufacturer. Click a manufacturer in the "Certificates by manufacturer" chart to look at that manufacturer alone.
 * Read only; every figure is computed by Spring from the live tables on each read. Not a BEE report.
 */
type Point = { label: string; value: number };
type Kpi = { key: string; label: string; value: number | null; unit: string; hint: string; tone: "good" | "attention" | "neutral" | "danger"; icon: string };
type Chart = { key: string; kind: "donut" | "bars" | "trend" | "multi"; title: string; data: Point[] | TwoPoint[]; aName?: string; bName?: string };
type Waiting = { reference: string; model: string; manufacturer: string; stage: string; days: number };
type Risk = { name: string; score: number; band: string; applications: number };
type Org = { id: string; name: string };
type Data = {
  asOf: string; range: { from: string; to: string }; organisations: Org[]; organisation: string | null; kpis: Kpi[]; charts: Chart[];
  waitingList: Waiting[]; riskList: Risk[]; note: string;
};

const TONE: Record<string, { chip: string; text: string }> = {
  good: { chip: "bg-[#e2f3e8] text-[#14532d]", text: "text-[#14532d]" },
  attention: { chip: "bg-[#fff1d2] text-[#8a4b00]", text: "text-[#8a4b00]" },
  danger: { chip: "bg-[#fde4e1] text-[#93000a]", text: "text-[#93000a]" },
  neutral: { chip: "bg-[#e3ebfb] text-[#14315e]", text: "text-[#14315e]" },
};

const today = () => new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = today(); d.setDate(d.getDate() - n); return iso(d); };
const PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
  { key: "all", label: "All time", range: () => ({ from: "", to: "" }) },
  { key: "30", label: "Last 30 days", range: () => ({ from: daysAgo(29), to: iso(today()) }) },
  { key: "90", label: "Last 90 days", range: () => ({ from: daysAgo(89), to: iso(today()) }) },
  { key: "year", label: "This year", range: () => ({ from: `${today().getFullYear()}-01-01`, to: iso(today()) }) },
];

const nice = (label: string) => prettyLabel(label).replace(/\bIame\b/g, "IAME").replace(/\bBee\b/g, "BEE");

const fmtValue = (k: Kpi): string => {
  if (k.value === null) return "n/a";
  if (k.unit === "INR") return k.value >= 10000000 ? `₹${(k.value / 10000000).toFixed(2)} Cr` : k.value >= 100000 ? `₹${(k.value / 100000).toFixed(2)} L` : `₹${formatNumber(k.value)}`;
  return `${formatNumber(k.value)}${k.unit === "%" ? "%" : ""}`;
};

function KpiCard({ k }: { k: Kpi }) {
  const t = TONE[k.tone] ?? TONE.neutral;
  return (
    <div className="rounded-2xl bg-white shadow p-space-md border border-[#e6eaf0]" data-testid={`exec-kpi-${k.key}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-label-md uppercase tracking-wide text-on-surface-variant leading-tight">{k.label}</span>
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${t.chip}`}><Icon name={k.icon} size={18} /></span>
      </div>
      <div className={`mt-1 text-[30px] leading-9 font-extrabold tabular-nums ${t.text}`} data-testid={`exec-kpi-${k.key}-value`}>
        {fmtValue(k)}{k.unit === "days" && k.value !== null ? <span className="ml-1 text-[14px] font-semibold text-on-surface-variant">days</span> : null}
      </div>
      <p className="font-label-sm text-on-surface-variant mt-1">{k.hint}</p>
    </div>
  );
}

function Card({ title, children, span = 1, testId }: { title: string; children: React.ReactNode; span?: 1 | 2; testId: string }) {
  return (
    <section className={`rounded-2xl bg-white shadow p-space-md border border-[#e6eaf0] ${span === 2 ? "lg:col-span-2" : ""}`} data-testid={testId}>
      <div role="heading" aria-level={2} className="font-title-sm text-on-surface mb-space-sm">{title}</div>
      {children}
    </section>
  );
}

/** Ranked bars: when a row can be chosen (the manufacturers), clicking it narrows the whole dashboard to that one. */
function RankedBars({ data, onPick, picked, empty = "Nothing in this period.", testId }: { data: Point[]; onPick?: (label: string) => void; picked?: string | null; empty?: string; testId: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <p className="font-body-sm text-on-surface-variant">{empty}</p>;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {data.map((d, i) => {
        const inner = (
          <>
            <div className="flex items-start justify-between gap-2 text-[12px] leading-4 text-on-surface"><span className="min-w-0 break-words" title={nice(d.label)}>{nice(d.label)}</span><span className="font-semibold tabular-nums">{formatNumber(d.value)}</span></div>
            <div className="h-2.5 rounded-full bg-[#eef1f5] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: colourFor(d.label, i) }} /></div>
          </>
        );
        return (
          <li key={d.label}>
            {onPick ? (
              <button type="button" className={`w-full text-left rounded-lg px-1 -mx-1 hover:bg-[#f4f8ff] ${picked === d.label ? "bg-[#e7effb]" : ""}`} onClick={() => onPick(d.label)} aria-label={`Show only ${d.label}`} data-testid="exec-pick">{inner}</button>
            ) : inner}
          </li>
        );
      })}
    </ul>
  );
}

function ChartCard({ c, orgs, orgName, onPick }: { c: Chart; orgs: Org[]; orgName: string | null; onPick: (id: string | null) => void }) {
  const points = c.data as Point[];
  const body = c.kind === "multi" ? <GroupedBars data={c.data as TwoPoint[]} title={c.title} aName={c.aName ?? "A"} bName={c.bName ?? "B"} height={300} />
    : c.kind === "donut" ? (points.length === 0 ? <p className="font-body-sm text-on-surface-variant">Nothing in this period.</p> : <DonutChart data={points} title={c.title} legendMax={6} />)
    : c.kind === "trend" ? <TrendChart data={points} title={c.title} colour="#1f6f4a" height={130} unit="₹" />
    : c.key === "manufacturers" ? <RankedBars data={points} testId="exec-manufacturers" picked={orgName}
      onPick={(label) => { const o = orgs.find((x) => x.name === label); if (o) onPick(o.id === (orgs.find((x) => x.name === orgName)?.id ?? "") ? null : o.id); }} />
    : <RankedBars data={points} testId={`exec-bars-${c.key}`} />;
  return <Card title={c.title} testId={`exec-chart-${c.key}`} span={c.kind === "multi" ? 2 : 1}>{body}</Card>;
}

export function ExecutiveDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [org, setOrg] = useState("");
  const [tick, setTick] = useState(0);
  const valid = !range.from || !range.to || range.from <= range.to;
  const qs = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), ...(org ? { organisation: org } : {}) }).toString();

  useEffect(() => {
    if (!valid) return;
    let live = true;
    void demoGet<Data>(demoPath("dashboard", "executive") + (qs ? `?${qs}` : "")).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.value); setError(null); } else setError(r.message);
    });
    return () => { live = false; };
  }, [qs, tick, valid]);

  const orgName = data?.organisations.find((o) => o.id === org)?.name ?? null;
  const chip = (active: boolean) => `px-3 py-1.5 rounded-full font-label-md transition-colors ${active ? "bg-white text-[#0f3d2a] shadow" : "bg-white/15 text-white hover:bg-white/25"}`;
  const field = "rounded-lg bg-white/15 text-white px-2.5 h-10 font-label-md border border-white/25 [color-scheme:dark]";

  return (
    <div className="space-y-space-md" data-testid="dashboard-executive">
      <header className="rounded-2xl bg-gradient-to-r from-[#0f3d2a] via-[#1b5a3d] to-[#2c7a52] text-white p-space-lg shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div>
            <p className="font-label-md uppercase tracking-[0.18em] !text-white/70">Bureau of Energy Efficiency · demonstration</p>
            <div role="heading" aria-level={1} className="mt-1 text-[30px] leading-9 font-bold tracking-tight text-white">Programme performance</div>
            <p className="font-body-md !text-white/85 mt-0.5">The programme at a glance: applications, certificates, fees, ledger, production and risk</p>
            <p className="font-label-md !text-white/70 mt-space-sm" data-testid="exec-asof">{data ? `Calculated live at ${istStamp(data.asOf, false)} IST. Monthly charts show the last 12 months when no dates are set.` : "Loading…"}</p>
          </div>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 font-label-md text-white" data-testid="exec-refresh"><Icon name="refresh" size={16} /> Refresh</button>
        </div>
        <div className="mt-space-md border-t border-white/20 pt-space-md flex flex-wrap items-end gap-space-sm" role="group" aria-label="Filters" data-testid="exec-filters">
          {PRESETS.map((p) => <button key={p.key} type="button" aria-pressed={preset === p.key} className={chip(preset === p.key)} onClick={() => { setPreset(p.key); setRange(p.range()); }} data-testid={`exec-range-${p.key}`}>{p.label}</button>)}
          <label className="flex flex-col font-label-sm !text-white/80">From
            <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => { setPreset("custom"); setRange({ ...range, from: e.target.value }); }} className={field} data-testid="exec-from" />
          </label>
          <label className="flex flex-col font-label-sm !text-white/80">To
            <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => { setPreset("custom"); setRange({ ...range, to: e.target.value }); }} className={field} data-testid="exec-to" />
          </label>
          <label className="flex flex-col font-label-sm !text-white/80">Manufacturer
            <select value={org} onChange={(e) => setOrg(e.target.value)} className={`${field} min-w-56`} data-testid="exec-org">
              <option value="" className="text-black">All manufacturers</option>
              {(data?.organisations ?? []).map((o) => <option key={o.id} value={o.id} className="text-black">{o.name}</option>)}
            </select>
          </label>
          {(org || preset !== "all") ? <button type="button" className="font-label-md text-white underline pb-2" onClick={() => { setPreset("all"); setRange({ from: "", to: "" }); setOrg(""); }} data-testid="exec-reset">Reset filters</button> : null}
        </div>
        {!valid ? <p role="alert" className="mt-2 font-label-md text-[#ffd7d2]">The start date is after the end date.</p> : null}
        {orgName ? <p className="mt-2 font-label-md !text-white/85" data-testid="exec-org-note">Showing {orgName} only. Compliance risk lists this manufacturer only.</p> : null}
      </header>
      {error ? <p role="alert" className="text-error font-body-md">{error}</p> : null}

      <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-4" data-testid="exec-kpis">
        {data ? data.kpis.map((k) => <KpiCard key={k.key} k={k} />) : Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[130px] rounded-2xl bg-white shadow animate-pulse" aria-hidden="true" />)}
      </div>

      <div className="grid gap-space-md lg:grid-cols-3" data-testid="exec-charts">
        {data ? data.charts.map((c) => <ChartCard key={c.key} c={c} orgs={data.organisations} orgName={orgName} onPick={(id) => setOrg(id ?? "")} />)
          : Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[220px] rounded-2xl bg-white shadow animate-pulse" aria-hidden="true" />)}
      </div>

      {data ? (
        <div className="grid gap-space-md lg:grid-cols-2">
          <Card title="Waiting the longest" testId="exec-waiting">
            {data.waitingList.length === 0 ? <p className="font-body-sm text-on-surface-variant">No open applications.</p> : (
              <table className="w-full font-body-sm">
                <thead><tr className="text-left text-on-surface-variant"><th className="py-1 pr-3">Reference</th><th className="pr-3">Manufacturer</th><th className="pr-3">Stage</th><th className="text-right">Days</th></tr></thead>
                <tbody>
                  {data.waitingList.map((w) => (
                    <tr key={w.reference} className="border-t border-outline-variant">
                      <td className="py-1.5 pr-3"><span className="font-semibold">{w.reference}</span><span className="block text-on-surface-variant">{w.model}</span></td>
                      <td className="pr-3">{w.manufacturer}</td>
                      <td className="pr-3"><Pill>{nice(w.stage)}</Pill></td>
                      <td className="text-right font-semibold tabular-nums">{w.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Highest compliance risk" testId="exec-risk">
            {data.riskList.length === 0 ? <p className="font-body-sm text-on-surface-variant">No scored manufacturer for this selection.</p> : (
              <table className="w-full font-body-sm">
                <thead><tr className="text-left text-on-surface-variant"><th className="py-1 pr-3">Manufacturer</th><th className="pr-3">Applications</th><th className="pr-3">Score</th><th>Risk band</th></tr></thead>
                <tbody>
                  {data.riskList.map((r) => (
                    <tr key={r.name} className="border-t border-outline-variant">
                      <td className="py-1.5 pr-3 font-semibold">{r.name}</td>
                      <td className="pr-3 tabular-nums">{r.applications}</td>
                      <td className="pr-3 font-semibold tabular-nums">{r.score}</td>
                      <td><Pill>{prettyLabel(r.band)}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="font-label-sm text-on-surface-variant mt-space-sm">Advisory scores from the AI use case, for a person to look at first. They are not findings.</p>
          </Card>
        </div>
      ) : null}
      <p className="font-label-sm text-on-surface-variant text-center" data-testid="exec-note">{data?.note ?? ""}</p>
    </div>
  );
}
