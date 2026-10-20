"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { ApplicationDocuments } from "@/components/app/lifecycle/ApplicationDocuments";
import { ApplicationHistory } from "@/components/app/lifecycle/ApplicationHistory";
import { CertificateCard } from "@/components/app/lifecycle/CertificateCard";
import { ProductDetails } from "@/components/app/lifecycle/ProductDetails";
import { feeText, modelDashboardHref, READ_UI_MESSAGES, stateLabel, type DetailRead, type ModelApplication } from "@/lib/client/runtimeModelApplications";
import { modelDraftFormHref } from "@/lib/client/runtimeModelDrafts";

/** The full page of one model application: where it stands, its details, evidence, fee, rating, certificate, documents and history. */

const PATH: [string, string][] = [
  ["draft", "Draft"], ["fee_due", "Fee"], ["iame_scrutiny", "IAME scrutiny"], ["bee_scrutiny", "BEE scrutiny"], ["rating", "Rating"], ["director_review", "Director review"], ["secretary_approval", "Final approval"], ["approved", "Approved"],
];
const TONE = (state: string) =>
  state === "approved" ? "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]" : state === "rejected" ? "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]" : state === "returned" ? "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]" : "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]";
const card = "rounded-xl border border-[#dbe6f7] bg-white";

function Fact({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{label}</div><div className={`mt-0.5 text-[14px] font-semibold text-[#14315E] ${mono ? "font-mono" : ""}`}>{value || "-"}</div></div>;
}

function Box({ title, testId, children, defaultOpen = true }: { title: string; testId: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${card} p-5`} data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span role="heading" aria-level={2} className="text-[16px] font-bold text-[#14315E]">{title}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={22} className="text-[#475569]" />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function StagePath({ state }: { state: string }) {
  const at = PATH.findIndex(([k]) => k === state);
  return (
    <ol className="flex flex-wrap gap-2" data-testid="app-stage-path" aria-label="Stages">
      {PATH.map(([k, label], i) => {
        const done = at >= 0 && i < at;
        const now = k === state;
        return (
          <li key={k} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${now ? "border-[#14315E] bg-[#14315E] text-white" : done ? "border-[#b7e0c6] bg-[#e2f3e8] text-[#14532d]" : "border-[#dbe6f7] bg-white text-[#64748b]"}`}>
            <Icon name={done ? "check_circle" : now ? "radio_button_checked" : "radio_button_unchecked"} size={16} />{label}
          </li>
        );
      })}
    </ol>
  );
}

