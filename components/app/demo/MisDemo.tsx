"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { demoGet, demoPath, type DemoResult } from "@/lib/client/runtimeDemo";
import { datedFileName, parseCsvText, saveBytes, saveCsv } from "@/lib/client/csv";
import { buildXlsx, XLSX_TYPE } from "@/lib/client/xlsx";
import { Icon } from "@/components/ui/Icon";
import { BarList, DonutChart, TrendChart } from "./charts";

/**
 * MIS dashboard on live data (demo slice S5). Read-only: every figure is a SQL aggregate computed by Spring on the live tables, with the time
 * of the read, a short data version and the source tables. Local demonstration on provisional rules, not a BEE report; rows marked
 * synthetic in the demo seed are test data. Panels follow the person's role; a part another demo area has not landed yet says so.
 */

type Card = { key: string; label: string; value: number | string | null; unit: string | null; note: string | null };
type Table = { key: string; title: string; chart: "bar" | "line" | "none"; columns: string[]; rows: (string | number | null)[][] };
type Panel = {
  panel: string;
  asOf: string;
  dataVersion: string;
  sources: string[];
  from: string;
  to: string;
  cards: Card[];
  tables: Table[];
  unavailable: { part: string; reason: string }[];
};
type Listing = { panels: string[] };
type ExportBody = { csv: string; filename: string };

const PANEL_TITLES: Record<string, string> = {
  summary: "Summary",
  applications: "Applications",
  finance: "Finance",
  production: "Production",
  certificates: "Certificates",
};

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const fmt = (v: unknown): string => (v === null || v === undefined ? "n/a" : typeof v === "number" ? nf.format(v) : String(v));

function cardValue(c: Card): string {
  if (c.value === null) return "n/a";
  const v = typeof c.value === "number" ? nf.format(c.value) : c.value;
  return c.unit === "INR" ? `INR ${v}` : c.unit ? `${v} ${c.unit}` : String(v);
}

function seriesOf(t: Table): { name: string; values: number[] }[] {
  return t.columns.slice(1).map((name, i) => ({ name, values: t.rows.map((r) => Number(r[i + 1] ?? 0)) }));
}

function LineChart({ table }: { table: Table }) {
  const series = seriesOf(table);
  const n = table.rows.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const W = 600;
  const H = 160;
  const x = (i: number) => (n <= 1 ? W / 2 : 20 + (i * (W - 40)) / (n - 1));
  const y = (v: number) => H - 10 - (v / max) * (H - 30);
  const tone = ["text-primary", "text-secondary"];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-auto" role="img" aria-label={`${table.title}: line chart of ${series.map((s) => s.name).join(" and ")} by month. The same figures are in the table below.`}>
        <line x1="20" y1={H - 10} x2={W - 20} y2={H - 10} stroke="currentColor" className="text-outline-variant" />
        {series.map((s, si) => (
          <g key={s.name} className={tone[si % tone.length]}>
            <polyline fill="none" stroke="currentColor" strokeWidth="2" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="currentColor" />
            ))}
          </g>
        ))}
        {table.rows.map((r, i) =>
          i % Math.ceil(n / 6) === 0 ? (
            <text key={i} x={x(i)} y={H + 12} textAnchor="middle" fontSize="10" fill="currentColor" className="text-on-surface-variant">{String(r[0])}</text>
          ) : null,
        )}
      </svg>
      <p className="font-label-sm text-label-sm text-on-surface-variant">
        {series.map((s, si) => (
          <span key={s.name} className={`mr-space-md ${tone[si % tone.length]}`}>● <span className="text-on-surface-variant">{s.name}</span></span>
        ))}
        Peak {nf.format(max)}
      </p>
    </div>
  );
}

