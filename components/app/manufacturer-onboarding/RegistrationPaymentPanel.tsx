"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PAYMENT_METHOD_LABELS, feeLines, feeTotal, inr } from "@/lib/manufacturer-onboarding/sopDefaults";
import type { ManufacturerApplication, ManufacturerDraft, SopDetails } from "@/lib/manufacturer-onboarding/types";
import { WizardFieldLabel, wizardInputClass } from "./wizardChrome";

/**
 * The payment of the registration (section 1.1 of the SOP, steps 8 to 12): the reference ID, the equipment and the firm, the registration charge and,
 * for a large-scale industry, the label security deposit, and the method: BillDesk, Razorpay or direct transfer (bank, transaction ID, date, remarks
 * and the receipt). Simulated: nothing real moves. The registration charge is settled when the application is submitted; this step records the choice
 * and the security deposit.
 */

const BANKS = ["State Bank of India", "HDFC Bank", "ICICI Bank", "Punjab National Bank", "Axis Bank", "Bank of Baroda", "Other"];
type Method = Exclude<SopDetails["payment"]["method"], "">;

type Props = {
  draft: ManufacturerDraft;
  setDraft: (d: ManufacturerDraft) => void;
  appRecord: ManufacturerApplication | null;
  busy: boolean;
  onReceiptUpload: (file: File) => void;
};

