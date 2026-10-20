"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import {
  cancelOrder, completeOrder, inr, makeSerials, METHOD_WORD, readDetails, readLine, startOrder,
  type FeeOrder, type PayResult, type ProductionDetailsView, type ProductionLine, type SerialPage,
} from "@/lib/client/runtimeProductionDetails";

/**
 * Production details, after section 1.3 of the SOP: the financial year, what was produced per model in each quarter (as certified by the CA),
 * the serial numbers linked to each production line, and the label fee with the labelling payment. The fee rate is a placeholder. Local demonstration.
 */

const shell = "rounded-2xl border border-[#dbe6f7] bg-white shadow-[0_1px_2px_rgba(20,49,94,0.06)]";
const fieldCls = "mt-1 block rounded-lg border border-outline-variant bg-white px-3 py-2 text-[13px] normal-case tracking-normal";
const labelCls = "block text-[12px] font-semibold uppercase tracking-wide text-[#64748b]";
const btn = "inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold !text-white disabled:opacity-50";
const btnOutline = "inline-flex items-center gap-1 rounded-lg border border-primary bg-white px-3 py-1.5 text-[13px] font-semibold !text-primary disabled:opacity-50";
const th = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";
const td = "px-3 py-2 align-top";
const SUB_WORD: Record<string, string> = { draft: "Draft", submitted: "Submitted", accepted: "Accepted", query: "Query" };

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}
const GREEN = "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]";
const AMBER = "border-[#f3dc9c] bg-[#fff4d6] text-[#8a4b00]";
const BLUE = "border-[#c9d9f7] bg-[#e7effb] text-[#14315E]";
const GREY = "border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]";

function Tile({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white" style={{ color: tone }}><Icon name={icon} size={22} /></span>
      <span><span className="block text-[22px] font-extrabold leading-6 text-white">{value}</span><span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#c9d9f7]">{label}</span><span className="block text-[11px] text-[#b6c8ea]">{note}</span></span>
    </div>
  );
}

