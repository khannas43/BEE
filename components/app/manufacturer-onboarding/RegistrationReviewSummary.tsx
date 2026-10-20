"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import { CATEGORY_OPTIONS, PAYMENT_METHOD_LABELS, feeLines, feeTotal, inr } from "@/lib/manufacturer-onboarding/sopDefaults";
import type { ManufacturerApplication, ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";
import { MANUFACTURER_REGISTRATION_STEPS, type ManufacturerRegistrationStepId } from "./wizardSteps";

function ReviewBlock({
  title,
  stepId,
  onEdit,
  readOnly,
  children,
}: {
  title: string;
  stepId: ManufacturerRegistrationStepId;
  onEdit: (stepId: ManufacturerRegistrationStepId) => void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-container-lowest/80 overflow-hidden" data-testid={`review-block-${stepId}`}>
      <div className="flex items-center justify-between gap-2 px-space-md py-3 bg-surface-container-low border-b border-border-subtle">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => onEdit(stepId)}
            className="inline-flex items-center gap-1 text-xs font-label-sm text-primary hover:underline"
            data-testid={`review-edit-${stepId}`}
          >
            <Icon name="edit" size={16} />
            Edit
          </button>
        ) : null}
      </div>
      <dl className="px-space-md py-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

function ReviewItem({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  const display = value.trim() || "—";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className="text-sm text-on-surface mt-0.5 break-words">{display}</dd>
    </div>
  );
}

type Props = {
  draft: ManufacturerDraft;
  appRecord: ManufacturerApplication | null;
  onEditStep: (stepId: ManufacturerRegistrationStepId) => void;
  /** Hide Edit controls (Director read-only review). */
  readOnly?: boolean;
};

