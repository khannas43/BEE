"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { DOCUMENT_KIND_LABELS, MANUFACTURER_ONBOARDING_DOCUMENT_KINDS } from "@/lib/manufacturer-onboarding/documentKinds";
import { annexureDisplayTitle } from "@/lib/manufacturer-onboarding/documentPresentation";
import { createEmptyFacility, normalizeDraftFacilities } from "@/lib/manufacturer-onboarding/facilityDefaults";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import type { AuthorisedSignatory, ManufacturerApplication, ManufacturerContact, ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { defaultCityForState, citiesForState } from "@/lib/manufacturer-onboarding/indiaLocations";
import { AnnexureDocumentsPanel } from "./AnnexureDocumentsPanel";
import { StateCitySelect } from "./StateCitySelect";
import { RegistrationReviewSummary } from "./RegistrationReviewSummary";
import { useManufacturerOnboardingClient } from "./ManufacturerOnboardingProvider";
import { RegistrationWizardLayout } from "./RegistrationWizardLayout";
import { ErrorState, LoadingState, SimulatedPaymentNote } from "./shared";
import {
  WizardFieldLabel,
  WizardNavFooter,
  WizardPanel,
  WizardReadinessAside,
  WizardSection,
  WizardStepHero,
  wizardInputClass,
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

function primaryCompanyContact(draft: ManufacturerDraft): ManufacturerContact {
  return draft.contacts[0] ?? { name: "", email: "", phone: "", role: "" };
}

function withPrimaryCompanyContact(draft: ManufacturerDraft, contact: ManufacturerContact): ManufacturerDraft {
  const contacts = draft.contacts.length ? [...draft.contacts] : [contact];
  contacts[0] = contact;
  return { ...draft, contacts };
}

function patchSignatory(draft: ManufacturerDraft, patch: Partial<AuthorisedSignatory>): ManufacturerDraft {
  return { ...draft, authorisedSignatory: { ...draft.authorisedSignatory, ...patch } };
}

function patchSignatoryAddress(
  draft: ManufacturerDraft,
  key: keyof AuthorisedSignatory["residentialAddress"],
  value: string,
): ManufacturerDraft {
  return patchSignatory(draft, {
    residentialAddress: { ...draft.authorisedSignatory.residentialAddress, [key]: value },
  });
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

function validationIssues(draft: ManufacturerDraft): string[] {
  const issues: string[] = [];
  if (!draft.legalName.trim()) issues.push("Legal entity name is required.");
  if (!draft.cin.trim()) issues.push("CIN is required.");
  if (!draft.registeredAddress.line1.trim()) issues.push("Registered address line 1 is required.");
  if (!draft.facilities.length) {
    issues.push("At least one manufacturing facility is required.");
  } else if (draft.facilities.some((f) => !f.name.trim())) {
    issues.push("Each facility must have a name.");
  }
  const sig = draft.authorisedSignatory;
  if (!sig.name.trim()) issues.push("Authorised signatory name is required.");
  if (!sig.role.trim()) issues.push("Authorised signatory designation is required.");
  if (!sig.pan.trim()) issues.push("Authorised signatory PAN is required.");
  if (!sig.aadhaar.trim()) issues.push("Authorised signatory Aadhaar number is required.");
  if (!sig.residentialAddress.line1.trim()) issues.push("Authorised signatory residential address is required.");
  if (draft.annexureDocuments.some((d) => !d.uploadedAt)) issues.push("All Annexure 1 documents must be uploaded.");
  if (!draft.declarationAccepted) issues.push("Declaration must be accepted.");
  if (!draft.agreementAccepted) issues.push("Agreement must be accepted.");
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
  }, [requestedApplicationId]);

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

  async function uploadKind(documentKind: (typeof MANUFACTURER_ONBOARDING_DOCUMENT_KINDS)[number], file: File) {
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
          {step === 0 && (
            <div className="space-y-space-lg">
              <WizardSection title="Legal entity" description="As registered with the Ministry of Corporate Affairs." icon="corporate_fare">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <WizardFieldLabel required>Legal name</WizardFieldLabel>
                    <input
                      className={wizardInputClass}
                      value={draft.legalName}
                      onChange={(e) => setDraft({ ...draft, legalName: e.target.value })}
                      data-testid="field-legal-name"
                    />
                  </label>
                  <label className="block">
                    <WizardFieldLabel required>CIN</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.cin} onChange={(e) => setDraft({ ...draft, cin: e.target.value })} data-testid="field-cin" />
                  </label>
                  <label className="block">
                    <WizardFieldLabel>GSTIN</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.gstin} onChange={(e) => setDraft({ ...draft, gstin: e.target.value })} data-testid="field-gstin" />
                  </label>
                </div>
              </WizardSection>
              <WizardSection title="Registered office address" icon="home_pin">
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["line1", "line2"] as const).map((key) => (
                    <label key={key} className="block sm:col-span-3">
                      <WizardFieldLabel required={key === "line1"}>
                        {key === "line1" ? "Address line 1" : "Address line 2"}
                      </WizardFieldLabel>
                      <input
                        className={wizardInputClass}
                        value={draft.registeredAddress[key]}
                        onChange={(e) => setDraft({ ...draft, registeredAddress: { ...draft.registeredAddress, [key]: e.target.value } })}
                        data-testid={`field-address-${key}`}
                      />
                    </label>
                  ))}
                  <StateCitySelect
                    state={draft.registeredAddress.state}
                    city={draft.registeredAddress.city}
                    onStateChange={(state) => {
                      const options = citiesForState(state);
                      const city = options.includes(draft.registeredAddress.city) ? draft.registeredAddress.city : defaultCityForState(state);
                      setDraft({ ...draft, registeredAddress: { ...draft.registeredAddress, state, city } });
                    }}
                    onCityChange={(city) => setDraft({ ...draft, registeredAddress: { ...draft.registeredAddress, city } })}
                  />
                  <label className="block">
                    <WizardFieldLabel>PIN code</WizardFieldLabel>
                    <input
                      className={wizardInputClass}
                      value={draft.registeredAddress.pincode}
                      onChange={(e) => setDraft({ ...draft, registeredAddress: { ...draft.registeredAddress, pincode: e.target.value } })}
                      data-testid="field-address-pincode"
                    />
                  </label>
                </div>
              </WizardSection>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-space-md">
              {draft.facilities.map((f, idx) => (
                <div key={f.id} className="border border-border-subtle rounded-2xl p-space-md space-y-3 bg-surface-container-lowest/60" data-testid={`facility-${idx}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-label-md font-semibold flex items-center gap-2">
                      <Icon name="factory" size={20} className="text-primary" />
                      Facility {idx + 1}
                    </p>
                    {draft.facilities.length > 1 && (
                      <button type="button" className="font-label-sm text-error hover:underline" onClick={() => setDraft({ ...draft, facilities: draft.facilities.filter((_, i) => i !== idx) })} data-testid={`facility-remove-${idx}`}>
                        Remove
                      </button>
                    )}
                  </div>
                  <label className="block">
                    <WizardFieldLabel required>Facility name</WizardFieldLabel>
                    <input className={wizardInputClass} value={f.name} onChange={(e) => { const facilities = [...draft.facilities]; facilities[idx] = { ...f, name: e.target.value }; setDraft({ ...draft, facilities }); }} data-testid={`field-facility-name-${idx}`} />
                  </label>
                  <label className="block">
                    <WizardFieldLabel>Street address</WizardFieldLabel>
                    <input className={wizardInputClass} value={f.addressLine} onChange={(e) => { const facilities = [...draft.facilities]; facilities[idx] = { ...f, addressLine: e.target.value }; setDraft({ ...draft, facilities }); }} data-testid={`field-facility-address-${idx}`} />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StateCitySelect
                      state={f.state}
                      city={f.city}
                      stateTestId={`field-facility-state-${idx}`}
                      cityTestId={`field-facility-city-${idx}`}
                      onStateChange={(state) => {
                        const facilities = [...draft.facilities];
                        const options = citiesForState(state);
                        const city = options.includes(f.city) ? f.city : defaultCityForState(state);
                        facilities[idx] = { ...f, state, city };
                        setDraft({ ...draft, facilities });
                      }}
                      onCityChange={(city) => {
                        const facilities = [...draft.facilities];
                        facilities[idx] = { ...f, city };
                        setDraft({ ...draft, facilities });
                      }}
                    />
                    <label className="block">
                      <WizardFieldLabel>PIN code</WizardFieldLabel>
                      <input
                        className={wizardInputClass}
                        value={f.pincode}
                        onChange={(e) => {
                          const facilities = [...draft.facilities];
                          facilities[idx] = { ...f, pincode: e.target.value };
                          setDraft({ ...draft, facilities });
                        }}
                        data-testid={`field-facility-pincode-${idx}`}
                      />
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-dashed border-outline-variant px-4 py-2.5 font-label-md text-primary hover:bg-primary/5" onClick={() => setDraft({ ...draft, facilities: [...draft.facilities, createEmptyFacility()] })} data-testid="facility-add">
                <Icon name="add" size={18} />
                Add another facility
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-space-lg">
              <WizardSection title="Authorised signatory" description="Must match PAN and photo ID in Annexure 1." icon="draw">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <WizardFieldLabel required>Full name</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.authorisedSignatory.name} onChange={(e) => setDraft(patchSignatory(draft, { name: e.target.value }))} data-testid="field-signatory-name" />
                  </label>
                  <label className="block">
                    <WizardFieldLabel required>Designation</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.authorisedSignatory.role} onChange={(e) => setDraft(patchSignatory(draft, { role: e.target.value }))} data-testid="field-signatory-role" />
                  </label>
                  <label className="block">
                    <WizardFieldLabel>DIN (if director)</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.authorisedSignatory.din} onChange={(e) => setDraft(patchSignatory(draft, { din: e.target.value }))} data-testid="field-signatory-din" />
                  </label>
                  <label className="block">
                    <WizardFieldLabel>Email</WizardFieldLabel>
                    <input className={wizardInputClass} type="email" value={draft.authorisedSignatory.email} onChange={(e) => setDraft(patchSignatory(draft, { email: e.target.value }))} data-testid="field-signatory-email" />
                  </label>
                  <label className="block">
                    <WizardFieldLabel>Mobile</WizardFieldLabel>
                    <input className={wizardInputClass} type="tel" value={draft.authorisedSignatory.phone} onChange={(e) => setDraft(patchSignatory(draft, { phone: e.target.value }))} data-testid="field-signatory-phone" />
                  </label>
                </div>
              </WizardSection>
              <WizardSection title="Identity (KYC)" icon="badge">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <WizardFieldLabel required>PAN</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.authorisedSignatory.pan} onChange={(e) => setDraft(patchSignatory(draft, { pan: e.target.value.toUpperCase() }))} data-testid="field-signatory-pan" />
                  </label>
                  <label className="block">
                    <WizardFieldLabel required>Aadhaar number</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.authorisedSignatory.aadhaar} onChange={(e) => setDraft(patchSignatory(draft, { aadhaar: e.target.value }))} data-testid="field-signatory-aadhaar" />
                  </label>
                  <label className="block sm:col-span-2">
                    <WizardFieldLabel>Father&apos;s / guardian&apos;s name</WizardFieldLabel>
                    <input className={wizardInputClass} value={draft.authorisedSignatory.fatherName} onChange={(e) => setDraft(patchSignatory(draft, { fatherName: e.target.value }))} data-testid="field-signatory-father-name" />
                  </label>
                </div>
              </WizardSection>
              <WizardSection title="Residential address" icon="home">
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["line1", "line2"] as const).map((key) => (
                    <label key={key} className="block sm:col-span-3">
                      <WizardFieldLabel required={key === "line1"}>{key === "line1" ? "Address line 1" : "Address line 2"}</WizardFieldLabel>
                      <input className={wizardInputClass} value={draft.authorisedSignatory.residentialAddress[key]} onChange={(e) => setDraft(patchSignatoryAddress(draft, key, e.target.value))} data-testid={`field-signatory-address-${key}`} />
                    </label>
                  ))}
                  <StateCitySelect
                    state={draft.authorisedSignatory.residentialAddress.state}
                    city={draft.authorisedSignatory.residentialAddress.city}
                    stateTestId="field-signatory-address-state"
                    cityTestId="field-signatory-address-city"
                    onStateChange={(state) => {
                      const addr = draft.authorisedSignatory.residentialAddress;
                      const options = citiesForState(state);
                      const city = options.includes(addr.city) ? addr.city : defaultCityForState(state);
                      setDraft(patchSignatory(draft, { residentialAddress: { ...addr, state, city } }));
                    }}
                    onCityChange={(city) => setDraft(patchSignatoryAddress(draft, "city", city))}
                  />
                  <label className="block">
                    <WizardFieldLabel>PIN code</WizardFieldLabel>
                    <input
                      className={wizardInputClass}
                      value={draft.authorisedSignatory.residentialAddress.pincode}
                      onChange={(e) => setDraft(patchSignatoryAddress(draft, "pincode", e.target.value))}
                      data-testid="field-signatory-address-pincode"
                    />
                  </label>
                </div>
              </WizardSection>
              <WizardSection title="Company contact (optional)" icon="support_agent">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {(["name", "email", "phone", "role"] as const).map((key) => (
                    <label key={key} className="block">
                      <WizardFieldLabel>{key === "role" ? "Role / department" : key.charAt(0).toUpperCase() + key.slice(1)}</WizardFieldLabel>
                      <input className={wizardInputClass} value={primaryCompanyContact(draft)[key]} onChange={(e) => setDraft(withPrimaryCompanyContact(draft, { ...primaryCompanyContact(draft), [key]: e.target.value }))} data-testid={`field-company-contact-${key}`} />
                    </label>
                  ))}
                </div>
              </WizardSection>
            </div>
          )}

          {step === 3 && (
            <AnnexureDocumentsPanel
              draft={draft}
              busy={busy}
              onNotesChange={(kind, value) => setDraft(withAnnexureNote(draft, kind, value))}
              onUpload={(kind, file) => void uploadKind(kind, file)}
              onRemove={(kind) => void removeKind(kind)}
            />
          )}

          {step === 4 && (
            <div className="space-y-space-md">
              {[
                { id: "declaration" as const, label: "I declare that the information supplied is accurate for this demonstration submission.", testId: "checkbox-declaration", checked: draft.declarationAccepted, field: "declarationAccepted" as const },
                { id: "agreement" as const, label: "I accept the demonstration terms and S&L registration agreement placeholder.", testId: "checkbox-agreement", checked: draft.agreementAccepted, field: "agreementAccepted" as const },
              ].map((item) => (
                <label key={item.id} className={`flex items-start gap-3 rounded-xl border p-space-md cursor-pointer transition-colors ${item.checked ? "border-primary/40 bg-primary/5" : "border-border-subtle hover:bg-surface-container-lowest"}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={item.checked} onChange={(e) => setDraft({ ...draft, [item.field]: e.target.checked })} data-testid={item.testId} />
                  <span className="text-sm text-on-surface">{item.label}</span>
                </label>
              ))}
            </div>
          )}

          {step === 5 && (
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-surface p-space-lg space-y-space-md">
              <p className="text-base font-semibold text-on-surface" data-testid="wizard-fee">
                Registration fee: <strong>₹ {appRecord ? formatFeeInr(appRecord.payment.amountInr) : "—"}</strong> INR
              </p>
              <SimulatedPaymentNote />
              <p className="font-body-sm text-on-surface-variant">
                On submit, payment will be recorded as {LABEL_AUTO_PAYMENT.toLowerCase()} and {LABEL_AUTO_RULES.toLowerCase()} will run automatically.
              </p>
            </div>
          )}

          {step === 6 && (
            <RegistrationReviewSummary draft={draft} appRecord={appRecord} onEditStep={goToStepId} />
          )}

          <WizardNavFooter
            step={step}
            stepCount={STEPS.length}
            busy={busy}
            issuesCount={issues.length}
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
