"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pill } from "./DemoShell";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath } from "@/lib/client/runtimeDemo";
import { istStamp } from "@/lib/client/istTime";

/**
 * The Director's and the Auditor's dashboards (demonstration). Tiles with a live figure and the first rows; a click opens the full list behind
 * the figure, with search, sort and downloads. Read only: every figure is computed by Spring from the live tables on each read.
 */
type Cell = string | number | boolean | null;
type TileBody = { key: string; label: string; value: number; unit: string; hint: string; tone: "good" | "attention" | "neutral"; columns: string[]; rows: Cell[][]; note: string | null; href: string | null };
type Overview = { view: string; title: string; asOf: string; tiles: TileBody[]; note: string };
type Drill = { key: string; label: string; hint: string; columns: string[]; rows: Cell[][]; total: number; shown: number; note: string | null; href: string | null };

const TONE: Record<string, string> = {
  good: "border-l-[6px] border-l-[#2e7d4f]",
  attention: "border-l-[6px] border-l-[#c7881a]",
  neutral: "border-l-[6px] border-l-[#3b5ea8]",
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** What a cell shows: instants in IST, a status word as a pill, anything else as text. */
function show(value: Cell, column: string): React.ReactNode {
  if (value === null || value === "") return "";
  if (typeof value === "string" && ISO.test(value)) return istStamp(value, false);
  if (/^(Chain|Stage|State|Ledger|Band|Decision|Event)$/.test(column) && typeof value === "string") return <Pill>{value.replaceAll("_", " ")}</Pill>;
  return String(value);
}

const plain = (value: Cell): string => (value === null ? "" : typeof value === "string" && ISO.test(value) ? istStamp(value, false) : String(value));

function DrillTable({ view, tile }: { view: string; tile: TileBody }) {
  const [data, setData] = useState<Drill | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void demoGet<Drill>(demoPath("dashboard", view, tile.key)).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.value); setError(null); } else setError(r.message);
    });
    return () => { live = false; };
  }, [view, tile.key]);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const tools = useListTools({
    rows,
    text: (r) => r.map(plain).join(" "),
    sortValue: (r, k) => { const v = r[Number(k)]; return typeof v === "number" ? v : plain(v ?? null).toLowerCase(); },
  });
  if (error) return <p role="alert" className="text-error font-body-md">{error}</p>;
  if (!data) return <p role="status" className="font-body-md">Loading…</p>;
  return (
    <section className="rounded-xl bg-surface-card shadow-md p-space-md space-y-space-sm" aria-labelledby="dash-drill-h" data-testid="dash-drill">
      <div className="flex flex-wrap items-baseline justify-between gap-space-sm">
        <h2 id="dash-drill-h" className="font-title-md text-title-md text-on-surface">{data.label} <span className="text-on-surface-variant font-body-md">· {data.total} in all{data.shown < data.total ? `, the first ${data.shown} shown` : ""}</span></h2>
        {data.href ? <Link href={data.href} className="text-primary underline font-label-md" data-testid="dash-open-screen">Open the working screen</Link> : null}
      </div>
      <p className="font-body-sm text-on-surface-variant">{data.hint}{data.note ? ` ${data.note}` : ""}</p>
      {data.rows.length === 0 ? <p className="font-body-md" data-testid="dash-drill-empty">Nothing to show: no records match this figure right now.</p> : (
        <>
          <ListToolbar tools={tools} searchLabel="Search this list" placeholder="Type to search"
            exportCsv={{ filename: `${view}-${data.key}`, header: data.columns, rows: tools.visible.map((r) => r.map((c) => (typeof c === "number" ? c : plain(c)))) }} />
          <div className="overflow-x-auto">
            <table className="w-full text-left font-body-sm" data-testid="dash-drill-table">
              <caption className="sr-only">{data.label}</caption>
              <thead><tr className="text-on-surface-variant font-label-sm">
                {data.columns.map((c, i) => <SortableTh key={c} tools={tools} k={String(i)} className="py-1 pr-3">{c}</SortableTh>)}
              </tr></thead>
              <tbody>
                {tools.paged.pageRows.map((r, i) => (
                  <tr key={i} className="border-t border-outline-variant" data-testid="dash-drill-row">
                    {r.map((c, j) => <td key={j} className="py-1 pr-3 align-top">{show(c, data.columns[j])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager tools={tools} />
        </>
      )}
    </section>
  );
}

export function RoleDashboard({ view }: { view: "director" | "auditor" }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void demoGet<Overview>(demoPath("dashboard", view)).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.value); setError(null); } else setError(r.message);
    });
    return () => { live = false; };
  }, [view, tick]);

  const selected = data?.tiles.find((t) => t.key === open) ?? null;

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid={`dashboard-${view}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-space-sm">
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">{data?.title ?? (view === "director" ? "Director's dashboard" : "Auditor's dashboard")}</h1>
          <p className="font-body-sm text-on-surface-variant mt-1">{data ? `As of ${istStamp(data.asOf, false)} IST. Every figure is calculated at this moment. Click a figure to see the records behind it.` : "Loading…"}</p>
        </div>
        <button type="button" onClick={() => setTick((n) => n + 1)} className="px-space-md py-1 rounded border border-primary text-primary font-label-md" data-testid="dash-refresh">Refresh</button>
      </div>
      {error ? <p role="alert" className="text-error font-body-md">{error}</p> : null}
      <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-3">
        {data?.tiles.map((t) => (
          <button key={t.key} type="button" onClick={() => setOpen(open === t.key ? null : t.key)} aria-pressed={open === t.key} data-testid={`dash-tile-${t.key}`}
            className={`text-left rounded-xl bg-surface-card shadow-md p-space-md ${TONE[t.tone] ?? ""} ${open === t.key ? "ring-2 ring-primary" : ""}`}>
            <span className="font-label-md text-on-surface-variant uppercase tracking-wide">{t.label}</span>
            <span className="block mt-1"><span className="font-display-sm text-[34px] leading-none font-semibold text-on-surface" data-testid={`dash-value-${t.key}`}>{t.value}</span> <span className="font-body-sm text-on-surface-variant">{t.unit}</span></span>
            <span className="block font-body-sm text-on-surface-variant mt-1">{t.hint}</span>
            {t.note ? <span className="block font-label-sm text-on-surface-variant mt-1">{t.note}</span> : null}
            {t.rows.length > 0 ? (
              <ul className="mt-space-sm space-y-0.5 font-label-sm text-on-surface">
                {t.rows.slice(0, 3).map((r, i) => <li key={i} className="truncate">{plain(r[0] ?? null)}{r[1] !== undefined && r[1] !== null ? ` · ${plain(r[1])}` : ""}</li>)}
              </ul>
            ) : null}
            <span className="block mt-space-sm text-primary font-label-md">{open === t.key ? "Hide the list" : "See the list"}</span>
          </button>
        ))}
      </div>
      {selected ? <DrillTable view={view} tile={selected} /> : <p className="font-body-sm text-on-surface-variant">Choose a figure to open its list.</p>}
    </div>
  );
}
