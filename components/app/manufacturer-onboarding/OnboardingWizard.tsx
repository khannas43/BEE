"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DOCUMENT_KIND_LABELS, MANUFACTURER_ONBOARDING_DOCUMENT_KINDS, REGISTRATION_DOCUMENT_KINDS } from "@/lib/manufacturer-onboarding/documentKinds";
import { annexureDisplayTitle } from "@/lib/manufacturer-onboarding/documentPresentation";
import { normalizeDraftFacilities } from "@/lib/manufacturer-onboarding/facilityDefaults";
import type { ManufacturerApplication, ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";
import { AnnexureDocumentsPanel } from "./AnnexureDocumentsPanel";
import { BusinessStep, CompanyStep, ContactsStep, DisclaimerStep, FacilitiesStep, RegistrationDetailsStep } from "./SopSteps";
import { RegistrationPaymentPanel } from "./RegistrationPaymentPanel";
import { RegistrationReviewSummary } from "./RegistrationReviewSummary";
import { useManufacturerOnboardingClient } from "./ManufacturerOnboardingProvider";
import { RegistrationWizardLayout } from "./RegistrationWizardLayout";
import { ErrorState, LoadingState } from "./shared";
import {
  WizardNavFooter,
  WizardPanel,
  WizardReadinessAside,
  WizardStepHero,
} from "./wizardChrome";
import {
  MANUFACTURER_REGISTRATION_STEPS as STEPS,
  stepIndexForId,
  type ManufacturerRegistrationStepId,
} from "./wizardSteps";

function normalizeLoadedDraft(draft: ManufacturerDraft): ManufacturerDraft {
  const withFacilities = normalizeDraftFacilities(draft);
  const notes = withFacilities.annexureNotes ?? {};
  return {
    ...withFacilities,
    annexureNotes: notes,
    annexureDocuments: withFacilities.annexureDocuments.map((d) => ({
      ...d,
      customLabel: notes[d.id] ?? "",
      kind: annexureDisplayTitle(d.id, notes),
    })),
  };
}

function withAnnexureNote(draft: ManufacturerDraft, documentKind: string, value: string): ManufacturerDraft {
  const annexureNotes = { ...draft.annexureNotes, [documentKind]: value };
  return {
    ...draft,
    annexureNotes,
    annexureDocuments: draft.annexureDocuments.map((d) =>
      d.id === documentKind
        ? { ...d, customLabel: value, kind: annexureDisplayTitle(documentKind, annexureNotes) }
        : d,
    ),
  };
}

/** What must be in place before the registration can be submitted (the SOP's required fields, documents and the payment). */
function validationIssues(draft: ManufacturerDraft): string[] {
  const issues: string[] = [];
  const sop = draft.sop;
  const biz = sop.business;
  if (!sop.disclaimerAccepted) issues.push("The disclaimer must be accepted.");
  if (!draft.legalName.trim()) issues.push("Name of the firm is required.");
  if (!sop.category) issues.push("Category is required.");
  if (!sop.scale) issues.push("Scale of industry (small or large) is required.");
  if (!sop.equipment) issues.push("Equipment is required.");
  if (!sop.brandName.trim()) issues.push("Brand name is required.");
  if (!draft.registeredAddress.line1.trim()) issues.push("Business address line 1 is required.");
  if (!draft.registeredAddress.state.trim() || !draft.registeredAddress.city.trim()) issues.push("Business state and city are required.");
  if (!draft.registeredAddress.pincode.trim()) issues.push("Business pincode is required.");
  if (!biz.mobile.trim()) issues.push("Business mobile number is required.");
  if (!biz.email.trim()) issues.push("Business email is required.");
  if (!draft.facilities.length) {
    issues.push("At least one manufacturing facility is required.");
  } else if (draft.facilities.some((f) => !f.name.trim() || !f.addressLine.trim() || !f.state.trim() || !f.pincode.trim() || !(f.mobile ?? "").trim() || !(f.email ?? "").trim())) {
    issues.push("Each facility needs a name, address, state, pincode, mobile and email.");
  }
  const c = draft.contacts[0];
  if (!c || !(c.firstName ?? "").trim() || !(c.lastName ?? "").trim() || !c.role.trim() || !c.email.trim() || !(c.mobile ?? "").trim()) {
    issues.push("The first contact person needs a first and last name, designation, email and mobile.");
  }
  if (!sop.companyRegNo.trim() || !sop.companyRegDate || !sop.companyPan.trim() || !sop.annualTurnoverLakhs.trim()) {
    issues.push("Company registration number and date, PAN and annual turnover are required.");
  }
  if (draft.annexureDocuments.some((d) => !d.uploadedAt && REGISTRATION_DOCUMENT_KINDS.includes(d.id as (typeof REGISTRATION_DOCUMENT_KINDS)[number]))) {
    issues.push("All documents must be uploaded.");
  }
  if (!sop.payment.status) issues.push("The payment of the registration charge and security deposit must be completed.");
  return issues;
}

export function OnboardingWizard() {
  const client = useManufacturerOnboardingClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedApplicationId = searchParams.get("applicationId");
  const [appId, setAppId] = useState<string | null>(null);
  const [appRecord, setAppRecord] = useState<ManufacturerApplication | null>(null);
  const [draft, setDraft] = useState<ManufacturerDraft | null>(null);
  const [step, setStep] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [validity, setValidity] = useState<Record<string, string>>({});

  // The client and its identity can be re-created while the page is open (session refresh, window focus). Reloading the draft
  // from the server each time would overwrite what the applicant has typed and not yet saved, so the draft is loaded once per
  // application and the latest client is read through a ref.
  const lastSavedRef = useRef<string>("");
  const savingRef = useRef<Promise<void> | null>(null);
  const latestRef = useRef<{ appId: string | null; appRecord: ManufacturerApplication | null; draft: ManufacturerDraft | null }>({ appId: null, appRecord: null, draft: null });
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);
  const loadedKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      if (!requestedApplicationId) {
        // An applicant whose registration is already submitted has nothing left to edit: show its status page instead of starting a new draft.
        const mine = await clientRef.current.listForApplicant();
        const editable = mine.some((x) => x.phase === "draft" || x.phase === "automatic_checks_failed" || x.phase === "returned");
        if (!editable && mine.length > 0) {
          router.replace(`/app/manufacturer/application/${encodeURIComponent(mine[0].id)}`);
          return;
        }
      }
      const id = requestedApplicationId || (await clientRef.current.defaultDraftId());
      const app = await clientRef.current.getApplication(id);
      const normalised = normalizeLoadedDraft(app.draft);
      lastSavedRef.current = JSON.stringify(normalised);
      setAppId(id);
      setAppRecord(app);
      setDraft(normalised);
    } catch {
      loadedKeyRef.current = null;
      setLoadError("Could not load the onboarding draft.");
    }
  }, [requestedApplicationId, router]);

  useEffect(() => {
    const key = requestedApplicationId ?? "default";
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    void load();
  }, [load, requestedApplicationId]);

  // Every step is saved as the applicant leaves it (and shortly after a field loses focus), so nothing typed on steps 1 to 6
  // is lost and the review step shows the stored draft.
  useEffect(() => {
    latestRef.current = { appId, appRecord, draft };
  }, [appId, appRecord, draft]);

  const markSaved = useCallback((d: ManufacturerDraft) => {
    lastSavedRef.current = JSON.stringify(d);
  }, []);

  const autosave = useCallback(async () => {
    if (savingRef.current) await savingRef.current;
    const { appId: id, appRecord: rec, draft: d } = latestRef.current;
    if (!id || !rec || !d) return;
    const json = JSON.stringify(d);
    if (json === lastSavedRef.current) return;
    const run = (async () => {
      try {
        const updated = await clientRef.current.saveDraft({ id, version: latestRef.current.appRecord?.version ?? rec.version, draft: d });
        lastSavedRef.current = json;
        latestRef.current = { ...latestRef.current, appRecord: updated };
        setAppRecord(updated);
      } catch {
        // the explicit Save button still reports failures; a failed background save is retried on the next change
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }, []);

  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutosave = useCallback(() => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => void autosave(), 400);
  }, [autosave]);
  useEffect(() => () => { if (blurTimerRef.current) clearTimeout(blurTimerRef.current); }, []);

  function goToStep(next: number | ((current: number) => number)) {
    void autosave();
    setStep(next);
  }

  const issues = useMemo(() => (draft ? validationIssues(draft) : []), [draft]);
  const stepMeta = STEPS[step];

  async function saveProgress() {
    if (!appId || !draft || !appRecord) return;
    setBusy(true);
    setSaveNote(null);
    try {
      if (savingRef.current) await savingRef.current;
      const updated = await client.saveDraft({ id: appId, version: latestRef.current.appRecord?.version ?? appRecord.version, draft });
      markSaved(draft);
      setAppRecord(updated);
      setSaveNote("Progress saved. You can resume later from this wizard.");
    } catch {
      setSaveNote("Save failed — please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadKind(documentKind: (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number], file: File, expiresOn?: string) {
    if (!appId || !appRecord || !draft) return;
    setBusy(true);
    setSaveNote(null);
    const custom = draft.annexureNotes[documentKind]?.trim();
    try {
      const updated = await client.uploadDocument({
        applicationId: appId,
        documentKind,
        label: custom || DOCUMENT_KIND_LABELS[documentKind],
        file,
        ...(expiresOn ? { expiresOn } : {}),
      });
      setAppRecord(updated);
      setDraft(normalizeLoadedDraft(updated.draft));
      setSaveNote(`${DOCUMENT_KIND_LABELS[documentKind]} uploaded.`);
    } catch {
      setSaveNote("Upload failed — check the file and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function removeKind(documentKind: (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number]) {
    if (!appId || !appRecord) return;
    setBusy(true);
    setSaveNote(null);
    try {
      const updated = await client.removeDocument({ applicationId: appId, documentKind });
      setAppRecord(updated);
      setDraft(normalizeLoadedDraft(updated.draft));
      setSaveNote("Document removed.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not remove this document.";
      setSaveNote(message);
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

  function goToStepId(id: ManufacturerRegistrationStepId) {
    const index = stepIndexForId(id);
    if (index >= 0) goToStep(index);
  }

  if (loadError) {
    return (
      <RegistrationWizardLayout appRecord={appRecord} step={step} onStepChange={goToStep}>
        <ErrorState message={loadError} onRetry={() => void load()} />
      </RegistrationWizardLayout>
    );
  }
  if (!draft || !appId || !stepMeta) {
    return (
      <RegistrationWizardLayout appRecord={null} step={0} onStepChange={() => {}}>
        <LoadingState label="Loading company registration wizard…" />
      </RegistrationWizardLayout>
    );
  }

  return (
    <RegistrationWizardLayout appRecord={appRecord} step={step} onStepChange={goToStep}>
      <div className="space-y-space-md w-full">
        <WizardStepHero stepIndex={step} stepCount={STEPS.length} title={stepMeta.title} blurb={stepMeta.blurb} />

        <WizardPanel>
          <div onBlur={scheduleAutosave} className="contents">
          {stepMeta.id === "disclaimer" && <DisclaimerStep draft={draft} setDraft={setDraft} />}
          {stepMeta.id === "company" && <CompanyStep draft={draft} setDraft={setDraft} />}
          {stepMeta.id === "business" && <BusinessStep draft={draft} setDraft={setDraft} />}
          {stepMeta.id === "facilities" && <FacilitiesStep draft={draft} setDraft={setDraft} />}
          {stepMeta.id === "contacts" && <ContactsStep draft={draft} setDraft={setDraft} />}
          {stepMeta.id === "registration" && <RegistrationDetailsStep draft={draft} setDraft={setDraft} />}
          {stepMeta.id === "annexure" && (
            <AnnexureDocumentsPanel
              draft={draft}
              busy={busy}
              validity={validity}
              onValidityChange={(kind, value) => setValidity((v) => ({ ...v, [kind]: value }))}
              onNotesChange={(kind, value) => setDraft(withAnnexureNote(draft, kind, value))}
              onUpload={(kind, file) => void uploadKind(kind, file, validity[kind])}
              onRemove={(kind) => void removeKind(kind)}
            />
          )}
          {stepMeta.id === "payment" && (
            <RegistrationPaymentPanel draft={draft} setDraft={setDraft} appRecord={appRecord} busy={busy} onReceiptUpload={(file) => void uploadKind("annexure_supporting" as (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number], file)} />
          )}
          {stepMeta.id === "review" && <RegistrationReviewSummary draft={draft} appRecord={appRecord} onEditStep={goToStepId} />}

          <WizardNavFooter
            step={step}
            stepCount={STEPS.length}
            busy={busy}
            issuesCount={issues.length}
            issues={issues}
            saveNote={saveNote}
            submitError={submitError}
            onBack={() => goToStep((s) => Math.max(0, s - 1))}
            onNext={() => goToStep((s) => Math.min(STEPS.length - 1, s + 1))}
            onSave={() => void saveProgress()}
            onSubmit={() => void submitApplication()}
          />
          </div>
        </WizardPanel>

        <WizardReadinessAside issues={issues} />
      </div>
    </RegistrationWizardLayout>
  );
}
