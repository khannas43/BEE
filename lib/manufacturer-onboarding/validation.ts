import { REGISTRATION_DOCUMENT_KINDS } from "./documentKinds";
import type { ManufacturerDraft } from "./types";

/** What must be in place before the registration can be submitted (the SOP's required fields, documents and the payment). */
export function registrationIssues(draft: ManufacturerDraft, options: { paymentRequired?: boolean } = {}): string[] {
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
  if (options.paymentRequired !== false && !sop.payment.status) issues.push("The payment of the registration charge and security deposit must be completed.");
  return issues;
}

