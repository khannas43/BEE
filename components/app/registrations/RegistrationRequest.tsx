"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { FailureBanner, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { RegistrationForm } from "@/components/app/registrations/RegistrationForm";
import { REGISTRATION_FEE_STATE, REGISTRATION_GATE_LABEL, REGISTRATION_KIND_LABEL, REGISTRATION_STATE_LABEL, indiaToday } from "@/components/app/registrations/labels";
import {
  type Registration,
  type RegistrationDocumentList,
  type RegistrationSubmitPreview,
  listRegistrationDocuments,
  previewRegistrationSubmit,
  readRegistration,
  registrationContentPath,
  registrationRequestHref,
  runSubmitRegistration,
  runUploadLicence,
  submitRegistrationSignature,
  uploadLicenceSignature,
} from "@/lib/client/runtimeRegistrations";
import { gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadOne = (id: string) => readRegistration(id);
const loadDocs = (id: string) => listRegistrationDocuments(id);
/** The target is `<id>:<version>` so a saved change reads the preview again. The epoch still re-reads it after an upload. */
const loadPreview = (target: string) => previewRegistrationSubmit(target.slice(0, target.lastIndexOf(":")));

/**
 * One registration request: its facts, the trade licence, and — while it is a draft — the submit review.
 * A submitted request stops at fee due, then at "Fee confirmed. Waiting for Programme review." Review and
 * approval are a later package. Provisional local rules, not BEE rules; the fee label comes from the service.
 */
export function RegistrationRequest({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const id = params.get("id");
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead(id, loadOne, revalidation));
  const documents = gateRead(identity.status, useRuntimeRead(id, loadDocs, revalidation));
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);

  return (
    <ScreenChrome module={module} screen={screen} subtitle="One registration request" implemented={runtimeRouteFor("/app/registrations/request")?.implemented}>
      <div className="space-y-space-md" data-testid="reg-request">
        <IdentityStrip identity={identity} testId="reg-request-identity" />
        {!id ? <p className="font-body-sm" data-testid="reg-request-missing">Open a request from the list.</p> : null}
        {id ? (
          <ReadPanel
            title="Registration request"
            read={read}
            loadingText="Loading the registration request…"
            loadingTestId="reg-request-loading"
            errorTestId="reg-request-error"
            signInReturnTo={registrationRequestHref(id)}
          >
            {(r) => (
              <RequestBody
                registration={r.registration}
                documents={documents}
                dirty={dirty}
                onDirtyChange={onDirtyChange}
                onChanged={revalidation.refresh}
                revalidation={revalidation}
              />
            )}
          </ReadPanel>
        ) : null}
      </div>
    </ScreenChrome>
  );
}

function RequestBody({
  registration,
  documents,
  dirty,
  onDirtyChange,
  onChanged,
  revalidation,
}: {
  registration: Registration;
  documents: { ok: true; documents: RegistrationDocumentList } | { ok: false; failure: { message: string; kind: string } } | null;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onChanged: () => void;
  revalidation: ReturnType<typeof useRevalidation>;
}) {
  const today = indiaToday();
  const draft = registration.state === "draft";
  const preview = useRuntimeRead(draft && !dirty ? `${registration.id}:${registration.version}` : null, loadPreview, revalidation);

  return (
    <div className="space-y-space-md">
      <p data-testid="reg-state" data-state={registration.state}>
        {registration.reference} · {REGISTRATION_KIND_LABEL[registration.kind]} · {registration.brandName} · {REGISTRATION_STATE_LABEL[registration.state]}
      </p>
      <p className="font-body-sm text-on-surface-variant">
        {registration.organisation}
        {registration.validFrom ? ` · from ${registration.validFrom}` : ""}
        {registration.validTo ? ` to ${registration.validTo}` : ""}
        {` · ${REGISTRATION_FEE_STATE[registration.state]}`}
      </p>
      {registration.state === "fee_due" && registration.submissionFee ? (
        <p data-testid="reg-fee-due">Fee due: INR {registration.submissionFee.totalInr}. Finance confirms it when it is received. {registration.submissionFee.label}</p>
      ) : null}
      {registration.state === "programme_review" ? (
        <p data-testid="reg-fee-confirmed">Fee confirmed. Waiting for Programme review.</p>
      ) : null}
      {draft ? (
        <RegistrationForm
          key={`${registration.id}-${registration.version}`}
          kind={registration.kind}
          today={today}
          existing={registration}
          signInReturnTo={registrationRequestHref(registration.id)}
          onSaved={onChanged}
          onDirtyChange={onDirtyChange}
        />
      ) : null}
      <LicenceCard registrationId={registration.id} editable={draft} documents={documents} onUploaded={onChanged} />
      {draft && !dirty && preview && !preview.ok ? (
        <FailureBanner failure={preview.failure} testId="reg-preview-error" signInReturnTo={registrationRequestHref(registration.id)} />
      ) : null}
      {draft && !dirty && preview && preview.ok ? (
        <SubmitReview registration={registration} preview={preview.preview} onDone={onChanged} />
      ) : null}
    </div>
  );
}

