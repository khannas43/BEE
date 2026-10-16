"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { demoGet, demoPath, type DemoResult } from "@/lib/client/runtimeDemo";

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

function BarChart({ table }: { table: Table }) {
  const values = table.rows.map((r) => Number(r[1] ?? 0));
  const max = Math.max(1, ...values);
  return (
    <ul className="space-y-1" role="img" aria-label={`${table.title}: bar chart of ${table.columns[1]}. The same figures are in the table below.`}>
      {table.rows.map((r, i) => (
        <li key={i} className="flex items-center gap-space-sm font-label-sm text-label-sm" aria-hidden="true">
          <span className="w-40 shrink-0 truncate text-on-surface-variant" title={String(r[0])}>{String(r[0])}</span>
          <span className="flex-1 bg-surface-container rounded h-3">
            <span className="block h-3 rounded bg-primary" style={{ width: `${(values[i] / max) * 100}%` }} />
          </span>
          <span className="w-16 text-right text-on-surface">{fmt(r[1])}</span>
        </li>
      ))}
    </ul>
  );
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

function ChartBlock({ table }: { table: Table }) {
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`mis-chart-${table.key}`} aria-labelledby={`mis-h-${table.key}`}>
      <h3 id={`mis-h-${table.key}`} className="font-title-md text-title-md text-on-surface mb-space-sm">{table.title}</h3>
      {table.rows.length === 0 ? null : table.chart === "bar" ? <BarChart table={table} /> : table.chart === "line" ? <LineChart table={table} /> : null}
      <DataTable table={table} />
    </section>
  );
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

  const exportCsv = useCallback(async () => {
    setNote(null);
    setExportError(null);
    const r = await demoGet<ExportBody>(demoPath("mis", "export") + `?panel=${encodeURIComponent(panel)}${query ? "&" + query.slice(1) : ""}`);
    if (r.ok) {
      download(r.value.filename, r.value.csv);
      setNote(`Downloaded ${r.value.filename}.`);
    } else {
      setExportError(r.message);
    }
  }, [panel, query]);

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-mis">
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">MIS dashboard</h1>
      </div>

      {panels && panels.length > 1 ? (
        <div role="tablist" aria-label="MIS panels" className="flex flex-wrap gap-space-sm">
          {panels.map((p) => (
            <button
              key={p}
              role="tab"
              type="button"
              aria-selected={p === panel}
              onClick={() => setPanel(p)}
              className={`px-space-md py-1 rounded-full font-label-md text-label-md ${p === panel ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface"}`}
              data-testid={`mis-tab-${p}`}
            >
              {PANEL_TITLES[p] ?? p}
            </button>
          ))}
        </div>
      ) : null}

      <form className="flex flex-wrap items-end gap-space-md" onSubmit={(e) => e.preventDefault()} aria-label="Date range for monthly charts">
        <label className="font-label-sm text-label-sm text-on-surface-variant">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 rounded border border-outline-variant px-2 py-1 text-on-surface" data-testid="mis-from" />
        </label>
        <label className="font-label-sm text-label-sm text-on-surface-variant">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 rounded border border-outline-variant px-2 py-1 text-on-surface" data-testid="mis-to" />
        </label>
        <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="px-space-md py-1 rounded bg-surface-container text-on-surface font-label-md" data-testid="mis-reset">Last 12 months</button>
        <button type="button" onClick={() => setReload((n) => n + 1)} className="px-space-md py-1 rounded bg-surface-container text-on-surface font-label-md" data-testid="mis-refresh">Refresh</button>
        <button type="button" onClick={exportCsv} disabled={!panel || !data} className="px-space-md py-1 rounded bg-primary text-on-primary font-label-md disabled:opacity-50" data-testid="mis-export">Download CSV</button>
        <span className="font-label-sm text-label-sm text-on-surface-variant">The range applies to the monthly charts; headline figures are all time.</span>
      </form>

      {error ? (
        <div role="alert" className="rounded border border-error p-space-md text-error font-body-md" data-testid="mis-error">{error}</div>
      ) : null}
      {note ? <p role="status" className="font-body-sm text-on-surface-variant" data-testid="mis-export-note">{note}</p> : null}
      {loading ? <p role="status" className="font-body-md text-on-surface-variant" data-testid="mis-loading">Loading figures…</p> : null}

      {data && !loading ? (
        <>
          <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="mis-asof">
            As of {new Date(data.asOf).toLocaleString("en-IN")} · data version <code>{data.dataVersion}</code> · range {data.from} to {data.to} · sources: {data.sources.join(", ")}
          </p>
          {data.cards.length > 0 ? (
            <ul className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-4" data-testid="mis-cards">
              {data.cards.map((c) => (
                <li key={c.key} className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid={`mis-card-${c.key}`}>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">{c.label}</p>
                  <p className="font-headline-sm text-headline-sm text-on-surface mt-1">{cardValue(c)}</p>
                  {c.note ? <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{c.note}</p> : null}
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
        </>
      ) : null}
    </div>
  );
}
