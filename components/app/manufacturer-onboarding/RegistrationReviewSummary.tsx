"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
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
  const sig = draft.authorisedSignatory;
  const addr = draft.registeredAddress;
  const contact = draft.contacts[0];
  const fee = appRecord ? formatFeeInr(appRecord.payment.amountInr) : "—";
  const account = draft.applicantAccount;

  return (
    <div className="space-y-space-md" data-testid="registration-review-summary">
      {!readOnly ? (
        <p className="text-sm font-body-sm text-on-surface-variant">
          Confirm every section below. When you submit, the demonstration fee is recorded automatically and eligibility checks run before activation under the 15-day observation window.
        </p>
      ) : (
        <p className="text-sm font-body-sm text-on-surface-variant">
          Submitted registration details as recorded in the application draft.
        </p>
      )}

      {account?.username?.trim() ? (
        <ReviewBlock title="Applicant portal account" stepId="company" onEdit={onEditStep} readOnly={readOnly}>
          <ReviewItem label="Username" value={account.username} />
          <ReviewItem label="Password" value={account.password ? "••••••••" : "—"} />
        </ReviewBlock>
      ) : null}

      <ReviewBlock title={MANUFACTURER_REGISTRATION_STEPS[0].title} stepId="company" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Legal name" value={draft.legalName} wide />
        <ReviewItem label="CIN" value={draft.cin} />
        <ReviewItem label="GSTIN" value={draft.gstin} />
        <ReviewItem label="Address line 1" value={addr.line1} wide />
        <ReviewItem label="Address line 2" value={addr.line2} wide />
        <ReviewItem label="State" value={addr.state} />
        <ReviewItem label="City" value={addr.city} />
        <ReviewItem label="PIN code" value={addr.pincode} />
      </ReviewBlock>

      <ReviewBlock title={MANUFACTURER_REGISTRATION_STEPS[1].title} stepId="facilities" onEdit={onEditStep} readOnly={readOnly}>
        {draft.facilities.length === 0 ? (
          <ReviewItem label="Facilities" value="None added" wide />
        ) : (
          draft.facilities.flatMap((f, i) => [
            <ReviewItem key={`${f.id}-name`} label={`Facility ${i + 1} name`} value={f.name} wide />,
            <ReviewItem key={`${f.id}-street`} label={`Facility ${i + 1} street`} value={f.addressLine} wide />,
            <ReviewItem key={`${f.id}-state`} label={`Facility ${i + 1} state`} value={f.state} />,
            <ReviewItem key={`${f.id}-city`} label={`Facility ${i + 1} city`} value={f.city} />,
            <ReviewItem key={`${f.id}-pin`} label={`Facility ${i + 1} PIN`} value={f.pincode} />,
          ])
        )}
      </ReviewBlock>

      <ReviewBlock title={MANUFACTURER_REGISTRATION_STEPS[2].title} stepId="contacts" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Signatory name" value={sig.name} />
        <ReviewItem label="Designation" value={sig.role} />
        <ReviewItem label="DIN" value={sig.din} />
        <ReviewItem label="PAN" value={sig.pan} />
        <ReviewItem label="Aadhaar" value={sig.aadhaar} />
        <ReviewItem label="Email" value={sig.email} />
        <ReviewItem label="Mobile" value={sig.phone} />
        <ReviewItem label="Father / guardian" value={sig.fatherName} wide />
        <ReviewItem label="Residential line 1" value={sig.residentialAddress.line1} wide />
        <ReviewItem label="Residential line 2" value={sig.residentialAddress.line2} wide />
        <ReviewItem label="Residential state" value={sig.residentialAddress.state} />
        <ReviewItem label="Residential city" value={sig.residentialAddress.city} />
        <ReviewItem label="Residential PIN" value={sig.residentialAddress.pincode} />
        <ReviewItem label="Company contact name" value={contact?.name ?? ""} />
        <ReviewItem label="Company contact email" value={contact?.email ?? ""} />
        <ReviewItem label="Company contact mobile" value={contact?.phone ?? ""} />
        <ReviewItem label="Company contact role" value={contact?.role ?? ""} />
      </ReviewBlock>

      <ReviewBlock title={MANUFACTURER_REGISTRATION_STEPS[3].title} stepId="annexure" onEdit={onEditStep} readOnly={readOnly}>
        {draft.annexureDocuments.map((doc) => (
          <ReviewItem
            key={doc.id}
            label={doc.kind}
            value={doc.uploadedAt ? doc.fileName : "Not uploaded"}
            wide
          />
        ))}
      </ReviewBlock>

      <ReviewBlock title={MANUFACTURER_REGISTRATION_STEPS[4].title} stepId="declaration" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Declaration accepted" value={draft.declarationAccepted ? "Yes" : "No"} />
        <ReviewItem label="Agreement accepted" value={draft.agreementAccepted ? "Yes" : "No"} />
      </ReviewBlock>

      <ReviewBlock title={MANUFACTURER_REGISTRATION_STEPS[5].title} stepId="fee" onEdit={onEditStep} readOnly={readOnly}>
        <ReviewItem label="Registration fee" value={`₹ ${fee} INR`} wide />
      </ReviewBlock>
    </div>
  );
}
