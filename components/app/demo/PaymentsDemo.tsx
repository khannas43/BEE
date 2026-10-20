"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pill } from "./DemoShell";
import { Icon } from "@/components/ui/Icon";
import { DescriptionList } from "@/components/app/kit/StatePanels";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";
import { datedFileName, saveBytes } from "@/lib/client/csv";
import { buildReceiptPdf, PDF_TYPE } from "@/lib/client/pdf";
import { istStamp } from "@/lib/client/istTime";

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

const btn = "border border-primary text-primary bg-white py-2 px-4 rounded-lg font-label-md disabled:opacity-50";
const primaryBtn = "!bg-[#1f3c88] !text-white border border-[#1f3c88] py-2 px-4 rounded-lg font-label-md hover:!bg-[#14315E] disabled:opacity-50";
const dangerBtn = "border border-[#ba1a1a] text-[#93000a] bg-white py-2 px-4 rounded-lg font-label-md disabled:opacity-50";
const card = "rounded-xl border border-[#dbe6f7] bg-white p-5";
const th = "px-3 py-2 align-top";
const HEAD_ROW = "bg-[#eef3fb] text-left text-[12px] font-semibold uppercase tracking-wide text-[#475569]";

function Tile({ icon, label, value, note, tone = "text-[#14315E]" }: { icon: string; label: string; value: string | number; note: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#dbe6f7] bg-white p-4">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#64748b]"><Icon name={icon} size={16} />{label}</span>
      <span className={`mt-1 block text-[26px] font-extrabold leading-8 ${tone}`}>{value}</span>
      <span className="block text-[12px] text-[#64748b]">{note}</span>
    </div>
  );
}

/** A section title with an icon; the text stays the heading of its card. */
function Title({ id, icon, children }: { id?: string; icon: string; children: React.ReactNode }) {
  return <div id={id} role="heading" aria-level={2} className="mb-3 flex items-center gap-2 text-[16px] font-bold text-[#14315E]"><Icon name={icon} size={20} className="text-[#254e9e]" />{children}</div>;
}
const inr = (v: string) => `INR ${v}`;

function ReceiptView({ receipt }: { receipt: Receipt }) {
  const rows = [
    { label: "Application", value: receipt.applicationReference },
    { label: "Gateway reference", value: receipt.gatewayRef, mono: true },
    { label: "Fee", value: receipt.feeInr ? inr(receipt.feeInr) : "-" },
    { label: `Tax (${receipt.taxRatePercent ?? "0"}%)`, value: receipt.taxInr ? inr(receipt.taxInr) : "-" },
    { label: "Paid in total", value: inr(receipt.amountInr) },
    { label: "Paid at", value: receipt.paidAt ?? "-" },
  ];
  return (
    <section className={card} aria-label={`Receipt ${receipt.receiptNumber}`} data-testid="pay-receipt">
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <Title icon="receipt_long">Receipt {receipt.receiptNumber}</Title>
        <button type="button" className={btn} data-testid="pay-receipt-download"
          onClick={() => saveBytes(datedFileName(`receipt-${receipt.receiptNumber}`, "pdf"), buildReceiptPdf({ receiptNumber: receipt.receiptNumber, rows, note: receipt.note }), PDF_TYPE)}>
          Download Receipt
        </button>
      </div>
      <DescriptionList rows={rows} />
      <p className="font-body-sm text-on-surface-variant mt-1">{receipt.note}</p>
    </section>
  );
}

type PaymentCols = PaymentRow & { createdAt?: string };

