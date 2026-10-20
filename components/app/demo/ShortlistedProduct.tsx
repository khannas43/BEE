"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Bars, BAND_TONE, btn, card, Chip, day, labelCls, stamp } from "@/components/app/demo/ProductTesting";
import { CATEGORY_WORD, decideCase, readProduct, RECOMMENDATION_WORD, RESULT_WORD, SOURCE_WORD, STAGE_WORD, type ProductView } from "@/lib/client/runtimeProductTesting";

/**
 * One shortlisted product (BEE Officer): why it was picked for random testing, in three boxes that open and close (risk score, production
 * anomaly, grievances received), and the Officer's decision with required remarks. Approving moves the product to the test cases.
 * `?reg=<certificate>&case=<reference>`. Local demonstration, not BEE rules.
 */

function Box({ title, summary, testId, children }: { title: string; summary: string; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`${card} p-4`} data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left" data-testid={`${testId}-toggle`}>
        <span><span role="heading" aria-level={2} className="block text-[16px] font-bold text-[#14315E]">{title}</span><span className="block text-[13px] text-[#64748b]">{summary}</span></span>
        <Icon name={open ? "expand_less" : "expand_more"} size={24} className="shrink-0 text-[#475569]" />
      </button>
      {open ? <div className="mt-3 border-t border-[#e2e8f0] pt-3">{children}</div> : null}
    </section>
  );
}

