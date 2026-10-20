"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnnexureDocumentsPanel } from "@/components/app/manufacturer-onboarding/AnnexureDocumentsPanel";
import { BusinessStep, CompanyStep, ContactsStep, DisclaimerStep, FacilitiesStep, RegistrationDetailsStep } from "@/components/app/manufacturer-onboarding/SopSteps";
import { WizardSection } from "@/components/app/manufacturer-onboarding/wizardChrome";
import { getCaptcha, errorText, submitForm, type Captcha } from "@/lib/client/agencyRegistration";
import { DOCUMENT_KIND_LABELS, REGISTRATION_DOCUMENT_KINDS, type ManufacturerOnboardingDocumentKind } from "@/lib/manufacturer-onboarding/documentKinds";
import { createEmptyFacility } from "@/lib/manufacturer-onboarding/facilityDefaults";
import { emptySop, feeLines, feeTotal, inr } from "@/lib/manufacturer-onboarding/sopDefaults";
import type { ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";
import { registrationIssues } from "@/lib/manufacturer-onboarding/validation";

/** Public Company Registration Form (SOP 1.1, option B): no account; submitting gives a Reference ID, the fee is paid afterwards. Local demonstration. */
const initial = (): ManufacturerDraft => ({
  legalName: "", cin: "", gstin: "", registeredAddress: { line1: "", line2: "", city: "", state: "", pincode: "" },
  facilities: [createEmptyFacility()], contacts: [],
  authorisedSignatory: { name: "", email: "", phone: "", role: "", pan: "", aadhaar: "", fatherName: "", din: "", residentialAddress: { line1: "", line2: "", city: "", state: "", pincode: "" } },
  annexureDocuments: [], annexureNotes: {}, applicantAccount: null, declarationAccepted: false, agreementAccepted: false, sop: emptySop(),
});

export default function AgencyRegistrationPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ManufacturerDraft>(initial);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const refreshCaptcha = useCallback(async () => {
    const r = await getCaptcha();
    if (r.ok) { setCaptcha(r.value); setAnswer(""); }
  }, []);
  useEffect(() => { let live = true; void getCaptcha().then((r) => { if (live && r.ok) setCaptcha(r.value); }); return () => { live = false; }; }, []);

  const kinds = useMemo(() => REGISTRATION_DOCUMENT_KINDS.filter((k) => k !== "ssi_certificate" || draft.sop.scale === "small"), [draft.sop.scale]);
  const shown: ManufacturerDraft = useMemo(() => ({
    ...draft,
    annexureDocuments: kinds.map((k) => ({ id: k, kind: DOCUMENT_KIND_LABELS[k], fileName: files[k]?.name ?? "", uploadedAt: files[k] ? "now" : null, expiresOn: expiry[k] })),
  }), [draft, kinds, files, expiry]);
  const setShown = (d: ManufacturerDraft) => setDraft({ ...d, annexureDocuments: [] });

  const scale = draft.sop.scale;
  const issues = registrationIssues(shown, { paymentRequired: false });

  async function submit() {
    setError(null);
    setProblems(issues);
    if (issues.length) return setError("Complete the details listed below.");
    if (!captcha || !answer.trim()) return setError("Type the characters shown in the picture.");
    setBusy(true);
    const out = await submitForm({ ...shown, annexureDocuments: [] }, files, expiry, { id: captcha.id, answer });
    setBusy(false);
    if (!out.ok) {
      setError(errorText(out.error));
      const d = out.detail as { issues?: string[] } | null;
      if (d?.issues) setProblems(d.issues);
      void refreshCaptcha();
      return;
    }
    try { sessionStorage.setItem("agency-registration", JSON.stringify(out.value)); } catch { /* the page still works from the Reference ID */ }
    router.push("/register/agency/submitted");
  }

  return (
    <main className="mx-auto max-w-5xl space-y-space-lg p-space-md lg:p-space-lg" data-testid="agency-registration">
      <header className="space-y-1">
        <p className="text-xs font-label-sm uppercase tracking-[0.1em] text-primary">Bureau of Energy Efficiency</p>
        <div role="heading" aria-level={1} className="text-2xl font-extrabold text-on-surface">Agency registration</div>
        <p className="text-sm text-on-surface-variant">Fill in the Company Registration Form. You get a Reference ID when you submit. The registration fee is paid afterwards from <Link href="/register/agency/pay" className="font-semibold text-primary underline" data-testid="goto-pay">Pay Registration Fee</Link>, and the sign-in details are sent once it is paid.</p>
      </header>

      <WizardSection title="Disclaimer" icon="gavel"><DisclaimerStep draft={draft} setDraft={setShown} /></WizardSection>
      {draft.sop.disclaimerAccepted ? (
        <>
          <WizardSection title="Company details" icon="business"><CompanyStep draft={draft} setDraft={setShown} /></WizardSection>
          <WizardSection title="Business address and contact" icon="location_on"><BusinessStep draft={draft} setDraft={setShown} /></WizardSection>
          <WizardSection title="Facilities" icon="factory"><FacilitiesStep draft={draft} setDraft={setShown} /></WizardSection>
          <WizardSection title="Contact persons" icon="person"><ContactsStep draft={draft} setDraft={setShown} /></WizardSection>
          <WizardSection title="Registration details" icon="badge"><RegistrationDetailsStep draft={draft} setDraft={setShown} /></WizardSection>
          <WizardSection title="Documents" icon="folder_open">
            <AnnexureDocumentsPanel
              draft={shown} busy={busy} validity={expiry}
              onValidityChange={(k, v) => setExpiry((e) => ({ ...e, [k]: v }))}
              onNotesChange={(k, v) => setDraft((d) => ({ ...d, annexureNotes: { ...d.annexureNotes, [k]: v } }))}
              onUpload={(k, f) => setFiles((x) => ({ ...x, [k]: f }))}
              onRemove={(k: ManufacturerOnboardingDocumentKind) => setFiles((x) => Object.fromEntries(Object.entries(x).filter(([key]) => key !== k)))}
            />
          </WizardSection>
          <WizardSection title="Fee to be paid after submitting" icon="payments">
            {scale ? (
              <div data-testid="agency-fee">
                <ul className="text-sm">{feeLines(scale).map((l) => <li key={l.label} className="flex justify-between border-b border-border-subtle py-1"><span>{l.label}</span><b>{inr(l.amountInr)}</b></li>)}</ul>
                <p className="mt-2 flex justify-between text-sm font-bold"><span>Total</span><span>{inr(feeTotal(scale))}</span></p>
              </div>
            ) : <p className="text-sm text-on-surface-variant">Choose the scale of industry to see the fee.</p>}
          </WizardSection>
          <WizardSection title="Submit" icon="send">
            <div className="flex flex-wrap items-end gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {captcha ? <img src={captcha.image} alt="Characters to type" width={150} height={44} className="rounded border border-outline-variant" data-testid="captcha-image" /> : null}
              <button type="button" onClick={() => void refreshCaptcha()} className="text-sm font-semibold text-primary underline">New picture</button>
              <label className="block text-sm">Type the characters
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" className="mt-1 block w-44 rounded-lg border border-outline-variant px-3 py-2" data-testid="captcha-answer" />
              </label>
              <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg !bg-primary px-6 py-2.5 font-label-md font-semibold !text-on-primary disabled:opacity-60" data-testid="agency-submit">{busy ? "Submitting…" : "Submit"}</button>
            </div>
            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-error" data-testid="agency-error">{error}</p> : null}
            {problems.length ? <ul className="mt-2 list-disc pl-5 text-sm text-error" data-testid="agency-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
          </WizardSection>
        </>
      ) : null}
    </main>
  );
}
