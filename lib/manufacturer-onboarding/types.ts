/** Typed manufacturer/company onboarding records — consumed via the client adapter, not raw fixtures. */

export const ONBOARDING_DISCLOSURE =
  "Optimized demonstration workflow based on the S&L registration requirements. New manufacturer applications wait for Director activation; payment and eligibility checks remain automatic. The 15-day observation policy is an owner-approved assumption pending formal BEE confirmation.";

export const DEMO_APPLICANT_IDENTITY = {
  username: "onboarding.applicant",
  password: "demo123",
  label: "Aarav onboarding applicant (synthetic demo identity — seeded by Agent A for the urgent demo)",
} as const;

export type ManufacturerOnboardingRole = "applicant" | "director" | "finance" | "programme";

export type ManufacturerLifecyclePhase =
  | "draft"
  | "submitted"
  | "automatic_checks_failed"
  | "director_review"
  | "returned"
  | "active_observation"
  | "active"
  | "on_hold"
  | "rejected"
  | "revoked";

export type ManufacturerFacility = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  /** The SOP's facility form: the same address as the business address, a second address line, district, contact details and the ISO 9001 validity. */
  sameAsBusiness?: boolean;
  addressLine2?: string;
  district?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  email?: string;
  website?: string;
  qmsValidTill?: string;
};

export type ManufacturerContact = {
  name: string;
  email: string;
  phone: string;
  role: string;
  /** The SOP's contact person: title, first, middle and last name, designation, mobile and fax. `name` is the full name. */
  title?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  mobile?: string;
  fax?: string;
};

/** Section 1.1 of the SOP for the BEE S&L portal: the fields of the Company Registration Form that the earlier wizard did not have. */
export type SopDetails = {
  disclaimerAccepted: boolean;
  category: "" | "manufacturer" | "importer";
  /** Small-scale industry (SSI certificate, no security deposit) or large-scale industry (security deposit). */
  scale: "" | "small" | "large";
  equipment: string;
  brandName: string;
  business: { country: string; district: string; phoneStd: string; phone: string; mobile: string; faxStd: string; fax: string; website: string; email: string };
  companyRegNo: string;
  companyRegDate: string;
  companyPan: string;
  annualTurnoverLakhs: string;
  /** The payment of the registration charge and security deposit (simulated; nothing real moves). */
  payment: {
    method: "" | "billdesk" | "razorpay" | "direct_transfer";
    status: "" | "paid" | "awaiting_confirmation";
    receipt: string;
    recordedAt: string;
    transfer: { bank: string; transactionId: string; paymentDate: string; remarks: string };
  };
};

/** Demo registration: stored in `draft_payload` for the presenter (Keycloak still uses seeded users). */
export type ApplicantAccountRecord = {
  username: string;
  password: string;
};

/** Authorised signatory on Form I / Annexure 1 — persisted in draft JSON. */
export type AuthorisedSignatory = {
  name: string;
  email: string;
  phone: string;
  /** Designation in the company (stored as `designation` in Spring draft JSON). */
  role: string;
  pan: string;
  aadhaar: string;
  fatherName: string;
  /** Director Identification Number, if applicable. */
  din: string;
  residentialAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
  };
};

export type AnnexureDocument = {
  id: string;
  kind: string;
  fileName: string;
  uploadedAt: string | null;
  /** Applicant-provided label (also stored in draft `annexureNotes`). */
  customLabel?: string;
  /** "Valid till" date of the latest version, when the SOP asks for it. */
  expiresOn?: string;
};

export type ManufacturerDraft = {
  legalName: string;
  cin: string;
  gstin: string;
  registeredAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
  };
  facilities: ManufacturerFacility[];
  contacts: ManufacturerContact[];
  authorisedSignatory: AuthorisedSignatory;
  annexureDocuments: AnnexureDocument[];
  /** Optional display names per document kind (Spring draft `annexureNotes`). */
  annexureNotes: Record<string, string>;
  applicantAccount: ApplicantAccountRecord | null;
  declarationAccepted: boolean;
  agreementAccepted: boolean;
  sop: SopDetails;
};

export type PaymentSummary = {
  feeLabel: string;
  amountInr: string;
  currency: "INR";
  /** Demo-only simulated gateway */
  gatewayMode: "simulated_demo";
  receiptNumber: string | null;
  verifiedAt: string | null;
};

export type AutomatedCheck = {
  id: string;
  label: string;
  outcome: "pass" | "fail" | "pending";
  completedAt: string | null;
  detail: string;
};

export type TimelineEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  icon: string;
};

export type AnomalyRecord = {
  id: string;
  raisedAt: string;
  /** Derived server-side from the authenticated session (display only). */
  raisedByRole: Exclude<ManufacturerOnboardingRole, "applicant">;
  summary: string;
  holdAppliedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

export type ManufacturerApplication = {
  id: string;
  reference: string;
  /** Optimistic-lock version from Spring — required on every PATCH and command. */
  version: number;
  syntheticDemo: boolean;
  companyCode: string;
  phase: ManufacturerLifecyclePhase;
  draft: ManufacturerDraft;
  payment: PaymentSummary;
  automatedChecks: AutomatedCheck[];
  timeline: TimelineEvent[];
  directorDecisionAt: string | null;
  directorDecisionNote: string | null;
  registrationNumber: string | null;
  activatedAt: string | null;
  observationStartedAt: string | null;
  observationEndsAt: string | null;
  anomalies: AnomalyRecord[];
  applicantAccountId: string;
};

export type ManufacturerApplicationSummary = Pick<
  ManufacturerApplication,
  "id" | "reference" | "phase" | "version" | "draft" | "registrationNumber" | "syntheticDemo"
> & { legalName: string };

export type CommandIdempotency = { idempotencyKey?: string };

export type SaveDraftInput = CommandIdempotency & {
  id: string;
  version: number;
  draft: ManufacturerDraft;
};

export type UploadDocumentInput = CommandIdempotency & {
  applicationId: string;
  documentKind: string;
  label: string;
  file: File;
  issueOn?: string;
  expiresOn?: string;
};

export type RemoveDocumentInput = {
  applicationId: string;
  documentKind: string;
};

export type SubmitApplicationInput = CommandIdempotency & { id: string; version: number };

export type DirectorDecisionInput = CommandIdempotency & { id: string; version: number; note?: string };

export type DirectorRejectInput = CommandIdempotency & { id: string; version: number; reason: string };

export type DirectorReturnInput = CommandIdempotency & { id: string; version: number; reason: string };

export type RaiseAnomalyInput = CommandIdempotency & {
  applicationId: string;
  version: number;
  summary: string;
};

export type DirectorResolveInput = CommandIdempotency & { applicationId: string; version: number; note: string };

export type DirectorRevokeInput = CommandIdempotency & { applicationId: string; version: number; reason: string };
