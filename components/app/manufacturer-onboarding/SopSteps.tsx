"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { citiesForState, defaultCityForState } from "@/lib/manufacturer-onboarding/indiaLocations";
import { CATEGORY_OPTIONS, EQUIPMENT_OPTIONS, REGISTRATION_CHARGE_INR, SECURITY_DEPOSIT_LARGE_INR, TITLE_OPTIONS, inr } from "@/lib/manufacturer-onboarding/sopDefaults";
import { DOCUMENT_KIND_LABELS } from "@/lib/manufacturer-onboarding/documentKinds";
import { createEmptyFacility } from "@/lib/manufacturer-onboarding/facilityDefaults";
import type { ManufacturerContact, ManufacturerDraft, ManufacturerFacility, SopDetails } from "@/lib/manufacturer-onboarding/types";
import { StateCitySelect } from "./StateCitySelect";
import { WizardFieldLabel, WizardSection, wizardInputClass } from "./wizardChrome";

/** The steps of the registration that follow the Company Registration Form of section 1.1 of the SOP. Local demonstration, not BEE rules. */

type StepProps = { draft: ManufacturerDraft; setDraft: (d: ManufacturerDraft) => void };

function Field({ label, required, value, onChange, testId, type = "text", className = "", placeholder }: {
  label: string; required?: boolean; value: string; onChange: (v: string) => void; testId: string; type?: string; className?: string; placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <WizardFieldLabel required={required}>{label}</WizardFieldLabel>
      <input className={wizardInputClass} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

/** Choosing the scale of industry adds (small) or removes (large) the SSI certificate row of the documents step. */
function withScale(draft: ManufacturerDraft, scale: "small" | "large"): ManufacturerDraft {
  const without = draft.annexureDocuments.filter((d) => d.id !== "ssi_certificate" || d.uploadedAt);
  const has = without.some((d) => d.id === "ssi_certificate");
  const docs = scale === "small" && !has
    ? [...without, { id: "ssi_certificate", kind: DOCUMENT_KIND_LABELS.ssi_certificate, fileName: "ssi_certificate.pdf", uploadedAt: null }]
    : scale === "large" ? without : without;
  return { ...draft, sop: { ...draft.sop, scale }, annexureDocuments: docs };
}

const patchSop = (draft: ManufacturerDraft, patch: Partial<SopDetails>): ManufacturerDraft => ({ ...draft, sop: { ...draft.sop, ...patch } });
const patchBusiness = (draft: ManufacturerDraft, patch: Partial<SopDetails["business"]>): ManufacturerDraft => patchSop(draft, { business: { ...draft.sop.business, ...patch } });

/** Step 1: the disclaimer. Accepting also records the declaration and agreement the automated checks look for. */
export function DisclaimerStep({ draft, setDraft }: StepProps) {
  const accepted = draft.sop.disclaimerAccepted;
  return (
    <div className="space-y-space-md" data-testid="sop-disclaimer">
      <div className="rounded-2xl border border-border-subtle bg-surface-container-lowest p-space-lg space-y-3 text-sm text-on-surface">
        <h3 className="text-base font-bold">Disclaimer</h3>
        <p>Though all efforts have been made to ensure that the content on this portal is accurate and up-to-date, the same should not be construed as a &apos;Statement of Law&apos; or used for any legal purposes. In case of any ambiguity or doubts, users are advised to verify or check with the Department(s) and/or other source(s). BEE India accepts no responsibility in relation to the accuracy, completeness, usefulness or otherwise, of the contents.</p>
        <h3 className="text-base font-bold pt-2">Limitation of Liability</h3>
        <p>Bureau of Energy Efficiency will not be liable in relation to the contents of, or use of, or otherwise in connection with, this Portal:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>for any direct loss;</li>
          <li>for any indirect, special or consequential loss; or</li>
          <li>for any business losses, loss of revenue, income, profits or anticipated savings, loss of contracts or business relationships, loss of reputation or goodwill, or loss or corruption of information or data.</li>
        </ul>
        <p className="text-xs text-on-surface-variant">Text as in section 1.1 of the SOP for the BEE S&amp;L portal. Local demonstration.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setDraft({ ...patchSop(draft, { disclaimerAccepted: true }), declarationAccepted: true, agreementAccepted: true })} aria-pressed={accepted}
          className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-label-md font-semibold ${accepted ? "!bg-[#14532d] !text-white" : "!bg-primary !text-on-primary"}`} data-testid="disclaimer-accept">
          <Icon name={accepted ? "check_circle" : "done"} size={18} /> {accepted ? "Accepted" : "Accept"}
        </button>
        {accepted ? null : (
          <Link href="/app" className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-5 py-2.5 font-label-md font-semibold text-on-surface-variant hover:bg-surface-container-low" data-testid="disclaimer-decline">Decline</Link>
        )}
      </div>
    </div>
  );
}

/** Step 2: name of the firm, category, scale of industry, equipment and brand. */
export function CompanyStep({ draft, setDraft }: StepProps) {
  const s = draft.sop;
  return (
    <div className="space-y-space-lg" data-testid="sop-company">
      <WizardSection title="Company details" description="The name must be as mentioned in the Company Registration Certificate." icon="corporate_fare">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name of the firm" required className="sm:col-span-2" value={draft.legalName} onChange={(v) => setDraft({ ...draft, legalName: v })} testId="field-legal-name" />
          <label className="block">
            <WizardFieldLabel required>Category</WizardFieldLabel>
            <select className={wizardInputClass} value={s.category} onChange={(e) => setDraft(patchSop(draft, { category: e.target.value as SopDetails["category"] }))} data-testid="field-category">
              <option value="">Select</option>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="block">
            <WizardFieldLabel required>Scale of industry</WizardFieldLabel>
            <div className="mt-1 space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="scale" checked={s.scale === "small"} onChange={() => setDraft(withScale(draft, "small"))} data-testid="field-scale-small" /> Small-scale industry (SSI): the SSI certificate is required</label>
              <label className="flex items-center gap-2"><input type="radio" name="scale" checked={s.scale === "large"} onChange={() => setDraft(withScale(draft, "large"))} data-testid="field-scale-large" /> Large-scale industry: security deposit {inr(SECURITY_DEPOSIT_LARGE_INR)}</label>
            </div>
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-sm text-on-surface" data-testid="company-fee-note">
          Company registration charge: <b>{inr(REGISTRATION_CHARGE_INR)}</b>{s.scale === "large" ? <> plus a label security deposit of <b>{inr(SECURITY_DEPOSIT_LARGE_INR)}</b></> : s.scale === "small" ? " (no security deposit for a small-scale industry)" : ""}.
        </p>
      </WizardSection>
      <WizardSection title="Equipment details" description="The equipment and brand being registered. Each brand is treated as an individual company." icon="ac_unit">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <WizardFieldLabel required>Equipment</WizardFieldLabel>
            <select className={wizardInputClass} value={s.equipment} onChange={(e) => setDraft(patchSop(draft, { equipment: e.target.value }))} data-testid="field-equipment">
              <option value="">Select</option>
              {EQUIPMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <Field label="Brand name" required value={s.brandName} onChange={(v) => setDraft(patchSop(draft, { brandName: v }))} testId="field-brand-name" />
        </div>
      </WizardSection>
    </div>
  );
}

/** Step 3: the business address and phone details. */
export function BusinessStep({ draft, setDraft }: StepProps) {
  const addr = draft.registeredAddress;
  const b = draft.sop.business;
  return (
    <div className="space-y-space-lg" data-testid="sop-business">
      <WizardSection title="Business address" icon="home_pin">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Address line 1" required value={addr.line1} onChange={(v) => setDraft({ ...draft, registeredAddress: { ...addr, line1: v } })} testId="field-address-line1" />
          <Field label="Address line 2" value={addr.line2} onChange={(v) => setDraft({ ...draft, registeredAddress: { ...addr, line2: v } })} testId="field-address-line2" />
          <StateCitySelect
            state={addr.state}
            city={addr.city}
            stateRequired
            onStateChange={(state) => {
              const city = citiesForState(state).includes(addr.city) ? addr.city : defaultCityForState(state);
              setDraft({ ...draft, registeredAddress: { ...addr, state, city } });
            }}
            onCityChange={(city) => setDraft({ ...draft, registeredAddress: { ...addr, city } })}
          />
          <Field label="Country" value={b.country} onChange={(v) => setDraft(patchBusiness(draft, { country: v }))} testId="field-business-country" />
          <Field label="District" value={b.district} onChange={(v) => setDraft(patchBusiness(draft, { district: v }))} testId="field-business-district" />
          <Field label="Pincode" required value={addr.pincode} onChange={(v) => setDraft({ ...draft, registeredAddress: { ...addr, pincode: v } })} testId="field-address-pincode" />
        </div>
      </WizardSection>
      <WizardSection title="Phone details" icon="call">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Field label="State code" value={b.phoneStd} onChange={(v) => setDraft(patchBusiness(draft, { phoneStd: v }))} testId="field-business-phone-std" />
            <Field label="Phone no." value={b.phone} onChange={(v) => setDraft(patchBusiness(draft, { phone: v }))} testId="field-business-phone" />
          </div>
          <Field label="Mobile no." required type="tel" value={b.mobile} onChange={(v) => setDraft(patchBusiness(draft, { mobile: v }))} testId="field-business-mobile" />
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Field label="State code" value={b.faxStd} onChange={(v) => setDraft(patchBusiness(draft, { faxStd: v }))} testId="field-business-fax-std" />
            <Field label="Fax no." value={b.fax} onChange={(v) => setDraft(patchBusiness(draft, { fax: v }))} testId="field-business-fax" />
          </div>
          <Field label="Website" value={b.website} onChange={(v) => setDraft(patchBusiness(draft, { website: v }))} testId="field-business-website" />
          <Field label="Email" required type="email" value={b.email} onChange={(v) => setDraft(patchBusiness(draft, { email: v }))} testId="field-business-email" />
        </div>
      </WizardSection>
    </div>
  );
}

/** Step 4: manufacturing facilities, each with its ISO 9001 validity, and "same as business address". */
export function FacilitiesStep({ draft, setDraft }: StepProps) {
  const update = (idx: number, patch: Partial<ManufacturerFacility>) => {
    const facilities = [...draft.facilities];
    facilities[idx] = { ...facilities[idx], ...patch };
    setDraft({ ...draft, facilities });
  };
  const sameAsBusiness = (idx: number, on: boolean) => {
    const a = draft.registeredAddress;
    const b = draft.sop.business;
    update(idx, on
      ? { sameAsBusiness: true, name: draft.facilities[idx].name || draft.legalName, addressLine: a.line1, addressLine2: a.line2, city: a.city, state: a.state, pincode: a.pincode, district: b.district, phone: b.phone, mobile: b.mobile, fax: b.fax, email: b.email, website: b.website }
      : { sameAsBusiness: false });
  };
  return (
    <div className="space-y-space-md" data-testid="sop-facilities">
      {draft.facilities.map((f, idx) => (
        <div key={f.id} className="border border-border-subtle rounded-2xl p-space-md space-y-3 bg-surface-container-lowest/60" data-testid={`facility-${idx}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-label-md font-semibold flex items-center gap-2"><Icon name="factory" size={20} className="text-primary" /> Manufacturing facility {idx + 1}</p>
            {draft.facilities.length > 1 ? (
              <button type="button" className="font-label-sm text-error hover:underline" onClick={() => setDraft({ ...draft, facilities: draft.facilities.filter((_, i) => i !== idx) })} data-testid={`facility-remove-${idx}`}>Remove</button>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sameAsBusiness === true} onChange={(e) => sameAsBusiness(idx, e.target.checked)} data-testid={`facility-same-${idx}`} /> Click here if same as business address</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name of the company" required className="sm:col-span-2" value={f.name} onChange={(v) => update(idx, { name: v })} testId={`field-facility-name-${idx}`} />
            <Field label="Address line 1" required value={f.addressLine} onChange={(v) => update(idx, { addressLine: v })} testId={`field-facility-address-${idx}`} />
            <Field label="Address line 2" value={f.addressLine2 ?? ""} onChange={(v) => update(idx, { addressLine2: v })} testId={`field-facility-address2-${idx}`} />
            <StateCitySelect state={f.state} city={f.city} stateRequired stateTestId={`field-facility-state-${idx}`} cityTestId={`field-facility-city-${idx}`}
              onStateChange={(state) => update(idx, { state, city: citiesForState(state).includes(f.city) ? f.city : defaultCityForState(state) })} onCityChange={(city) => update(idx, { city })} />
            <Field label="District" value={f.district ?? ""} onChange={(v) => update(idx, { district: v })} testId={`field-facility-district-${idx}`} />
            <Field label="Pincode" required value={f.pincode} onChange={(v) => update(idx, { pincode: v })} testId={`field-facility-pincode-${idx}`} />
            <Field label="Phone no." value={f.phone ?? ""} onChange={(v) => update(idx, { phone: v })} testId={`field-facility-phone-${idx}`} />
            <Field label="Mobile no." required type="tel" value={f.mobile ?? ""} onChange={(v) => update(idx, { mobile: v })} testId={`field-facility-mobile-${idx}`} />
            <Field label="Fax no." value={f.fax ?? ""} onChange={(v) => update(idx, { fax: v })} testId={`field-facility-fax-${idx}`} />
            <Field label="Email" required type="email" value={f.email ?? ""} onChange={(v) => update(idx, { email: v })} testId={`field-facility-email-${idx}`} />
            <Field label="Website" value={f.website ?? ""} onChange={(v) => update(idx, { website: v })} testId={`field-facility-website-${idx}`} />
            <Field label="Quality management system certificate (ISO 9001) valid till" type="date" value={f.qmsValidTill ?? ""} onChange={(v) => update(idx, { qmsValidTill: v })} testId={`field-facility-qms-${idx}`} />
          </div>
        </div>
      ))}
      <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-dashed border-outline-variant px-4 py-2.5 font-label-md text-primary hover:bg-primary/5" onClick={() => setDraft({ ...draft, facilities: [...draft.facilities, createEmptyFacility()] })} data-testid="facility-add">
        <Icon name="add" size={18} /> Add manufacturing facility
      </button>
    </div>
  );
}

