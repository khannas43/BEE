"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { DOCUMENT_KIND_LABELS, MANUFACTURER_ONBOARDING_DOCUMENT_KINDS } from "@/lib/manufacturer-onboarding/documentKinds";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import type { ManufacturerApplication, ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { useManufacturerOnboardingClient } from "./ManufacturerOnboardingProvider";
import {
  ErrorState,
  LoadingState,
  OnboardingChrome,
  PhaseStatus,
  SimulatedPaymentNote,
} from "./shared";

const STEPS = [
  { id: "company", title: "Company & registered office", icon: "corporate_fare", blurb: "Legal entity identifiers and the registered office address as they should appear on your company registration record." },
  { id: "facilities", title: "Manufacturing facilities", icon: "factory" },
  { id: "contacts", title: "Contacts & signatory", icon: "contacts" },
  { id: "annexure", title: "Annexure 1 documents", icon: "folder_open" },
  { id: "declaration", title: "Declaration & agreement", icon: "gavel" },
  { id: "fee", title: "Fee summary", icon: "receipt_long" },
  { id: "review", title: "Review & submit", icon: "fact_check" },
] as const;

function validationIssues(draft: ManufacturerDraft): string[] {
  const issues: string[] = [];
  if (!draft.legalName.trim()) issues.push("Legal entity name is required.");
  if (!draft.cin.trim()) issues.push("CIN is required.");
  if (!draft.registeredAddress.line1.trim()) issues.push("Registered address line 1 is required.");
  if (!draft.facilities.length) issues.push("At least one manufacturing facility is required.");
  if (!draft.authorisedSignatory.name.trim()) issues.push("Authorised signatory name is required.");
  if (draft.annexureDocuments.some((d) => !d.uploadedAt)) issues.push("All Annexure 1 documents must be uploaded.");
  if (!draft.declarationAccepted) issues.push("Declaration must be accepted.");
  if (!draft.agreementAccepted) issues.push("Agreement must be accepted.");
  return issues;
}

