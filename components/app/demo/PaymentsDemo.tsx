"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill } from "./DemoShell";
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";

type Receipt = {
  receiptNumber: string;
  applicationReference: string;
  gatewayRef: string;
  paidAt: string | null;
  feeInr: string | null;
  taxRatePercent: string | null;
  taxInr: string | null;
  amountInr: string;
  note: string;
};
export type PaymentRow = {
  id: string;
  applicationId: string;
  applicationReference: string;
  brandName?: string;
  modelNumber?: string;
  organisationCode?: string;
  amountInr: string;
  status: "initiated" | "paid" | "failed";
  gatewayRef: string;
  receiptNumber: string | null;
  feeConfirmed?: boolean;
  feeConfirmationReference?: string | null;
  receipt?: Receipt;
};
type FeeDue = { applicationId: string; reference: string; brandName: string; modelNumber: string; feeInr: string; taxRatePercent: string; taxInr: string; totalInr: string };
type Listing = { view: "applicant" | "finance"; payments: PaymentRow[]; feeDue?: FeeDue[] };
type Difference = { kind: string; paymentId: string; applicationReference: string; gatewayRef: string; paidInr: string; confirmedInr: string | null };
type Reconciliation = {
  byStatus: { status: string; count: number; totalInr: string }[];
  paidTotalInr: string;
  confirmedReceiptsTotalInr: string;
  confirmedReceiptsCount: number;
  confirmedWithoutSimulatedPayment: number;
  confirmedWithoutSimulatedPaymentInr: string;
  differences: Difference[];
  receipts: Receipt[];
  note: string;
};

const btn = "border border-primary text-primary py-2 px-4 rounded-lg font-label-md disabled:opacity-50";
const card = "bg-surface-card rounded-xl shadow-sm p-space-md";
const th = "py-1 pr-3";
const inr = (v: string) => `INR ${v}`;

function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <section className={card} aria-label={`Receipt ${receipt.receiptNumber}`} data-testid="pay-receipt">
      <h3 className="font-title-md text-title-md text-on-surface">Receipt {receipt.receiptNumber}</h3>
      <dl className="font-body-sm mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt>Application</dt><dd>{receipt.applicationReference}</dd>
        <dt>Gateway reference</dt><dd>{receipt.gatewayRef}</dd>
        <dt>Fee</dt><dd>{receipt.feeInr ? inr(receipt.feeInr) : "-"}</dd>
        <dt>Tax ({receipt.taxRatePercent ?? "0"}%)</dt><dd>{receipt.taxInr ? inr(receipt.taxInr) : "-"}</dd>
        <dt>Paid in total</dt><dd>{inr(receipt.amountInr)}</dd>
        <dt>Paid at</dt><dd>{receipt.paidAt ?? "-"}</dd>
      </dl>
      <p className="font-body-sm text-on-surface-variant mt-1">{receipt.note}</p>
    </section>
  );
}

