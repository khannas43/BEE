"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import {
  addToTesting, advanceCase, CATEGORY_WORD, drawAtRandom, readCases, readGrievances, readOverview, RECOMMENDATION_WORD, RESULT_WORD,
  readProduct, SOURCE_WORD, STAGE_WORD, STAGES, type Grievance, type Overview, type ProductView, type Stage, type TestCase,
} from "@/lib/client/runtimeProductTesting";

/**
 * Product testing (BEE Officer). BEE buys units from the market and tests them at its own cost. Four views: the overview, the grievance inbox
 * (complaints from several channels), and the test cases by stage; the shortlist has the risk-weighted random draw.
 * `?tab=overview|grievances|cases`. A failed test leads only to a recommendation. Local demonstration, not BEE rules.
 */

export const card = "rounded-xl border border-[#dbe6f7] bg-white";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
export const fieldCls = "mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px]";
export const labelCls = "block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]";
export const btn = "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50";
export const btnOutline = "inline-flex items-center gap-1 rounded-lg border border-primary bg-white px-3 py-1.5 text-[13px] font-semibold text-primary disabled:opacity-50";

type Tab = "overview" | "grievances" | "cases";
const TABS: { key: Tab; label: string }[] = [{ key: "overview", label: "Overview" }, { key: "grievances", label: "Grievance inbox" }, { key: "cases", label: "Test cases" }];
const COPY: Record<Tab, string> = {
  overview: "Products shortlisted for random testing, from complaints and compliance risk. Open one to see why it was picked and to approve it for testing. BEE buys the units from the market and tests them at its own cost.",
  grievances: "Complaints from end customers, from every channel in one list.",
  cases: "Products the Officer has approved for testing, one row each. Open a case to see its progress and move it to the next step. The manufacturer sees only the result.",
};

export const stamp = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
export const day = (iso: string) => stamp(iso).split(",")[0];

export const BAND_TONE = { high: "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]", medium: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]", low: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" };
const RESULT_TONE: Record<string, string> = { pass: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]", fail: "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]", retest: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" };

export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
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
  const tab: Tab = param === "grievances" || param === "cases" ? param : "overview";
  const approved = useSearchParams()?.get("approved") ?? "";
  const [notice, setNotice] = useState<string | null>(approved ? `Case ${approved} was approved for testing. BEE now buys a unit from the market and tests it.` : null);
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
      {tab === "overview" ? <OverviewView onDone={setNotice} /> : tab === "grievances" ? <GrievanceView onDone={setNotice} /> : <CasesView onDone={setNotice} />}
    </div>
  );
}

export function Bars({ data, words, tone }: { data: Record<string, number>; words: Record<string, string>; tone: string }) {
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

function OverviewView({ onDone }: { onDone: (m: string) => void }) {
  const { data, error } = useLoad<Overview>(readOverview);
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  return (
    <div className="space-y-space-md" data-testid="testing-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/app/demo/testing?tab=grievances&status=active" className="block hover:opacity-90" data-testid="tile-open-grievances" aria-label="Open grievances: go to the list">
          <Tile label="Open grievances" value={data.openGrievances} note={`${data.grievancesLast30} in the last 30 days. Click to list them`} tone="text-[#8a4b00]" />
        </Link>
        <Tile label="Products flagged" value={data.flagged} note="high review priority" tone="text-[#93000a]" />
        <Tile label="Cases in progress" value={data.stages.selected + data.stages.procured + data.stages.at_lab + data.stages.result_in} note="not yet closed" />
        <Tile label="Results this quarter" value={data.resultsThisQuarter} note="tested by BEE" />
      </div>
      <ShortlistTable onDone={onDone} />
      <div className="grid gap-space-md lg:grid-cols-2">
        <section className={`${card} p-4`}><div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Grievances by source</div><Bars data={data.sources} words={SOURCE_WORD} tone="#254e9e" /></section>
        <section className={`${card} p-4`}><div role="heading" aria-level={2} className="mb-3 text-[16px] font-bold text-[#14315E]">Grievances by category</div><Bars data={data.categories} words={CATEGORY_WORD} tone="#c47f17" /></section>
      </div>
    </div>
  );
}

/** The list status of a case: waiting for the Officer, not approved, in testing (approved, not yet resulted) or tested (result in or closed). */
export type ListStatus = "waiting" | "in_testing" | "tested";
export const LIST_STATUS_WORD: Record<ListStatus, string> = { waiting: "Waiting for approval", in_testing: "In testing", tested: "Tested" };
export const listStatusOf = (stage: Stage): ListStatus => (stage === "shortlisted" || stage === "not_approved" ? "waiting" : stage === "result_in" || stage === "closed" ? "tested" : "in_testing");
const LIST_STATUS_TONE: Record<ListStatus, string> = {
  waiting: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]",
  in_testing: "border-[#c9d9f7] bg-[#e7effb] text-[#14315E]", tested: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]",
};