export function OnboardingWizard() {
  const client = useManufacturerOnboardingClient();
  const router = useRouter();
  const [appId, setAppId] = useState<string | null>(null);
  const [appRecord, setAppRecord] = useState<ManufacturerApplication | null>(null);
  const [draft, setDraft] = useState<ManufacturerDraft | null>(null);
  const [step, setStep] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const id = await client.defaultDraftId();
      const app = await client.getApplication(id);
      setAppId(id);
      setAppRecord(app);
      setDraft(app.draft);
    } catch {
      setLoadError("Could not load the onboarding draft.");
    }
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture client fetch on mount
    void load();
  }, [load]);

  const issues = useMemo(() => (draft ? validationIssues(draft) : []), [draft]);

  async function saveProgress() {
    if (!appId || !draft || !appRecord) return;
    setBusy(true);
    setSaveNote(null);
    try {
      const updated = await client.saveDraft({ id: appId, version: appRecord.version, draft });
      setAppRecord(updated);
      setSaveNote("Progress saved. You can resume later from this wizard.");
    } catch {
      setSaveNote("Save failed — please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadKind(documentKind: (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number], file: File) {
    if (!appId || !appRecord) return;
    setBusy(true);
    setSaveNote(null);
    try {
      const updated = await client.uploadDocument({
        applicationId: appId,
        documentKind,
        label: DOCUMENT_KIND_LABELS[documentKind],
        file,
      });
      setAppRecord(updated);
      setDraft(updated.draft);
      setSaveNote(`${DOCUMENT_KIND_LABELS[documentKind]} uploaded.`);
    } catch {
      setSaveNote("Upload failed — check the file and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
    if (!appId || !draft || !appRecord || issues.length) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const saved = await client.saveDraft({ id: appId, version: appRecord.version, draft });
      setAppRecord(saved);
      const updated = await client.submit({ id: appId, version: saved.version });
      router.push(`/app/manufacturer/application/${updated.id}`);
    } catch {
      setSubmitError("Submit failed — check validation and retry.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;
  if (!draft || !appId) return <LoadingState label="Loading company registration wizard…" />;

  return (
    <OnboardingChrome icon="factory" title="Manufacturer / company registration" showDisclosure={false}>
      <div className="space-y-space-md">
        <section className="rounded-xl border border-border-subtle bg-surface-card p-space-sm" aria-label="Progress">
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-7" data-testid="onboarding-stepper">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={`h-full w-full text-left flex items-center gap-1.5 rounded-lg px-2 py-2 text-label-sm leading-tight ${i === step ? "bg-primary/10 text-primary font-semibold" : "text-on-surface-variant hover:bg-surface-container-low"}`}
                  data-testid={`step-${s.id}`}
                >
                  <Icon name={s.icon} size={16} className="shrink-0" />
                  <span className="break-words">{i + 1}. {s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-space-md min-w-0">
          <section className="rounded-2xl border border-border-subtle bg-gradient-to-r from-primary/10 via-surface-card to-surface-card p-space-md" data-testid="wizard-application-overview">
            <div className="flex flex-wrap items-start justify-between gap-space-sm">
              <div>
                <p className="font-label-sm text-primary uppercase tracking-wide">Manufacturer registration application</p>
                <h2 className="font-headline-sm text-headline-sm mt-1">Step {step + 1} of {STEPS.length}: {STEPS[step].title}</h2>
                <p className="font-body-sm text-on-surface-variant mt-1">{"blurb" in STEPS[step] ? STEPS[step].blurb : "Complete this section, save your progress whenever needed, and continue through the registration journey."}</p>
              </div>
              <div className="text-right space-y-1">
                <p className="font-mono text-xs text-on-surface-variant">{appRecord?.reference}</p>
                {appRecord && <PhaseStatus phase={appRecord.phase} />}
              </div>
            </div>
            <div className="mt-space-md h-2 rounded-full bg-surface-container-high overflow-hidden" aria-label={`${Math.round(((step + 1) / STEPS.length) * 100)} percent complete`}>
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.round(((step + 1) / STEPS.length) * 100)}%` }} />
            </div>
          </section>

          <section className="bg-surface-card rounded-xl shadow-sm p-space-md space-y-space-md" aria-labelledby="step-heading">
            <h2 id="step-heading" className="font-headline-sm text-headline-sm">{STEPS[step].title}</h2>

            {step === 0 && (
              <div className="space-y-space-lg">
                <section>
                  <h3 className="font-label-lg font-semibold mb-2">Legal entity</h3>
                  <p className="font-body-sm text-on-surface-variant mb-3">Use the name and identifiers recorded with the Ministry of Corporate Affairs.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="font-label-sm text-label-sm">Legal name</span>
                      <input className="w-full mt-1 rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface" value={draft.legalName} onChange={(e) => setDraft({ ...draft, legalName: e.target.value })} data-testid="field-legal-name" />
                    </label>
                    <label className="block">
                      <span className="font-label-sm text-label-sm">CIN</span>
                      <input className="w-full mt-1 rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface" value={draft.cin} onChange={(e) => setDraft({ ...draft, cin: e.target.value })} data-testid="field-cin" />
                    </label>
                    <label className="block">
                      <span className="font-label-sm text-label-sm">GSTIN</span>
                      <input className="w-full mt-1 rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface" value={draft.gstin} onChange={(e) => setDraft({ ...draft, gstin: e.target.value })} data-testid="field-gstin" />
                    </label>
                  </div>
                </section>
                <section className="border-t border-border-subtle pt-space-md">
                  <h3 className="font-label-lg font-semibold mb-2">Registered office address</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["line1", "line2", "city", "state", "pincode"] as const).map((key) => (
                      <label key={key} className={`block ${key === "line1" || key === "line2" ? "sm:col-span-2" : ""}`}>
                        <span className="font-label-sm text-label-sm capitalize">{key.replace("line", "Line ")}</span>
                        <input
                          className="w-full mt-1 rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface"
                          value={draft.registeredAddress[key]}
                          onChange={(e) => setDraft({ ...draft, registeredAddress: { ...draft.registeredAddress, [key]: e.target.value } })}
                          data-testid={`field-address-${key}`}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {draft.facilities.map((f, idx) => (
                  <div key={f.id} className="border rounded-lg p-space-sm space-y-2" data-testid={`facility-${idx}`}>
                    <input className="w-full rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface" value={f.name} onChange={(e) => {
                      const facilities = [...draft.facilities];
                      facilities[idx] = { ...f, name: e.target.value };
                      setDraft({ ...draft, facilities });
                    }} placeholder="Facility name" />
                    <input className="w-full rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface" value={f.addressLine} onChange={(e) => {
                      const facilities = [...draft.facilities];
                      facilities[idx] = { ...f, addressLine: e.target.value };
                      setDraft({ ...draft, facilities });
                    }} placeholder="Address" />
                  </div>
                ))}
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2 font-label-md font-semibold">Authorised signatory</label>
                {(["name", "email", "phone", "role"] as const).map((key) => (
                  <label key={key} className="block">
                    <span className="font-label-sm text-label-sm capitalize">{key}</span>
                    <input
                      className="w-full mt-1 rounded-lg border border-outline-variant px-3 py-2 font-body-md bg-surface"
                      value={draft.authorisedSignatory[key]}
                      onChange={(e) => setDraft({ ...draft, authorisedSignatory: { ...draft.authorisedSignatory, [key]: e.target.value } })}
                      data-testid={`field-signatory-${key}`}
                    />
                  </label>
                ))}
              </div>
            )}

            {step === 3 && (
              <ul className="space-y-2">
                {draft.annexureDocuments.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-space-sm">
                    <div>
                      <p className="font-label-md">{doc.kind}</p>
                      <p className="font-body-sm text-on-surface-variant">{doc.fileName}</p>
                      {doc.uploadedAt ? (
                        <p className="font-body-sm text-success" data-testid={`upload-status-${doc.id}`}>Uploaded</p>
                      ) : (
                        <p className="font-body-sm text-on-surface-variant" data-testid={`upload-status-${doc.id}`}>Required</p>
                      )}
                    </div>
                    <label className="text-primary font-semibold text-label-sm cursor-pointer">
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadKind(doc.id as (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number], file);
                          e.target.value = "";
                        }}
                        data-testid={`upload-${doc.id}`}
                      />
                      {doc.uploadedAt ? "Replace file" : "Upload file"}
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={draft.declarationAccepted} onChange={(e) => setDraft({ ...draft, declarationAccepted: e.target.checked })} data-testid="checkbox-declaration" />
                  <span className="font-body-sm">I declare that the information supplied is accurate for this demonstration submission.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={draft.agreementAccepted} onChange={(e) => setDraft({ ...draft, agreementAccepted: e.target.checked })} data-testid="checkbox-agreement" />
                  <span className="font-body-sm">I accept the demonstration terms and S&L registration agreement placeholder.</span>
                </label>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <p className="font-body-md" data-testid="wizard-fee">
                  Demonstration fee: <strong>₹ {appRecord ? formatFeeInr(appRecord.payment.amountInr) : "—"}</strong> INR
                </p>
                <SimulatedPaymentNote />
                <p className="font-body-sm text-on-surface-variant">On submit, payment will be recorded as {LABEL_AUTO_PAYMENT.toLowerCase()} and {LABEL_AUTO_RULES.toLowerCase()} will run automatically.</p>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-3">
                <p className="font-body-md">Review your entries, then submit. Payment and initial automated checks run immediately; a BEE Officer then reviews the registration before activation.</p>
                <dl className="grid sm:grid-cols-2 gap-2 font-body-sm">
                  <div><dt className="text-on-surface-variant">Entity</dt><dd>{draft.legalName}</dd></div>
                  <div><dt className="text-on-surface-variant">CIN</dt><dd>{draft.cin}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-on-surface-variant">Address</dt><dd>{draft.registeredAddress.line1}, {draft.registeredAddress.city}</dd></div>
                </dl>
                {submitError && <p className="text-error font-body-sm" role="alert">{submitError}</p>}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="rounded-lg border px-3 py-2 font-label-md disabled:opacity-40" data-testid="wizard-back">
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className="rounded-lg bg-primary text-on-primary px-3 py-2 font-label-md font-semibold" data-testid="wizard-next">
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || issues.length > 0}
                  onClick={() => void submitApplication()}
                  className="rounded-lg bg-primary text-on-primary px-3 py-2 font-label-md font-semibold disabled:opacity-40"
                  data-testid="wizard-submit"
                >
                  Submit registration
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void saveProgress()} className="rounded-lg border px-3 py-2 font-label-md" data-testid="wizard-save">
                Save & resume later
              </button>
            </div>
            {saveNote && <p className="font-body-sm text-on-surface-variant" role="status">{saveNote}</p>}
          </section>

          <aside className="bg-surface-container-low rounded-xl p-space-sm" data-testid="validation-summary">
            <h3 className="font-label-md font-semibold mb-2">Validation summary</h3>
            {issues.length === 0 ? (
              <p className="font-body-sm text-success">All required checks pass for submit.</p>
            ) : (
              <ul className="list-disc pl-5 font-body-sm text-on-surface-variant space-y-1">
                {issues.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </aside>

          <p className="font-body-sm">
            <Link href="/register/manufacturer" className="text-primary font-semibold">Applicant login introduction</Link>
          </p>
        </div>
      </div>
    </OnboardingChrome>
  );
}