const fullName = (c: ManufacturerContact) => [c.firstName, c.middleName, c.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

/** Contact persons. The first one is also recorded as the authorised signatory, which the automated checks look for. */
function withContacts(draft: ManufacturerDraft, contacts: ManufacturerContact[]): ManufacturerDraft {
  const first = contacts[0];
  return {
    ...draft,
    contacts,
    authorisedSignatory: first
      ? { ...draft.authorisedSignatory, name: first.name, role: first.role, email: first.email, phone: first.mobile || first.phone }
      : draft.authorisedSignatory,
  };
}

const emptyContact = (): ManufacturerContact => ({ name: "", email: "", phone: "", role: "", title: "", firstName: "", middleName: "", lastName: "", mobile: "", fax: "" });

/** Step 5: contact persons (title, names, designation, email, phone, mobile, fax). */
export function ContactsStep({ draft, setDraft }: StepProps) {
  const contacts = draft.contacts.length ? draft.contacts : [emptyContact()];
  const update = (idx: number, patch: Partial<ManufacturerContact>) => {
    const next = [...contacts];
    const merged = { ...next[idx], ...patch };
    next[idx] = { ...merged, name: fullName(merged) || merged.name };
    setDraft(withContacts(draft, next));
  };
  return (
    <div className="space-y-space-md" data-testid="sop-contacts">
      {contacts.map((c, idx) => (
        <WizardSection key={idx} title={idx === 0 ? "Contact person 1 (authorised signatory)" : `Contact person ${idx + 1}`} icon="person">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <WizardFieldLabel required>Title</WizardFieldLabel>
              <select className={wizardInputClass} value={c.title ?? ""} onChange={(e) => update(idx, { title: e.target.value })} data-testid={`field-contact-title-${idx}`}>
                <option value="">Select title</option>{TITLE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <Field label="First name" required value={c.firstName ?? ""} onChange={(v) => update(idx, { firstName: v })} testId={`field-contact-first-${idx}`} />
            <Field label="Middle name" value={c.middleName ?? ""} onChange={(v) => update(idx, { middleName: v })} testId={`field-contact-middle-${idx}`} />
            <Field label="Last name" required value={c.lastName ?? ""} onChange={(v) => update(idx, { lastName: v })} testId={`field-contact-last-${idx}`} />
            <Field label="Designation" required value={c.role} onChange={(v) => update(idx, { role: v })} testId={`field-contact-designation-${idx}`} />
            <Field label="Email" required type="email" value={c.email} onChange={(v) => update(idx, { email: v })} testId={`field-contact-email-${idx}`} />
            <Field label="Phone no." value={c.phone} onChange={(v) => update(idx, { phone: v })} testId={`field-contact-phone-${idx}`} />
            <Field label="Mobile no." required type="tel" value={c.mobile ?? ""} onChange={(v) => update(idx, { mobile: v })} testId={`field-contact-mobile-${idx}`} />
            <Field label="Fax no." value={c.fax ?? ""} onChange={(v) => update(idx, { fax: v })} testId={`field-contact-fax-${idx}`} />
          </div>
          {idx > 0 ? <button type="button" className="mt-2 font-label-sm text-error hover:underline" onClick={() => setDraft(withContacts(draft, contacts.filter((_, i) => i !== idx)))}>Remove this contact person</button> : null}
        </WizardSection>
      ))}
      <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-dashed border-outline-variant px-4 py-2.5 font-label-md text-primary hover:bg-primary/5" onClick={() => setDraft(withContacts(draft, [...contacts, emptyContact()]))} data-testid="contact-add">
        <Icon name="add" size={18} /> Add another contact person
      </button>
    </div>
  );
}

/** Step 6: company registration and financial details; CIN, GSTIN and the signatory's KYC are optional extras. */
export function RegistrationDetailsStep({ draft, setDraft }: StepProps) {
  const s = draft.sop;
  const sig = draft.authorisedSignatory;
  return (
    <div className="space-y-space-lg" data-testid="sop-registration">
      <WizardSection title="Company registration / financial details" icon="badge">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company registration no." required value={s.companyRegNo} onChange={(v) => setDraft(patchSop(draft, { companyRegNo: v }))} testId="field-company-reg-no" />
          <Field label="Company registration date" required type="date" value={s.companyRegDate} onChange={(v) => setDraft(patchSop(draft, { companyRegDate: v }))} testId="field-company-reg-date" />
          <Field label="Company's PAN" required value={s.companyPan} onChange={(v) => setDraft(patchSop(draft, { companyPan: v.toUpperCase() }))} testId="field-company-pan" />
          <Field label="Annual turnover (in lakhs, ₹)" required type="number" value={s.annualTurnoverLakhs} onChange={(v) => setDraft(patchSop(draft, { annualTurnoverLakhs: v }))} testId="field-turnover" />
        </div>
      </WizardSection>
      <details className="rounded-2xl border border-border-subtle p-space-md" data-testid="optional-details">
        <summary className="cursor-pointer font-label-md font-semibold text-primary">Additional optional details (CIN, GSTIN and signatory KYC)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="CIN" value={draft.cin} onChange={(v) => setDraft({ ...draft, cin: v })} testId="field-cin" />
          <Field label="GSTIN" value={draft.gstin} onChange={(v) => setDraft({ ...draft, gstin: v })} testId="field-gstin" />
          <Field label="Signatory DIN (if a director)" value={sig.din} onChange={(v) => setDraft({ ...draft, authorisedSignatory: { ...sig, din: v } })} testId="field-signatory-din" />
          <Field label="Signatory Aadhaar number" value={sig.aadhaar} onChange={(v) => setDraft({ ...draft, authorisedSignatory: { ...sig, aadhaar: v } })} testId="field-signatory-aadhaar" />
          <Field label="Signatory father's / guardian's name" className="sm:col-span-2" value={sig.fatherName} onChange={(v) => setDraft({ ...draft, authorisedSignatory: { ...sig, fatherName: v } })} testId="field-signatory-father-name" />
        </div>
      </details>
    </div>
  );
}

