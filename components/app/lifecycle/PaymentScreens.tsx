"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, ScreenChrome, Status, OK, WARN, BAD, INFO } from "@/components/app/ScreenScaffold";
import { previewRoleOf, useRole } from "@/components/app/RoleContext";
import { isExternalRole } from "@/lib/roles";
import { Module, Screen } from "@/lib/screens";
import { PARTNER_PAYMENTS, PartnerPaymentRow, PayStatus, inr } from "@/lib/mock/payments";
import { StageScreen } from "./StageScreen";

const STATUS_TONE: Record<PayStatus, string> = { Paid: OK, Processing: WARN, Due: INFO, Failed: BAD };

/**
 * /app/model-label/model-payment is reached by two very different actors:
 *  - a PAYER (Manufacturer / Registered Agency) → a read-only view of their own
 *    fees, transactions, reconciliation and receipts. No confirmation action.
 *  - BEE FINANCE → the fee-confirmation workflow (StageScreen), where the
 *    "Confirm fee received" action lives.
 * A payer can never confirm receipt of their own fee.
 */
export function ModelPaymentScreen({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  if (isExternalRole(role)) return <PartnerPayments module={module} screen={screen} />;
  return <StageScreen module={module} screen={screen} variant="fee" />;
}

function PartnerPayments({ module, screen }: { module: Module; screen: Screen }) {
  const { role } = useRole();
  const org = previewRoleOf(role);
  const set = PARTNER_PAYMENTS[role];
  const [receipt, setReceipt] = useState<PartnerPaymentRow | null>(null);

  if (!set) {
    return (
      <ScreenChrome module={module} screen={screen} subtitle="Your application fees and receipts">
        <Card><p className="font-body-sm text-body-sm text-on-surface-variant">No payment records for your organisation.</p></Card>
      </ScreenChrome>
    );
  }

  const totalDue = set.rows.reduce((n, r) => n + Math.max(0, r.amountDue - r.amountPaid), 0);
  const totalPaid = set.rows.reduce((n, r) => n + r.amountPaid, 0);
  const awaiting = set.rows.filter((r) => r.status === "Processing").length;

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Your application fees, receipts and reconciliation status">
      {/* Payer boundary — a payer cannot confirm their own fee */}
      <div className="flex items-start gap-space-sm bg-navy-subtle border border-navy-dark/20 rounded-xl p-space-sm" role="note">
        <Icon name="account_balance_wallet" size={18} className="text-navy-dark shrink-0 mt-0.5" />
        <p className="font-body-sm text-body-sm text-on-surface">
          <span className="font-semibold">{set.org} — payments.</span> This shows only your organisation&rsquo;s applications. Receipt of a fee is confirmed by the <span className="font-semibold">BEE Finance</span> team — a payer cannot confirm their own payment. Scoping is simulated in this prototype.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md">
        <Kpi label="Applications" value={String(set.rows.length)} icon="receipt_long" tone="text-primary" />
        <Kpi label="Amount due" value={inr(totalDue)} icon="pending_actions" tone={totalDue ? "text-solar-gold-dark" : "text-success"} />
        <Kpi label="Amount paid" value={inr(totalPaid)} icon="paid" tone="text-success" />
        <Kpi label="Awaiting Finance confirmation" value={String(awaiting)} icon="hourglass_top" tone={awaiting ? "text-solar-gold-dark" : "text-success"} />
      </div>

      <Card title="Fee ledger">
        <div className="overflow-x-auto app-scroll">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border-subtle">
                {["Application", "Model", "Amount", "Payment", "Transaction", "Reconciliation", "Receipt"].map((h) => (
                  <th key={h} className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide py-2 pr-space-md whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {set.rows.map((r) => (
                <tr key={r.appId} className="border-b border-border-subtle/60">
                  <td className="py-2.5 pr-space-md font-mono text-label-sm text-on-surface whitespace-nowrap">{r.appId}</td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface">{r.model} · {r.stars}★</td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface whitespace-nowrap">
                    {r.status === "Due" ? <span className="text-solar-gold-dark font-semibold">{inr(r.amountDue)} due</span> : <span>{inr(r.amountPaid)} paid</span>}
                  </td>
                  <td className="py-2.5 pr-space-md"><Status label={r.status} tone={STATUS_TONE[r.status]} /></td>
                  <td className="py-2.5 pr-space-md font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">
                    {r.txnId === "—" ? "—" : <div><div className="font-mono text-label-sm">{r.txnId}</div><div className="font-label-sm text-label-sm">{r.method}{r.paidOn ? ` · ${r.paidOn}` : ""}</div></div>}
                  </td>
                  <td className="py-2.5 pr-space-md">
                    <Status label={r.recon} tone={r.recon === "Reconciled" ? OK : r.recon === "Pending" ? WARN : "bg-surface-container text-on-surface-variant"} />
                  </td>
                  <td className="py-2.5 pr-space-md whitespace-nowrap">
                    {r.receiptNo ? (
                      <button type="button" onClick={() => setReceipt(r)} className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary hover:underline"><Icon name="receipt" size={14} /> View receipt</button>
                    ) : (
                      <span className="font-label-sm text-label-sm text-on-surface-variant">{r.status === "Processing" ? "On confirmation" : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm flex items-center gap-1">
          <Icon name="info" size={13} /> A receipt is issued once BEE Finance confirms the fee and reconciliation completes.
        </p>
      </Card>

      {receipt && <ReceiptModal row={receipt} org={set.org} gstin={set.gstin} payer={org.name} onClose={() => setReceipt(null)} />}
    </ScreenChrome>
  );
}

function ReceiptModal({ row, org, gstin, onClose }: { row: PartnerPaymentRow; org: string; gstin: string; payer: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-space-md" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-card rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-primary text-on-primary px-space-lg py-space-md flex items-center justify-between">
          <div>
            <div className="font-label-sm text-label-sm opacity-90">Bureau of Energy Efficiency</div>
            <div className="font-title-lg text-title-lg font-semibold">Fee receipt</div>
          </div>
          <Icon name="verified" size={28} fill />
        </div>
        <div className="p-space-lg space-y-space-sm">
          <RRow k="Receipt no." v={row.receiptNo!} />
          <RRow k="Payer" v={org} />
          <RRow k="GSTIN" v={gstin} />
          <RRow k="Application" v={row.appId} />
          <RRow k="Model" v={`${row.model} · ${row.stars}★`} />
          <RRow k="Amount paid" v={inr(row.amountPaid)} />
          <RRow k="Method" v={row.method} />
          <RRow k="Transaction" v={row.txnId} />
          <RRow k="Paid on" v={row.paidOn ?? "—"} />
          <RRow k="Reconciliation" v={row.recon} />
          <div className="flex items-center gap-1.5 bg-success-light text-success rounded-lg p-space-sm font-label-sm text-label-sm mt-space-sm"><Icon name="check_circle" size={16} fill /> Fee confirmed by BEE Finance · settlement reconciled.</div>
          <div className="flex justify-end gap-space-sm pt-space-sm">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 bg-surface-container text-on-surface font-label-md text-label-md py-2 px-space-md rounded-lg hover:bg-forest-light"><Icon name="print" size={16} /> Print</button>
            <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 bg-primary text-on-primary font-label-md text-label-md py-2 px-space-md rounded-lg hover:bg-forest-dark">Close</button>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant text-center">Simulated receipt for prototype demonstration.</p>
        </div>
      </div>
    </div>
  );
}

function RRow({ k, v }: { k: string; v: string }) {
  return <div className="flex items-start justify-between gap-space-sm"><span className="font-label-sm text-label-sm text-on-surface-variant shrink-0">{k}</span><span className="font-label-md text-label-md text-on-surface font-medium text-right">{v}</span></div>;
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: string; tone: string }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md">
      <div className="flex items-center justify-between"><span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span><Icon name={icon} size={18} className={tone} /></div>
      <div className={`font-headline-sm text-headline-sm font-bold ${tone} mt-1`}>{value}</div>
    </div>
  );
}
