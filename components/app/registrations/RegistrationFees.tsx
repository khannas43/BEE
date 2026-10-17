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
          <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="regfee-success">
            <p className="font-body-md text-body-md">
              Fee confirmed for <strong>{done.reference}</strong>. It is now with the Programme officer for review.
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
              Receipt {done.receiptReference} · ₹{Number(done.amountInr).toLocaleString("en-IN")} received on {done.receivedOn} · version {done.version}.
            </p>
            <button type="button" className="mt-space-md text-primary font-label-md" onClick={() => setDone(null)} data-testid="regfee-back">Back to the list</button>
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

const TH = "py-2 pr-3 text-left font-label-sm text-on-surface-variant";
const TD = "py-2 pr-3 align-top";

function FeeList({ items, openId, onOpen, onConfirmed, onReload }: { items: Registration[]; openId: string | null; onOpen: (id: string | null) => void; onConfirmed: (r: RegistrationFeeReceipt) => void; onReload: () => void }) {
  const tools = useListTools({
    rows: items,
    text: (i) => `${i.reference} ${i.organisation} ${i.brandName} ${i.kind}`,
    sortValue: (i, k) => (k === "ref" ? i.reference : k === "org" ? i.organisation : k === "brand" ? i.brandName : k === "kind" ? i.kind : Number(i.submissionFee?.totalInr ?? 0)),
    pageSize: 8,
  });
  const open = items.find((i) => i.id === openId) ?? null;
  return (
    <div className="space-y-space-sm">
      <ListToolbar tools={tools} searchLabel="Search registrations" placeholder="Reference, organisation or brand" />
      <div className="overflow-x-auto">
        <table className="w-full font-body-sm text-body-sm" data-testid="regfee-table">
          <caption className="sr-only">Registrations waiting for their fee</caption>
          <thead>
            <tr>
              <SortableTh tools={tools} k="ref" className={TH}>Reference</SortableTh><SortableTh tools={tools} k="org" className={TH}>Organisation</SortableTh>
              <SortableTh tools={tools} k="brand" className={TH}>Brand</SortableTh><SortableTh tools={tools} k="kind" className={TH}>Kind</SortableTh>
              <SortableTh tools={tools} k="fee" className={TH}>Fee due</SortableTh><th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {tools.paged.pageRows.map((i) => (
              <tr key={i.id} className="border-t border-outline-variant" data-testid={`regfee-row-${i.reference}`}>
                <td className={`${TD} font-mono`}>{i.reference}</td>
                <td className={TD}>{i.organisation}</td>
                <td className={`${TD} font-semibold`}>{i.brandName}</td>
                <td className={TD}>{i.kind === "brand" ? "Brand" : "Agency"}</td>
                <td className={TD}>{i.submissionFee ? money(i.submissionFee.totalInr) : "—"}</td>
                <td className={TD}>
                  <button type="button" className="text-primary font-label-md" aria-expanded={openId === i.id} onClick={() => onOpen(openId === i.id ? null : i.id)} data-testid={`regfee-open-${i.reference}`}>
                    {openId === i.id ? "Close" : "Review"}
                  </button>
                </td>
              </tr>
            ))}
            {tools.paged.total === 0 ? <tr><td className={TD} colSpan={6}>No registration matches this search.</td></tr> : null}
          </tbody>
        </table>
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
    <div className="mt-space-sm rounded-xl border border-outline-variant p-space-md" data-testid="regfee-detail">
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
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">Only Finance staff who took no other part in this request can confirm, and never its own organisation.</p>
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
          <input value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="regfee-receipt" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Date received
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="regfee-received-on" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Amount received (₹)
          <input inputMode="decimal" value={amountInr} onChange={(e) => setAmountInr(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="regfee-amount" />
        </label>
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="regfee-input-error">{inputError}</p> : null}
    </div>
  );
}
