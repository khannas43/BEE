"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import {
  addToTesting, advanceCase, CATEGORY_WORD, drawAtRandom, readCases, readGrievances, readOverview, readSelection, RECOMMENDATION_WORD, RESULT_WORD,
  readProduct, SOURCE_WORD, STAGE_WORD, STAGES, type Grievance, type Overview, type ProductView, type RankedProduct, type Stage, type TestCase,
} from "@/lib/client/runtimeProductTesting";

/**
 * Product testing (BEE Officer). BEE buys units from the market and tests them at its own cost. Four views: the overview, the grievance inbox
 * (complaints from several channels), the risk-ranked selection list (with a risk-weighted random draw) and the test cases by stage.
 * `?tab=overview|grievances|selection|cases`. A failed test leads only to a recommendation. Local demonstration, not BEE rules.
 */

const card = "rounded-xl border border-[#dbe6f7] bg-white";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const fieldCls = "mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
const labelCls = "block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]";
const btn = "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50";
const btnOutline = "inline-flex items-center gap-1 rounded-lg border border-primary bg-white px-3 py-1.5 text-[13px] font-semibold text-primary disabled:opacity-50";

type Tab = "overview" | "grievances" | "selection" | "cases";
const TABS: { key: Tab; label: string }[] = [{ key: "overview", label: "Overview" }, { key: "grievances", label: "Grievance inbox" }, { key: "selection", label: "Risk selection" }, { key: "cases", label: "Test cases" }];
const COPY: Record<Tab, string> = {
  overview: "Complaints from customers and the compliance risk of each manufacturer decide which products BEE buys from the market and tests, at its own cost.",
  grievances: "Complaints from end customers, from every channel in one list.",
  selection: "Every certified product ranked by review priority. Each score shows the points behind it. Add a product to testing, or draw at random, weighted by risk.",
  cases: "Each product BEE buys and tests moves through five stages. The manufacturer sees only the result.",
};

const stamp = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const day = (iso: string) => stamp(iso).split(",")[0];