export function RegistrationPaymentPanel({ draft, setDraft, appRecord, busy, onReceiptUpload }: Props) {
  const pay = draft.sop.payment;
  const [method, setMethod] = useState<Method | "">(pay.method);
  const [gateway, setGateway] = useState(false);
  const [receiptName, setReceiptName] = useState("");
  const lines = feeLines(draft.sop.scale);
  const total = feeTotal(draft.sop.scale);
  const setPayment = (patch: Partial<SopDetails["payment"]>) => setDraft({ ...draft, sop: { ...draft.sop, payment: { ...pay, ...patch } } });
  const setTransfer = (patch: Partial<SopDetails["payment"]["transfer"]>) => setPayment({ transfer: { ...pay.transfer, ...patch } });
  const done = pay.status !== "";
  const confirmOnline = () => {
    if (method === "" || method === "direct_transfer") return;
    setPayment({ method, status: "paid", receipt: `SIM-${method === "billdesk" ? "BD" : "RP"}-${Date.now().toString().slice(-7)}`, recordedAt: new Date().toISOString() });
    setGateway(false);
  };
  const confirmTransfer = () => {
    const t = pay.transfer;
    if (!t.bank || !t.transactionId.trim() || !t.paymentDate) return;
    setPayment({ method: "direct_transfer", status: "awaiting_confirmation", receipt: `TRF-${t.transactionId.trim().slice(0, 12)}`, recordedAt: new Date().toISOString() });
  };

  if (!draft.sop.scale) {
    return <p className="rounded-lg bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant" data-testid="payment-needs-scale">Choose the scale of industry in the company details first: the security deposit depends on it.</p>;
  }
  return (
    <div className="space-y-space-md" data-testid="sop-payment">
      <table className="w-full overflow-hidden rounded-xl border border-border-subtle text-sm">
        <tbody>
          {[["Reference ID", appRecord?.reference ?? "-"], ["Equipment", draft.sop.equipment || "-"], ["Firm name", draft.legalName || "-"]].map(([k, v]) => (
            <tr key={k} className="border-t border-border-subtle first:border-t-0"><th className="w-44 bg-surface-container-low px-3 py-2 text-left font-semibold text-on-surface-variant">{k}</th><td className="px-3 py-2 text-on-surface">{v}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-space-md space-y-2" data-testid="payment-lines">
        {lines.map((l) => <div key={l.label} className="flex justify-between text-sm"><span>{l.label}</span><b className="tabular-nums">{inr(l.amountInr)}</b></div>)}
        <div className="flex justify-between border-t border-primary/20 pt-2 text-base"><b>Payment amount</b><b className="tabular-nums" data-testid="payment-total">{inr(total)}</b></div>
      </div>

      {done ? (
        <div className="space-y-2 rounded-xl border border-success/30 bg-success-container/20 p-space-md" data-testid="payment-recorded">
          <p className="flex items-center gap-2 font-semibold text-on-surface"><Icon name={pay.status === "paid" ? "verified" : "hourglass_top"} size={20} className={pay.status === "paid" ? "text-success" : "text-[#8a4b00]"} />
            {pay.status === "paid" ? `Paid by ${PAYMENT_METHOD_LABELS[pay.method as Method]}` : "Direct transfer recorded: awaiting confirmation by BEE Finance"}</p>
          <p className="text-sm text-on-surface-variant">Receipt {pay.receipt}. Simulated: nothing real moved.</p>
          <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => { setPayment({ method: "", status: "", receipt: "", recordedAt: "" }); setMethod(""); }} data-testid="payment-change">Change the payment method</button>
        </div>
      ) : (
        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Payment method</legend>
            {(Object.keys(PAYMENT_METHOD_LABELS) as Method[]).map((m) => (
              <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${method === m ? "border-primary bg-primary/5" : "border-border-subtle"}`}>
                <input type="radio" name="pay-method" checked={method === m} onChange={() => { setMethod(m); setGateway(false); }} data-testid={`payment-method-${m}`} /> {PAYMENT_METHOD_LABELS[m]}
                {m === "direct_transfer" ? <span className="ml-auto text-xs font-normal text-on-surface-variant">confirmed by BEE Finance</span> : null}
              </label>
            ))}
          </fieldset>

          {method === "billdesk" || method === "razorpay" ? (
            gateway ? (
              <div className="space-y-3 rounded-xl bg-gradient-to-br from-[#14315E] to-[#254e9e] p-space-md text-white" data-testid="payment-gateway">
                <div className="text-xs uppercase tracking-wide text-[#c9d9f7]">{PAYMENT_METHOD_LABELS[method]} (simulated)</div>
                <div className="text-3xl font-extrabold">{inr(total)}</div>
                <p className="text-sm text-[#dbe6f7]">This stands in for the gateway page. Nothing real moves.</p>
                <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-label-md font-semibold !text-[#14315E]" onClick={confirmOnline} data-testid="payment-pay-now"><Icon name="check_circle" size={18} /> Pay now</button>
              </div>
            ) : (
              <button type="button" className="inline-flex items-center gap-2 rounded-lg !bg-primary px-5 py-2.5 font-label-md font-semibold !text-on-primary" onClick={() => setGateway(true)} data-testid="payment-proceed">
                <Icon name="payments" size={18} /> Proceed to payment with {PAYMENT_METHOD_LABELS[method]}
              </button>
            )
          ) : null}

          {method === "direct_transfer" ? (
            <div className="space-y-3 rounded-xl border border-border-subtle p-space-md" data-testid="payment-transfer">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><WizardFieldLabel required>Bank name</WizardFieldLabel>
                  <select className={wizardInputClass} value={pay.transfer.bank} onChange={(e) => setTransfer({ bank: e.target.value })} data-testid="transfer-bank"><option value="">Select bank</option>{BANKS.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
                <label className="block"><WizardFieldLabel required>Transaction ID</WizardFieldLabel><input className={wizardInputClass} value={pay.transfer.transactionId} onChange={(e) => setTransfer({ transactionId: e.target.value })} data-testid="transfer-txn" /></label>
                <label className="block"><WizardFieldLabel required>Payment date</WizardFieldLabel><input className={wizardInputClass} type="date" value={pay.transfer.paymentDate} onChange={(e) => setTransfer({ paymentDate: e.target.value })} data-testid="transfer-date" /></label>
                <label className="block"><WizardFieldLabel>Upload payment receipt</WizardFieldLabel>
                  <input className={wizardInputClass} type="file" accept=".pdf,image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setReceiptName(f.name); onReceiptUpload(f); } }} data-testid="transfer-receipt" />
                  {receiptName ? <span className="text-xs text-on-surface-variant">{receiptName}</span> : null}</label>
                <label className="block sm:col-span-2"><WizardFieldLabel>Remarks</WizardFieldLabel><textarea className={wizardInputClass} rows={2} value={pay.transfer.remarks} onChange={(e) => setTransfer({ remarks: e.target.value })} data-testid="transfer-remarks" /></label>
              </div>
              <button type="button" className="inline-flex items-center gap-2 rounded-lg !bg-primary px-5 py-2.5 font-label-md font-semibold !text-on-primary disabled:opacity-50" disabled={!pay.transfer.bank || !pay.transfer.transactionId.trim() || !pay.transfer.paymentDate} onClick={confirmTransfer} data-testid="transfer-submit">Submit transfer details</button>
            </div>
          ) : null}
        </div>
      )}

      <div className="rounded-xl bg-surface-container-low px-space-md py-3 text-xs text-on-surface-variant space-y-1">
        <p className="font-semibold text-on-surface">Instructions</p>
        <p>Please use the online payment gateway for fast processing of your application. No charges shall be levied by BEE or the bank for the e-payment. All other charges will be absorbed by BEE. Multiple payments shall not be carried over.</p>
        <p>Demonstration: payment is simulated. The company registration charge is recorded automatically when you submit; the security deposit is recorded here.</p>
      </div>
    </div>
  );
}
