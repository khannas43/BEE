"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { manufacturerProfileHref } from "@/lib/demo/manufacturerDirectory";
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
import { istStamp } from "@/lib/client/istTime";
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
      <p className="sr-only" data-testid="reg-state" data-state={registration.state}>
        {registration.reference} · {REGISTRATION_KIND_LABEL[registration.kind]} · {registration.brandName} · {REGISTRATION_STATE_LABEL[registration.state]}
      </p>
      <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary p-space-md text-on-primary shadow-md lg:p-space-lg" data-testid="reg-hero">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">{REGISTRATION_KIND_LABEL[registration.kind]} registration request</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wide">{registration.reference}</p>
            <p className="mt-1 text-base font-medium">{registration.brandName}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/15 px-2.5 py-1">{registration.organisation}</span>
              {registration.validFrom ? <span className="rounded-full bg-white/15 px-2.5 py-1">From {registration.validFrom}{registration.validTo ? ` to ${registration.validTo}` : ""}</span> : null}
              <span className="rounded-full bg-white/15 px-2.5 py-1">Version {registration.version}</span>
            </div>
          </div>
          <span className="rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-on-surface shadow-sm">{REGISTRATION_STATE_LABEL[registration.state]}</span>
        </div>
      </div>
      <RequestProgress state={registration.state} />
      <div className="grid gap-space-md lg:grid-cols-2">
        <div className="rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm" data-testid="reg-facts">
          <div role="heading" aria-level={2} className="mb-2 font-title-md font-semibold text-on-surface">Request details</div>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <Fact label="Kind">{REGISTRATION_KIND_LABEL[registration.kind]} registration</Fact>
            <Fact label="Brand">{registration.brandName}</Fact>
            <Fact label="Applicant"><Link href={manufacturerProfileHref(registration.organisation)} className="font-semibold text-primary hover:underline">{registration.organisation}</Link></Fact>
            <Fact label="Stage">{REGISTRATION_STATE_LABEL[registration.state]}</Fact>
            {registration.kind === "agency" ? <Fact label="Authorisation period">{registration.validFrom ?? "-"}{registration.validTo ? ` to ${registration.validTo}` : " (open-ended)"}</Fact> : null}
            <Fact label="Trade licence">{registration.tradeLicenceUploaded ? "Uploaded" : "Not uploaded"}</Fact>
          </div>
        </div>
        <div className="rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm" data-testid="reg-fee-card">
          <div role="heading" aria-level={2} className="mb-2 font-title-md font-semibold text-on-surface">Fee</div>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <Fact label="Status">{REGISTRATION_FEE_STATE[registration.state]}</Fact>
            <Fact label="Amount">{registration.submissionFee ? `INR ${registration.submissionFee.totalInr}` : "-"}</Fact>
            <div className="sm:col-span-2"><Fact label="Basis">{registration.submissionFee ? registration.submissionFee.label : "No fee has been recorded yet."}</Fact></div>
          </div>
          <p className="mt-2 text-xs text-on-surface-variant">Provisional local rules, not BEE rules.</p>
        </div>
      </div>
      {registration.state === "fee_due" && registration.submissionFee ? (
        <p className="rounded-xl border border-[#f3dc9c] bg-[#fff4d6] px-space-md py-2.5 text-sm" data-testid="reg-fee-due">Fee due: INR {registration.submissionFee.totalInr}. Finance confirms it when it is received. {registration.submissionFee.label}</p>
      ) : null}
      {registration.state === "programme_review" ? (
        <p className="rounded-xl border border-[#c9d9f7] bg-[#e7effb] px-space-md py-2.5 text-sm" data-testid="reg-fee-confirmed">Fee confirmed. Waiting for Programme review.</p>
      ) : null}
      {registration.state === "returned" ? (
        <p className="rounded-xl border border-[#f3dc9c] bg-[#fff4d6] px-space-md py-2.5 text-sm" data-testid="reg-returned">
          {returned
            ? <>Returned by {REGISTRATION_ACTOR_LABEL[returned.actorRole] ?? returned.actorRole}: <span data-testid="reg-returned-reason">{returned.note ?? "No reason was recorded."}</span></>
            : "Returned for changes. No reason is shown; ask the reviewer."}
        </p>
      ) : null}
      {registration.state === "approved" ? (
        <p className="rounded-xl border border-[#b7e0c6] bg-[#e2f3e8] px-space-md py-2.5 text-sm" data-testid="reg-registered">
          Registered. {registration.kind === "brand" ? registration.brandName : `${registration.brandName}${registration.validFrom ? ` from ${registration.validFrom}` : ""}${registration.validTo ? ` to ${registration.validTo}` : ""}`}
          {registration.registeredBrandId || registration.registeredAuthorisationId ? " It is on the register." : ""}
        </p>
      ) : null}
      {registration.state === "rejected" ? (
        <p className="rounded-xl border border-[#f5c2c0] bg-[#fdecea] px-space-md py-2.5 text-sm" data-testid="reg-rejected">Rejected. {rejected?.note ?? ""}</p>
      ) : null}
      {result ? (
        <p className="rounded-xl border border-primary/30 bg-primary/5 px-space-md py-2.5 text-sm font-medium" data-testid="rev-result">
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
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm p-space-md" data-testid="reg-licence">
      <div role="heading" aria-level={2} className="font-title-md font-semibold text-on-surface">Trade licence</div>
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
    </div>
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
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm p-space-md" data-testid="reg-submit-review">
      <div role="heading" aria-level={2} className="font-title-md font-semibold text-on-surface">Submit review</div>
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
    </div>
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
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm p-space-md" data-testid="rev-trail">
      <div role="heading" aria-level={2} className="font-title-md font-semibold text-on-surface">Trail</div>
      <ol className="mt-space-sm space-y-4 font-body-sm">
        {steps.map((step, index) => (
          <li key={`${step.action}-${step.at}-${index}`} data-testid={`rev-trail-${index}`} className="relative flex gap-3">
            {index < steps.length - 1 ? <span className="absolute left-[7px] top-5 bottom-[-16px] w-px bg-outline-variant" aria-hidden="true" /> : null}
            <span className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full bg-primary/15 ring-4 ring-white"><span className="absolute inset-1 rounded-full bg-primary" /></span>
            <span>
              <span className="block font-semibold text-on-surface">{REGISTRATION_ACTION_LABEL[step.action] ?? step.action}{" · "}{REGISTRATION_ACTOR_LABEL[step.actorRole] ?? step.actorRole}</span>
              {step.note ? <span className="block text-on-surface-variant">{step.note}</span> : null}
              <span className="block text-xs text-on-surface-variant">{istStamp(step.at, false)} IST</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
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
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm p-space-md" data-testid="rev-decision">
      <div role="heading" aria-level={2} className="font-title-md font-semibold text-on-surface">Decision</div>
      <p className="font-body-sm text-on-surface-variant mt-1">Provisional local rules, not BEE rules.</p>
      <label className="block font-label-sm text-label-sm text-on-surface-variant mt-space-sm">
        Reason or note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="rev-note" aria-describedby="rev-note-help" />
      </label>
      {confirms ? (
        <p className="font-body-sm mt-space-sm" data-testid="rev-confirm">
          {registration.kind === "brand" ? `This registers the brand for ${registration.organisation}.` : "This records the agency's authorisation."}
        </p>
      ) : null}
      {actions.some((a) => REASON_ACTIONS.has(a)) && text.length < 1 ? (
        <p className="font-body-sm text-on-surface-variant mt-1" id="rev-note-help" data-testid="rev-note-help">A reason of 1 to 500 characters is needed to return{actions.includes("reject") ? " or reject" : ""} a request.</p>
      ) : null}
      <CommandOutcome state={command.state} errorTestId="rev-decision-error" reloadTestId="rev-decision-reload" onReload={() => { command.reset(); onReload(); }} signInReturnTo={registrationRequestHref(registration.id)} />
      <div className="mt-space-sm flex flex-wrap gap-space-sm">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={command.state.phase === "busy" || !withinLimit || (REASON_ACTIONS.has(action) && text.length < 1)}
            onClick={() => void act(action)}
            className={`rounded-xl px-4 py-2.5 font-semibold disabled:opacity-50 ${action === "approve" || action === "recommend" ? "bg-primary text-on-primary" : action === "reject" ? "border border-error bg-white text-error" : "border border-outline-variant bg-white text-on-surface"}`}
            data-testid={ACTION_BUTTON[action].testId}
          >
            {command.state.phase === "busy" ? "Sending…" : ACTION_BUTTON[action].label}
          </button>
        ))}
      </div>
    </div>
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
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm p-space-md" data-testid="reg-resubmit-panel">
      <div role="heading" aria-level={2} className="font-title-md font-semibold text-on-surface">Resubmit</div>
      <p className="font-body-sm text-on-surface-variant mt-1">The fee already confirmed is not charged again. Provisional local rules, not BEE rules.</p>
      {dirty ? <p className="font-body-sm text-on-surface-variant mt-1" id="reg-resubmit-help" data-testid="reg-resubmit-help">Save or discard your edits before resubmitting.</p> : null}
      <CommandOutcome state={command.state} errorTestId="reg-resubmit-error" reloadTestId="reg-resubmit-reload" onReload={() => { command.reset(); onReload(); }} signInReturnTo={registrationRequestHref(registration.id)} />
      <button
        type="button"
        disabled={dirty || command.state.phase === "busy"}
        aria-describedby={dirty ? "reg-resubmit-help" : undefined}
        onClick={() => void send()}
        className="mt-space-sm w-full border border-primary text-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
        data-testid="reg-resubmit"
      >
        {command.state.phase === "busy" ? "Resubmitting…" : "Resubmit"}
      </button>
    </div>
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-on-surface-variant">{label}</div>
      <div className="mt-0.5 font-medium text-on-surface break-words">{children}</div>
    </div>
  );
}