const BAND_TONE = { high: "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]", medium: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]", low: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" };
const RESULT_TONE: Record<string, string> = { pass: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]", fail: "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]", retest: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" };

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${tone}`}>{children}</span>;
}

function Tile({ label, value, note, tone = "text-[#14315E]" }: { label: string; value: number | string; note: string; tone?: string }) {
  return (
    <div className={`${card} p-4`}>
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{label}</span>
      <span className={`block text-[26px] font-extrabold leading-8 ${tone}`}>{value}</span>
      <span className="block text-[12px] text-[#64748b]">{note}</span>
    </div>
  );
}

function useLoad<T>(load: () => Promise<{ ok: true; value: T } | { ok: false; message: string }>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await load();
    if (r.ok) { setData(r.value); setError(null); } else setError(r.message);
  }, [load]);
  useEffect(() => {
    let live = true;
    void load().then((r) => { if (!live) return; if (r.ok) setData(r.value); else setError(r.message); });
    return () => { live = false; };
  }, [load]);
  return { data, error, reload };
}

export function ProductTesting() {
  const param = useSearchParams()?.get("tab") ?? "";
  const tab: Tab = param === "grievances" || param === "selection" || param === "cases" ? param : "overview";
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-testing">
      <h1 className="flex-1 min-w-0">Product testing</h1>
      <p className="ai-lead">{COPY[tab]}</p>
      <nav className="flex flex-wrap gap-2" aria-label="Product testing views">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/demo/testing?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} data-testid={`testing-tab-${t.key}`}
            className={`rounded-full border px-4 py-1.5 text-[13px] font-semibold ${tab === t.key ? "border-primary !bg-primary !text-white" : "border-[#c9d9f7] bg-white !text-primary hover:bg-[#f4f8ff]"}`}>{t.label}</Link>
        ))}
      </nav>
      {notice ? <p role="status" className="rounded-lg border border-[#b7e0c6] bg-[#e2f3e8] px-3 py-2 text-[13px] font-semibold text-[#14532d]" data-testid="testing-notice">{notice}</p> : null}
      {tab === "overview" ? <OverviewView /> : tab === "grievances" ? <GrievanceView /> : tab === "selection" ? <SelectionView onDone={setNotice} /> : <CasesView onDone={setNotice} />}
    </div>
  );
}

function Bars({ data, words, tone }: { data: Record<string, number>; words: Record<string, string>; tone: string }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <ul className="space-y-2">
      {Object.entries(data).map(([k, n]) => (
        <li key={k}>
          <div className="flex items-start justify-between gap-2 text-[12px] leading-4 text-on-surface"><span className="min-w-0 break-words">{words[k] ?? k}</span><span className="font-semibold tabular-nums">{n}</span></div>
          <div className="mt-1 h-2 rounded-full bg-[#eef3fb]"><div className="h-2 rounded-full" style={{ width: `${(n / max) * 100}%`, background: tone }} /></div>
        </li>
      ))}
    </ul>
  );
}

function OverviewView() {
  const { data, error } = useLoad<Overview>(readOverview);
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  return (
    <div className="space-y-space-md" data-testid="testing-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open grievances" value={data.openGrievances} note={`${data.grievancesLast30} received in the last 30 days`} tone="text-[#8a4b00]" />
        <Tile label="Products flagged" value={data.flagged} note="high review priority" tone="text-[#93000a]" />
        <Tile label="Cases in progress" value={data.stages.selected + data.stages.procured + data.stages.at_lab + data.stages.result_in} note="not yet closed" />
        <Tile label="Results this quarter" value={data.resultsThisQuarter} note="tested by BEE" />
      </div>
      <ProductPanel />
      <section className={`${card} p-4`}>
        <div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Test cases by stage</div>
        <ol className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {STAGES.map((s, i) => (
            <li key={s} className="rounded-lg border border-[#dbe6f7] bg-[#f9fbff] p-3 text-center">
              <div className="text-[12px] font-semibold text-[#64748b]">{i + 1}. {STAGE_WORD[s]}</div>
              <div className="text-[24px] font-extrabold text-[#14315E]">{data.stages[s]}</div>
            </li>
          ))}
        </ol>
        <Link href="/app/demo/testing?tab=cases" className="mt-3 inline-block text-[13px] font-semibold text-primary hover:underline">Open the test cases</Link>
      </section>
      <div className="grid gap-space-md lg:grid-cols-2">
        <section className={`${card} p-4`}><div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Grievances by source</div><Bars data={data.sources} words={SOURCE_WORD} tone="#254e9e" /></section>
        <section className={`${card} p-4`}><div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Grievances by category</div><Bars data={data.categories} words={CATEGORY_WORD} tone="#c47f17" /></section>
      </div>
      <section className={`${card} p-4`}>
        <div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Highest review priority</div>
        <ul className="divide-y divide-[#e2e8f0]">
          {data.top.map((p) => (
            <li key={p.registrationId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span><b>{p.model}</b> · {p.manufacturer}<span className="block text-[12px] text-[#64748b]">{p.grievances} grievance{p.grievances === 1 ? "" : "s"} in 90 days{p.openCase ? ` · case ${p.openCase}` : ""}</span></span>
              <Chip tone={BAND_TONE[p.band]}>Score {p.score}</Chip>
            </li>
          ))}
        </ul>
        <Link href="/app/demo/testing?tab=selection" className="mt-2 inline-block text-[13px] font-semibold text-primary hover:underline">Open the risk selection</Link>
      </section>
    </div>
  );
}

function ProductPanel() {
  const { data: list } = useLoad<{ products: RankedProduct[]; total: number }>(readSelection);
  const [reg, setReg] = useState("");
  const [view, setView] = useState<ProductView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = reg || list?.products[0]?.registrationId || "";
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    void readProduct(chosen).then((r) => { if (!live) return; if (r.ok) { setView(r.value); setError(null); } else setError(r.message); });
    return () => { live = false; };
  }, [chosen]);
  if (!list) return null;
  const shown = view && view.product.registrationId === chosen ? view : null;
  return (
    <section className={`${card} p-4 space-y-space-sm`} data-testid="product-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Product view: risk, production anomaly and grievances</div>
        <label className={labelCls}>Product
          <select value={chosen} onChange={(e) => setReg(e.target.value)} className={`${fieldCls} w-auto min-w-[280px]`} data-testid="product-select">
            {list.products.map((p) => <option key={p.registrationId} value={p.registrationId}>{p.model} · {p.manufacturer} (score {p.score})</option>)}
          </select>
        </label>
      </div>
      {error ? <p role="alert" className="text-error font-body-sm">{error}</p> : null}
      {!shown ? <p role="status" className="font-body-sm">Loading…</p> : <ProductBody v={shown} />}
    </section>
  );
}

function ProductBody({ v }: { v: ProductView }) {
  const p = v.product;
  const a = v.anomaly;
  const g = v.grievances;
  const maxUnits = Math.max(1, ...(a.quarters ?? []).map((q) => q.units));
  const panel = "rounded-xl border border-[#dbe6f7] bg-[#f9fbff] p-4";
  const head = "mb-2 text-[12px] font-bold uppercase tracking-wide text-[#475569]";
  return (
    <div className="space-y-space-sm">
      <p className="text-[13px] text-[#334155]"><b>{p.model}</b> · {p.brand} · {p.manufacturer} · {p.registrationId} · {p.stars} star · rated ISEER {p.ratedIseer}
        {p.openCase ? <> · <Link href="/app/demo/testing?tab=cases" className="font-semibold text-primary hover:underline">case {p.openCase}</Link></> : null}</p>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className={panel} data-testid="pv-risk">
          <div className={head}>Risk score</div>
          <div className="flex items-center gap-3"><span className="text-[34px] font-extrabold leading-9 text-[#14315E]">{p.score}</span><Chip tone={BAND_TONE[p.band]}>{p.band}</Chip><span className="text-[12px] text-[#64748b]">of 100</span></div>
          <ul className="mt-2 space-y-1 text-[12px]">{p.factors.map((f) => <li key={f.label} className="flex justify-between gap-3"><span>{f.label}</span><b className="tabular-nums">+{f.points}</b></li>)}</ul>
        </div>
        <div className={panel} data-testid="pv-anomaly">
          <div className={head}>Production anomaly</div>
          {!a.found ? <p className="text-[13px] text-[#64748b]">No production reported for this model, so nothing to check yet.</p> : (
            <>
              <Chip tone={a.status === "flagged" ? BAND_TONE.high : BAND_TONE.low}>{a.status === "flagged" ? "Flagged for a look" : "Normal"}</Chip>
              <ul className="mt-2 space-y-1">{(a.quarters ?? []).map((q) => (
                <li key={q.quarter} className="text-[12px]"><div className="flex justify-between"><span>{q.quarter}</span><b className="tabular-nums">{q.units.toLocaleString("en-IN")} units</b></div><div className="mt-0.5 h-1.5 rounded-full bg-[#e2e8f0]"><div className="h-1.5 rounded-full bg-[#254e9e]" style={{ width: `${(q.units / maxUnits) * 100}%` }} /></div></li>
              ))}</ul>
              {a.boundSerials != null ? <p className="mt-2 text-[12px] text-[#64748b]">{a.boundSerials.toLocaleString("en-IN")} QR serials bound.</p> : null}
              {(a.flags ?? []).length > 0 ? <ul className="mt-2 space-y-1 text-[12px] text-[#93000a]">{(a.flags ?? []).map((f, i) => <li key={i}>{f.quarter}: {f.detail}</li>)}</ul> : <p className="mt-2 text-[12px] text-[#64748b]">No quarter stands out against the others.</p>}
            </>
          )}
        </div>
        <div className={panel} data-testid="pv-grievances">
          <div className={head}>Grievances received</div>
          {g.total === 0 ? <p className="text-[13px] text-[#64748b]">None received against this product.</p> : (
            <>
              <p className="text-[13px]"><b className="text-[22px] text-[#14315E]">{g.total}</b> in total, {g.last90} in the last 90 days</p>
              <div className="mt-2"><Bars data={g.byCategory} words={CATEGORY_WORD} tone="#c47f17" /></div>
              <div className="mt-2 text-[12px] text-[#64748b]">Channels: {Object.entries(g.bySource).map(([k, n]) => `${SOURCE_WORD[k] ?? k} ${n}`).join(", ")}</div>
              <ul className="mt-2 space-y-1 text-[12px]">{g.latest.map((x) => <li key={x.reference}><b>{day(x.receivedAt)}</b> · {CATEGORY_WORD[x.category]} · {x.complainant ?? "-"}</li>)}</ul>
              <Link href="/app/demo/testing?tab=grievances" className="mt-2 inline-block text-[12px] font-semibold text-primary hover:underline">Open the grievance inbox</Link>
            </>
          )}
        </div>
      </div>
      {v.cases.length > 0 ? <p className="text-[12px] text-[#64748b]">BEE testing: {v.cases.map((c) => `${c.reference} (${STAGE_WORD[c.stage]}${c.result ? `, ${RESULT_WORD[c.result]}` : ""})`).join(", ")}.</p> : null}
    </div>
  );
}

function GrievanceView() {
  const { data, error } = useLoad<{ grievances: Grievance[] }>(readGrievances);
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const rows = (data?.grievances ?? []).filter((g) => (!source || g.source === source) && (!category || g.category === category) && (!status || g.status === status));
  const tools = useListTools<Grievance>({
    rows,
    text: (g) => `${g.reference} ${g.model} ${g.manufacturer} ${g.complainant ?? ""} ${g.summary} ${SOURCE_WORD[g.source]} ${CATEGORY_WORD[g.category]}`,
    date: (g) => g.receivedAt.slice(0, 10),
    sortValue: (g, k) => (k === "ref" ? g.reference : k === "source" ? g.source : k === "cat" ? g.category : k === "model" ? g.model : k === "status" ? g.status : g.receivedAt),
    pageSize: 10,
  });
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  const STATUS = { open: "Open", in_testing: "In testing", closed: "Closed" } as const;
  return (
    <div className="space-y-space-sm" data-testid="testing-grievances">
      <section className={`${card} p-4 space-y-space-sm`}>
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Filters</div>
        <ListToolbar tools={tools} searchLabel="Search" placeholder="Reference, model, person or text" dateLabel="Received"
          exportCsv={{ filename: "grievances", header: ["Reference", "Received", "Source", "Category", "Model", "Manufacturer", "Complainant", "Contact", "Status", "Complaint"], rows: tools.visible.map((g) => [g.reference, day(g.receivedAt), SOURCE_WORD[g.source], CATEGORY_WORD[g.category], g.model, g.manufacturer, g.complainant ?? "", g.contact ?? "", STATUS[g.status], g.summary]) }} />
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>Source<select value={source} onChange={(e) => { setSource(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="grievance-source"><option value="">All</option>{Object.entries(SOURCE_WORD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={labelCls}>Category<select value={category} onChange={(e) => { setCategory(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="grievance-category"><option value="">All</option>{Object.entries(CATEGORY_WORD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={labelCls}>Status<select value={status} onChange={(e) => { setStatus(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="grievance-status"><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
      </section>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]" data-testid="grievance-table">
          <caption className="sr-only">Grievances, newest first</caption>
          <thead><tr className="bg-[#eef3fb]">
            <SortableTh tools={tools} k="ref" className={th}>Reference</SortableTh><SortableTh tools={tools} k="date" className={th}>Received</SortableTh><SortableTh tools={tools} k="source" className={th}>Source</SortableTh>
            <SortableTh tools={tools} k="cat" className={th}>Category</SortableTh><SortableTh tools={tools} k="model" className={th}>Product</SortableTh><th className={th}>Complainant</th><SortableTh tools={tools} k="status" className={th}>Status</SortableTh>
          </tr></thead>
          <tbody>
            {tools.paged.pageRows.length === 0 ? <tr><td className={td} colSpan={7}>No grievance for this selection.</td></tr> : tools.paged.pageRows.map((g) => (
              <tr key={g.reference} className="border-t border-[#e2e8f0]">
                <td className={`${td} font-semibold`}>{g.reference}</td><td className={`${td} whitespace-nowrap`}>{day(g.receivedAt)}</td><td className={td}>{SOURCE_WORD[g.source]}</td>
                <td className={td}>{CATEGORY_WORD[g.category]}<div className="max-w-[320px] text-[12px] text-[#64748b]">{g.summary}</div></td>
                <td className={td}>{g.model}<div className="text-[12px] text-[#64748b]">{g.manufacturer}</div></td>
                <td className={td}>{g.complainant ?? "-"}<div className="text-[12px] text-[#64748b]">{g.contact}</div></td>
                <td className={td}><Chip tone={g.status === "open" ? "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" : g.status === "in_testing" ? "border-[#c9d9f7] bg-[#e7effb] text-[#14315E]" : "border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]"}>{STATUS[g.status]}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}

function SelectionView({ onDone }: { onDone: (m: string) => void }) {
  const { data, error, reload } = useLoad<{ products: RankedProduct[]; total: number }>(readSelection);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState("3");
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  const add = async (p: RankedProduct) => {
    setBusy(true); setProblem(null);
    const r = await addToTesting(p.registrationId);
    setBusy(false);
    if (r.ok) { onDone(`${p.model} was added to testing as case ${String(r.value.reference)}.`); void reload(); } else setProblem(r.message);
  };
  const draw = async () => {
    setBusy(true); setProblem(null);
    const r = await drawAtRandom(Number(size));
    setBusy(false);
    if (r.ok) { onDone(`Drew ${(r.value.references as string[]).length} products at random, weighted by risk (${(r.value.references as string[]).join(", ")}). The draw is recorded.`); void reload(); } else setProblem(r.message);
  };
  return (
    <div className="space-y-space-sm" data-testid="testing-selection">
      <section className={`${card} flex flex-wrap items-end justify-between gap-3 p-4`}>
        <div className="max-w-xl text-[13px] text-[#334155]"><b>Risk-weighted random draw.</b> Every product that is not already in testing has a chance of being drawn in proportion to its risk score plus a small base, so higher risk is more likely but nothing is certain. The seed and weights of each draw are kept.</div>
        <div className="flex items-end gap-2">
          <label className={labelCls}>How many<select value={size} onChange={(e) => setSize(e.target.value)} className={`${fieldCls} w-auto`} data-testid="draw-size">{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <button type="button" className={btn} disabled={busy} onClick={() => void draw()} data-testid="draw-button"><Icon name="casino" size={16} /> Draw at random</button>
        </div>
      </section>
      {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{problem}</p> : null}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]" data-testid="selection-table">
          <caption className="sr-only">Products ranked by review priority</caption>
          <thead><tr className="bg-[#eef3fb]"><th className={th}>Rank</th><th className={th}>Product</th><th className={th}>Manufacturer</th><th className={th}>Grievances (90 days)</th><th className={th}>Review priority</th><th className={th}>Why</th><th className={th}>Testing</th></tr></thead>
          <tbody>
            {data.products.map((p, i) => (
              <tr key={p.registrationId} className="border-t border-[#e2e8f0]">
                <td className={td}>{i + 1}</td>
                <td className={td}><span className="font-semibold">{p.model}</span><div className="text-[12px] text-[#64748b]">{p.registrationId} · {p.stars} star</div></td>
                <td className={td}>{p.manufacturer}</td><td className={td}>{p.grievances}</td>
                <td className={td}><Chip tone={BAND_TONE[p.band]}>{p.score} · {p.band}</Chip></td>
                <td className={td}>
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setOpen(open === p.registrationId ? null : p.registrationId)} aria-expanded={open === p.registrationId} data-testid={`why-${p.registrationId}`}>{open === p.registrationId ? "Hide" : "Show points"}</button>
                  {open === p.registrationId ? <ul className="mt-2 max-w-[360px] space-y-1 text-[12px]">{p.factors.map((f) => <li key={f.label} className="flex justify-between gap-3"><span>{f.label}</span><b className="tabular-nums">+{f.points}</b></li>)}<li className="flex justify-between gap-3 border-t border-[#e2e8f0] pt-1"><b>Total (at most 100)</b><b className="tabular-nums">{p.score}</b></li></ul> : null}
                </td>
                <td className={td}>{p.openCase ? <Link href="/app/demo/testing?tab=cases" className="font-semibold text-primary hover:underline">{p.openCase}</Link> : <button type="button" className={btnOutline} disabled={busy} onClick={() => void add(p)} data-testid={`add-${p.registrationId}`}>Add to testing</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-[#64748b]">The top {data.products.length} of {data.total} certified products are shown. Review priority only, not a finding.</p>
    </div>
  );
}

const NEXT_HINT: Record<Exclude<Stage, "closed">, string> = {
  selected: "Record where BEE bought the unit.", procured: "Record the laboratory the unit was sent to.", at_lab: "Record the test result.", result_in: "Close the case with a recommendation.",
};

function CasesView({ onDone }: { onDone: (m: string) => void }) {
  const { data, error, reload } = useLoad<{ cases: TestCase[] }>(readCases);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  const current = data.cases.find((c) => c.id === openId) ?? null;
  return (
    <div className="space-y-space-md" data-testid="testing-cases">
      <div className="grid gap-3 lg:grid-cols-5">
        {STAGES.map((s, i) => {
          const list = data.cases.filter((c) => c.stage === s);
          return (
            <section key={s} className="rounded-xl border border-[#dbe6f7] bg-[#f9fbff] p-3" data-testid={`stage-${s}`}>
              <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[#475569]">{i + 1}. {STAGE_WORD[s]} <span className="text-[#14315E]">({list.length})</span></div>
              <ul className="space-y-2">
                {list.length === 0 ? <li className="text-[12px] text-[#64748b]">None</li> : list.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-pressed={openId === c.id} data-testid={`case-${c.reference}`}
                      className={`w-full rounded-lg border bg-white p-2 text-left text-[12px] hover:border-[#9dbdec] ${openId === c.id ? "border-[#254e9e] ring-2 ring-[#c9d9f7]" : "border-[#dbe6f7]"}`}>
                      <span className="block font-bold text-[#14315E]">{c.model}</span><span className="block text-[#64748b]">{c.reference} · {c.manufacturer}</span>
                      {c.result ? <span className="mt-1 block"><Chip tone={RESULT_TONE[c.result]}>{RESULT_WORD[c.result]}</Chip></span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {current ? <CaseDetail key={current.id} c={current} onDone={(m) => { onDone(m); void reload(); }} /> : <p className="text-[13px] text-[#64748b]">Pick a case to see its history and move it to the next stage.</p>}
    </div>
  );
}