function ShortlistTable({ onDone }: { onDone: (m: string) => void }) {
  const router = useRouter();
  const { data, error, reload } = useLoad<{ cases: TestCase[] }>(readCases);
  const [size, setSize] = useState("3");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [basis, setBasis] = useState("");
  const all = data?.cases ?? [];
  const rows = all.filter((c) => (!status || listStatusOf(c.stage) === status) && (!basis || c.basis === basis));
  const tools = useListTools<TestCase>({
    rows,
    text: (c) => `${c.reference} ${c.model} ${c.brand} ${c.manufacturer} ${c.reason}`,
    date: (c) => c.selectedAt.slice(0, 10),
    sortValue: (c, k) => (k === "ref" ? c.reference : k === "model" ? c.model : k === "mfr" ? c.manufacturer : k === "score" ? c.riskScore ?? 0 : k === "basis" ? c.basis : k === "status" ? listStatusOf(c.stage) : c.selectedAt),
    pageSize: 12,
  });
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  const draw = async () => {
    setBusy(true); setProblem(null);
    const r = await drawAtRandom(Number(size));
    setBusy(false);
    if (r.ok) { const refs = r.value.references as string[]; onDone(`Drew ${refs.length} product${refs.length === 1 ? "" : "s"} at random, weighted by risk (${refs.join(", ")}). They are on the shortlist, waiting for the Officer.`); void reload(); } else setProblem(r.message);
  };
  const open = (c: TestCase) => router.push(`/app/demo/testing/product?reg=${encodeURIComponent(c.registrationId)}&case=${encodeURIComponent(c.reference)}`);
  return (
    <section className="space-y-space-sm" data-testid="shortlist">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Shortlisted for random testing</div>
        <div className="flex items-end gap-2">
          <label className={labelCls}>Random draw<select value={size} onChange={(e) => setSize(e.target.value)} className={`${fieldCls} w-auto`} data-testid="draw-size" title="Products are drawn in proportion to their risk score plus a base of 5; the seed and weights are kept">{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} product{n === 1 ? "" : "s"}</option>)}</select></label>
          <button type="button" className={btn} disabled={busy} onClick={() => void draw()} data-testid="draw-button"><Icon name="casino" size={16} /> Draw at random</button>
        </div>
      </div>
      {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{problem}</p> : null}
      <section className={`${card} p-4 space-y-space-sm`}>
        <ListToolbar tools={tools} searchLabel="Search" placeholder="Product, manufacturer or reference" dateLabel="Shortlisted"
          exportCsv={{ filename: "shortlist", header: ["Case", "Product", "Manufacturer", "Risk score", "Basis", "Shortlisted", "Status"], rows: tools.visible.map((c) => [c.reference, c.model, c.manufacturer, c.riskScore ?? "", c.basis, day(c.selectedAt), LIST_STATUS_WORD[listStatusOf(c.stage)]]) }} />
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>Status<select value={status} onChange={(e) => { setStatus(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="shortlist-status"><option value="">All</option>{(Object.keys(LIST_STATUS_WORD) as ListStatus[]).map((k) => <option key={k} value={k}>{LIST_STATUS_WORD[k]}</option>)}</select></label>
          <label className={labelCls}>Picked by<select value={basis} onChange={(e) => { setBasis(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="shortlist-basis"><option value="">All</option><option value="random">Random draw</option><option value="risk">Risk ranking</option><option value="manual">Officer</option></select></label>
        </div>
      </section>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]" data-testid="shortlist-table">
          <caption className="sr-only">Products shortlisted for random testing, with their status</caption>
          <thead><tr className="bg-[#eef3fb]">
            <SortableTh tools={tools} k="ref" className={th}>Case</SortableTh><SortableTh tools={tools} k="model" className={th}>Product</SortableTh><SortableTh tools={tools} k="mfr" className={th}>Manufacturer</SortableTh>
            <SortableTh tools={tools} k="score" className={th}>Risk score</SortableTh><SortableTh tools={tools} k="basis" className={th}>Picked by</SortableTh><SortableTh tools={tools} k="date" className={th}>Shortlisted</SortableTh><SortableTh tools={tools} k="status" className={th}>Status</SortableTh>
          </tr></thead>
          <tbody>
            {tools.paged.pageRows.length === 0 ? <tr><td className={td} colSpan={7}>No product on the shortlist for this selection.</td></tr> : tools.paged.pageRows.map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-[#e2e8f0] hover:bg-[#f4f8ff]" onClick={() => open(c)} data-testid={`shortlist-row-${c.reference}`}>
                <td className={`${td} font-semibold`}><Link href={`/app/demo/testing/product?reg=${encodeURIComponent(c.registrationId)}&case=${encodeURIComponent(c.reference)}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{c.reference}</Link></td>
                <td className={td}>{c.model}<div className="text-[12px] text-[#64748b]">{c.registrationId}</div></td><td className={td}>{c.manufacturer}</td>
                <td className={td}>{c.riskScore ?? "-"}</td><td className={td}>{c.basis === "random" ? "Random draw (risk-weighted)" : c.basis === "risk" ? "Risk ranking" : "Officer"}</td>
                <td className={`${td} whitespace-nowrap`}>{day(c.selectedAt)}</td>
                <td className={td}><Chip tone={LIST_STATUS_TONE[listStatusOf(c.stage)]}>{LIST_STATUS_WORD[listStatusOf(c.stage)]}</Chip>{STAGES.includes(c.stage) ? <div className="mt-1 text-[12px] text-[#64748b]">{STAGE_WORD[c.stage]}{c.result ? `: ${RESULT_WORD[c.result]}` : ""}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
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
        {p.openCase ? <> · <Link href={`/app/demo/testing?tab=cases&case=${p.openCase}`} className="font-semibold text-primary hover:underline">case {p.openCase}</Link></> : null}</p>
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

function GrievanceView({ onDone, initialStatus }: { onDone: (m: string) => void; initialStatus?: string }) {
  const { data, error, reload } = useLoad<{ grievances: Grievance[] }>(readGrievances);
  const fromUrl = useSearchParams()?.get("status") ?? "";
  const startStatus = initialStatus ?? fromUrl;
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(["active", "open", "in_testing", "closed"].includes(startStatus) ? startStatus : "");
  const [openRef, setOpenRef] = useState<string | null>(null);
  const rows = (data?.grievances ?? []).filter((g) => (!source || g.source === source) && (!category || g.category === category) && (!status || (status === "active" ? g.status !== "closed" : g.status === status)));
  const tools = useListTools<Grievance>({
    rows,
    text: (g) => `${g.reference} ${g.model} ${g.manufacturer} ${g.complainant ?? ""} ${g.summary} ${SOURCE_WORD[g.source]} ${CATEGORY_WORD[g.category]}`,
    date: (g) => g.receivedAt.slice(0, 10),
    sortValue: (g, k) => (k === "ref" ? g.reference : k === "source" ? g.source : k === "cat" ? g.category : k === "model" ? g.model : k === "status" ? g.status : g.receivedAt),
    pageSize: 10,
  });
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  const STATUS = { open: "Awaiting approval", in_testing: "In testing", closed: "Closed" } as const;
  const picked = data.grievances.find((g) => g.reference === openRef) ?? null;
  return (
    <div className="space-y-space-sm" data-testid="testing-grievances">
      <section className={`${card} p-4 space-y-space-sm`}>
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Filters</div>
        <ListToolbar tools={tools} searchLabel="Search" placeholder="Reference, model, person or text" dateLabel="Received"
          exportCsv={{ filename: "grievances", header: ["Reference", "Received", "Source", "Category", "Model", "Manufacturer", "Complainant", "Contact", "Status", "Complaint"], rows: tools.visible.map((g) => [g.reference, day(g.receivedAt), SOURCE_WORD[g.source], CATEGORY_WORD[g.category], g.model, g.manufacturer, g.complainant ?? "", g.contact ?? "", STATUS[g.status], g.summary]) }} />
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>Source<select value={source} onChange={(e) => { setSource(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="grievance-source"><option value="">All</option>{Object.entries(SOURCE_WORD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={labelCls}>Category<select value={category} onChange={(e) => { setCategory(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="grievance-category"><option value="">All</option>{Object.entries(CATEGORY_WORD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={labelCls}>Status<select value={status} onChange={(e) => { setStatus(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="grievance-status"><option value="">All</option><option value="active">Not closed (open and in testing)</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
      </section>
      <p className="text-[13px] text-[#475569]" data-testid="grievance-count">{rows.length} grievance{rows.length === 1 ? "" : "s"} in this list. Click a row to see the details and approve the product for testing.</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]" data-testid="grievance-table">
          <caption className="sr-only">Grievances, newest first</caption>
          <thead><tr className="bg-[#eef3fb]">
            <SortableTh tools={tools} k="ref" className={th}>Reference</SortableTh><SortableTh tools={tools} k="date" className={th}>Received</SortableTh><SortableTh tools={tools} k="source" className={th}>Source</SortableTh>
            <SortableTh tools={tools} k="cat" className={th}>Category</SortableTh><SortableTh tools={tools} k="model" className={th}>Product</SortableTh><th className={th}>Complainant</th><SortableTh tools={tools} k="status" className={th}>Status</SortableTh>
          </tr></thead>
          <tbody>
            {tools.paged.pageRows.length === 0 ? <tr><td className={td} colSpan={7}>No grievance for this selection.</td></tr> : tools.paged.pageRows.map((g) => (
              <tr key={g.reference} className={`cursor-pointer border-t border-[#e2e8f0] hover:bg-[#f4f8ff] ${openRef === g.reference ? "bg-[#eef3fb]" : ""}`} onClick={() => setOpenRef(g.reference)} data-testid={`grievance-row-${g.reference}`}>
                <td className={`${td} font-semibold`}><button type="button" className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setOpenRef(g.reference); }}>{g.reference}</button></td><td className={`${td} whitespace-nowrap`}>{day(g.receivedAt)}</td><td className={td}>{SOURCE_WORD[g.source]}</td>
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
      {picked ? <GrievanceDetail key={picked.reference} g={picked} statusWord={STATUS[picked.status]} onClose={() => setOpenRef(null)} onDone={(m) => { onDone(m); void reload(); }} /> : null}
    </div>
  );
}

function GrievanceDetail({ g, statusWord, onClose, onDone }: { g: Grievance; statusWord: string; onClose: () => void; onDone: (m: string) => void }) {
  const [view, setView] = useState<ProductView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void readProduct(g.registrationId).then((r) => { if (live && r.ok) setView(r.value); });
    return () => { live = false; };
  }, [g.registrationId]);
  const open = view?.product.openCase ?? null;
  const approve = async () => {
    setBusy(true); setProblem(null);
    const r = await addToTesting(g.registrationId, `Shortlisted after grievance ${g.reference} (${CATEGORY_WORD[g.category]}).`);
    setBusy(false);
    if (r.ok) onDone(`${g.model} was added to the shortlist as case ${String(r.value.reference)}. The Officer approves it for testing from the Overview.`); else setProblem(r.message);
  };
  return (
    <section className={`${card} p-5 space-y-space-sm`} data-testid="grievance-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">{g.reference} · {CATEGORY_WORD[g.category]}</div><div className="text-[13px] text-[#64748b]">{g.model} · {g.brand} · {g.manufacturer} · {g.registrationId}</div></div>
        <div className="flex items-center gap-2"><Chip tone="border-[#c9d9f7] bg-[#e7effb] text-[#14315E]">{statusWord}</Chip><button type="button" className={btnOutline} onClick={onClose} data-testid="grievance-close">Close</button></div>
      </div>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className={labelCls}>Received</dt><dd>{stamp(g.receivedAt)}</dd></div>
        <div><dt className={labelCls}>Channel</dt><dd>{SOURCE_WORD[g.source]}</dd></div>
        <div><dt className={labelCls}>Complainant</dt><dd>{g.complainant ?? "-"}</dd></div>
        <div><dt className={labelCls}>Contact</dt><dd>{g.contact ?? "-"}</dd></div>
      </dl>
      <p className="rounded-lg bg-[#f9fbff] px-3 py-2 text-[13px] text-[#334155]">{g.summary}</p>
      {view ? <ProductBody v={view} /> : <p role="status" className="font-body-sm">Loading the product view…</p>}
      {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{problem}</p> : null}
      <div className="rounded-xl border border-[#dbe6f7] bg-[#f9fbff] p-4">
        {open ? <p className="text-[13px] text-[#334155]">This product is already on the shortlist or in testing as case <Link href={`/app/demo/testing?tab=cases&case=${open}`} className="font-semibold text-primary hover:underline">{open}</Link>.</p>
          : g.status === "closed" ? <p className="text-[13px] text-[#475569]">This grievance is closed.</p>
          : <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-[13px] text-[#334155]">Shortlisting puts the product on the Overview list. The BEE Officer then approves it for testing, with remarks: BEE buys a unit from the market and tests it at its own cost.</p>
              <button type="button" className={btn} disabled={busy || !view} onClick={() => void approve()} data-testid="grievance-approve"><Icon name="playlist_add" size={16} /> Add to shortlist</button></div>}
      </div>
    </section>
  );
}

const NEXT_HINT: Record<"selected" | "procured" | "at_lab" | "result_in", string> = {
  selected: "Record where BEE bought the unit.", procured: "Record the laboratory the unit was sent to.", at_lab: "Record the test result.", result_in: "Close the case with a recommendation.",
};

function CasesView({ onDone }: { onDone: (m: string) => void }) {
  const { data, error, reload } = useLoad<{ cases: TestCase[] }>(readCases);
  const caseParam = useSearchParams()?.get("case") ?? "";
  if (!data && !error) return <p role="status" className="font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="text-error font-body-sm">{error}</p>;
  const approvedCases = data.cases.filter((c) => STAGES.includes(c.stage));
  const current = caseParam ? approvedCases.find((c) => c.reference === caseParam) ?? null : null;
  if (caseParam && !current) return <div className="space-y-3" data-testid="testing-cases"><Link href="/app/demo/testing?tab=cases" className="text-[13px] font-semibold text-primary hover:underline">All test cases</Link><p className="text-[13px] text-[#64748b]">{caseParam} is not a test case yet. A shortlisted product becomes a test case when the Officer approves it.</p></div>;
  return current
    ? <CaseDetail key={current.id} c={current} onDone={(m) => { onDone(m); void reload(); }} />
    : <CasesList cases={approvedCases} />;
}

function CasesList({ cases }: { cases: TestCase[] }) {
  const router = useRouter();
  const [stage, setStage] = useState("");
  const [result, setResult] = useState("");
  const rows = cases.filter((c) => (!stage || c.stage === stage) && (!result || (result === "none" ? !c.result : c.result === result)));
  const tools = useListTools<TestCase>({
    rows,
    text: (c) => `${c.reference} ${c.model} ${c.brand} ${c.manufacturer} ${c.laboratory ?? ""} ${c.procuredFrom ?? ""}`,
    date: (c) => c.updatedAt.slice(0, 10),
    sortValue: (c, k) => (k === "ref" ? c.reference : k === "model" ? c.model : k === "mfr" ? c.manufacturer : k === "stage" ? STAGES.indexOf(c.stage) : k === "result" ? c.result ?? "" : c.updatedAt),
    pageSize: 12,
  });
  const open = (c: TestCase) => router.push(`/app/demo/testing?tab=cases&case=${encodeURIComponent(c.reference)}`);
  return (
    <div className="space-y-space-sm" data-testid="cases-list">
      <section className={`${card} p-4 space-y-space-sm`}>
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">Filters</div>
        <ListToolbar tools={tools} searchLabel="Search" placeholder="Product, manufacturer, laboratory or case" dateLabel="Updated"
          exportCsv={{ filename: "test-cases", header: ["Case", "Product", "Manufacturer", "Stage", "Bought from", "Laboratory", "Result", "Updated"], rows: tools.visible.map((c) => [c.reference, c.model, c.manufacturer, STAGE_WORD[c.stage], c.procuredFrom ?? "", c.laboratory ?? "", c.result ? RESULT_WORD[c.result] : "", day(c.updatedAt)]) }} />
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>Stage<select value={stage} onChange={(e) => { setStage(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="cases-stage"><option value="">All</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}</select></label>
          <label className={labelCls}>Result<select value={result} onChange={(e) => { setResult(e.target.value); tools.setPage(1); }} className={`${fieldCls} w-auto`} data-testid="cases-result"><option value="">All</option><option value="none">No result yet</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="retest">Retest</option></select></label>
        </div>
      </section>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]" data-testid="cases-table">
          <caption className="sr-only">Test cases, one row per product</caption>
          <thead><tr className="bg-[#eef3fb]">
            <SortableTh tools={tools} k="ref" className={th}>Case</SortableTh><SortableTh tools={tools} k="model" className={th}>Product</SortableTh><SortableTh tools={tools} k="mfr" className={th}>Manufacturer</SortableTh>
            <SortableTh tools={tools} k="stage" className={th}>Current stage</SortableTh><th className={th}>Bought from</th><th className={th}>Laboratory</th><SortableTh tools={tools} k="result" className={th}>Result</SortableTh><SortableTh tools={tools} k="date" className={th}>Updated</SortableTh>
          </tr></thead>
          <tbody>
            {tools.paged.pageRows.length === 0 ? <tr><td className={td} colSpan={8}>No test case for this selection.</td></tr> : tools.paged.pageRows.map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-[#e2e8f0] hover:bg-[#f4f8ff]" onClick={() => open(c)} data-testid={`case-row-${c.reference}`}>
                <td className={`${td} font-semibold`}><Link href={`/app/demo/testing?tab=cases&case=${encodeURIComponent(c.reference)}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{c.reference}</Link></td>
                <td className={td}>{c.model}<div className="text-[12px] text-[#64748b]">{c.registrationId}</div></td><td className={td}>{c.manufacturer}</td>
                <td className={td}><Chip tone="border-[#c9d9f7] bg-[#e7effb] text-[#14315E]">{STEPS.indexOf(c.stage) + 1} of 6 · {STAGE_WORD[c.stage]}</Chip></td>
                <td className={td}>{c.procuredFrom ?? "-"}</td><td className={td}>{c.laboratory ?? "-"}</td>
                <td className={td}>{c.result ? <Chip tone={RESULT_TONE[c.result]}>{RESULT_WORD[c.result]}</Chip> : "-"}</td>
                <td className={`${td} whitespace-nowrap`}>{day(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager tools={tools} />
    </div>
  );
}

const STEPS: Stage[] = ["shortlisted", ...STAGES];

function Stepper({ c }: { c: TestCase }) {
  const at = STEPS.indexOf(c.stage);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="case-stepper" aria-label="Progress of this test case">
      {STEPS.map((st, i) => {
        const ev = c.history.filter((h) => h.stage === st).at(-1);
        const state = i < at ? "done" : i === at ? "current" : "next";
        return (
          <li key={st} aria-current={state === "current" ? "step" : undefined} className={`rounded-lg border p-3 text-[12px] ${state === "current" ? "border-[#254e9e] bg-[#e7effb] ring-2 ring-[#c9d9f7]" : state === "done" ? "border-[#b7e0c6] bg-[#f0f9f3]" : "border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8]"}`}>
            <div className="flex items-center gap-1 font-bold text-[#14315E]">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white ${state === "done" ? "bg-[#14532d]" : state === "current" ? "bg-[#254e9e]" : "bg-[#cbd5e1]"}`}>{state === "done" ? "✓" : i + 1}</span>
              <span className={state === "next" ? "text-[#94a3b8]" : ""}>{STAGE_WORD[st]}</span>
            </div>
            <div className="mt-1">{ev ? day(ev.at) : state === "next" ? "Not yet" : ""}</div>
          </li>
        );
      })}
    </ol>
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
      <Link href="/app/demo/testing?tab=cases" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline" data-testid="case-back"><Icon name="arrow_back" size={16} /> All test cases</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">{c.model} · {c.reference}</div><div className="text-[13px] text-[#64748b]">{c.brand} · {c.manufacturer} · {c.registrationId}</div></div>
        <Chip tone="border-[#c9d9f7] bg-[#e7effb] text-[#14315E]">{STAGE_WORD[c.stage]}</Chip>
      </div>
      <Stepper c={c} />
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
          <p className="text-[12px] text-[#64748b]">{NEXT_HINT[c.stage as "selected" | "procured" | "at_lab" | "result_in"]}</p>
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