function PaymentsTable({ payments, finance, receiptId, onToggleReceipt }: { payments: PaymentRow[]; finance: boolean; receiptId: string | null; onToggleReceipt: (id: string) => void }) {
  const rows = payments as PaymentCols[];
  const tools = useListTools({
    rows,
    text: (p) => `${p.applicationReference} ${p.organisationCode ?? ""} ${p.brandName ?? ""} ${p.modelNumber ?? ""} ${p.status} ${p.gatewayRef}`,
    date: (p) => p.createdAt?.slice(0, 10),
    sortValue: (p, k) => (k === "app" ? p.applicationReference : k === "org" ? p.organisationCode ?? "" : k === "amount" ? Number(p.amountInr) : k === "status" ? p.status : k === "gw" ? p.gatewayRef : k === "date" ? p.createdAt ?? "" : p.receiptNumber ?? ""),
  });
  return (
    <div className="space-y-space-sm mt-space-sm">
      <ListToolbar tools={tools} searchLabel="Search by application" placeholder="Application, organisation or gateway reference" dateLabel="Created"
        exportCsv={{ filename: "payments", header: ["Application", "Organisation", "Brand", "Model", "Amount INR", "Status", "Gateway reference", "Receipt", "Created"],
          rows: tools.visible.map((p) => [p.applicationReference, p.organisationCode, p.brandName, p.modelNumber, Number(p.amountInr), p.status, p.gatewayRef, p.receiptNumber, istStamp(p.createdAt)]) }} />
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No payments match.</p> : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]">
            <caption className="sr-only">Payments</caption>
            <thead><tr className={HEAD_ROW}>
              <SortableTh tools={tools} k="app" className={th}>Application</SortableTh>{finance ? <SortableTh tools={tools} k="org" className={th}>Organisation</SortableTh> : null}
              <SortableTh tools={tools} k="amount" className={th}>Amount</SortableTh><SortableTh tools={tools} k="status" className={th}>Status</SortableTh>
              <SortableTh tools={tools} k="gw" className={th}>Gateway reference</SortableTh><SortableTh tools={tools} k="date" className={th}>Created</SortableTh>
              {finance ? <th className={th}>Fee confirmed</th> : <SortableTh tools={tools} k="receipt" className={th}>Receipt</SortableTh>}
            </tr></thead>
            <tbody>
              {tools.paged.pageRows.map((p) => (
                <tr key={p.id} className="border-t border-[#e7edf6]">
                  <td className={th}>{p.applicationReference}</td>{finance ? <td className={th}>{p.organisationCode}</td> : null}
                  <td className={th}>{inr(p.amountInr)}</td><td className={th}><Pill>{p.status}</Pill></td><td className={th}><code>{p.gatewayRef}</code></td>
                  <td className={th}>{p.createdAt ? p.createdAt.slice(0, 10) : ""}</td>
                  {finance ? <td className={th}>{p.feeConfirmed ? `Yes (${p.feeConfirmationReference})` : p.status === "paid" ? "Not yet: use the gateway reference as the receipt reference" : "No"}</td> : (
                    <td className={th}>{p.receiptNumber ? <button type="button" className={btn} onClick={() => onToggleReceipt(p.id)}>{receiptId === p.id ? "Hide receipt" : `Receipt ${p.receiptNumber}`}</button> : "-"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
          <ListPager tools={tools} />
        </>
      )}
    </div>
  );
}

export function PaymentsDemo() {
  const highlight = useSearchParams()?.get("application") ?? null;
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
  const justSubmitted = highlight ? (listing?.feeDue ?? []).find((a) => a.reference === highlight) : undefined;

  const payments = listing?.payments ?? [];
  const open = payments.filter((p) => p.status === "initiated");
  const finance = listing?.view === "finance";
  const receipt = payments.find((p) => p.id === receiptId)?.receipt;

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-payments">
      <h1 className="font-headline-md text-headline-md text-on-surface">Payments</h1>
      {listing ? (() => {
        const sum = (xs: PaymentRow[]) => xs.reduce((n, p) => n + Number(p.amountInr), 0);
        const paid = payments.filter((p) => p.status === "paid");
        const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
        return finance ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pay-summary">
            <Tile icon="payments" label="Payments" value={payments.length} note="all organisations" />
            <Tile icon="task_alt" label="Paid" value={rupees(sum(paid))} note={`${paid.length} payments`} tone="text-[#14532d]" />
            <Tile icon="hourglass_top" label="Open at the gateway" value={open.length} note={rupees(sum(open))} tone="text-[#8a4b00]" />
            <Tile icon="error" label="Failed" value={payments.filter((p) => p.status === "failed").length} note="declined at the gateway" tone="text-[#93000a]" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pay-summary">
            <Tile icon="request_quote" label="Waiting for the fee" value={(listing.feeDue ?? []).length} note={rupees((listing.feeDue ?? []).reduce((n, a) => n + Number(a.totalInr), 0))} tone="text-[#8a4b00]" />
            <Tile icon="hourglass_top" label="Payment open" value={open.length} note="started, not completed" />
            <Tile icon="task_alt" label="Paid" value={paid.length} note={rupees(sum(paid))} tone="text-[#14532d]" />
            <Tile icon="error" label="Failed" value={payments.filter((p) => p.status === "failed").length} note="can be tried again" tone="text-[#93000a]" />
          </div>
        );
      })() : null}
      {justSubmitted ? <p role="status" className="rounded-lg border border-[#b7e0c6] bg-[#e2f3e8] px-3 py-2 font-body-sm font-semibold text-[#14532d]" data-testid="pay-just-submitted">Application {justSubmitted.reference} was submitted and is waiting for its fee of {inr(justSubmitted.totalInr)}. Pay at the simulated gateway below.</p> : null}
      {error ? <p role="alert" className="font-body-sm text-error" data-testid="pay-error">{error}</p> : null}
      {status ? <p role="status" className="font-body-sm text-on-surface" data-testid="pay-status">{status}</p> : null}

      {listing && !finance ? (
        <section className={card} aria-labelledby="pay-due-h" data-testid="pay-due">
          <Title id="pay-due-h" icon="request_quote">Applications waiting for the fee</Title>
          {(listing.feeDue ?? []).length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No application is waiting for its fee.</p> : (
            <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]"><table className="w-full text-[13px]">
              <caption className="sr-only">Applications waiting for the fee</caption>
              <thead><tr className={HEAD_ROW}>
                <th className={th}>Application</th><th className={th}>Model</th><th className={th}>Fee</th><th className={th}>Tax</th><th className={th}>To pay</th><th className={th}><span className="sr-only">Action</span></th>
              </tr></thead>
              <tbody>
                {(listing.feeDue ?? []).map((a) => {
                  const current = payments.find((p) => p.applicationId === a.applicationId && p.status !== "failed");
                  const live = Boolean(current);
                  return (
                    <tr key={a.applicationId} className={`border-t border-[#e7edf6] ${a.reference === highlight ? "bg-[#fff4d6]" : ""}`}>
                      <td className={th}>{a.reference}</td><td className={th}>{a.brandName} {a.modelNumber}</td>
                      <td className={th}>{inr(a.feeInr)}</td><td className={th}>{inr(a.taxInr)} ({a.taxRatePercent}%)</td><td className={th}>{inr(a.totalInr)}</td>
                      <td className={th}>
                        <button type="button" className={primaryBtn} disabled={busy || live} onClick={() => void start(a)} aria-label={`Pay at simulated gateway for ${a.reference}`}>
                          {current?.status === "paid" ? "Paid, awaiting Finance" : live ? "Payment open" : "Pay at simulated gateway"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </section>
      ) : null}

      {listing && !finance
        ? open.map((p) => (
            <section key={p.id} className="rounded-xl border-2 border-[#254e9e] bg-[#f4f8ff] p-5" aria-labelledby={`gw-${p.id}`} data-testid="pay-gateway">
              <Title id={`gw-${p.id}`} icon="account_balance">Simulated gateway: {p.applicationReference}</Title>
              <p className="text-[13px]">Gateway reference <strong>{p.gatewayRef}</strong>, amount <strong className="text-[18px] text-[#14315E]">{inr(p.amountInr)}</strong> (fixed from the fee snapshot; the gateway cannot change it). This is a simulated gateway: no money moves.</p>
              <div className="flex gap-space-sm mt-space-sm">
                <button type="button" className={primaryBtn} disabled={busy} onClick={() => void callback(p, "paid")}>Pay now</button>
                <button type="button" className={dangerBtn} disabled={busy} onClick={() => void callback(p, "failed")}>Decline</button>
              </div>
            </section>
          ))
        : null}

      {listing && !finance && lastCallback ? (
        <section className={card} data-testid="pay-replay">
          <Title icon="replay">Send the same callback again</Title>
          <p className="font-body-sm text-on-surface-variant mt-1">A gateway may deliver one callback twice. The second is recognised by its payload fingerprint and ignored.</p>
          <button type="button" className={`${btn} mt-space-sm`} disabled={busy} onClick={() => {
            const p = payments.find((x) => x.id === lastCallback.id);
            if (p) void callback(p, "paid", lastCallback);
          }}>Replay last callback</button>
        </section>
      ) : null}

      {listing ? (
        <section className={card} aria-labelledby="pay-list-h" data-testid="pay-list">
          <Title id="pay-list-h" icon="payments">{finance ? "All payments" : "My organisation's payments"}</Title>
          {payments.length === 0 ? <p className="font-body-sm text-on-surface-variant mt-1">No payments yet.</p> : (
            <PaymentsTable payments={payments} finance={finance} receiptId={receiptId} onToggleReceipt={(id) => setReceiptId(receiptId === id ? null : id)} />
          )}
          {finance ? <p className="font-body-sm text-on-surface-variant mt-space-sm">Finance still confirms the fee in the Finance queue. This simulation never changes the application.</p> : null}
        </section>
      ) : null}

      {receipt ? <ReceiptView receipt={receipt} /> : null}

      {finance && reconciliation ? (
        <section className={card} aria-labelledby="pay-rec-h" data-testid="pay-reconciliation">
          <Title id="pay-rec-h" icon="balance">Reconciliation</Title>
          <table className="w-full text-[13px] mt-space-sm">
            <caption className="sr-only">Payments by status</caption>
            <thead><tr className={HEAD_ROW}><th className={th}>Status</th><th className={th}>Payments</th><th className={th}>Total</th></tr></thead>
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
