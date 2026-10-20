"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Bars, BAND_TONE, btn, Chip, day, labelCls, stamp } from "@/components/app/demo/ProductTesting";
import { CATEGORY_WORD, decideCase, readProduct, RECOMMENDATION_WORD, RESULT_WORD, SOURCE_WORD, STAGE_WORD, type ProductView } from "@/lib/client/runtimeProductTesting";

/**
 * One shortlisted product (BEE Officer): a header with the product and its risk, why it was picked for random testing, three cards that open and
 * close (risk score, production anomaly, grievances received), and the Officer's decision with required remarks. Approving moves the product to
 * the test cases. `?reg=<certificate>&case=<reference>`. Local demonstration, not BEE rules.
 */

const BAND_COLOUR = { high: "#c0392b", medium: "#d68910", low: "#1e8449" } as const;
const shell = "rounded-2xl border border-[#dbe6f7] bg-white shadow-[0_1px_2px_rgba(20,49,94,0.06)]";

/** A ring that fills to the score, coloured by band. */
function Ring({ score, band, size = 96 }: { score: number; band: keyof typeof BAND_COLOUR; size?: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Risk score ${score} of 100, ${band}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BAND_COLOUR[band]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[26px] font-extrabold text-[#14315E]">{score}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">of 100</span>
      </div>
    </div>
  );
}

function Card({ icon, accent, title, headline, caption, open, onToggle, testId, children }: {
  icon: string; accent: string; title: string; headline: ReactNode; caption: string; open: boolean; onToggle: () => void; testId: string; children: ReactNode;
}) {
  return (
    <section className={`${shell} overflow-hidden !p-0`} style={{ borderTop: `4px solid ${accent}` }} data-testid={testId}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-5 text-left" data-testid={`${testId}-toggle`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${accent}1f`, color: accent }}><Icon name={icon} size={22} /></span>
        <span className="min-w-0 flex-1">
          <span role="heading" aria-level={2} className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">{title}</span>
          <span className="mt-1 block text-[22px] font-extrabold leading-7 text-[#14315E]">{headline}</span>
          <span className="mt-0.5 block text-[13px] text-[#64748b]">{caption}</span>
        </span>
        <span className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-primary">{open ? "Hide" : "Details"}<Icon name={open ? "expand_less" : "expand_more"} size={20} /></span>
      </button>
      {open ? <div className="border-t border-[#e2e8f0] bg-[#fbfcfe] p-5">{children}</div> : null}
    </section>
  );
}

function Reason({ icon, tone, label, text }: { icon: string; tone: string; label: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${tone}1f`, color: tone }}><Icon name={icon} size={18} /></span>
      <span className="min-w-0"><span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">{label}</span><span className="block text-[14px] leading-5 text-[#1e293b]">{text}</span></span>
    </li>
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
  const [open, setOpen] = useState({ risk: false, anomaly: false, grievances: false });
  useEffect(() => {
    if (!reg) return;
    let live = true;
    void readProduct(reg).then((r) => { if (!live) return; if (r.ok) setView(r.value); else setError(r.message); });
    return () => { live = false; };
  }, [reg]);
  const back = <Link href="/app/demo/testing?tab=overview" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline" data-testid="product-back"><Icon name="arrow_back" size={16} /> Shortlisted for random testing</Link>;
  if (!reg) return <div className="p-space-md lg:p-space-lg space-y-3">{back}<p role="alert" className="text-error font-body-sm">No product was chosen.</p></div>;
  if (!view && !error) return <p role="status" className="p-space-md font-body-sm">Loading…</p>;
  if (!view) return <div className="p-space-md lg:p-space-lg space-y-3">{back}<p role="alert" className="text-error font-body-sm">{error}</p></div>;

  const p = view.product;
  const a = view.anomaly;
  const g = view.grievances;
  const c = view.cases.find((x) => x.reference === caseRef) ?? view.cases.find((x) => x.stage === "shortlisted") ?? view.cases[0] ?? null;
  const waiting = c?.stage === "shortlisted" || c?.stage === "not_approved";
  const flags = a.flags ?? [];
  const maxUnits = Math.max(1, ...(a.quarters ?? []).map((q) => q.units));
  const topCategory = Object.entries(g.byCategory).sort((x, y) => y[1] - x[1])[0];
  const weight = (c?.riskScore ?? p.score) + 5;
  const allOpen = open.risk && open.anomaly && open.grievances;
  const points = p.factors.filter((f) => f.points > 0);
  const anomalyHead = !a.found ? "No data" : a.status === "flagged" ? `${flags.length} finding${flags.length === 1 ? "" : "s"}` : "Normal";
  const pickedBy = c?.basis === "random" ? `Drawn at random, risk-weighted (weight ${weight}: score ${c.riskScore ?? p.score} plus a base of 5). Higher risk means a higher chance of being drawn.` : c?.basis === "risk" ? "Shortlisted from the risk ranking." : "Shortlisted by the Officer.";

  const approve = async () => {
    if (!c) return;
    if (remarks.trim().length < 5) { setProblem("Remarks are required (at least 5 characters)."); return; }
    setBusy(true); setProblem(null);
    const r = await decideCase(c.id, "approve", remarks.trim());
    setBusy(false);
    if (!r.ok) { setProblem(r.message); return; }
    router.push(`/app/demo/testing?tab=cases&case=${encodeURIComponent(c.reference)}&approved=${encodeURIComponent(c.reference)}`);
  };

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="shortlisted-product">
      {back}

      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#14315E] via-[#1c3f78] to-[#254e9e] text-white shadow-[0_6px_20px_rgba(20,49,94,0.25)]" data-testid="product-hero">
        <div className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c9d9f7]">
              <span>Random testing</span>{c ? <><span aria-hidden>·</span><span>{c.reference}</span></> : null}
            </div>
            <div role="heading" aria-level={1} className="mt-1 text-[32px] font-extrabold leading-9 !text-white">{p.model}</div>
            <p className="mt-1 text-[14px] text-[#dbe6f7]">{p.brand} · {p.manufacturer}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="rounded-full bg-white/15 px-3 py-1 font-semibold">{"★".repeat(Math.max(0, Math.min(5, p.stars)))} {p.stars} star</span>
              <span className="rounded-full bg-white/15 px-3 py-1 font-semibold">Rated ISEER {p.ratedIseer}</span>
              <span className="rounded-full bg-white/15 px-3 py-1 font-mono">{p.registrationId}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 text-[#14315E]">
            <Ring score={p.score} band={p.band} />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Review priority</div>
              <div className="mt-1"><Chip tone={BAND_TONE[p.band]}>{p.band === "high" ? "High" : p.band === "medium" ? "Medium" : "Low"}</Chip></div>
              {c ? <div className="mt-2"><Chip tone={waiting ? "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]" : "border-[#c9d9f7] bg-[#e7effb] text-[#14315E]"}>{waiting ? "Waiting for approval" : STAGE_WORD[c.stage]}</Chip></div> : null}
            </div>
          </div>
        </div>
      </header>

      <section className={`${shell} p-6`} data-testid="product-reason">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">Why this product was shortlisted</div>
          <span className="hidden text-[12px] text-[#64748b] sm:block">Review priority only, not a finding</span>
        </div>
        <p className="mb-4 rounded-xl bg-[#f4f8ff] px-4 py-3 text-[13px] leading-5 text-[#334155]">{pickedBy}</p>
        <ul className="grid gap-4 lg:grid-cols-3">
          <Reason icon="shield" tone={BAND_COLOUR[p.band]} label="Risk score" text={`${p.score} of 100, ${p.band}. Biggest factor: ${(points.slice().sort((x, y) => y.points - x.points)[0]?.label ?? "none").replace(/\s*\(.*$/, "").replace(/ in the last 90 days/, "").toLowerCase()} (+${points.slice().sort((x, y) => y.points - x.points)[0]?.points ?? 0}).`} />
          <Reason icon={a.found && a.status === "flagged" ? "warning" : "query_stats"} tone={a.found && a.status === "flagged" ? "#c0392b" : a.found ? "#1e8449" : "#64748b"} label="Production anomaly"
            text={!a.found ? "No production reported for this model, so nothing to check yet." : a.status === "flagged" ? (flags[0]?.detail ? `Flagged: ${flags[0].quarter}, ${flags[0].detail}` : "Flagged for a look.") : "Nothing stands out against earlier quarters."} />
          <Reason icon="report" tone={g.total > 0 ? "#d68910" : "#64748b"} label="Grievances received"
            text={g.total > 0 ? `${g.total} against this product (${g.last90} in the last 90 days)${topCategory ? `, mostly ${CATEGORY_WORD[topCategory[0]].toLowerCase()}` : ""}.` : "None received against this product."} />
        </ul>
      </section>

      <div className="flex items-center justify-between">
        <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">The evidence</div>
        <button type="button" className="text-[13px] font-semibold text-primary hover:underline" onClick={() => { const v = !allOpen; setOpen({ risk: v, anomaly: v, grievances: v }); }} data-testid="toggle-all">{allOpen ? "Collapse all" : "Expand all"}</button>
      </div>
      <div className="grid items-start gap-space-md lg:grid-cols-3">
        <Card testId="box-risk" icon="shield" accent={BAND_COLOUR[p.band]} title="Risk score" headline={<>{p.score}<span className="text-[14px] font-semibold text-[#64748b]"> / 100 · {p.band}</span></>} caption="Compliance risk and grievances, in points" open={open.risk} onToggle={() => setOpen((o) => ({ ...o, risk: !o.risk }))}>
          <ul className="space-y-3 text-[13px]">
            {p.factors.map((f) => (
              <li key={f.label}>
                <div className="flex items-start justify-between gap-3"><span className="text-[#334155]">{f.label}</span><b className="tabular-nums text-[#14315E]">+{f.points}</b></div>
                <div className="mt-1 h-1.5 rounded-full bg-[#e2e8f0]"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (f.points / 40) * 100)}%`, background: BAND_COLOUR[p.band] }} /></div>
              </li>
            ))}
            <li className="flex justify-between border-t border-[#e2e8f0] pt-2 text-[14px]"><b>Total (at most 100)</b><b className="tabular-nums">{p.score}</b></li>
          </ul>
        </Card>
        <Card testId="box-anomaly" icon={a.found && a.status === "flagged" ? "warning" : "query_stats"} accent={a.found && a.status === "flagged" ? "#c0392b" : a.found ? "#1e8449" : "#64748b"} title="Production anomaly" headline={anomalyHead}
          caption={!a.found ? "No production reported for this model" : a.status === "flagged" ? "Flagged for a person to look at" : "No quarter stands out"} open={open.anomaly} onToggle={() => setOpen((o) => ({ ...o, anomaly: !o.anomaly }))}>
          {!a.found ? <p className="text-[13px] text-[#64748b]">No production has been reported for this model, so there is nothing to check yet.</p> : (
            <div className="space-y-4">
              <ul className="space-y-2">{(a.quarters ?? []).map((q) => (
                <li key={q.quarter} className="text-[12px]"><div className="flex justify-between"><span className="text-[#475569]">{q.quarter}</span><b className="tabular-nums text-[#14315E]">{q.units.toLocaleString("en-IN")} units</b></div>
                  <div className="mt-0.5 h-2 rounded-full bg-[#e2e8f0]"><div className="h-2 rounded-full bg-[#254e9e]" style={{ width: `${(q.units / maxUnits) * 100}%` }} /></div></li>
              ))}</ul>
              {a.boundSerials != null ? <p className="text-[12px] text-[#64748b]">{a.boundSerials.toLocaleString("en-IN")} QR serials bound.</p> : null}
              {flags.length > 0 ? <ul className="space-y-2">{flags.map((f, i) => <li key={i} className="rounded-lg border border-[#f5c2c0] bg-[#fdecea] px-3 py-2 text-[12px] text-[#93000a]"><b>{f.quarter}</b>: {f.detail}</li>)}</ul> : null}
            </div>
          )}
        </Card>
        <Card testId="box-grievances" icon="report" accent={g.total > 0 ? "#d68910" : "#64748b"} title="Grievances received" headline={<>{g.total}<span className="text-[14px] font-semibold text-[#64748b]"> in total · {g.last90} in 90 days</span></>}
          caption={g.total === 0 ? "None received" : Object.entries(g.bySource).map(([k, n]) => `${SOURCE_WORD[k] ?? k} ${n}`).slice(0, 2).join(", ")} open={open.grievances} onToggle={() => setOpen((o) => ({ ...o, grievances: !o.grievances }))}>
          {g.total === 0 ? <p className="text-[13px] text-[#64748b]">No customer grievance has been received against this product.</p> : (
            <div className="space-y-4">
              <Bars data={g.byCategory} words={CATEGORY_WORD} tone="#d68910" />
              <ul className="space-y-3 text-[13px]">{g.latest.map((x) => <li key={x.reference} className="border-l-2 border-[#e6c27a] pl-3"><b className="text-[#14315E]">{day(x.receivedAt)}</b> · {CATEGORY_WORD[x.category]} · {x.complainant ?? "-"}<div className="text-[12px] text-[#64748b]">{x.summary}</div></li>)}</ul>
              <Link href="/app/demo/testing?tab=grievances" className="inline-block text-[12px] font-semibold text-primary hover:underline">Open the grievance inbox</Link>
            </div>
          )}
        </Card>
      </div>

      <section className={`${shell} overflow-hidden !p-0`} style={{ borderTop: "4px solid #1e8449" }} data-testid="product-approval">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">BEE Officer approval</div>
            {!c ? <p className="text-[13px] text-[#64748b]">This product is not on the shortlist.</p> : waiting ? (
              <>
                {c.approvalRemarks ? <div className="rounded-xl bg-[#f1f5f9] px-4 py-3 text-[13px] text-[#475569]"><b>Earlier remarks{c.approvedAt ? ` (${stamp(c.approvedAt)})` : ""}:</b> {c.approvalRemarks}</div> : null}
                <label className={`${labelCls} block`}>Remarks (required)
                  <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} rows={4} placeholder="Why you approve this product for testing, and any point to note"
                    className="mt-1 block w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-[14px] normal-case tracking-normal focus:border-[#254e9e] focus:outline-none focus:ring-2 focus:ring-[#c9d9f7]" data-testid="approval-remarks" />
                  <span className="mt-1 block text-right text-[11px] font-normal normal-case tracking-normal text-[#94a3b8]">{remarks.length} / 500</span>
                </label>
                {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container" data-testid="approval-problem">{problem}</p> : null}
                <button type="button" className={`${btn} !px-5 !py-2.5 !text-[14px] !bg-[#14532d]`} disabled={busy} onClick={() => void approve()} data-testid="approve-button"><Icon name="check_circle" size={18} /> Approve for testing</button>
              </>
            ) : (
              <div className="space-y-3 text-[13px] text-[#334155]">
                <p className="flex items-center gap-2"><Icon name="verified" size={20} className="text-[#1e8449]" /><b>Approved for testing</b>{c.approvedAt ? ` on ${stamp(c.approvedAt)}` : ""}</p>
                {c.approvalRemarks ? <p className="rounded-xl bg-[#f4f8ff] px-4 py-3">{c.approvalRemarks}</p> : null}
                <p>Test status: <b>{STAGE_WORD[c.stage]}</b>{c.procuredFrom ? ` · bought from ${c.procuredFrom}` : ""}{c.laboratory ? ` · ${c.laboratory}` : ""}{c.result ? ` · result ${RESULT_WORD[c.result]}, ISEER ${c.measuredIseer} against ${c.ratedIseer} rated` : ""}{c.recommendation ? ` · ${RECOMMENDATION_WORD[c.recommendation]}` : ""}.</p>
                <Link href={`/app/demo/testing?tab=cases&case=${encodeURIComponent(c.reference)}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" data-testid="open-test-case">Open this test case <Icon name="arrow_forward" size={16} /></Link>
              </div>
            )}
          </div>
          <aside className="rounded-xl bg-[#f4f8ff] p-4 text-[13px] text-[#334155]">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">What approval does</div>
            <ol className="space-y-2">
              {["BEE buys a unit of this model from the market, at its own cost.", "The unit is tested at a laboratory.", "The result is recorded; the manufacturer sees only the result."].map((t, i) => (
                <li key={t} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#254e9e] text-[11px] font-bold text-white">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
          </aside>
        </div>
      </section>
    </div>
  );
}
