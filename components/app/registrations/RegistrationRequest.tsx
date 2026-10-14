"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand, type CommandState } from "@/components/app/kit/CommandPanel";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { FailureBanner, ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { RegistrationForm } from "@/components/app/registrations/RegistrationForm";
import {
  REASON_ACTIONS,
  REGISTRATION_ACTION_LABEL,
  REGISTRATION_ACTOR_LABEL,
  REGISTRATION_FEE_STATE,
  REGISTRATION_GATE_LABEL,
  REGISTRATION_KIND_LABEL,
  REGISTRATION_STATE_LABEL,
  applicantMayRevise,
  indiaToday,
  reviewActionsFor,
} from "@/components/app/registrations/labels";
import {
  type Registration,
  type RegistrationDocumentList,
  type RegistrationSubmitPreview,
  type RegistrationTransitionReceipt,
  listRegistrationDocuments,
  previewRegistrationSubmit,
  readRegistration,
  registrationContentPath,
  registrationRequestHref,
  registrationReviewsHref,
  runSubmitRegistration,
  runTransitionRegistration,
  runUploadLicence,
  submitRegistrationSignature,
  transitionRegistrationSignature,
  uploadLicenceSignature,
} from "@/lib/client/runtimeRegistrations";
import { commandAdvice, gateRead } from "@/lib/client/runtimeHttp";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const loadOne = (id: string) => readRegistration(id);
const loadDocs = (id: string) => listRegistrationDocuments(id);
/** The target is `<id>:<version>` so a saved change reads the preview again. The epoch still re-reads it after an upload. */
const loadPreview = (target: string) => previewRegistrationSubmit(target.slice(0, target.lastIndexOf(":")));

/**
 * One registration request. An applicant files, revises a return and reads the end state. Programme and the Director
 * take the step their role is offered in this state. Spring decides whether that person may take it.
 * Provisional local rules, not BEE rules; the fee label comes from the service.
 */
