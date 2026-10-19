"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { BarList, DonutChart, formatNumber, type Point, prettyLabel, TrendChart } from "./charts";
import { Pill } from "./DemoShell";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath } from "@/lib/client/runtimeDemo";
import { istStamp } from "@/lib/client/istTime";

/**
 * The Director's and the Auditor's dashboards (demonstration). Each figure is a card with its charts; a click opens the records behind it, with
 * search, sort and downloads. One date range drives every card, chart and list. The compliance risk list also says why each risk is high.
 * Read only: every figure is computed by Spring from the live tables on each read.
 */
type Cell = string | number | boolean | null;
type Chart = { kind: "donut" | "bars" | "trend"; title: string; data: Point[] };
type Why = { factor: string; points: number; weight: number; reason: string };
type TileBody = {
  key: string; label: string; value: number; unit: string; hint: string; tone: "good" | "attention" | "neutral" | "danger"; icon: string; columns: string[]; rows: Cell[][];
  note: string | null; href: string | null; charts: Chart[]; details?: Why[][]; total: number; shown: number;
};
type Range = { from: string; to: string };
type Overview = { view: string; title: string; asOf: string; tiles: TileBody[]; note: string; range: Range };

const TONE: Record<string, { chip: string; bar: string; text: string }> = {
  good: { chip: "bg-[#e2f3e8] text-[#14532d]", bar: "from-[#2e7d4f] to-[#6fbf8f]", text: "text-[#14532d]" },
  attention: { chip: "bg-[#fff1d2] text-[#8a4b00]", bar: "from-[#d99a1c] to-[#f2cf7e]", text: "text-[#8a4b00]" },
  danger: { chip: "bg-[#fde4e1] text-[#93000a]", bar: "from-[#c0392b] to-[#ef9a90]", text: "text-[#93000a]" },
  neutral: { chip: "bg-[#e3ebfb] text-[#14315e]", bar: "from-[#3b5ea8] to-[#8fa9de]", text: "text-[#14315e]" },
};
const TREND_COLOUR: Record<string, string> = { good: "#1f6f4a", attention: "#c7881a", danger: "#c0392b", neutral: "#3b5ea8" };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const plain = (v: Cell): string => (v === null ? "" : typeof v === "string" && ISO.test(v) ? istStamp(v, false) : String(v));

function show(value: Cell, column: string): React.ReactNode {
  if (value === null || value === "") return "";
  if (typeof value === "string" && ISO.test(value)) return istStamp(value, false);
  if (/^(Chain|Stage|State|Ledger|Risk band|Decision|Event)$/.test(column) && typeof value === "string") return <Pill>{prettyLabel(value)}</Pill>;
  if (column === "Score" && typeof value === "number") return <span className="font-semibold tabular-nums">{value}</span>;
  return String(value);
}

// ---------------------------------------------------------------- the date range

const today = () => new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = today(); d.setDate(d.getDate() - n); return iso(d); };
const PRESETS: { key: string; label: string; range: () => Range }[] = [
  { key: "all", label: "All time", range: () => ({ from: "", to: "" }) },
  { key: "30", label: "Last 30 days", range: () => ({ from: daysAgo(29), to: iso(today()) }) },
  { key: "90", label: "Last 90 days", range: () => ({ from: daysAgo(89), to: iso(today()) }) },
  { key: "year", label: "This year", range: () => ({ from: `${today().getFullYear()}-01-01`, to: iso(today()) }) },
];

function RangeBar({ range, preset, onPreset, onCustom }: { range: Range; preset: string; onPreset: (key: string) => void; onCustom: (r: Range) => void }) {
  const chip = (active: boolean) => `px-3 py-1.5 rounded-full font-label-md transition-colors ${active ? "bg-white text-[#0f3d2a] shadow" : "bg-white/15 text-white hover:bg-white/25"}`;
  const field = "rounded-lg bg-white/15 text-white px-2.5 py-1.5 font-label-md border border-white/25 [color-scheme:dark]";
  return (
    <div className="flex flex-wrap items-end gap-space-sm" role="group" aria-label="Date range" data-testid="dash-range">
      {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => onPreset(p.key)} aria-pressed={preset === p.key} className={chip(preset === p.key)} data-testid={`dash-range-${p.key}`}>{p.label}</button>)}
      <label className="flex flex-col font-label-sm !text-white/80">From
        <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => onCustom({ ...range, from: e.target.value })} className={field} data-testid="dash-range-from" />
      </label>
      <label className="flex flex-col font-label-sm !text-white/80">To
        <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => onCustom({ ...range, to: e.target.value })} className={field} data-testid="dash-range-to" />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- one card