export function PaymentsDemo() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [lastCallback, setLastCallback] = useState<{ id: string; body: Record<string, string> } | null>(null);

  const load = useCallback(async () => {
    const res = await demoGet<Listing & DemoBody>(demoPath("payments"));
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(null);
    setListing(res.value);
    if (res.value.view === "finance") {
      const rec = await demoGet<Reconciliation & DemoBody>(demoPath("payments", "reconciliation"));
      if (rec.ok) setReconciliation(rec.value);
      else setError(rec.message);
    }
  }, []);

  useEffect(() => {
    // Initial read of the list; the setState calls happen after the awaited response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(action: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>) {
    setBusy(true);
    setStatus(null);
    const out = await action();
    setBusy(false);
    if (out.ok) {
      setError(null);
      setStatus(out.message);
      await load();
    } else {
      setStatus(null);
      setError(out.message);
    }
  }

  const start = (app: FeeDue) =>
    run(async () => {
      const res = await demoPost<DemoBody>(demoPath("payments"), { applicationId: app.applicationId });
      return res.ok ? { ok: true, message: `Payment started for ${app.reference}: gateway reference ${String(res.value.gatewayRef)}, ${inr(String(res.value.amountInr))}.` } : { ok: false, message: res.message };
    });

  const callback = (p: PaymentRow, outcome: "paid" | "failed", repeat?: { id: string; body: Record<string, string> }) =>
    run(async () => {
      const body = repeat?.body ?? { gatewayRef: p.gatewayRef, outcome, nonce: crypto.randomUUID() };
      const res = await demoPost<DemoBody>(demoPath("payments", p.id, "callback"), body);
      if (!res.ok) return { ok: false, message: res.message };
      setLastCallback({ id: p.id, body });
      const replayed = res.value.replayed === true;
      return {
        ok: true,
        message: replayed
          ? `Same callback received again: ignored, the first result stands (${String(res.value.status)}). Nothing changed, no duplicate record.`
          : `Simulated gateway callback received: ${String(res.value.status)}${res.value.receiptNumber ? `, receipt ${String(res.value.receiptNumber)}` : ""}.`,
      };
    });

  if (!listing && !error) return <div className="p-space-md lg:p-space-lg" data-testid="demo-payments" role="status">Loading payments…</div>;

  const payments = listing?.payments ?? [];
  const open = payments.filter((p) => p.status === "initiated");
  const finance = listing?.view === "finance";
  const receipt = payments.find((p) => p.id === receiptId)?.receipt;

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-payments">
      <h1 className="font-headline-md text-headline-md text-on-surface">Payments (simulated)</h1>
      {error ? <p role="alert" className="font-body-sm text-error" data-testid="pay-error">{error}</p> : null}
      {status ? <p role="status" className="font-body-sm text-on-surface" data-testid="pay-status">{status}</p> : null}

      {listing && !finance ? (
        <section className={card} aria-labelledby="pay-due-h" data-testid="pay-due">
          <h2 id="pay-due-h" className="font-title-md text-title-md text-on-surface">Applications waiting for the fee</h2>
          {(listing.feeDue ?? []).length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No application is waiting for its fee.</p> : (
            <table className="w-full font-body-sm mt-space-sm">
              <caption className="sr-only">Applications waiting for the fee</caption>
              <thead><tr className="text-left text-on-surface-variant font-label-sm">
                <th className={th}>Application</th><th className={th}>Model</th><th className={th}>Fee</th><th className={th}>Tax</th><th className={th}>To pay</th><th className={th}><span className="sr-only">Action</span></th>
              </tr></thead>
              <tbody>
                {(listing.feeDue ?? []).map((a) => {
                  const live = payments.some((p) => p.applicationId === a.applicationId && p.status !== "failed");
                  return (
                    <tr key={a.applicationId}>
                      <td className={th}>{a.reference}</td><td className={th}>{a.brandName} {a.modelNumber}</td>
                      <td className={th}>{inr(a.feeInr)}</td><td className={th}>{inr(a.taxInr)} ({a.taxRatePercent}%)</td><td className={th}>{inr(a.totalInr)}</td>
                      <td className={th}>
                        <button type="button" className={btn} disabled={busy || live} onClick={() => void start(a)} aria-label={`Pay at simulated gateway for ${a.reference}`}>
                          {live ? "Payment open" : "Pay at simulated gateway"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {listing && !finance
        ? open.map((p) => (
            <section key={p.id} className={card} aria-labelledby={`gw-${p.id}`} data-testid="pay-gateway">
              <h2 id={`gw-${p.id}`} className="font-title-md text-title-md text-on-surface">Simulated gateway: {p.applicationReference}</h2>
              <p className="font-body-sm mt-1">Gateway reference <strong>{p.gatewayRef}</strong>, amount {inr(p.amountInr)} (fixed from the fee snapshot; the gateway cannot change it).</p>
              <div className="flex gap-space-sm mt-space-sm">
                <button type="button" className={btn} disabled={busy} onClick={() => void callback(p, "paid")}>Pay now</button>
                <button type="button" className={btn} disabled={busy} onClick={() => void callback(p, "failed")}>Decline</button>
              </div>
            </section>
          ))
        : null}

      {listing && !finance && lastCallback ? (
        <section className={card} data-testid="pay-replay">
          <h2 className="font-title-md text-title-md text-on-surface">Send the same callback again</h2>
          <p className="font-body-sm text-on-surface-variant mt-1">A gateway may deliver one callback twice. The second is recognised by its payload fingerprint and ignored.</p>
          <button type="button" className={`${btn} mt-space-sm`} disabled={busy} onClick={() => {
            const p = payments.find((x) => x.id === lastCallback.id);
            if (p) void callback(p, "paid", lastCallback);
          }}>Replay last callback</button>
        </section>
      ) : null}

      {listing ? (
        <section className={card} aria-labelledby="pay-list-h" data-testid="pay-list">
          <h2 id="pay-list-h" className="font-title-md text-title-md text-on-surface">{finance ? "All payments" : "My organisation's payments"}</h2>
          {payments.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No payments yet.</p> : (
            <table className="w-full font-body-sm mt-space-sm">
              <caption className="sr-only">Payments</caption>
              <thead><tr className="text-left text-on-surface-variant font-label-sm">
                <th className={th}>Application</th>{finance ? <th className={th}>Organisation</th> : null}<th className={th}>Amount</th><th className={th}>Status</th>
                <th className={th}>Gateway reference</th>{finance ? <th className={th}>Fee confirmed</th> : <th className={th}>Receipt</th>}
              </tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className={th}>{p.applicationReference}</td>{finance ? <td className={th}>{p.organisationCode}</td> : null}
                    <td className={th}>{inr(p.amountInr)}</td><td className={th}><Pill>{p.status}</Pill></td><td className={th}><code>{p.gatewayRef}</code></td>
                    {finance ? <td className={th}>{p.feeConfirmed ? `Yes (${p.feeConfirmationReference})` : p.status === "paid" ? "Not yet: use the gateway reference as the receipt reference" : "No"}</td> : (
                      <td className={th}>{p.receiptNumber ? <button type="button" className={btn} onClick={() => setReceiptId(receiptId === p.id ? null : p.id)}>{receiptId === p.id ? "Hide receipt" : `Receipt ${p.receiptNumber}`}</button> : "-"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {finance ? <p className="font-body-sm text-on-surface-variant mt-space-sm">Finance still confirms the fee in the Finance queue. This simulation never changes the application.</p> : null}
        </section>
      ) : null}

      {receipt ? <ReceiptView receipt={receipt} /> : null}

      {finance && reconciliation ? (
        <section className={card} aria-labelledby="pay-rec-h" data-testid="pay-reconciliation">
          <h2 id="pay-rec-h" className="font-title-md text-title-md text-on-surface">Reconciliation</h2>
          <table className="font-body-sm mt-space-sm">
            <caption className="sr-only">Payments by status</caption>
            <thead><tr className="text-left text-on-surface-variant font-label-sm"><th className={th}>Status</th><th className={th}>Payments</th><th className={th}>Total</th></tr></thead>
            <tbody>{reconciliation.byStatus.map((s) => <tr key={s.status}><td className={th}>{s.status}</td><td className={th}>{s.count}</td><td className={th}>{inr(s.totalInr)}</td></tr>)}</tbody>
          </table>
          <p className="font-body-sm mt-space-sm">Simulated payments paid: <strong>{inr(reconciliation.paidTotalInr)}</strong>. Fee receipts confirmed by Finance: <strong>{inr(reconciliation.confirmedReceiptsTotalInr)}</strong> ({reconciliation.confirmedReceiptsCount}).</p>
          <p className="font-body-sm text-on-surface-variant">{reconciliation.confirmedWithoutSimulatedPayment} confirmed receipt(s) ({inr(reconciliation.confirmedWithoutSimulatedPaymentInr)}) have no simulated payment; that is normal for earlier applications.</p>
          <h3 className="font-label-md text-on-surface mt-space-sm">Differences</h3>
          {reconciliation.differences.length === 0 ? <p className="font-body-sm">No differences.</p> : (
            <ul className="font-body-sm list-disc pl-5">
              {reconciliation.differences.map((d) => (
                <li key={d.paymentId}>{d.applicationReference}: {d.kind === "paid_not_yet_confirmed" ? `paid ${inr(d.paidInr)} but not yet confirmed by Finance` : `paid ${inr(d.paidInr)}, confirmed ${inr(d.confirmedInr ?? "0")}`} (gateway reference {d.gatewayRef})</li>
              ))}
            </ul>
          )}
          <h3 className="font-label-md text-on-surface mt-space-sm">Receipts for paid payments</h3>
          <ul className="font-body-sm list-disc pl-5">
            {reconciliation.receipts.map((r) => <li key={r.receiptNumber}>{r.receiptNumber}: {r.applicationReference}, fee {r.feeInr ? inr(r.feeInr) : "-"} + tax {r.taxInr ? inr(r.taxInr) : "-"} = {inr(r.amountInr)}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
