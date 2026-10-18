/** Typed manufacturer/company onboarding records — consumed via the client adapter, not raw fixtures. */

export const ONBOARDING_DISCLOSURE =
  "Optimized demonstration workflow based on the S&L registration requirements. Automatic processing and the post-approval observation policy are owner-approved assumptions pending formal BEE confirmation.";

export const DEMO_APPLICANT_IDENTITY = {
  username: "onboarding.applicant",
  password: "demo123",
  label: "Aarav onboarding applicant (synthetic demo identity)",
} as const;

export type ManufacturerOnboardingRole = "applicant" | "director" | "finance" | "programme";

export type ManufacturerLifecyclePhase =
  | "draft"
  | "awaiting_director"
  | "active_observation"
  | "hold_anomaly"
  | "observation_completed"
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
  syntheticDemo: true;
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
  "id" | "reference" | "phase" | "draft" | "registrationNumber" | "syntheticDemo"
> & { legalName: string };

export type SaveDraftInput = {
  id: string;
  draft: ManufacturerDraft;
};

export type SubmitApplicationInput = { id: string };

export type DirectorDecisionInput = { id: string; note?: string };

export type DirectorRejectInput = { id: string; reason: string };

export type RaiseAnomalyInput = {
  applicationId: string;
  summary: string;
  raisedByRole: Exclude<ManufacturerOnboardingRole, "applicant">;
};

export type DirectorResolveInput = { applicationId: string; note: string };

export type DirectorRevokeInput = { applicationId: string; reason: string };