export function ProductionDetails() {
  const [fy, setFy] = useState("");
  const [org, setOrg] = useState("");
  const [view, setView] = useState<ProductionDetailsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [line, setLine] = useState<{ l: ProductionLine; fq: number } | null>(null);
  const [order, setOrder] = useState<FeeOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await readDetails(fy || undefined, org || undefined);
    if (r.ok) { setView(r.value); setError(null); if (!fy && r.value.financialYear) setFy(r.value.financialYear); } else setError(r.message);
  }, [fy, org]);
  useEffect(() => {
    let live = true;
    void readDetails(fy || undefined, org || undefined).then((r) => {
      if (!live) return;
      if (r.ok) { setView(r.value); setError(null); if (!fy && r.value.financialYear) setFy(r.value.financialYear); } else setError(r.message);
    });
    return () => { live = false; };
  }, [fy, org]);

  if (!view && !error) return <p role="status" className="p-space-md font-body-sm">Loading…</p>;
  if (!view) return <p role="alert" className="p-space-md text-error font-body-sm">{error}</p>;
  const staff = view.staff;
  const quarters = view.quarters ?? [];
  const selectedFee = quarters.filter((q) => picked.includes(q.fq)).reduce((n, q) => n + Number(q.fee), 0);

  const pay = async () => {
    if (!fy || picked.length === 0) return;
    setBusy(true); setProblem(null);
    const r = await startOrder(fy, picked);
    setBusy(false);
    if (r.ok) setOrder(r.value); else setProblem(r.message);
  };

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="production-details">
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#14315E] via-[#1c3f78] to-[#254e9e] text-white shadow-[0_6px_20px_rgba(20,49,94,0.25)]" data-testid="pd-hero">
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c9d9f7]">{view.equipment}</div>
              <div role="heading" aria-level={2} className="mt-1 text-[26px] font-extrabold leading-8 !text-white">Production details{view.organisation ? `: ${view.organisation}` : ""}</div>
              <p className="mt-1 max-w-2xl text-[13px] text-[#dbe6f7]">What was manufactured in each quarter of the financial year, as certified by your Chartered Accountant, the serial numbers linked to it, and the label fee payable at ₹{Number(view.feePerUnit)} a unit (a placeholder rate).</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {staff ? (
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#c9d9f7]">Manufacturer
                  <select value={org || view.organisationCode || ""} onChange={(e) => { setOrg(e.target.value); setPicked([]); setLine(null); }} className={`${fieldCls} !text-[#14315E]`} data-testid="pd-org">
                    <option value="">Choose…</option>{(view.organisations ?? []).map((o) => <option key={o.code} value={o.code}>{o.name.replace(/\s*\(synthetic[^)]*\)\s*$/, "")}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#c9d9f7]">Financial year
                <select value={fy} onChange={(e) => { setFy(e.target.value); setPicked([]); setLine(null); }} className={`${fieldCls} !text-[#14315E]`} data-testid="pd-fy">
                  {view.years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
          </div>
          {view.financialYear ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile icon="factory" tone="#254e9e" label="Units produced" value={quarters.reduce((n, q) => n + q.units, 0).toLocaleString("en-IN")} note={`financial year ${view.financialYear}`} />
              <Tile icon="receipt_long" tone="#d68910" label="Label fee payable" value={inr(view.payable ?? 0)} note="all quarters" />
              <Tile icon="check_circle" tone="#1e8449" label="Paid" value={inr(view.paid ?? 0)} note="settled orders" />
              <Tile icon="pending_actions" tone="#c0392b" label="Balance" value={inr(view.balance ?? 0)} note="still to pay" />
            </div>
          ) : null}
        </div>
      </header>

      {notice ? <p role="status" className="rounded-lg border border-[#b7e0c6] bg-[#e2f3e8] px-3 py-2 text-[13px] font-semibold text-[#14532d]" data-testid="pd-notice">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{error}</p> : null}

      {!view.financialYear ? <p className="text-[13px] text-[#64748b]">Choose a manufacturer to see its production details.</p> : view.lines.length === 0 ? <p className="text-[13px] text-[#64748b]">No production is declared in {view.financialYear}.</p> : (
        <>
          <section className={`${shell} overflow-hidden`} data-testid="pd-grid">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] p-5">
              <div><div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">What was manufactured</div><p className="text-[12px] text-[#64748b]">Units per model and quarter, as certified by the CA. Click a figure to see its serial numbers. <span className="font-semibold">*</span> expired model, <span className="font-semibold">(W)</span> withdrawn model.</p></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Production per model and quarter of {view.financialYear}</caption>
                <thead><tr className="bg-[#eef3fb]"><th className={th}>Model</th>{quarters.map((q) => <th key={q.fq} className={`${th} text-right`}>{q.label}</th>)}<th className={`${th} text-right`}>Total</th></tr></thead>
                <tbody>
                  {view.lines.map((l) => (
                    <tr key={l.applicationId} className="border-t border-[#e2e8f0]" data-testid={`pd-line-${l.model}`}>
                      <td className={td}><span className="font-semibold text-[#14315E]">{l.model}{l.mark === "expired" ? " *" : l.mark === "withdrawn" ? " (W)" : ""}</span><div className="text-[12px] text-[#64748b]">{l.registrationId ?? l.reference}</div></td>
                      {l.quarters.map((q) => (
                        <td key={q.fq} className={`${td} text-right`}>
                          {q.units > 0 ? (
                            <button type="button" onClick={() => setLine({ l, fq: q.fq })} className={`rounded-lg px-2 py-1 text-right hover:bg-[#f4f8ff] ${line?.l.applicationId === l.applicationId && line.fq === q.fq ? "bg-[#e7effb] ring-2 ring-[#c9d9f7]" : ""}`} data-testid={`pd-cell-${l.model}-${q.fq}`}>
                              <b className="block tabular-nums text-[#14315E]">{q.units.toLocaleString("en-IN")}</b>
                              <span className="block text-[11px] text-[#64748b]">{q.serials.total > 0 ? `${q.serials.total.toLocaleString("en-IN")} serials` : "no serials yet"}</span>
                            </button>
                          ) : <span className="text-[#94a3b8]">-</span>}
                        </td>
                      ))}
                      <td className={`${td} text-right font-bold tabular-nums text-[#14315E]`}>{l.quarters.reduce((n, q) => n + q.units, 0).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c9d9f7] bg-[#f9fbff] font-semibold"><td className={td}>Total units</td>{quarters.map((q) => <td key={q.fq} className={`${td} text-right tabular-nums`}>{q.units ? q.units.toLocaleString("en-IN") : "-"}</td>)}<td className={`${td} text-right tabular-nums`}>{quarters.reduce((n, q) => n + q.units, 0).toLocaleString("en-IN")}</td></tr>
                  <tr className="bg-[#f9fbff] font-semibold"><td className={td}>Label fee</td>{quarters.map((q) => <td key={q.fq} className={`${td} text-right tabular-nums`}>{q.units ? inr(q.fee) : "-"}</td>)}<td className={`${td} text-right tabular-nums`}>{inr(view.payable ?? 0)}</td></tr>
                  <tr className="bg-[#f9fbff]" data-testid="pd-payment-row"><td className={td}><span className="font-semibold">Payment</span><div className="text-[11px] font-normal text-[#64748b]">Select quarters to pay</div></td>
                    {quarters.map((q) => (
                      <td key={q.fq} className={`${td} text-right`}>
                        {q.units === 0 ? <span className="text-[#94a3b8]">-</span> : q.payment ? (
                          <span><Chip tone={q.payment.status === "paid" ? GREEN : AMBER}>{q.payment.status === "paid" ? "Paid" : "Awaiting payment"}</Chip>{q.payment.receipt ? <span className="mt-1 block text-[11px] text-[#64748b]">{q.payment.receipt}</span> : null}</span>
                        ) : staff ? <Chip tone={GREY}>Unpaid</Chip> : (
                          <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#14315E]"><input type="checkbox" checked={picked.includes(q.fq)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, q.fq] : p.filter((x) => x !== q.fq)))} data-testid={`pd-pay-q${q.fq}`} /> Pay Q{q.fq}</label>
                        )}
                      </td>
                    ))}
                    <td className={td} />
                  </tr>
                  <tr className="bg-[#f9fbff]" data-testid="pd-ca-row"><td className={td}><span className="font-semibold">CA document and submission</span><div className="text-[11px] font-normal text-[#64748b]">Managed in the Quarterly submission tab</div></td>
                    {quarters.map((q) => (
                      <td key={q.fq} className={`${td} text-right text-[12px]`}>
                        {q.submission ? (
                          <span><Chip tone={q.submission.state === "accepted" ? GREEN : q.submission.state === "submitted" ? BLUE : AMBER}>{SUB_WORD[q.submission.state] ?? q.submission.state}</Chip>
                            <span className="mt-1 block text-[11px] text-[#64748b]">{q.submission.evidence} CA document{q.submission.evidence === 1 ? "" : "s"}</span>
                            <Link href={`/app/demo/production?open=${q.submission.id}`} className="text-[11px] font-semibold text-primary hover:underline">Open</Link></span>
                        ) : <span className="text-[#94a3b8]">-</span>}
                      </td>
                    ))}
                    <td className={td} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {!staff ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] bg-[#fbfcfe] p-5" data-testid="pd-paybar">
                <div className="text-[13px] text-[#334155]"><b>Payable now:</b> {inr(selectedFee)} <span className="text-[#64748b]">for {picked.length} quarter{picked.length === 1 ? "" : "s"}. Paid: {inr(view.paid ?? 0)}. Balance: {inr(view.balance ?? 0)}.</span></div>
                <button type="button" className={btn} disabled={busy || picked.length === 0} onClick={() => void pay()} data-testid="pd-pay-button"><Icon name="payments" size={18} /> Pay label fee</button>
              </div>
            ) : null}
            {problem ? <p role="alert" className="mx-5 mb-5 rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{problem}</p> : null}
          </section>

          {line ? <SerialPanel key={`${line.l.applicationId}-${line.fq}-${fy}`} l={line.l} fq={line.fq} fy={fy} org={staff ? (org || view.organisationCode || "") : ""} writer={!staff} onChanged={() => { void load(); }} onClose={() => setLine(null)} /> : null}

          <section className={`${shell} overflow-hidden`} data-testid="pd-orders">
            <div className="border-b border-[#e2e8f0] p-5"><div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">Label fee payments</div></div>
            {(view.orders ?? []).length === 0 ? <p className="p-5 text-[13px] text-[#64748b]">No payment yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[13px]"><caption className="sr-only">Label fee orders</caption>
                <thead><tr className="bg-[#eef3fb]"><th className={th}>Order</th><th className={th}>Year</th><th className={th}>Quarters</th><th className={th}>Method</th><th className={`${th} text-right`}>Amount</th><th className={th}>Status</th><th className={th}>Receipt</th></tr></thead>
                <tbody>{(view.orders ?? []).map((o) => (
                  <tr key={o.orderId} className="border-t border-[#e2e8f0]"><td className={`${td} font-semibold`}>{o.orderId}</td><td className={td}>{o.financialYear}</td><td className={td}>{o.quarters.split(",").map((q) => `Q${q}`).join(", ")}</td><td className={td}>{o.method ? METHOD_WORD[o.method] : "-"}</td>
                    <td className={`${td} text-right tabular-nums`}>{inr(o.amount)}</td><td className={td}><Chip tone={o.status === "paid" ? GREEN : o.status === "initiated" ? AMBER : GREY}>{o.status === "paid" ? "Paid" : o.status === "initiated" ? (o.method === "direct_transfer" ? "Awaiting confirmation" : "Awaiting payment") : "Failed"}</Chip></td><td className={td}>{o.receipt ?? "-"}</td></tr>
                ))}</tbody></table></div>
            )}
          </section>
        </>
      )}

      {order ? <PaymentDialog order={order} onClose={() => setOrder(null)} onSettled={(r) => { setNotice(r.status === "paid" ? `Payment received. Receipt ${r.receipt}.` : r.status === "awaiting_confirmation" ? "Direct transfer recorded. It is confirmed when BEE Finance sees the transfer." : "The payment failed. You can try again."); setPicked([]); void load(); }} /> : null}
    </div>
  );
}

function SerialPanel({ l, fq, fy, org, writer, onChanged, onClose }: { l: ProductionLine; fq: number; fy: string; org: string; writer: boolean; onChanged: () => void; onClose: () => void }) {
  const q = l.quarters[fq - 1];
  const [state, setState] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SerialPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState("500");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void readLine({ app: l.applicationId, fy, fq, offset, state, organisation: org || undefined }).then((r) => { if (!live) return; if (r.ok) { setData(r.value); setError(null); } else setError(r.message); });
    return () => { live = false; };
  }, [l.applicationId, fy, fq, offset, state, org, version]);
  const make = async () => {
    setBusy(true); setError(null);
    const r = await makeSerials(l.applicationId, fy, fq, Number(qty));
    setBusy(false);
    if (r.ok) { setVersion((v) => v + 1); onChanged(); } else setError(r.message);
  };
  return (
    <section className={`${shell} overflow-hidden`} style={{ borderTop: "4px solid #254e9e" }} data-testid="pd-serials">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div><div role="heading" aria-level={2} className="text-[18px] font-bold text-[#14315E]">Serial numbers: {l.model}, Q{fq} {fy}</div>
          <p className="text-[12px] text-[#64748b]">{q.units.toLocaleString("en-IN")} units declared · {q.serials.total.toLocaleString("en-IN")} serial numbers linked · {q.serials.bound.toLocaleString("en-IN")} bound to a label · {q.serials.voided.toLocaleString("en-IN")} voided</p></div>
        <button type="button" className={btnOutline} onClick={onClose}>Close</button>
      </div>
      <div className="grid gap-5 border-t border-[#e2e8f0] p-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className={labelCls}>Status<select value={state} onChange={(e) => { setState(e.target.value); setOffset(0); }} className={fieldCls} data-testid="pd-serial-state"><option value="">All</option><option value="allocated">Allocated</option><option value="bound">Bound to a label</option><option value="void">Voided</option></select></label>
            <span className="pb-2 text-[12px] text-[#64748b]">{data ? `${data.total.toLocaleString("en-IN")} serial numbers` : ""}</span>
          </div>
          {error ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{error}</p> : null}
          {!data ? <p className="text-[13px]">Loading…</p> : data.serials.length === 0 ? <p className="text-[13px] text-[#64748b]">No serial numbers are linked to this production line yet.</p> : (
            <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]"><caption className="sr-only">Serial numbers of this production line</caption>
              <thead><tr className="bg-[#eef3fb]"><th className={th}>Serial number</th><th className={th}>Status</th><th className={th}>Allocated</th><th className={th}>Batch</th></tr></thead>
              <tbody>{data.serials.map((s) => (
                <tr key={s.serial} className="border-t border-[#e2e8f0]"><td className={`${td} font-mono text-[12px]`}>{s.serial}</td><td className={td}><Chip tone={s.state === "bound" ? GREEN : s.state === "void" ? GREY : BLUE}>{s.state === "bound" ? "Bound" : s.state === "void" ? "Voided" : "Allocated"}</Chip></td><td className={`${td} whitespace-nowrap`}>{s.allocatedAt.slice(0, 10)}</td><td className={`${td} font-mono text-[12px]`}>{s.batch}</td></tr>
              ))}</tbody></table></div>
          )}
          {data && data.total > data.limit ? (
            <div className="flex items-center justify-between text-[12px] text-[#475569]"><span>Showing {data.offset + 1} to {Math.min(data.offset + data.limit, data.total)} of {data.total.toLocaleString("en-IN")}</span>
              <span className="flex gap-2"><button type="button" className={btnOutline} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.limit))}>Previous</button><button type="button" className={btnOutline} disabled={offset + data.limit >= data.total} onClick={() => setOffset(offset + data.limit)}>Next</button></span></div>
          ) : null}
        </div>
        <aside className="space-y-3 rounded-xl bg-[#f4f8ff] p-4 text-[13px] text-[#334155]">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Batches of this line</div>
          {data && data.batches.length > 0 ? <ul className="space-y-1">{data.batches.map((b) => <li key={b.id} className="flex justify-between"><span className="font-mono text-[12px]">{b.id}</span><span>{b.quantity.toLocaleString("en-IN")} · {b.status}</span></li>)}</ul> : <p className="text-[12px] text-[#64748b]">None yet.</p>}
          {writer ? (
            <div className="border-t border-[#c9d9f7] pt-3">
              <label className={labelCls}>Make serial numbers<input type="number" min={1} max={5000} value={qty} onChange={(e) => setQty(e.target.value)} className={`${fieldCls} w-32`} data-testid="pd-serial-qty" /></label>
              <button type="button" className={`${btn} mt-2`} disabled={busy} onClick={() => void make()} data-testid="pd-serial-make">Make serial numbers</button>
              <p className="mt-2 text-[11px] text-[#64748b]">Up to 5,000 at a time, linked to this model and quarter.</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

type Step = "order" | "gateway" | "result";

function PaymentDialog({ order, onClose, onSettled }: { order: FeeOrder; onClose: () => void; onSettled: (r: PayResult) => void }) {
  const [step, setStep] = useState<Step>("order");
  const [method, setMethod] = useState("razorpay");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const settle = async (outcome: "paid" | "failed") => {
    setBusy(true); setProblem(null);
    const r = await completeOrder(order.orderId, method, outcome);
    setBusy(false);
    if (r.ok) { setResult(r.value); setStep("result"); onSettled(r.value); } else setProblem(r.message);
  };
  const cancel = async () => {
    setBusy(true);
    await cancelOrder(order.orderId);
    setBusy(false);
    onClose();
  };
  if (typeof document === "undefined") return null;
  const row = (k: string, v: string) => <tr key={k} className="border-t border-[#e2e8f0]"><th className="w-44 bg-[#f4f8ff] px-3 py-2 text-left text-[12px] font-semibold text-[#475569]">{k}</th><td className="px-3 py-2 text-[13px] text-[#14315E]">{v}</td></tr>;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Labelling payment" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="pd-dialog">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><div role="heading" aria-level={2} className="text-[20px] font-extrabold text-[#14315E]">Labelling payment</div><div className="text-[12px] text-[#64748b]">Simulated gateway: no money moves</div></div>
          {step !== "result" ? <button type="button" className={btnOutline} disabled={busy} onClick={() => void cancel()} data-testid="pd-dialog-close">Cancel</button> : null}
        </div>
        {step === "order" ? (
          <div className="space-y-4">
            <table className="w-full overflow-hidden rounded-lg border border-[#e2e8f0]"><tbody>{[["Reference ID", order.orderId], ["Equipment", order.equipment], ["Financial year", order.financialYear], ["Firm name", order.firm]].map(([k, v]) => row(k, v))}</tbody></table>
            <table className="w-full text-[13px]"><thead><tr className="bg-[#eef3fb]"><th className={th}>Quarter</th><th className={`${th} text-right`}>Units</th><th className={`${th} text-right`}>Label fee</th></tr></thead>
              <tbody>{order.items.map((i) => <tr key={i.fq} className="border-t border-[#e2e8f0]"><td className={td}>{i.label}</td><td className={`${td} text-right tabular-nums`}>{i.units.toLocaleString("en-IN")}</td><td className={`${td} text-right tabular-nums`}>{inr(i.amount)}</td></tr>)}
                <tr className="border-t-2 border-[#c9d9f7] font-bold"><td className={td} colSpan={2}>Payment amount</td><td className={`${td} text-right tabular-nums`}>{inr(order.amount)}</td></tr></tbody></table>
            <fieldset className="space-y-2"><legend className={labelCls}>Payment method</legend>
              {order.methods.map((m) => (
                <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[14px] font-semibold ${method === m ? "border-[#254e9e] bg-[#f4f8ff]" : "border-[#dbe6f7]"}`}><input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} data-testid={`pd-method-${m}`} />{METHOD_WORD[m]}{m === "direct_transfer" ? <span className="ml-auto text-[11px] font-normal text-[#64748b]">confirmed by BEE Finance</span> : null}</label>
              ))}
            </fieldset>
            <button type="button" className={btn} onClick={() => setStep("gateway")} data-testid="pd-click-to-pay">Click here to pay</button>
          </div>
        ) : step === "gateway" ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-gradient-to-br from-[#14315E] to-[#254e9e] p-5 text-white"><div className="text-[12px] uppercase tracking-wide text-[#c9d9f7]">{METHOD_WORD[method]} (simulated)</div><div className="mt-1 text-[30px] font-extrabold">{inr(order.amount)}</div><div className="text-[12px] text-[#dbe6f7]">{order.firm} · {order.orderId}</div></div>
            {method === "direct_transfer" ? <p className="text-[13px] text-[#334155]">Make a bank transfer to the BEE account quoting the reference <b>{order.orderId}</b>. BEE Finance confirms it when the transfer is seen. In this demonstration nothing is transferred.</p> : <p className="text-[13px] text-[#334155]">This stands in for the gateway page. Choose the outcome to see how the screen responds.</p>}
            {problem ? <p role="alert" className="rounded-lg bg-error-container p-space-sm font-body-sm text-on-error-container">{problem}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${btn} !bg-[#14532d]`} disabled={busy} onClick={() => void settle("paid")} data-testid="pd-gateway-pay"><Icon name="check_circle" size={18} /> {method === "direct_transfer" ? "I have made the transfer" : "Pay now"}</button>
              {method !== "direct_transfer" ? <button type="button" className={btnOutline} disabled={busy} onClick={() => void settle("failed")} data-testid="pd-gateway-fail">Simulate a failed payment</button> : null}
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4 text-center" data-testid="pd-result">
            <Icon name={result.status === "paid" ? "verified" : result.status === "awaiting_confirmation" ? "hourglass_top" : "error"} size={48} className={result.status === "paid" ? "text-[#1e8449]" : result.status === "failed" ? "text-[#c0392b]" : "text-[#d68910]"} />
            <div className="text-[20px] font-extrabold text-[#14315E]">{result.status === "paid" ? "Payment received" : result.status === "awaiting_confirmation" ? "Awaiting confirmation" : "Payment failed"}</div>
            <p className="text-[13px] text-[#475569]">{result.status === "paid" ? `Receipt ${result.receipt} · gateway reference ${result.gatewayRef} · ${inr(order.amount)}` : result.note ?? "Nothing was charged. You can start the payment again."}</p>
            <button type="button" className={btn} onClick={onClose} data-testid="pd-result-close">Done</button>
          </div>
        ) : null}
      </div>
    </div>, document.body);
}