function Body({ a }: { a: ModelApplication }) {
  const open = a.state === "draft" || a.state === "returned";
  return (
    <div className="space-y-space-md" data-testid="app-full-view" data-selected-id={a.id}>
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div role="heading" aria-level={2} className="font-mono text-[22px] font-extrabold text-[#14315E]" data-testid="app-full-reference">{a.reference}</div>
            <div className="text-[14px] text-[#475569]">{a.brandName} {a.modelNumber} · {a.organisation} · {a.category}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold capitalize ${TONE(a.state)}`}>{stateLabel(a.state)}</span>
            {open ? <Link href={modelDraftFormHref(a.id)} className="inline-flex items-center gap-1 rounded-lg !bg-[#1f3c88] px-3 py-1.5 text-[13px] font-semibold !text-white" data-testid="app-full-edit"><Icon name="edit" size={16} />{a.state === "returned" ? "Edit and resubmit" : "Edit draft"}</Link> : null}
            {a.state === "fee_due" ? <Link href={`/app/demo/payments?application=${encodeURIComponent(a.reference)}`} className="inline-flex items-center gap-1 rounded-lg !bg-[#1f3c88] px-3 py-1.5 text-[13px] font-semibold !text-white" data-testid="app-full-pay"><Icon name="payments" size={16} />Pay the fee</Link> : null}
          </div>
        </div>
        <div className="mt-4"><StagePath state={a.state} /></div>
        {a.state === "returned" && a.returnNote ? (
          <div className="mt-4 rounded-lg border border-[#f3dc9c] bg-[#fff4d6] px-3 py-2 text-[13px] text-[#8a4b00]" data-testid="app-full-return"><strong>Returned by {stateLabel(a.returnNote.fromState)}.</strong> {a.returnNote.reason}</div>
        ) : null}
        {a.state === "rejected" && a.rejection ? (
          <div className="mt-4 rounded-lg border border-[#f5c2c0] bg-[#fdecea] px-3 py-2 text-[13px] text-[#93000a]" data-testid="app-full-rejection"><strong>Rejected by {stateLabel(a.rejection.fromState)}. This is final.</strong> {a.rejection.reason}</div>
        ) : null}
      </div>

      <Box title="Application" testId="app-box-application">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Reference" value={a.reference} mono /><Fact label="Brand" value={a.brandName} /><Fact label="Model number" value={a.modelNumber} /><Fact label="Category" value={a.category} />
          <Fact label="Organisation" value={a.organisation} /><Fact label="Submitted on" value={a.submittedAt ? a.submittedAt.slice(0, 10) : "Not submitted"} /><Fact label="Version" value={String(a.version)} /><Fact label="Record id" value={a.id} mono />
        </div>
      </Box>

      <ProductDetails applicationId={a.id} />

      <Box title="Test evidence" testId="app-box-evidence">
        <div className="grid gap-4 sm:grid-cols-3">
          <Fact label="Laboratory" value={a.laboratoryCode} /><Fact label="Test date" value={a.testedOn} /><Fact label="Declared efficiency (ISEER)" value={a.declaredIseer === undefined ? "" : String(a.declaredIseer)} />
        </div>
      </Box>

      {a.submissionFee ? (
        <Box title="Fee" testId="app-box-fee">
          <div className="grid gap-4 sm:grid-cols-3">
            <Fact label={a.submissionFee.label} value={feeText(a.submissionFee)} /><Fact label="Fee rule" value={`${a.submissionFee.feeRuleKey} v${a.submissionFee.feeRuleVersion}`} /><Fact label="Status" value={a.submissionFee.verificationStatus.replaceAll("_", " ")} />
          </div>
          {a.submissionFee.localDemoFee ? <p className="mt-2 text-[12px] text-[#64748b]">This amount is for the local demonstration and is not a BEE-approved fee.</p> : null}
        </Box>
      ) : null}

      {a.rating ? (
        <Box title="Rating" testId="app-box-rating">
          <div className="grid gap-4 sm:grid-cols-4">
            <Fact label="Star rating" value={`${a.rating.stars} star`} /><Fact label="Declared ISEER" value={a.rating.declaredIseer} /><Fact label="Verified ISEER" value={a.rating.verifiedIseer} /><Fact label="Scheme" value={`${a.rating.schemeKey} (version ${a.rating.ratingVersion})`} />
          </div>
          <p className="mt-2 text-[12px] text-[#64748b]">A local demonstration rating, never a BEE rating.</p>
        </Box>
      ) : null}

      {a.state === "approved" && a.certificate ? <CertificateCard certificate={a.certificate} applicationId={a.id} /> : null}

      <Box title="Documents" testId="app-box-documents" defaultOpen={false}><ApplicationDocuments key={a.id} applicationId={a.id} /></Box>
      <Box title="History" testId="app-box-history"><ApplicationHistory key={a.id} applicationId={a.id} testIdPrefix="model-app-history" /></Box>
    </div>
  );
}

export function ApplicationFullView({ detailRead, returnTo }: { detailRead: DetailRead | null; returnTo: string }) {
  return (
    <div className="space-y-space-md" data-testid="model-application-full">
      <Link href={modelDashboardHref()} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary" data-testid="app-full-back"><Icon name="arrow_back" size={16} /> All model applications</Link>
      <ReadPanel title="Application" read={detailRead} loadingText={READ_UI_MESSAGES.loading_detail} errorTestId="app-full-error" signInReturnTo={returnTo}>
        {(r) => <Body a={r.application} />}
      </ReadPanel>
    </div>
  );
}
