"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { FakeTable, ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { DescriptionList, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  type FeeConfirmationReceipt,
  feeConfirmationSignature,
  runFeeConfirmation,
} from "@/lib/client/runtimeFeeConfirmation";
import {
  type ModelApplication,
  readModelApplication,
  readModelApplicationList,
  stateLabel,
} from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

/**
 * First slice step 2: Finance confirms, by hand, that the fee on a submitted application was received (fee_due to
 * iame_scrutiny). Spring decides what Finance may see (only fee_due applications) and whether a confirmation is allowed;
 * this screen only shows the result. Provisional local rules, not BEE rules.
 */
const ROUTE = "/app/finance/finance-queue";
const RETURN_TO = ROUTE;
const LIST_TARGET = "list";

// Stable loaders: useRuntimeRead takes them as effect dependencies.
const loadList = () => readModelApplicationList();
const loadDetail = (id: string) => readModelApplication(id);

export const FINANCE_COPY = {
  listTitle: "Applications awaiting fee confirmation",
  loading: "Loading applications…",
  loadingDetail: "Loading application…",
  empty: "No application is waiting for fee confirmation.",
  provisional: "Manual confirmation. These checks are provisional local rules, not BEE rules.",
  separation: "Only Finance staff who took no other part in this application can confirm, and never its own organisation.",
} as const;