export function RegistrationReviewSummary({ draft, appRecord, onEditStep, readOnly }: Props) {
  const sop = draft.sop;
  const addr = draft.registeredAddress;
  const biz = sop.business;
  const account = draft.applicantAccount;
  const pay = sop.payment;
  const fee = appRecord ? formatFeeInr(appRecord.payment.amountInr) : "—";
  const category = CATEGORY_OPTIONS.find((o) => o.value === sop.category)?.label ?? "";
  const scale = sop.scale === "small" ? "Small-scale industry (SSI)" : sop.scale === "large" ? "Large-scale industry" : "";
  const dash = (v: string | undefined) => v ?? "";
  const step = (id: ManufacturerRegistrationStepId) => MANUFACTURER_REGISTRATION_STEPS.find((x) => x.id === id)!.title;

  return (
    <div className="space-y-space-md" data-testid="registration-review-summary">
      <p className="text-sm font-body-sm text-on-surface-variant">
        {readOnly
          ? "Submitted registration details as recorded in the application."
          : "Review the agency information. When you submit, the registration charge is recorded automatically and eligibility checks run before activation under the 15-day observation window."}
      </p>

      {account?.username?.trim() ? (
        <ReviewBlock title="Applicant portal account" stepId="company" onEdit={onEditStep} readOnly={readOnly}>
          <ReviewItem label="Username" value={account.username} />
          <ReviewItem label="Password" value={account.password ? "••••••••" : "—"} />
        </ReviewBlock>
      ) : null}

      <ReviewBlock title={step("company")} stepId="company" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Name of the firm" value={draft.legalName} wide />
        <ReviewItem label="Category" value={category} />
        <ReviewItem label="Scale of industry" value={scale} />
        <ReviewItem label="Equipment" value={sop.equipment} />
        <ReviewItem label="Brand name" value={sop.brandName} />
      </ReviewBlock>

      <ReviewBlock title={step("business")} stepId="business" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Address line 1" value={addr.line1} wide />
        <ReviewItem label="Address line 2" value={addr.line2} wide />
        <ReviewItem label="City / town" value={addr.city} />
        <ReviewItem label="District" value={biz.district} />
        <ReviewItem label="State" value={addr.state} />
        <ReviewItem label="Country" value={biz.country} />
        <ReviewItem label="Pincode" value={addr.pincode} />
        <ReviewItem label="Phone" value={[biz.phoneStd, biz.phone].filter(Boolean).join("-")} />
        <ReviewItem label="Mobile" value={biz.mobile} />
        <ReviewItem label="Fax" value={[biz.faxStd, biz.fax].filter(Boolean).join("-")} />
        <ReviewItem label="Email" value={biz.email} />
        <ReviewItem label="Website" value={biz.website} />
      </ReviewBlock>

      <ReviewBlock title={step("facilities")} stepId="facilities" onEdit={onEditStep} readOnly={readOnly}>
        {draft.facilities.length === 0 ? (
          <ReviewItem label="Facilities" value="None added" wide />
        ) : (
          draft.facilities.flatMap((f, i) => [
            <ReviewItem key={`${f.id}-name`} label={`Facility ${i + 1}`} value={f.name} wide />,
            <ReviewItem key={`${f.id}-addr`} label="Address" value={[f.addressLine, f.addressLine2, f.city, f.district, f.state, f.pincode].filter(Boolean).join(", ")} wide />,
            <ReviewItem key={`${f.id}-contact`} label="Contact" value={[f.mobile, f.email].filter(Boolean).join(" · ")} />,
            <ReviewItem key={`${f.id}-qms`} label="ISO 9001 valid till" value={dash(f.qmsValidTill)} />,
          ])
        )}
      </ReviewBlock>

      <ReviewBlock title={step("contacts")} stepId="contacts" onEdit={onEditStep} readOnly={readOnly}>
        {draft.contacts.length === 0 ? (
          <ReviewItem label="Contact persons" value="None added" wide />
        ) : (
          draft.contacts.flatMap((c, i) => [
            <ReviewItem key={`c${i}-name`} label={i === 0 ? "Contact person 1 (signatory)" : `Contact person ${i + 1}`} value={[c.title, c.name].filter(Boolean).join(" ")} wide />,
            <ReviewItem key={`c${i}-role`} label="Designation" value={c.role} />,
            <ReviewItem key={`c${i}-email`} label="Email" value={c.email} />,
            <ReviewItem key={`c${i}-mobile`} label="Mobile" value={dash(c.mobile)} />,
          ])
        )}
      </ReviewBlock>

      <ReviewBlock title={step("registration")} stepId="registration" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Company registration no." value={sop.companyRegNo} />
        <ReviewItem label="Company registration date" value={sop.companyRegDate} />
        <ReviewItem label="Company's PAN" value={sop.companyPan} />
        <ReviewItem label="Annual turnover (lakhs)" value={sop.annualTurnoverLakhs} />
        <ReviewItem label="CIN (optional)" value={draft.cin} />
        <ReviewItem label="GSTIN (optional)" value={draft.gstin} />
      </ReviewBlock>

      <ReviewBlock title={step("annexure")} stepId="annexure" onEdit={onEditStep} readOnly={readOnly}>
        {draft.annexureDocuments.map((doc) => (
          <ReviewItem key={doc.id} label={doc.kind} value={doc.uploadedAt ? `${doc.fileName}${doc.expiresOn ? ` · valid till ${doc.expiresOn}` : ""}` : "Not uploaded"} wide />
        ))}
      </ReviewBlock>

      <ReviewBlock title={step("payment")} stepId="payment" onEdit={onEditStep} readOnly={readOnly}>
        {feeLines(sop.scale).map((l) => <ReviewItem key={l.label} label={l.label} value={inr(l.amountInr)} />)}
        <ReviewItem label="Payment amount" value={sop.scale ? inr(feeTotal(sop.scale)) : ""} />
        <ReviewItem label="Method" value={pay.method ? PAYMENT_METHOD_LABELS[pay.method] : ""} />
        <ReviewItem label="Status" value={pay.status === "paid" ? "Paid (simulated)" : pay.status === "awaiting_confirmation" ? "Awaiting confirmation by BEE Finance" : ""} />
        <ReviewItem label="Receipt" value={pay.receipt} />
        {appRecord ? <ReviewItem label="Registration charge recorded at submit" value={`₹ ${fee} INR`} wide /> : null}
      </ReviewBlock>
    </div>
  );
}
