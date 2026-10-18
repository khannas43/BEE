/** Typed manufacturer/company onboarding records — consumed via the client adapter, not raw fixtures. */

export const ONBOARDING_DISCLOSURE =
  "Optimized demonstration workflow based on the S&L registration requirements. Automatic processing and the post-approval observation policy are owner-approved assumptions pending formal BEE confirmation.";

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
};

export type ManufacturerContact = {
  name: string;
  email: string;
  phone: string;
  role: string;
};

export type AnnexureDocument = {
  id: string;
  kind: string;
  fileName: string;
  uploadedAt: string | null;
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
  authorisedSignatory: ManufacturerContact;
  annexureDocuments: AnnexureDocument[];
  declarationAccepted: boolean;
  agreementAccepted: boolean;
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

export type SubmitApplicationInput = CommandIdempotency & { id: string; version: number };

export type DirectorDecisionInput = CommandIdempotency & { id: string; version: number; note?: string };

export type DirectorRejectInput = CommandIdempotency & { id: string; version: number; reason: string };

export type RaiseAnomalyInput = CommandIdempotency & {
  applicationId: string;
  version: number;
  summary: string;
};

export type DirectorResolveInput = CommandIdempotency & { applicationId: string; version: number; note: string };

export type DirectorRevokeInput = CommandIdempotency & { applicationId: string; version: number; reason: string };