export function FinanceQueue({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const revalidation = useRevalidation();
  const [receipt, setReceipt] = useState<FeeConfirmationReceipt | null>(null);

  const list = gateRead(identity.status, useRuntimeRead(LIST_TARGET, loadList, revalidation));
  const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle="Confirm that the fee was received"
      implemented={runtimeRouteFor(ROUTE)?.implemented}
    >
      <div className="space-y-space-md" data-testid="finance-queue">
        <IdentityStrip identity={identity} testId="finance-identity" />
        <div className={`grid grid-cols-1 gap-space-md ${selectedId ? "lg:grid-cols-5" : ""}`}>
          <div className={selectedId ? "lg:col-span-3" : ""}>
            <ReadPanel
              title={FINANCE_COPY.listTitle}
              read={list}
              loadingText={FINANCE_COPY.loading}
              loadingTestId="finance-queue-loading"
              errorTestId="finance-queue-error"
              signInReturnTo={RETURN_TO}
              isEmpty={(r) => r.list.count === 0}
              emptyText={FINANCE_COPY.empty}
              emptyTestId="finance-queue-empty"
              resultAction={(r) => <span className="font-label-sm text-label-sm text-on-surface-variant">{r.list.count} records</span>}
            >
              {(r) => (
                <FakeTable
                  columns={["Reference", "Organisation", "Brand / Model", "Fee", ""]}
                  rows={r.list.items.map((a) => [
                    <span key="ref" className="font-mono" data-testid={`finance-ref-${a.reference}`}>{a.reference}</span>,
                    a.organisation,
                    <div key="m">
                      <div className="font-semibold text-on-surface">{a.brandName}</div>
                      <div className="font-label-sm text-label-sm text-on-surface-variant">{a.modelNumber}</div>
                    </div>,
                    a.submissionFee ? `₹${Number(a.submissionFee.amountInr).toLocaleString("en-IN")}` : "—",
                    <Link
                      key="open"
                      href={`${ROUTE}?id=${encodeURIComponent(a.id)}`}
                      className={`font-label-sm text-label-sm inline-flex items-center gap-1 ${a.id === selectedId ? "text-on-surface font-semibold" : "text-primary hover:underline"}`}
                      data-testid={`finance-open-${a.reference}`}
                    >
                      {a.id === selectedId ? "Selected" : "Review"} <Icon name="arrow_forward" size={14} />
                    </Link>,
                  ])}
                />
              )}
            </ReadPanel>
          </div>
          {selectedId ? (
            <div className="lg:col-span-2" data-testid="finance-detail" data-selected-id={selectedId}>
              {receipt && receipt.applicationId === selectedId ? (
                <ConfirmedNote receipt={receipt} />
              ) : (
                <ReadPanel
                  title="Fee and evidence"
                  read={detail}
                  loadingText={FINANCE_COPY.loadingDetail}
                  errorTestId="finance-detail-error"
                  signInReturnTo={RETURN_TO}
                  action={
                    <Link href={ROUTE} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="finance-detail-close">
                      Close <Icon name="close" size={14} />
                    </Link>
                  }
                >
                  {(r) => (
                    <DetailAndConfirm
                      application={r.application}
                      onConfirmed={(done) => {
                        setReceipt(done);
                        revalidation.refresh();
                      }}
                      onReload={revalidation.refresh}
                    />
                  )}
                </ReadPanel>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </ScreenChrome>
  );
}

function ConfirmedNote({ receipt }: { receipt: FeeConfirmationReceipt }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="fee-confirm-success">
      <p className="font-body-md text-body-md">
        Fee confirmed for <strong>{receipt.reference}</strong>. It is now <strong>{stateLabel(receipt.toState)}</strong>.
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-sm">
        Receipt {receipt.receiptReference} · ₹{Number(receipt.amountInr).toLocaleString("en-IN")} received on {receipt.receivedOn} · version {receipt.version}.
      </p>
      <Link href={ROUTE} className="inline-flex mt-space-md text-primary font-label-md" data-testid="fee-confirm-back">
        Back to the queue
      </Link>
    </div>
  );
}

function DetailAndConfirm({
  application,
  onConfirmed,
  onReload,
}: {
  application: ModelApplication;
  onConfirmed: (receipt: FeeConfirmationReceipt) => void;
  onReload: () => void;
}) {
  const fee = application.submissionFee;
  const [receiptReference, setReceiptReference] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [amountInr, setAmountInr] = useState(fee?.amountInr ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runFeeConfirmation, feeConfirmationSignature);

  async function confirm() {
    if (!receiptReference.trim() || !receivedOn || !amountInr.trim()) {
      setInputError("Enter the receipt reference, the date received and the amount received.");
      return;
    }
    setInputError(null);
    const result = await command.execute({ id: application.id, version: application.version, receiptReference: receiptReference.trim(), receivedOn, amountInr: amountInr.trim() });
    if (result?.ok) onConfirmed(result.value);
  }

  return (
    <div>
      <DescriptionList
        testId="finance-detail-fields"
        rows={[
          { label: "Reference", value: application.reference, mono: true },
          { label: "Organisation", value: application.organisation },
          { label: "Brand", value: application.brandName },
          { label: "Model number", value: application.modelNumber },
          { label: "Fee due", value: fee ? `₹${Number(fee.amountInr).toLocaleString("en-IN")} ${fee.currency}` : "—" },
          { label: "Fee rule", value: fee ? `${fee.feeRuleKey} v${fee.feeRuleVersion} (${fee.verificationStatus})${fee.localDemoFee ? ", not a BEE-approved fee" : ""}` : "—" },
          { label: "Laboratory", value: application.laboratoryCode ?? "—" },
          { label: "Test date", value: application.testedOn ?? "—" },
          { label: "Declared efficiency", value: application.declaredIseer === undefined ? "—" : String(application.declaredIseer) },
          { label: "Version", value: String(application.version) },
        ]}
      />
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">{FINANCE_COPY.provisional}</p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">{FINANCE_COPY.separation}</p>
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void confirm()}
        runLabel="Confirm fee received"
        busyLabel="Confirming…"
        runTestId="fee-confirm-run"
        errorTestId="fee-confirm-error"
        reloadTestId="fee-confirm-reload"
        onReload={onReload}
        signInReturnTo={RETURN_TO}
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Receipt reference
          <input value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="fee-confirm-receipt" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Date received
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="fee-confirm-received-on" />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Amount received (₹)
          <input inputMode="decimal" value={amountInr} onChange={(e) => setAmountInr(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="fee-confirm-amount" />
        </label>
      </CommandPanel>
      {inputError ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="fee-confirm-input-error">{inputError}</p>
      ) : null}
    </div>
  );
}