function DataTable({ table }: { table: Table }) {
  return (
    <div className="overflow-x-auto mt-space-sm">
      <table className="w-full font-body-sm text-body-sm" data-testid={`mis-table-${table.key}`}>
        <caption className="sr-only">{table.title}</caption>
        <thead>
          <tr className="text-left text-on-surface-variant">
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={`py-1 pr-space-md font-label-md ${i > 0 ? "text-right" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr><td colSpan={table.columns.length} className="py-1 text-on-surface-variant">No rows yet.</td></tr>
          ) : (
            table.rows.map((r, i) => (
              <tr key={i} className="border-t border-outline-variant">
                {r.map((v, j) => (
                  <td key={j} className={`py-1 pr-space-md ${j > 0 ? "text-right" : ""}`}>{fmt(v)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A distribution of a few groups reads best as a ring; a long list as ranked bars; a single monthly series as a trend; several series as lines. */
function ChartBlock({ table }: { table: Table }) {
  const points = table.rows.map((r) => ({ label: String(r[0]), value: Number(r[1] ?? 0) }));
  const multi = table.columns.length > 2;
  return (
    <div className="rounded-2xl bg-white shadow-md border border-outline-variant/60 p-space-md" data-testid={`mis-chart-${table.key}`} role="group" aria-labelledby={`mis-h-${table.key}`}>
      <div role="heading" aria-level={3} id={`mis-h-${table.key}`} className="text-[15px] leading-6 font-bold text-on-surface mb-space-sm">{table.title}</div>
      {table.rows.length === 0 ? <p className="font-body-sm text-on-surface-variant">Nothing in this period.</p> : table.chart === "bar" ? (
        points.length <= 6 ? <DonutChart data={points} title={table.title} /> : <BarList data={points} title={table.title} />
      ) : table.chart === "line" ? (
        multi ? <LineChart table={table} /> : <TrendChart data={points} title={table.title} />
      ) : null}
      <details className="mt-space-sm">
        <summary className="font-label-md text-primary">Show the figures</summary>
        <DataTable table={table} />
      </details>
    </div>
  );
}

const CARD_ICON: [RegExp, string][] = [[/submitted/, "description"], [/approved/, "task_alt"], [/average|days/, "schedule"], [/returned/, "undo"], [/rejected/, "block"], [/certificate/, "verified"], [/fee|receipt|inr/, "payments"], [/delegation/, "group"]];
const CARD_TONE = ["bg-[#e3ebfb] text-[#14315e]", "bg-[#e2f3e8] text-[#14532d]", "bg-[#fff1d2] text-[#8a4b00]", "bg-[#efe3f6] text-[#59307a]"];
const iconFor = (key: string, label: string) => CARD_ICON.find(([re]) => re.test(`${key} ${label}`.toLowerCase()))?.[1] ?? "insights";

export function MisDemo() {
  const [panels, setPanels] = useState<string[] | null>(null);
  const [panel, setPanel] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<{ key: string; data: Panel | null; error: string | null } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [from, to]);

  useEffect(() => {
    let live = true;
    demoGet<Listing>(demoPath("mis")).then((r) => {
      if (!live) return;
      if (r.ok) {
        setPanels(r.value.panels);
        setPanel((p) => p || r.value.panels[0] || "");
      } else {
        setListError(r.message);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    let live = true;
    const key = `${panel}${query}#${reload}`;
    demoGet<Panel>(demoPath("mis", panel) + query).then((r: DemoResult<Panel>) => {
      if (!live) return;
      setResult(r.ok ? { key, data: r.value, error: null } : { key, data: null, error: r.message });
    });
    return () => {
      live = false;
    };
  }, [panel, query, reload]);

  const loadKey = `${panel}${query}#${reload}`;
  const loading = !listError && (!panel || result?.key !== loadKey);
  const data = result?.key === loadKey ? result.data : null;
  const error = listError ?? exportError ?? (result?.key === loadKey ? result.error : null);

  const exportExcel = useCallback(async () => {
    setNote(null);
    setExportError(null);
    const r = await demoGet<ExportBody>(demoPath("mis", "export") + `?panel=${encodeURIComponent(panel)}${query ? "&" + query.slice(1) : ""}`);
    if (r.ok) {
      // the same panel as the CSV: its comment lines and tables, one row each, as a workbook
      const rows = parseCsvText(r.value.csv);
      const file = datedFileName(r.value.filename.replace(/-\d{4}-\d{2}-\d{2}\.csv$/, ""), "xlsx");
      saveBytes(file, buildXlsx(`MIS ${panel}`, rows[0] ?? [], rows.slice(1).map((x) => x.map((c) => (c !== "" && /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)))), XLSX_TYPE);
      setNote(`Downloaded ${file}.`);
    } else {
      setExportError(r.message);
    }
  }, [panel, query]);

  const exportCsv = useCallback(async () => {
    setNote(null);
    setExportError(null);
    const r = await demoGet<ExportBody>(demoPath("mis", "export") + `?panel=${encodeURIComponent(panel)}${query ? "&" + query.slice(1) : ""}`);
    if (r.ok) {
      saveCsv(r.value.filename, r.value.csv);
      setNote(`Downloaded ${r.value.filename}.`);
    } else {
      setExportError(r.message);
    }
  }, [panel, query]);

  const chip = (active: boolean) => `!px-3 !py-1.5 !rounded-full font-label-md transition-colors !border-0 ${active ? "!bg-white !text-[#0f3d2a] !shadow" : "!bg-white/15 !text-white hover:!bg-white/25"}`;
  const field = "block mt-1 rounded-lg bg-white/15 text-white px-2.5 py-1.5 font-label-md border border-white/25 [color-scheme:dark]";
  const thisYear = () => { const d = new Date(); setFrom(`${d.getFullYear()}-01-01`); setTo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); };
  return (
    <div className="space-y-space-md" data-testid="demo-mis">
      <header className="rounded-2xl bg-gradient-to-r from-[#0f3d2a] via-[#1b5a3d] to-[#2c7a52] text-white p-space-lg shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div>
            <p className="font-label-md uppercase tracking-[0.18em] !text-white/70">Bureau of Energy Efficiency · demonstration</p>
            <div role="heading" aria-level={1} className="mt-1 text-[30px] leading-9 font-bold tracking-tight text-white">MIS dashboard</div>
            <p className="font-body-md !text-white/85 mt-0.5">The programme in figures, calculated live from the database</p>
            {data && !loading ? <p className="font-label-md !text-white/70 mt-space-sm" data-testid="mis-asof">Calculated live at {new Date(data.asOf).toLocaleString("en-IN")} · data version <code className="!bg-white/15 !text-white">{data.dataVersion}</code> · range {data.from} to {data.to}</p> : null}
          </div>
          <div className="flex flex-wrap gap-space-sm">
            <button type="button" onClick={() => setReload((n) => n + 1)} className="inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 font-label-md text-white" data-testid="mis-refresh"><Icon name="refresh" size={18} /> Refresh</button>
            <button type="button" onClick={exportCsv} disabled={!panel || !data} className="inline-flex items-center gap-1 rounded-full bg-white text-[#0f3d2a] px-4 py-2 font-label-md disabled:opacity-50" data-testid="mis-export"><Icon name="download" size={18} /> Download CSV</button>
            <button type="button" onClick={exportExcel} disabled={!panel || !data} className="inline-flex items-center gap-1 rounded-full bg-white text-[#0f3d2a] px-4 py-2 font-label-md disabled:opacity-50" data-testid="mis-export-xlsx"><Icon name="table_view" size={18} /> Download Excel</button>
          </div>
        </div>
        <div className="mt-space-md border-t border-white/20 pt-space-md flex flex-wrap items-end justify-between gap-space-md">
          {panels && panels.length > 1 ? (
            <div role="tablist" aria-label="MIS panels" className="flex flex-wrap gap-space-sm">
              {panels.map((p) => (
                <button key={p} role="tab" type="button" aria-selected={p === panel} onClick={() => setPanel(p)} className={chip(p === panel)} data-testid={`mis-tab-${p}`}>
                  {PANEL_TITLES[p] ?? p}
                </button>
              ))}
            </div>
          ) : <span />}
          <form className="flex flex-wrap items-end gap-space-sm" onSubmit={(e) => e.preventDefault()} aria-label="Date range for monthly charts">
            <label className="font-label-sm !text-white/80">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} data-testid="mis-from" /></label>
            <label className="font-label-sm !text-white/80">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} data-testid="mis-to" /></label>
            <button type="button" onClick={() => { setFrom(""); setTo(""); }} aria-pressed={!from && !to} className={chip(!from && !to)} data-testid="mis-reset">Last 12 months</button>
            <button type="button" onClick={thisYear} className={chip(false)} data-testid="mis-this-year">This year</button>
          </form>
        </div>
        <p className="font-label-sm !text-white/65 mt-2">The range applies to the monthly charts; headline figures are all time.</p>
      </header>

      {error ? (
        <div role="alert" className="rounded border border-error p-space-md text-error font-body-md" data-testid="mis-error">{error}</div>
      ) : null}
      {note ? <p role="status" className="font-body-sm text-on-surface-variant" data-testid="mis-export-note">{note}</p> : null}
      {loading ? <p role="status" className="font-body-md text-on-surface-variant" data-testid="mis-loading">Loading figures…</p> : null}

      {data && !loading ? (
        <>
          {data.cards.length > 0 ? (
            <ul className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-4" data-testid="mis-cards">
              {data.cards.map((c, i) => (
                <li key={c.key} title={c.note ?? undefined} className="relative overflow-hidden rounded-2xl bg-white shadow-md border border-outline-variant/60 p-space-md" data-testid={`mis-card-${c.key}`}>
                  <span className="flex items-center gap-space-sm">
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${CARD_TONE[i % CARD_TONE.length]}`}><Icon name={iconFor(c.key, c.label)} size={22} /></span>
                    <span className="font-label-md text-on-surface-variant uppercase tracking-wide leading-tight">{c.label}</span>
                  </span>
                  <p className="mt-space-sm text-[34px] leading-none font-bold text-on-surface tabular-nums">{cardValue(c)}</p>
                  {c.note ? <p className="font-label-sm text-on-surface-variant mt-1 truncate">{c.note}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {data.unavailable.map((u) => (
            <p key={u.part} role="status" className="rounded bg-surface-container p-space-md font-body-sm text-on-surface" data-testid="mis-unavailable">
              <strong>{u.part}:</strong> not available yet. {u.reason}
            </p>
          ))}
          <div className="grid gap-space-md lg:grid-cols-2">
            {data.tables.map((t) => (
              <ChartBlock key={t.key} table={t} />
            ))}
          </div>
          <details className="text-on-surface-variant font-label-md">
            <summary>Where these figures come from</summary>
            <p className="mt-1">Sources: {data.sources.join(", ")}.</p>
          </details>
        </>
      ) : null}
    </div>
  );
}