function CaseDetail({ c, onDone }: { c: TestCase; onDone: (m: string) => void }) {
  const [form, setForm] = useState<Record<string, string>>({ result: "pass", recommendation: "none", testedOn: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setBusy(true); setProblem(null);
    const r = await advanceCase(c.id, form);
    setBusy(false);
    if (r.ok) onDone(`Case ${c.reference} moved to "${STAGE_WORD[r.value.stage as Stage]}".`); else setProblem(r.message);
  };
  const last = c.stage === "closed";
  return (
    <section className={`${card} p-5 space-y-space-sm`} data-testid="case-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">{c.model} · {c.reference}</div><div className="text-[13px] text-[#64748b]">{c.brand} · {c.manufacturer} · {c.registrationId}</div></div>
        <Chip tone="border-[#c9d9f7] bg-[#e7effb] text-[#14315E]">{STAGE_WORD[c.stage]}</Chip>
      </div>
      <p className="text-[13px] text-[#334155]"><b>{c.basis === "risk" ? "Chosen from the risk ranking" : c.basis === "random" ? "Risk-weighted random draw" : "Chosen by the Officer"}{c.riskScore != null ? ` (score ${c.riskScore})` : ""}:</b> {c.reason}</p>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className={labelCls}>Bought from</dt><dd>{c.procuredFrom ?? "Not yet"}</dd></div>
        <div><dt className={labelCls}>Laboratory</dt><dd>{c.laboratory ?? "Not yet"}</dd></div>
        <div><dt className={labelCls}>Result</dt><dd>{c.result ? <Chip tone={RESULT_TONE[c.result]}>{RESULT_WORD[c.result]}</Chip> : "Not yet"}{c.measuredIseer ? <span className="ml-2">ISEER {c.measuredIseer} against {c.ratedIseer} rated</span> : null}</dd></div>
        <div><dt className={labelCls}>Recommendation</dt><dd>{c.recommendation ? RECOMMENDATION_WORD[c.recommendation] : "Not yet"}</dd></div>
      </dl>
      <div>
        <div className={labelCls}>History</div>
        <ol className="mt-1 space-y-1 text-[13px]">{c.history.map((h, i) => <li key={i}><b>{STAGE_WORD[h.stage]}</b> · {stamp(h.at)}{h.by ? ` · ${h.by}` : ""}{h.note ? <span className="text-[#475569]"> · {h.note}</span> : null}</li>)}</ol>
      </div>
      {last ? <p className="rounded-lg bg-[#f1f5f9] px-3 py-2 text-[13px] text-[#475569]">This case is closed.</p> : (
        <div className="rounded-xl border border-[#dbe6f7] bg-[#f9fbff] p-4 space-y-space-sm">
          <div className="text-[14px] font-bold text-[#14315E]">Next: {STAGE_WORD[STAGES[STAGES.indexOf(c.stage) + 1]]}</div>
          <p className="text-[12px] text-[#64748b]">{NEXT_HINT[c.stage as Exclude<Stage, "closed">]}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.stage === "selected" ? <label className={labelCls}>Bought from<input className={fieldCls} value={form.procuredFrom ?? ""} onChange={(e) => set("procuredFrom", e.target.value)} placeholder="Shop or channel and city" data-testid="adv-procured" /></label> : null}
            {c.stage === "procured" ? <label className={labelCls}>Laboratory<input className={fieldCls} value={form.laboratory ?? ""} onChange={(e) => set("laboratory", e.target.value)} placeholder="Name and city" data-testid="adv-lab" /></label> : null}
            {c.stage === "at_lab" ? (
              <>
                <label className={labelCls}>Result<select className={fieldCls} value={form.result} onChange={(e) => set("result", e.target.value)} data-testid="adv-result"><option value="pass">Pass</option><option value="fail">Fail</option><option value="retest">Retest</option></select></label>
                <label className={labelCls}>Measured ISEER (rated {c.ratedIseer})<input className={fieldCls} inputMode="decimal" value={form.measuredIseer ?? ""} onChange={(e) => set("measuredIseer", e.target.value)} data-testid="adv-iseer" /></label>
                <label className={labelCls}>Tested on<input type="date" className={fieldCls} value={form.testedOn} onChange={(e) => set("testedOn", e.target.value)} data-testid="adv-date" /></label>
              </>
            ) : null}
            {c.stage === "result_in" ? (
              <label className={labelCls}>Recommendation<select className={fieldCls} value={form.recommendation} onChange={(e) => set("recommendation", e.target.value)} data-testid="adv-recommendation">
                {Object.entries(RECOMMENDATION_WORD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            ) : null}
            <label className={`${labelCls} sm:col-span-2`}>Note (optional)<input className={fieldCls} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} maxLength={500} data-testid="adv-note" /></label>
          </div>
          {c.stage === "result_in" ? <p className="text-[12px] text-[#64748b]">A recommendation is only advice to the Director. A hold is decided through the usual approval, not here.</p> : null}
          {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{problem}</p> : null}
          <button type="button" className={btn} disabled={busy} onClick={() => void submit()} data-testid="adv-submit">Move to {STAGE_WORD[STAGES[STAGES.indexOf(c.stage) + 1]]}</button>
        </div>
      )}
    </section>
  );
}