function LicenceCard({
  registrationId,
  editable,
  documents,
  onUploaded,
}: {
  registrationId: string;
  editable: boolean;
  documents: { ok: true; documents: RegistrationDocumentList } | { ok: false; failure: { message: string } } | null;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useCommand(runUploadLicence, uploadLicenceSignature);
  const licence = documents && documents.ok ? documents.documents.items.find((d) => d.documentKind === "trade_licence") : undefined;
  const versions = licence?.versions ?? [];

  async function send() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const result = await upload.execute({ id: registrationId, file });
    if (result?.ok) {
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    }
  }

  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reg-licence">
      <h2 className="font-title-md text-title-md text-on-surface">Trade licence</h2>
      {documents && documents.ok ? (
        <p className="font-body-sm text-on-surface-variant mt-1" data-testid="reg-licence-note">{documents.documents.verificationNote}</p>
      ) : null}
      {documents && !documents.ok ? <p className="text-error font-body-sm mt-1" data-testid="reg-licence-read-error">{documents.failure.message}</p> : null}
      {editable ? (
        <CommandPanel
          className="mt-space-sm"
          state={upload.state}
          onRun={() => void send()}
          runLabel="Upload trade licence"
          busyLabel="Uploading…"
          runTestId="reg-licence-upload"
          errorTestId="reg-licence-error"
          reloadTestId="reg-licence-reload"
          onReload={onUploaded}
          signInReturnTo={registrationRequestHref(registrationId)}
        >
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            PDF
            <input ref={fileRef} type="file" accept="application/pdf" className="mt-1 block font-body-sm" data-testid="reg-licence-file" />
          </label>
        </CommandPanel>
      ) : null}
      <ul className="mt-space-sm space-y-1">
        {versions.map((v) => (
          <li key={v.id} data-testid={`reg-licence-version-${v.versionNumber}`}>
            v{v.versionNumber} · {v.label} · {v.originalFilename}
            {" · "}
            <a href={licence ? registrationContentPath(registrationId, licence.id, v.id) : "#"} className="text-primary" data-testid={`reg-licence-download-${v.versionNumber}`}>
              Download
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubmitReview({ registration, preview, onDone }: { registration: Registration; preview: RegistrationSubmitPreview; onDone: () => void }) {
  const command = useCommand(runSubmitRegistration, submitRegistrationSignature);
  const fee = preview.submissionFee;
  const gatesMet = preview.gates.every((g) => g.met);

  async function submit() {
    if (!fee || !gatesMet) return;
    const result = await command.execute({
      id: registration.id,
      version: preview.version,
      expectedFee: { amountInr: fee.amountInr, feeRuleKey: fee.feeRuleKey, feeRuleVersion: fee.feeRuleVersion },
    });
    if (result?.ok) onDone();
    // The fee rule moved after the preview: read the review again so the next Submit carries the new fee.
    else if (result && !result.ok && "code" in result.failure && result.failure.code === "fee_preview_conflict") onDone();
  }

  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reg-submit-review">
      <h2 className="font-title-md text-title-md text-on-surface">Submit review</h2>
      <p className="font-body-sm text-on-surface-variant mt-1">{preview.intakeNote}</p>
      <ul className="mt-space-sm space-y-1">
        {preview.gates.map((gate) => (
          <li key={gate.code} data-testid={`reg-gate-${gate.code}`} data-met={gate.met ? "true" : "false"}>
            {REGISTRATION_GATE_LABEL[gate.code] ?? gate.code}: {gate.met ? "Met" : "Unmet"}
          </li>
        ))}
      </ul>
      {fee ? (
        <div className="mt-space-sm font-body-sm" data-testid="reg-fee">
          <p>Amount INR {fee.amountInr} · tax {fee.taxRatePercent}% (INR {fee.taxInr})</p>
          <p data-testid="reg-fee-total">Total INR {fee.totalInr}</p>
          <p>Rule {fee.feeRuleKey} version {fee.feeRuleVersion}</p>
          <p data-testid="reg-fee-label">{fee.label}</p>
        </div>
      ) : null}
      <CommandPanel
        className="mt-space-sm"
        state={command.state}
        onRun={() => void submit()}
        runLabel="Submit"
        busyLabel="Submitting…"
        runTestId="reg-submit"
        errorTestId="reg-submit-error"
        reloadTestId="reg-submit-reload"
        onReload={onDone}
        disabled={!gatesMet || !fee}
        signInReturnTo={registrationRequestHref(registration.id)}
      />
    </section>
  );
}
