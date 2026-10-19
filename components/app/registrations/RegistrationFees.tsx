"use client";

import { useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { DescriptionList, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type Registration,
  readRegistrationList,
  type RegistrationFeeReceipt,
  registrationFeeSignature,
  runRegistrationFeeConfirmation,
} from "@/lib/client/runtimeRegistrations";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * Finance confirms, by hand, that a brand or agency registration fee was received (fee due to programme review). Spring decides which
 * requests Finance sees (only those waiting for their fee) and whether a confirmation is allowed: the payer's own organisation and the
 * person who filed can never confirm. This screen only shows the result.
 */
export const REGISTRATION_FEES_ROUTE = "/app/registrations/fees";
const loadList = () => readRegistrationList();
const money = (v: string) => `₹${Number(v).toLocaleString("en-IN")}`;

export function RegistrationFees({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead("fees", loadList, revalidation));
  const [openId, setOpenId] = useState<string | null>(null);
  const [done, setDone] = useState<RegistrationFeeReceipt | null>(null);

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Confirm that a registration fee was received" implemented={runtimeRouteFor(REGISTRATION_FEES_ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="regfee-screen">
        <IdentityStrip identity={identity} testId="regfee-identity" />
        {done ? (
          <div className="rounded-2xl border border-[#b7e0c6] bg-[#e2f3e8] p-space-md shadow-sm" data-testid="regfee-success">
            <p className="font-body-md text-body-md">
              Fee confirmed for <strong>{done.reference}</strong>. It is now with the Programme officer for review.
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
              Receipt {done.receiptReference} · ₹{Number(done.amountInr).toLocaleString("en-IN")} received on {done.receivedOn} · version {done.version}.
            </p>
            <button type="button" className="mt-space-md rounded-xl border border-primary bg-white px-4 py-2 font-semibold text-primary" onClick={() => setDone(null)} data-testid="regfee-back">Back to the list</button>
          </div>
        ) : null}
        <ReadPanel
          title="Registrations awaiting fee confirmation"
          read={read}
          loadingText="Loading registrations…"
          loadingTestId="regfee-loading"
          errorTestId="regfee-error"
          signInReturnTo={REGISTRATION_FEES_ROUTE}
          isEmpty={(r) => r.list.items.filter((i) => i.state === "fee_due").length === 0}
          emptyText="No registration is waiting for fee confirmation."
          emptyTestId="regfee-empty"
        >
          {(r) => (
            <FeeList
              items={r.list.items.filter((i) => i.state === "fee_due")}
              openId={openId}
              onOpen={setOpenId}
              onConfirmed={(receipt) => { setDone(receipt); setOpenId(null); revalidation.refresh(); }}
              onReload={revalidation.refresh}
            />
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}


function FeeList({ items, openId, onOpen, onConfirmed, onReload }: { items: Registration[]; openId: string | null; onOpen: (id: string | null) => void; onConfirmed: (r: RegistrationFeeReceipt) => void; onReload: () => void }) {
  const tools = useListTools({
    rows: items,
    text: (i) => `${i.reference} ${i.organisation} ${i.brandName} ${i.kind}`,
    sortValue: (i, k) => (k === "ref" ? i.reference : k === "org" ? i.organisation : k === "brand" ? i.brandName : k === "kind" ? i.kind : Number(i.submissionFee?.totalInr ?? 0)),
    pageSize: 8,
  });
  const open = items.find((i) => i.id === openId) ?? null;
  const total = items.reduce((sum, i) => sum + Number(i.submissionFee?.totalInr ?? 0), 0);
  const cell = "px-3 py-3 align-top";
  const head = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide";
  return (
    <div className="space-y-space-md">
      <p className="text-sm text-on-surface-variant">Brand and agency registrations whose fee has been filed but not yet confirmed. Confirm the fee once the payment is received; the request then moves to Programme review.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="regfee-tiles">
        <div className="rounded-2xl border border-border-subtle bg-white px-4 py-3 shadow-sm"><div className="text-2xl font-bold tabular-nums text-[#8a4b00]">{items.length}</div><div className="text-sm font-semibold text-on-surface">Awaiting confirmation</div></div>
        <div className="rounded-2xl border border-border-subtle bg-white px-4 py-3 shadow-sm"><div className="text-2xl font-bold tabular-nums text-primary">{money(String(total))}</div><div className="text-sm font-semibold text-on-surface">Total fee due</div></div>
        <div className="rounded-2xl border border-border-subtle bg-white px-4 py-3 shadow-sm"><div className="text-2xl font-bold tabular-nums text-on-surface">{items.filter((i) => i.kind === "agency").length} agency, {items.filter((i) => i.kind === "brand").length} brand</div><div className="text-sm font-semibold text-on-surface">By kind</div></div>
      </div>
      <ListToolbar tools={tools} searchLabel="Search registrations" placeholder="Reference, organisation or brand" />
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="regfee-table">
            <caption className="sr-only">Registrations waiting for their fee</caption>
            <thead>
              <tr>
                <SortableTh tools={tools} k="ref" className={head}>Reference</SortableTh>
                <SortableTh tools={tools} k="brand" className={head}>Brand</SortableTh>
                <SortableTh tools={tools} k="org" className={head}>Organisation</SortableTh>
                <SortableTh tools={tools} k="fee" className={head}>Fee due</SortableTh>
                <th className={head}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tools.paged.pageRows.map((i) => (
                <tr key={i.id} data-testid={`regfee-row-${i.reference}`} className={openId === i.id ? "bg-primary/5" : ""}>
                  <td className={cell}><span className="font-mono text-xs font-semibold">{i.reference}</span></td>
                  <td className={cell}>
                    <div className="font-semibold text-on-surface">{i.brandName}</div>
                    <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{i.kind === "brand" ? "Brand" : "Agency"} registration</span>
                  </td>
                  <td className={cell}>{i.organisation}</td>
                  <td className={`${cell} font-semibold tabular-nums`}>{i.submissionFee ? money(i.submissionFee.totalInr) : "-"}</td>
                  <td className={`${cell} text-right`}>
                    <button type="button" className={`whitespace-nowrap rounded-xl px-3 py-1.5 font-semibold ${openId === i.id ? "border border-outline-variant bg-white text-on-surface" : "border border-primary bg-white text-primary hover:bg-primary/5"}`} aria-expanded={openId === i.id} onClick={() => onOpen(openId === i.id ? null : i.id)} data-testid={`regfee-open-${i.reference}`}>
                      {openId === i.id ? "Close" : "Review"}
                    </button>
                  </td>
                </tr>
              ))}
              {tools.paged.total === 0 ? <tr><td className={cell} colSpan={5}>No registration matches this search.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <ListPager tools={tools} />
      {open ? <ConfirmPanel key={open.id} registration={open} onConfirmed={onConfirmed} onReload={onReload} /> : null}
    </div>
  );
}

function ConfirmPanel({ registration, onConfirmed, onReload }: { registration: Registration; onConfirmed: (r: RegistrationFeeReceipt) => void; onReload: () => void }) {
  const fee = registration.submissionFee;
  const [receiptReference, setReceiptReference] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [amountInr, setAmountInr] = useState(fee?.totalInr ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runRegistrationFeeConfirmation, registrationFeeSignature);

  async function confirm() {
    if (!receiptReference.trim() || !receivedOn || !amountInr.trim()) {
      setInputError("Enter the receipt reference, the date received and the amount received.");
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: registration.id, version: registration.version, receiptReference: receiptReference.trim(), receivedOn, amountInr: amountInr.trim() });
    if (result?.ok) onConfirmed(result.value);
  }

  return (
    <div className="space-y-space-md rounded-2xl border border-primary/30 bg-white p-space-md shadow-md" data-testid="regfee-detail">
      <div className="rounded-xl bg-gradient-to-r from-forest-dark to-primary p-space-md text-on-primary">
        <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">Confirm fee received</p>
        <p className="mt-1 font-mono text-xl font-bold">{registration.reference}</p>
        <p className="mt-1 text-base font-medium">{registration.brandName} · {registration.organisation}</p>
        <p className="mt-2 text-2xl font-bold">{fee ? money(fee.totalInr) : "-"} <span className="text-sm font-normal text-on-primary/80">due</span></p>
      </div>
      <div className="grid gap-space-md lg:grid-cols-2">
      <div>
      <DescriptionList
        testId="regfee-fields"
        rows={[
          { label: "Reference", value: registration.reference, mono: true },
          { label: "Kind", value: registration.kind === "brand" ? "Brand registration" : "Agency authorisation" },
          { label: "Organisation", value: registration.organisation },
          { label: "Brand", value: registration.brandName },
          { label: "Fee due", value: fee ? `${money(fee.totalInr)} ${fee.currency}` : "—" },
          { label: "Fee before tax", value: fee ? money(fee.amountInr) : "—" },
          { label: "Tax", value: fee ? (Number(fee.taxInr) === 0 ? "none set" : `${money(fee.taxInr)} (${Number(fee.taxRatePercent)}%)`) : "—" },
          { label: "Fee rule", value: fee ? `${fee.feeRuleKey} v${fee.feeRuleVersion}${fee.localDemoFee ? ", not a BEE-approved fee" : ""}` : "—" },
        ]}
      />
      </div>
      <div>
      <p className="font-label-sm text-label-sm text-on-surface-variant">Only Finance staff who took no other part in this request can confirm, and never its own organisation.</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void confirm()}
        runLabel="Confirm fee received"
        busyLabel="Confirming…"
        runTestId="regfee-run"
        errorTestId="regfee-error-command"
        reloadTestId="regfee-reload"
        onReload={onReload}
        signInReturnTo={REGISTRATION_FEES_ROUTE}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Receipt reference
          <input value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} className="mt-1 w-full rounded-xl border border-border-subtle bg-white px-3 py-2 font-body-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-testid="regfee-receipt" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Date received
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="mt-1 w-full rounded-xl border border-border-subtle bg-white px-3 py-2 font-body-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-testid="regfee-received-on" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Amount received (₹)
          <input inputMode="decimal" value={amountInr} onChange={(e) => setAmountInr(e.target.value)} className="mt-1 w-full rounded-xl border border-border-subtle bg-white px-3 py-2 font-body-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" data-testid="regfee-amount" />
        </label>
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="regfee-input-error">{inputError}</p> : null}
      </div>
      </div>
    </div>
  );
}