function TileCard({ t, open, onToggle }: { t: TileBody; open: boolean; onToggle: () => void }) {
  const tone = TONE[t.tone] ?? TONE.neutral;
  const donut = t.charts.find((c) => c.kind === "donut");
  const trend = t.charts.find((c) => c.kind === "trend");
  return (
    <button type="button" onClick={onToggle} aria-pressed={open} data-testid={`dash-tile-${t.key}`} title={t.hint}
      className={`group relative overflow-hidden text-left rounded-2xl bg-white shadow-md hover:shadow-xl transition-shadow p-space-md border ${open ? "border-primary ring-2 ring-primary/40" : "border-outline-variant/60"}`}>
      <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${tone.bar}`} aria-hidden="true" />
      <span className="flex items-center gap-space-sm">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone.chip}`}><Icon name={t.icon} size={22} /></span>
        <span className="font-label-md text-on-surface-variant uppercase tracking-wide leading-tight">{t.label}</span>
      </span>
      <span className="flex items-end gap-2 mt-space-sm">
        <span className="text-[44px] leading-none font-bold text-on-surface tabular-nums" data-testid={`dash-value-${t.key}`}>{formatNumber(t.value)}</span>
        <span className="pb-1.5 font-label-md text-on-surface-variant">{t.unit}</span>
      </span>
      <span className="block mt-space-sm min-h-[104px]">
        {donut && donut.data.some((d) => d.value > 0) ? <DonutChart data={donut.data} title={donut.title} size={104} legendMax={4} /> : trend ? <TrendChart data={trend.data} title={trend.title} colour={TREND_COLOUR[t.tone]} height={96} /> : null}
      </span>
      {donut && trend ? <span className="block mt-1 opacity-90"><TrendChart data={trend.data} title={trend.title} colour={TREND_COLOUR[t.tone]} height={34} compact /></span> : null}
      <span className={`mt-space-sm inline-flex items-center gap-1 font-label-md ${tone.text}`}>{open ? "Hide the records" : "See the records"}<Icon name={open ? "expand_less" : "arrow_forward"} size={16} /></span>
    </button>
  );
}

// ---------------------------------------------------------------- the list behind a card

