"use client";

import { useEffect, useState } from "react";
import { CATEGORY_WORD, readMine, RESULT_WORD, type MineProduct } from "@/lib/client/runtimeProductTesting";

/**
 * BEE test results (manufacturer). BEE buys products from the market and tests them at its own cost; the manufacturer sees the result of each
 * test and, per product, how many customer complaints there are and in which category. Never the complainant, the channel or the text.
 */

const card = "rounded-xl border border-[#dbe6f7] bg-white";
const RESULT_TONE: Record<string, string> = { pass: "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]", fail: "border-[#f5c2c0] bg-[#fdecea] text-[#93000a]", retest: "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" };

export function TestResults() {
  const [data, setData] = useState<{ products: MineProduct[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readMine().then((r) => { if (!live) return; if (r.ok) setData(r.value); else setError(r.message); });
    return () => { live = false; };
  }, []);
  if (!data && !error) return <p role="status" className="p-space-md font-body-sm">Loading…</p>;
  if (!data) return <p role="alert" className="p-space-md text-error font-body-sm">{error}</p>;
  const tested = data.products.filter((p) => p.tests.length > 0).length;
  const withGrievances = data.products.filter((p) => p.grievances.total > 0).length;
  const total = data.products.reduce((n, p) => n + p.grievances.total, 0);
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-test-results">
      <h1 className="flex-1 min-w-0">BEE test results</h1>
      <p className="ai-lead">{data.note}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[["Products tested by BEE", tested, `of ${data.products.length} certified products`], ["Customer grievances", total, "across all products, in total"], ["Products with grievances", withGrievances, "have at least one"]].map(([l, v, n]) => (
          <div key={String(l)} className={`${card} p-4`}><span className="block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">{l}</span><span className="block text-[26px] font-extrabold leading-8 text-[#14315E]">{v}</span><span className="block text-[12px] text-[#64748b]">{n}</span></div>
        ))}
      </div>
      <div className="grid gap-space-md lg:grid-cols-2" data-testid="test-results-products">
        {data.products.map((p) => (
          <section key={p.registrationId} className={`${card} p-4 space-y-2`} data-testid={`product-${p.registrationId}`}>
            <div><div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">{p.model}</div><div className="text-[12px] text-[#64748b]">{p.brand} · {p.registrationId} · {p.stars} star · rated ISEER {p.ratedIseer}</div></div>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">BEE test result</div>
              {p.tests.length === 0 ? <p className="text-[13px] text-[#64748b]">Not tested by BEE yet.</p> : (
                <ul className="mt-1 space-y-1 text-[13px]">
                  {p.tests.map((t) => (
                    <li key={t.reference} className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${RESULT_TONE[t.result]}`}>{RESULT_WORD[t.result]}</span>
                      <span>ISEER {t.measuredIseer} against {t.ratedIseer} rated · {t.testedOn}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748b]">Customer grievances</div>
              {p.grievances.total === 0 ? <p className="text-[13px] text-[#64748b]">None.</p> : (
                <>
                  <p className="text-[13px]"><b>{p.grievances.total}</b> in total, {p.grievances.last90} in the last 90 days</p>
                  <ul className="mt-1 flex flex-wrap gap-2 text-[12px]">{Object.entries(p.grievances.byCategory).map(([k, n]) => <li key={k} className="rounded-full border border-[#c9d9f7] bg-[#e7effb] px-2.5 py-0.5 text-[#14315E]">{CATEGORY_WORD[k] ?? k}: {n}</li>)}</ul>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