export function ShortlistedProduct() {
  const params = useSearchParams();
  const router = useRouter();
  const reg = params?.get("reg") ?? "";
  const caseRef = params?.get("case") ?? "";
  const [view, setView] = useState<ProductView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = () => readProduct(reg).then((r) => { if (r.ok) { setView(r.value); setError(null); } else setError(r.message); });
  useEffect(() => {
    if (!reg) return;
    let live = true;
    void readProduct(reg).then((r) => { if (!live) return; if (r.ok) setView(r.value); else setError(r.message); });
    return () => { live = false; };
  }, [reg]);
  const back = <Link href="/app/demo/testing?tab=overview" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline" data-testid="product-back"><Icon name="arrow_back" size={16} /> Shortlisted products</Link>;
  if (!reg) return <div className="p-space-md lg:p-space-lg space-y-3">{back}<p role="alert" className="text-error font-body-sm">No product was chosen.</p></div>;
  if (!view && !error) return <p role="status" className="p-space-md font-body-sm">Loading…</p>;
  if (!view) return <div className="p-space-md lg:p-space-lg space-y-3">{back}<p role="alert" className="text-error font-body-sm">{error}</p></div>;
  const p = view.product;
  const a = view.anomaly;
  const g = view.grievances;
  const c = view.cases.find((x) => x.reference === caseRef) ?? view.cases.find((x) => x.stage === "shortlisted") ?? view.cases[0] ?? null;
  const waiting = c?.stage === "shortlisted" || c?.stage === "not_approved";
  const reconsider = c?.stage === "not_approved";
  const topCategory = Object.entries(g.byCategory).sort((x, y) => y[1] - x[1])[0];
  const flags = a.flags ?? [];
  const maxUnits = Math.max(1, ...(a.quarters ?? []).map((q) => q.units));
  const weight = (c?.riskScore ?? p.score) + 5;
  const reason = [
    c?.basis === "random" ? `Drawn at random with weight ${weight} (risk score ${c.riskScore ?? p.score} plus a base of 5): higher risk means a higher chance of being drawn.` : c?.basis === "risk" ? "Shortlisted from the risk ranking." : "Shortlisted by the Officer.",
    `Risk score ${p.score} of 100 (${p.band}).`,
    a.found ? (a.status === "flagged" ? `Production anomaly: flagged. ${flags[0]?.detail ?? ""}` : "Production anomaly: nothing stands out.") : "Production anomaly: no production reported for this model.",
    g.total > 0 ? `${g.total} customer grievance${g.total === 1 ? "" : "s"} against it (${g.last90} in the last 90 days)${topCategory ? `, mostly ${CATEGORY_WORD[topCategory[0]].toLowerCase()}` : ""}.` : "No customer grievance against it.",
  ];
  const decide = async (decision: "approve" | "decline") => {
    if (!c) return;
    if (remarks.trim().length < 5) { setProblem("Remarks are required (at least 5 characters)."); return; }
    setBusy(true); setProblem(null);
    const r = await decideCase(c.id, decision, remarks.trim());
    setBusy(false);
    if (!r.ok) { setProblem(r.message); return; }
    if (decision === "approve") { router.push(`/app/demo/testing?tab=cases&case=${encodeURIComponent(c.reference)}&approved=${encodeURIComponent(c.reference)}`); return; }
    setDone("The product was not approved for testing. Your remarks are kept on the case.");
    void load();
  };
  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="shortlisted-product">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex-1 min-w-0">{p.model}</h1>
          <p className="text-[13px] text-[#64748b]">{p.brand} · {p.manufacturer} · {p.registrationId} · {p.stars} star · rated ISEER {p.ratedIseer}{c ? ` · case ${c.reference}` : ""}</p>
        </div>
        {c ? <Chip tone={waiting ? "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" : "border-[#c9d9f7] bg-[#e7effb] text-[#14315E]"}>{waiting ? "Waiting for approval" : STAGE_WORD[c.stage]}</Chip> : null}
      </div>

      <section className={`${card} p-4`} data-testid="product-reason">
        <div role="heading" aria-level={2} className="mb-2 text-[16px] font-bold text-[#14315E]">Why this product was shortlisted</div>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#334155]">{reason.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </section>

      <Box testId="box-risk" title="Risk score" summary={`${p.score} of 100, ${p.band}`}>
        <div className="flex items-center gap-3"><span className="text-[34px] font-extrabold leading-9 text-[#14315E]">{p.score}</span><Chip tone={BAND_TONE[p.band]}>{p.band}</Chip><span className="text-[12px] text-[#64748b]">of 100</span></div>
        <ul className="mt-2 max-w-xl space-y-1 text-[13px]">{p.factors.map((f) => <li key={f.label} className="flex justify-between gap-3"><span>{f.label}</span><b className="tabular-nums">+{f.points}</b></li>)}
          <li className="flex justify-between gap-3 border-t border-[#e2e8f0] pt-1"><b>Total (at most 100)</b><b className="tabular-nums">{p.score}</b></li></ul>
      </Box>

      <Box testId="box-anomaly" title="Production anomaly" summary={!a.found ? "No production reported for this model" : a.status === "flagged" ? `Flagged: ${flags.length} finding${flags.length === 1 ? "" : "s"}` : "Normal"}>
        {!a.found ? <p className="text-[13px] text-[#64748b]">No production has been reported for this model, so there is nothing to check yet.</p> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ul className="space-y-1">{(a.quarters ?? []).map((q) => (
              <li key={q.quarter} className="text-[12px]"><div className="flex justify-between"><span>{q.quarter}</span><b className="tabular-nums">{q.units.toLocaleString("en-IN")} units</b></div><div className="mt-0.5 h-1.5 rounded-full bg-[#e2e8f0]"><div className="h-1.5 rounded-full bg-[#254e9e]" style={{ width: `${(q.units / maxUnits) * 100}%` }} /></div></li>
            ))}</ul>
            <div className="text-[13px]">
              <Chip tone={a.status === "flagged" ? BAND_TONE.high : BAND_TONE.low}>{a.status === "flagged" ? "Flagged for a look" : "Normal"}</Chip>
              {a.boundSerials != null ? <p className="mt-2 text-[12px] text-[#64748b]">{a.boundSerials.toLocaleString("en-IN")} QR serials bound.</p> : null}
              {flags.length > 0 ? <ul className="mt-2 space-y-1 text-[12px] text-[#93000a]">{flags.map((f, i) => <li key={i}>{f.quarter}: {f.detail}</li>)}</ul> : <p className="mt-2 text-[12px] text-[#64748b]">No quarter stands out against the others.</p>}
            </div>
          </div>
        )}
      </Box>

      <Box testId="box-grievances" title="Grievances received" summary={g.total === 0 ? "None" : `${g.total} in total, ${g.last90} in the last 90 days`}>
        {g.total === 0 ? <p className="text-[13px] text-[#64748b]">No customer grievance has been received against this product.</p> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div><Bars data={g.byCategory} words={CATEGORY_WORD} tone="#c47f17" /><p className="mt-2 text-[12px] text-[#64748b]">Channels: {Object.entries(g.bySource).map(([k, n]) => `${SOURCE_WORD[k] ?? k} ${n}`).join(", ")}</p></div>
            <ul className="space-y-2 text-[13px]">{g.latest.map((x) => <li key={x.reference}><b>{day(x.receivedAt)}</b> · {CATEGORY_WORD[x.category]} · {x.complainant ?? "-"}<div className="text-[12px] text-[#64748b]">{x.summary}</div></li>)}
              <li><Link href="/app/demo/testing?tab=grievances" className="text-[12px] font-semibold text-primary hover:underline">Open the grievance inbox</Link></li></ul>
          </div>
        )}
      </Box>

      <section className={`${card} p-5 space-y-space-sm`} data-testid="product-approval">
        <div role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">BEE Officer approval</div>
        {!c ? <p className="text-[13px] text-[#64748b]">This product is not on the shortlist.</p> : waiting ? (
          <>
            {reconsider ? <div className="rounded-lg bg-[#f1f5f9] px-3 py-2 text-[13px] text-[#475569]"><b>Earlier remarks{c?.approvedAt ? ` (${stamp(c.approvedAt)})` : ""}:</b> {c?.approvalRemarks}</div> : null}
            <p className="text-[13px] text-[#334155]">{reconsider ? "This product is waiting for your approval. Remarks are required." : "Approving sends the product for testing: BEE buys a unit from the market and tests it at its own cost. Remarks are required."}</p>
            <label className={`${labelCls} block`}>Remarks (required)
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} rows={3} placeholder="Why you approve, or why not, and any point to note"
                className="mt-1 block w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] normal-case tracking-normal" data-testid="approval-remarks" />
            </label>
            {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container" data-testid="approval-problem">{problem}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} disabled={busy} onClick={() => void decide("approve")} data-testid="approve-button"><Icon name="check_circle" size={16} /> Approve for testing</button>
            </div>
          </>
        ) : (
          <div className="space-y-2 text-[13px] text-[#334155]">
            <p><b>{"Approved for testing"}</b>{c.approvedAt ? ` on ${stamp(c.approvedAt)}` : ""}.</p>
            {c.stage !== "not_approved" ? <p>Test status: <b>{STAGE_WORD[c.stage]}</b>{c.procuredFrom ? ` · bought from ${c.procuredFrom}` : ""}{c.laboratory ? ` · ${c.laboratory}` : ""}{c.result ? ` · result ${RESULT_WORD[c.result]}, ISEER ${c.measuredIseer} against ${c.ratedIseer} rated` : ""}{c.recommendation ? ` · ${RECOMMENDATION_WORD[c.recommendation]}` : ""}.</p> : null}
            {c.approvalRemarks ? <p className="rounded-lg bg-[#f9fbff] px-3 py-2">{c.approvalRemarks}</p> : null}
            {c.stage !== "not_approved" ? <Link href={`/app/demo/testing?tab=cases&case=${encodeURIComponent(c.reference)}`} className="inline-block font-semibold text-primary hover:underline" data-testid="open-test-case">Open this test case</Link> : null}
            {done ? <p role="status" className="font-semibold text-[#14532d]">{done}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
