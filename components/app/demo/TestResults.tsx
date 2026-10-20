"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Bars, Chip, day, fieldCls, labelCls } from "@/components/app/demo/ProductTesting";
import { CATEGORY_WORD, readMine, RESULT_WORD, type MineProduct } from "@/lib/client/runtimeProductTesting";

/**
 * BEE test results (manufacturer). BEE buys products from the market and tests them at its own cost; the manufacturer sees the result of each
 * test and, per product, how many customer complaints there are and in which category. Never the complainant, the channel, the text, the risk
 * score or whether a product has been shortlisted. Local demonstration, not BEE rules.
 */

const RESULT_TONE: Record<string, string> = { pass: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]", fail: "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]", retest: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" };
const RESULT_COLOUR: Record<string, string> = { pass: "#1e8449", fail: "#c0392b", retest: "#d68910" };
const shell = "rounded-2xl border border-[#dbe6f7] bg-white shadow-[0_1px_2px_rgba(20,49,94,0.06)]";

/** Measured against rated efficiency: two bars on one scale and the difference in percent. */
function Efficiency({ measured, rated, colour }: { measured: number; rated: number; colour: string }) {
  const max = Math.max(measured, rated) * 1.1;
  const diff = ((measured - rated) / rated) * 100;
  return (
    <div className="space-y-2" data-testid="efficiency">
      {[["Measured by BEE", measured, colour], ["Rated", rated, "#254e9e"]].map(([label, v, c]) => (
        <div key={String(label)}>
          <div className="flex justify-between text-[12px]"><span className="text-[#475569]">{label}</span><b className="tabular-nums text-[#14315E]">ISEER {Number(v).toFixed(2)}</b></div>
          <div className="mt-0.5 h-2.5 rounded-full bg-[#e2e8f0]"><div className="h-2.5 rounded-full" style={{ width: `${(Number(v) / max) * 100}%`, background: String(c) }} /></div>
        </div>
      ))}
      <p className="text-[12px] font-semibold" style={{ color: colour }}>{diff >= 0 ? `${diff.toFixed(1)}% above the rating` : `${Math.abs(diff).toFixed(1)}% below the rating`}</p>
    </div>
  );
}

function Stat({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: number; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white" style={{ color: tone }}><Icon name={icon} size={22} /></span>
      <span><span className="block text-[26px] font-extrabold leading-7 text-white">{value}</span><span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#c9d9f7]">{label}</span><span className="block text-[11px] text-[#b6c8ea]">{note}</span></span>
    </div>
  );
}