const PROGRESS = [
  { key: "fee", label: "Fee", detail: "Filed and fee confirmed" },
  { key: "programme", label: "Programme review", detail: "Recommendation" },
  { key: "officer", label: "BEE Officer approval", detail: "Decision" },
  { key: "register", label: "On the register", detail: "Brand or authorisation entered" },
] as const;

/** Where the request stands on the four-step path; a returned or rejected request marks the step it stopped at. */
function RequestProgress({ state }: { state: Registration["state"] }) {
  const at = state === "draft" || state === "fee_due" ? 0 : state === "programme_review" ? 1 : state === "director_approval" ? 2 : state === "approved" ? 4 : state === "returned" ? 1 : 2;
  const stopped = state === "returned" || state === "rejected";
  return (
    <div className="rounded-2xl border border-border-subtle bg-white px-space-md py-space-md shadow-sm" aria-label="Progress" data-testid="reg-progress">
      <ol className="grid grid-cols-4 gap-2">
        {PROGRESS.map((st, i) => {
          const done = i < at;
          const current = i === at && !stopped;
          const failed = i === at && stopped;
          const dot = done ? "bg-success text-on-success" : failed ? "bg-error text-on-error" : current ? "bg-primary text-on-primary ring-4 ring-primary/20" : "bg-surface-container-high text-on-surface-variant";
          return (
            <li key={st.key} className="relative flex flex-col items-center text-center">
              {i > 0 ? <span className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${i <= at ? "bg-success" : "bg-outline-variant"}`} aria-hidden="true" /> : null}
              <span className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${dot}`}>
                {done ? <Icon name="check" size={16} /> : failed ? <Icon name="priority_high" size={16} /> : current ? <Icon name="more_horiz" size={16} /> : i + 1}
              </span>
              <span className={`mt-2 text-xs leading-tight ${current ? "font-semibold text-primary" : failed ? "font-semibold text-error" : "text-on-surface"}`}>{st.label}</span>
              <span className="mt-0.5 hidden text-[11px] leading-tight text-on-surface-variant sm:block">{st.detail}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