export function RegistrationRequest({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const id = params.get("id");
  const revalidation = useRevalidation();
  const read = gateRead(identity.status, useRuntimeRead(id, loadOne, revalidation));
  const documents = gateRead(identity.status, useRuntimeRead(id, loadDocs, revalidation));
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<RegistrationTransitionReceipt | null>(null);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);
  const roles = identity.status === "signed-in" ? identity.me.effectiveRoles.map((r) => r.role) : [];

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
                roles={roles}
                result={result}
                onResult={setResult}
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
  roles,
  result,
  onResult,
  onDirtyChange,
  onChanged,
  revalidation,
}: {
  registration: Registration;
  documents: { ok: true; documents: RegistrationDocumentList } | { ok: false; failure: { message: string; kind: string } } | null;
  dirty: boolean;
  roles: string[];
  result: RegistrationTransitionReceipt | null;
  onResult: (receipt: RegistrationTransitionReceipt) => void;
  onDirtyChange: (dirty: boolean) => void;
  onChanged: () => void;
  revalidation: ReturnType<typeof useRevalidation>;
}) {
  const today = indiaToday();
  const draft = registration.state === "draft";
  const revising = applicantMayRevise(roles, registration.state);
  const editable = draft || revising;
  const preview = useRuntimeRead(draft && !dirty ? `${registration.id}:${registration.version}` : null, loadPreview, revalidation);
  const actions = reviewActionsFor(roles, registration.state);
  const returned = [...(registration.trail ?? [])].reverse().find((step) => step.action === "return");
  const rejected = [...(registration.trail ?? [])].reverse().find((step) => step.action === "reject");

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
      {registration.state === "returned" && returned ? (
        <p data-testid="reg-returned">
          Returned by {REGISTRATION_ACTOR_LABEL[returned.actorRole] ?? returned.actorRole}: <span data-testid="reg-returned-reason">{returned.note ?? ""}</span>
        </p>
      ) : null}
      {registration.state === "approved" ? (
        <p data-testid="reg-registered">
          Registered. {registration.kind === "brand" ? registration.brandName : `${registration.brandName}${registration.validFrom ? ` from ${registration.validFrom}` : ""}${registration.validTo ? ` to ${registration.validTo}` : ""}`}
          {registration.registeredBrandId ? ` · ${registration.registeredBrandId}` : ""}
          {registration.registeredAuthorisationId ? ` · ${registration.registeredAuthorisationId}` : ""}
        </p>
      ) : null}
      {registration.state === "rejected" ? (
        <p data-testid="reg-rejected">Rejected. {rejected?.note ?? ""}</p>
      ) : null}
      {result ? (
        <p data-testid="rev-result">
          {REGISTRATION_STATE_LABEL[result.toState]}
          {" · "}
          <Link href={registrationReviewsHref()} className="text-primary">Back to the queue</Link>
        </p>
      ) : null}
      {editable ? (
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
      <LicenceCard registrationId={registration.id} editable={editable} documents={documents} onUploaded={onChanged} />
      {registration.trail ? <Trail steps={registration.trail} /> : null}
      {actions.length > 0 ? (
        <DecisionPanel registration={registration} actions={actions} onReload={onChanged} onDone={(receipt) => { onResult(receipt); onChanged(); }} />
      ) : null}
      {revising ? <Resubmit registration={registration} dirty={dirty} onReload={onChanged} onDone={(receipt) => { onResult(receipt); onChanged(); }} /> : null}
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

const ACTION_BUTTON: Record<"recommend" | "return" | "approve" | "reject", { label: string; testId: string }> = {
  recommend: { label: "Recommend", testId: "rev-recommend" },
  return: { label: "Return", testId: "rev-return" },
  approve: { label: "Approve", testId: "rev-approve" },
  reject: { label: "Reject", testId: "rev-reject" },
};

function Trail({ steps }: { steps: NonNullable<Registration["trail"]> }) {
  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="rev-trail">
      <h2 className="font-title-md text-title-md text-on-surface">Trail</h2>
      <ul className="mt-space-sm space-y-1 font-body-sm">
        {steps.map((step, index) => (
          <li key={`${step.action}-${step.at}-${index}`} data-testid={`rev-trail-${index}`}>
            {REGISTRATION_ACTION_LABEL[step.action] ?? step.action}
            {" · "}
            {REGISTRATION_ACTOR_LABEL[step.actorRole] ?? step.actorRole}
            {step.note ? ` · ${step.note}` : ""}
            {` · ${step.at}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DecisionPanel({
  registration,
  actions,
  onDone,
  onReload,
}: {
  registration: Registration;
  actions: ("recommend" | "return" | "approve" | "reject")[];
  onDone: (receipt: RegistrationTransitionReceipt) => void;
  onReload: () => void;
}) {
  const [note, setNote] = useState("");
  const command = useCommand(runTransitionRegistration, transitionRegistrationSignature);
  const text = note.trim();
  const withinLimit = text.length <= 500;
  const confirms = actions.includes("approve") || actions.includes("reject");

  async function act(action: "recommend" | "return" | "approve" | "reject") {
    if (REASON_ACTIONS.has(action) && (text.length < 1 || text.length > 500)) return;
    if (!withinLimit) return;
    const result = await command.execute({ id: registration.id, action, version: registration.version, ...(text ? { note: text } : {}) });
    if (result?.ok) onDone(result.value);
  }

  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="rev-decision">
      <h2 className="font-title-md text-title-md text-on-surface">Decision</h2>
      <p className="font-body-sm text-on-surface-variant mt-1">Provisional local rules, not BEE rules.</p>
      <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
        Reason or note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="rev-note" />
      </label>
      {confirms ? (
        <p className="font-body-sm mt-space-sm" data-testid="rev-confirm">
          {registration.kind === "brand" ? `This registers the brand for ${registration.organisation}.` : "This records the agency's authorisation."}
        </p>
      ) : null}
      <CommandOutcome state={command.state} errorTestId="rev-decision-error" reloadTestId="rev-decision-reload" onReload={onReload} signInReturnTo={registrationRequestHref(registration.id)} />
      <div className="mt-space-sm flex flex-wrap gap-space-sm">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={command.state.phase === "busy" || !withinLimit || (REASON_ACTIONS.has(action) && text.length < 1)}
            onClick={() => void act(action)}
            className="border border-primary text-primary py-2.5 px-4 rounded-lg font-label-md disabled:opacity-50"
            data-testid={ACTION_BUTTON[action].testId}
          >
            {command.state.phase === "busy" ? "Sending…" : ACTION_BUTTON[action].label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Resubmit({ registration, dirty, onDone, onReload }: { registration: Registration; dirty: boolean; onDone: (receipt: RegistrationTransitionReceipt) => void; onReload: () => void }) {
  const command = useCommand(runTransitionRegistration, transitionRegistrationSignature);

  async function send() {
    if (dirty) return;
    const result = await command.execute({ id: registration.id, action: "resubmit", version: registration.version });
    if (result?.ok) onDone(result.value);
  }

  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reg-resubmit-panel">
      <h2 className="font-title-md text-title-md text-on-surface">Resubmit</h2>
      <p className="font-body-sm text-on-surface-variant mt-1">The fee already confirmed is not charged again. Provisional local rules, not BEE rules.</p>
      <CommandOutcome state={command.state} errorTestId="reg-resubmit-error" reloadTestId="reg-resubmit-reload" onReload={onReload} signInReturnTo={registrationRequestHref(registration.id)} />
      <button
        type="button"
        disabled={dirty || command.state.phase === "busy"}
        onClick={() => void send()}
        className="mt-space-sm w-full border border-primary text-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
        data-testid="reg-resubmit"
      >
        {command.state.phase === "busy" ? "Resubmitting…" : "Resubmit"}
      </button>
    </section>
  );
}

function CommandOutcome<T>({ state, errorTestId, reloadTestId, onReload, signInReturnTo }: {
  state: CommandState<T>;
  errorTestId: string;
  reloadTestId: string;
  onReload: () => void;
  signInReturnTo: string;
}) {
  if (state.phase !== "failed") return null;
  const failure = state.failure;
  const advice = commandAdvice(failure);
  return (
    <div className="mt-space-sm" data-testid={errorTestId} data-failure-code={"code" in failure ? failure.code : failure.kind}>
      <p className="text-error font-body-sm">{failure.message}</p>
      {advice.reload ? (
        <button type="button" onClick={onReload} className="mt-1 text-primary font-label-md hover:underline" data-testid={reloadTestId}>Reload the latest version</button>
      ) : null}
      {advice.signIn ? (
        <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="mt-1 inline-block text-primary font-label-md hover:underline">Sign in</Link>
      ) : null}
    </div>
  );
}