function ProductCard({ p }: { p: MineProduct }) {
  const latest = p.tests[0] ?? null;
  const colour = latest ? RESULT_COLOUR[latest.result] : "#94a3b8";
  const g = p.grievances;
  return (
    <section className={`${shell} overflow-hidden !p-0`} style={{ borderTop: `4px solid ${colour}` }} data-testid={`product-${p.registrationId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <div role="heading" aria-level={2} className="text-[20px] font-extrabold leading-6 text-[#14315E]">{p.model}</div>
          <div className="mt-1 text-[12px] text-[#64748b]">{p.brand} · <span className="font-mono">{p.registrationId}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-[12px]"><span className="rounded-full bg-[#f4f8ff] px-2.5 py-0.5 font-semibold text-[#14315E]">{"★".repeat(Math.max(0, Math.min(5, p.stars)))} {p.stars} star</span><span className="rounded-full bg-[#f4f8ff] px-2.5 py-0.5 font-semibold text-[#14315E]">Rated ISEER {p.ratedIseer}</span></div>
        </div>
        {latest ? <Chip tone={RESULT_TONE[latest.result]}>{RESULT_WORD[latest.result]}</Chip> : <Chip tone="border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]">Not tested by BEE yet</Chip>}
      </div>
      <div className="grid gap-px border-t border-[#e2e8f0] bg-[#e2e8f0] md:grid-cols-2">
        <div className="bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]"><Icon name="science" size={16} /> BEE test result</div>
          {!latest ? <p className="text-[13px] text-[#64748b]">BEE has not tested this model. A result appears here once it has.</p> : (
            <div className="space-y-3">
              {latest.measuredIseer && latest.ratedIseer ? <Efficiency measured={Number(latest.measuredIseer)} rated={Number(latest.ratedIseer)} colour={colour} /> : null}
              <dl className="grid grid-cols-2 gap-2 text-[12px]"><div><dt className="text-[#64748b]">Tested on</dt><dd className="font-semibold text-[#14315E]">{latest.testedOn ? day(latest.testedOn) : "-"}</dd></div><div><dt className="text-[#64748b]">Laboratory</dt><dd className="font-semibold text-[#14315E]">{latest.laboratory ?? "-"}</dd></div></dl>
              {p.tests.length > 1 ? <p className="text-[12px] text-[#64748b]">{p.tests.length - 1} earlier test{p.tests.length === 2 ? "" : "s"} on record.</p> : null}
            </div>
          )}
        </div>
        <div className="bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]"><Icon name="report" size={16} /> Customer grievances</div>
          {g.total === 0 ? <p className="text-[13px] text-[#64748b]">No customer grievance against this model.</p> : (
            <div className="space-y-3">
              <p className="text-[13px]"><b className="text-[26px] font-extrabold leading-7 text-[#14315E]">{g.total}</b> <span className="text-[#475569]">in total, {g.last90} in the last 90 days</span></p>
              <Bars data={g.byCategory} words={CATEGORY_WORD} tone="#d68910" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function TestResults() {
  const [data, setData] = useState<{ products: MineProduct[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState("");
  const [grievance, setGrievance] = useState("");
  useEffect(() => {
    let live = true;
    void readMine().then((r) => { if (!live) return; if (r.ok) setData(r.value); else setError(r.message); });
    return () => { live = false; };
  }, []);
  if (!data && !error) return <p role="status" className="p-space-md font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="p-space-md text-error font-body-sm">{error}</p>;

  const all = data.products;
  const tested = all.filter((p) => p.tests.length > 0);
  const passed = tested.filter((p) => p.tests[0].result === "pass").length;
  const attention = tested.filter((p) => p.tests[0].result !== "pass").length;
  const total = all.reduce((n, p) => n + p.grievances.total, 0);
  const shown = all.filter((p) => {
    const l = p.tests[0]?.result;
    return (!q || `${p.model} ${p.registrationId}`.toLowerCase().includes(q.toLowerCase()))
      && (!result || (result === "untested" ? !l : l === result))
      && (!grievance || (grievance === "with" ? p.grievances.total > 0 : p.grievances.total === 0));
  }).sort((a, b) => Number(b.tests.length > 0) - Number(a.tests.length > 0) || b.grievances.total - a.grievances.total || a.model.localeCompare(b.model));

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-test-results">
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#14315E] via-[#1c3f78] to-[#254e9e] text-white shadow-[0_6px_20px_rgba(20,49,94,0.25)]" data-testid="results-hero">
        <div className="space-y-5 p-6">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c9d9f7]">Bureau of Energy Efficiency</div>
            <div role="heading" aria-level={1} className="mt-1 text-[30px] font-extrabold leading-9 !text-white">BEE test results</div>
            <p className="mt-1 max-w-3xl text-[14px] text-[#dbe6f7]">{data.note}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon="science" tone="#254e9e" label="Tested by BEE" value={tested.length} note={`of ${all.length} certified models`} />
            <Stat icon="check_circle" tone="#1e8449" label="Passed" value={passed} note="latest result" />
            <Stat icon="priority_high" tone="#c0392b" label="Need attention" value={attention} note="fail or retest" />
            <Stat icon="report" tone="#d68910" label="Customer grievances" value={total} note="across all your models" />
          </div>
        </div>
      </header>

      <section className={`${shell} p-4`} data-testid="results-filters">
        <div className="flex flex-wrap items-end gap-3">
          <label className={`${labelCls} min-w-[220px] flex-1`}>Search
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model or certificate number" className={fieldCls} data-testid="results-search" />
          </label>
          <label className={labelCls}>Test result
            <select value={result} onChange={(e) => setResult(e.target.value)} className={`${fieldCls} w-auto`} data-testid="results-result"><option value="">All</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="retest">Retest</option><option value="untested">Not tested yet</option></select>
          </label>
          <label className={labelCls}>Grievances
            <select value={grievance} onChange={(e) => setGrievance(e.target.value)} className={`${fieldCls} w-auto`} data-testid="results-grievance"><option value="">All</option><option value="with">With grievances</option><option value="none">None</option></select>
          </label>
          {q || result || grievance ? <button type="button" className="pb-2 text-[13px] font-semibold text-primary underline" onClick={() => { setQ(""); setResult(""); setGrievance(""); }}>Clear filters</button> : null}
        </div>
        <p className="mt-2 text-[12px] text-[#64748b]" data-testid="results-count">{shown.length} of {all.length} model{all.length === 1 ? "" : "s"}</p>
      </section>

      <div className="grid gap-space-md lg:grid-cols-2" data-testid="test-results-products">
        {shown.length === 0 ? <p className="text-[13px] text-[#64748b]">No model matches these filters.</p> : shown.map((p) => <ProductCard key={p.registrationId} p={p} />)}
      </div>
    </div>
  );
}