function WhyPanel({ name, score, why }: { name: string; score: number; why: Why[] }) {
  return (
    <div className="rounded-xl bg-[#fff8f6] border border-[#f1c6c0] p-space-md" data-testid="dash-why">
      <p className="font-title-md text-title-md text-on-surface">Why {name} is in the high risk band</p>
      <p className="font-body-sm text-on-surface-variant mt-0.5">Score {score} of 100. Each factor adds points up to its weight; the biggest reasons come first. A priority for a person to look at, not a finding.</p>
      <ul className="mt-space-sm space-y-space-sm">
        {why.map((w) => (
          <li key={w.factor} data-testid="dash-why-factor">
            <div className="flex justify-between gap-2 font-label-md"><span className="text-on-surface">{w.factor}</span><span className="font-semibold tabular-nums text-[#93000a]">+{w.points} of {w.weight}</span></div>
            <div className="h-2 rounded-full bg-white overflow-hidden border border-[#f1c6c0]"><div className="h-full rounded-full bg-gradient-to-r from-[#c0392b] to-[#ef9a90]" style={{ width: `${Math.min(100, (w.points / Math.max(1, w.weight)) * 100)}%` }} /></div>
            <p className="font-body-sm text-on-surface-variant mt-0.5">{w.reason.charAt(0).toUpperCase() + w.reason.slice(1)}.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DrillTable({ view, tile, range }: { view: string; tile: TileBody; range: Range }) {
  const [data, setData] = useState<TileBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const qs = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) }).toString();
  useEffect(() => {
    let live = true;
    void demoGet<TileBody>(demoPath("dashboard", view, tile.key) + (qs ? `?${qs}` : "")).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.value); setError(null); setExpanded(null); } else setError(r.message);
    });
    return () => { live = false; };
  }, [view, tile.key, qs]);
  const indexed = useMemo(() => (data?.rows ?? []).map((cells, i) => ({ cells, i })), [data]);
  const tools = useListTools({
    rows: indexed,
    text: (r) => r.cells.map(plain).join(" "),
    sortValue: (r, k) => { const v = r.cells[Number(k)]; return typeof v === "number" ? v : plain(v ?? null).toLowerCase(); },
  });
  if (error) return <p role="alert" className="text-error font-body-md">{error}</p>;
  if (!data) return <p role="status" className="font-body-md">Loading…</p>;
  const hasWhy = !!data.details;
  const withWhy = hasWhy ? (data.columns.length + 1) : data.columns.length;
  const tone = TONE[data.tone] ?? TONE.neutral;
  return (
    <div role="region" className="rounded-2xl bg-white shadow-md border border-outline-variant/60 overflow-hidden" aria-labelledby="dash-drill-h" data-testid="dash-drill">
      <div className={`h-1.5 bg-gradient-to-r ${tone.bar}`} />
      <div className="p-space-md space-y-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-sm">
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone.chip}`}><Icon name={data.icon} size={22} /></span>
            <div>
              <div role="heading" aria-level={2} id="dash-drill-h" className="text-[20px] leading-7 font-bold text-on-surface">{data.label}</div>
              <p className="font-body-sm text-on-surface-variant" data-testid="dash-drill-count">{formatNumber(data.total)} {data.unit}{data.shown < data.total ? `, the first ${data.shown} shown` : ""}{range.from || range.to ? ` · ${range.from || "the start"} to ${range.to || "today"}` : " · all time"}</p>
            </div>
          </div>
          {data.href ? <Link href={data.href} className="inline-flex items-center gap-1 rounded-lg border border-primary text-primary px-3 py-1.5 font-label-md hover:bg-primary/5" data-testid="dash-open-screen">Open the working screen <Icon name="arrow_forward" size={16} /></Link> : null}
        </div>
        {data.note ? <p className="font-body-sm text-on-surface-variant">{data.note}</p> : null}
        {data.charts.length > 0 ? (
          <div className="grid gap-space-md md:grid-cols-3" data-testid="dash-charts">
            {data.charts.map((c) => (
              <div key={c.title} className="rounded-xl bg-surface-container-low p-space-md">
                <p className="font-label-md text-on-surface-variant uppercase tracking-wide mb-space-sm">{c.title}</p>
                {c.kind === "donut" ? <DonutChart data={c.data} title={c.title} /> : c.kind === "bars" ? <BarList data={c.data} title={c.title} unit={/INR/i.test(c.title) ? "₹" : ""} /> : <TrendChart data={c.data} title={c.title} colour={TREND_COLOUR[data.tone]} unit={/INR/i.test(c.title) ? "₹" : ""} />}
              </div>
            ))}
          </div>
        ) : null}
        {data.rows.length === 0 ? (
          <div className="rounded-xl bg-surface-container-low p-space-lg text-center" data-testid="dash-drill-empty">
            <Icon name="inbox" size={32} />
            <p className="font-title-md text-title-md mt-1">Nothing to show</p>
            <p className="font-body-sm text-on-surface-variant">No records match this figure in the chosen dates. Widen the date range to see more.</p>
          </div>
        ) : (
          <>
            <ListToolbar tools={tools} searchLabel="Search this list" placeholder="Type to search"
              exportCsv={{ filename: `${view}-${data.key}`, header: data.columns, rows: tools.visible.map((r) => r.cells.map((c) => (typeof c === "number" ? c : plain(c)))) }} />
            <div className="overflow-x-auto rounded-xl border border-outline-variant/60">
              <table className="w-full text-left font-body-sm" data-testid="dash-drill-table">
                <caption className="sr-only">{data.label}</caption>
                <thead><tr className="bg-surface-container-low text-on-surface-variant font-label-sm">
                  {hasWhy ? <th className="w-8" /> : null}
                  {data.columns.map((c, i) => <SortableTh key={c} tools={tools} k={String(i)} className="py-2 px-3">{c}</SortableTh>)}
                </tr></thead>
                <tbody>
                  {tools.paged.pageRows.map((r) => (
                    <Fragment key={r.i}>
                      <tr className={`border-t border-outline-variant ${hasWhy ? "cursor-pointer hover:bg-surface-container-low" : ""}`} data-testid="dash-drill-row"
                        onClick={hasWhy ? () => setExpanded(expanded === r.i ? null : r.i) : undefined}>
                        {hasWhy ? <td className="px-2"><button type="button" aria-expanded={expanded === r.i} aria-label={`Why ${plain(r.cells[0])} is high`} onClick={(e) => { e.stopPropagation(); setExpanded(expanded === r.i ? null : r.i); }} className="bg-transparent !p-0 !border-0 !shadow-none !text-primary" data-testid="dash-why-toggle"><Icon name={expanded === r.i ? "expand_less" : "expand_more"} size={20} /></button></td> : null}
                        {r.cells.map((c, j) => <td key={j} className="py-2 px-3 align-top">{show(c, data.columns[j])}</td>)}
                      </tr>
                      {hasWhy && expanded === r.i && data.details?.[r.i] ? (
                        <tr className="bg-[#fffaf9]"><td colSpan={withWhy} className="p-space-md"><WhyPanel name={plain(r.cells[0])} score={Number(r.cells[1])} why={data.details[r.i]} /></td></tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPager tools={tools} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

export function RoleDashboard({ view }: { view: "director" | "auditor" }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [preset, setPreset] = useState("all");
  const [range, setRange] = useState<Range>({ from: "", to: "" });
  const valid = !range.from || !range.to || range.from <= range.to;
  const qs = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) }).toString();

  useEffect(() => {
    if (!valid) return;
    let live = true;
    void demoGet<Overview>(demoPath("dashboard", view) + (qs ? `?${qs}` : "")).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.value); setError(null); } else setError(r.message);
    });
    return () => { live = false; };
  }, [view, tick, qs, valid]);

  const selected = data?.tiles.find((t) => t.key === open) ?? null;
  const title = data?.title ?? (view === "director" ? "Programme at a glance" : "Auditor's dashboard");
  const subtitle = view === "director" ? "How the programme is doing, right now" : "Can every record be trusted, and who did what";

  return (
    <div className="space-y-space-md" data-testid={`dashboard-${view}`}>
      <header className="rounded-2xl bg-gradient-to-r from-[#0f3d2a] via-[#1b5a3d] to-[#2c7a52] text-white p-space-lg shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div>
            <p className="font-label-md uppercase tracking-[0.18em] !text-white/70">Bureau of Energy Efficiency · demonstration</p>
            <div role="heading" aria-level={1} className="mt-1 text-[30px] leading-9 font-bold tracking-tight text-white">{title}</div>
            <p className="font-body-md !text-white/85 mt-0.5">{subtitle}</p>
            <p className="font-label-md !text-white/70 mt-space-sm" data-testid="dash-asof">{data ? `Calculated live at ${istStamp(data.asOf, false)} IST` : "Loading…"}</p>
          </div>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 font-label-md text-white" data-testid="dash-refresh"><Icon name="refresh" size={18} /> Refresh</button>
        </div>
        <div className="mt-space-md border-t border-white/20 pt-space-md">
          <RangeBar range={range} preset={preset}
            onPreset={(k) => { setPreset(k); setRange(PRESETS.find((p) => p.key === k)!.range()); }}
            onCustom={(r) => { setPreset("custom"); setRange(r); }} />
          {!valid ? <p role="alert" className="mt-2 font-label-md text-[#ffd7d2]">The start date is after the end date.</p> : null}
        </div>
      </header>
      {error ? <p role="alert" className="text-error font-body-md">{error}</p> : null}
      <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-3">
        {data ? data.tiles.map((t) => <TileCard key={t.key} t={t} open={open === t.key} onToggle={() => setOpen(open === t.key ? null : t.key)} />)
          : [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[300px] rounded-2xl bg-white shadow animate-pulse" aria-hidden="true" />)}
      </div>
      {selected ? <DrillTable view={view} tile={selected} range={range} /> : data ? <p className="font-body-sm text-on-surface-variant text-center py-space-sm">Choose a card to open the records behind it.</p> : null}
    </div>
  );
}
