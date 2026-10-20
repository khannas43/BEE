/**
 * Initial fixture records for the optimized manufacturer onboarding demo.
 * Imported only by the fixture client — components must use ManufacturerOnboardingClient.
 */
import { emptySop } from "./sopDefaults";
import { annexureDocumentsFromHeads, MANUFACTURER_ONBOARDING_DOCUMENT_KINDS } from "./documentKinds";
import {
  PROVISIONAL_COMPANY_REGISTRATION_FEE_INR,
  PROVISIONAL_COMPANY_REGISTRATION_FEE_LABEL,
} from "./fees";
import { observationWindowFromApproval } from "./observation";
import type { ManufacturerApplication } from "./types";

const baseDraft = {
  legalName: "Aarav Appliances Pvt Ltd",
  cin: "U29300MH2018PTC312045",
  gstin: "27AABCA1234F1Z5",
  registeredAddress: {
    line1: "Plot 14, MIDC Industrial Area",
    line2: "Andheri East",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400093",
  },
  facilities: [
    {
      id: "fac-1",
      name: "Andheri assembly unit",
      addressLine: "Plot 14, MIDC",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400093",
    },
  ],
  contacts: [
    { name: "Priya Nair", email: "priya.nair@aarav-demo.invalid", phone: "+91 98200 11223", role: "Compliance lead" },
  ],
  authorisedSignatory: {
    name: "Rahul Aarav",
    email: "rahul.aarav@aarav-demo.invalid",
    phone: "+91 98190 44556",
    role: "Managing Director",
    pan: "AABCA1234F",
    aadhaar: "1234 5678 9012",
    fatherName: "Vikram Aarav",
    din: "01234567",
    residentialAddress: {
      line1: "Flat 12, Oberoi Springs",
      line2: "Goregaon East",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400063",
    },
  },
  annexureDocuments: annexureDocumentsFromHeads(
    MANUFACTURER_ONBOARDING_DOCUMENT_KINDS.map((documentKind, i) => ({
      documentKind,
      latestVersion: 1,
      status: i < 3 ? "uploaded" : "missing",
    })),
  ),
  annexureNotes: {},
  applicantAccount: null,
  declarationAccepted: true,
  agreementAccepted: true, sop: emptySop(),
};

export function buildPaymentBase() {
  return {
    feeLabel: PROVISIONAL_COMPANY_REGISTRATION_FEE_LABEL,
    amountInr: PROVISIONAL_COMPANY_REGISTRATION_FEE_INR,
    currency: "INR" as const,
    gatewayMode: "simulated_demo" as const,
  };
}

function checksComplete(at: string) {
  return [
    {
      id: "chk-docs",
      label: "Annexure 1 document completeness",
      outcome: "pass" as const,
      completedAt: at,
      detail: "Required Annexure 1 uploads present for demonstration.",
    },
    {
      id: "chk-elig",
      label: "Eligibility rules (demonstration ruleset)",
      outcome: "pass" as const,
      completedAt: at,
      detail: "Automated rules check completed against the demonstration policy pack.",
    },
  ];
}

function checksFailed(at: string) {
  return [
    {
      id: "chk-docs",
      label: "Annexure 1 document completeness",
      outcome: "fail" as const,
      completedAt: at,
      detail: "Factory licence upload could not be matched to the declared facility (demonstration failure).",
    },
    {
      id: "chk-elig",
      label: "Eligibility rules (demonstration ruleset)",
      outcome: "pass" as const,
      completedAt: at,
      detail: "Eligibility rules passed; document check failed.",
    },
  ];
}

export const FIXTURE_APPLICATION_IDS = {
  draft: "00000000-0000-4000-d000-000000000001",
  director: "00000000-0000-4000-d000-000000000002",
  observation: "00000000-0000-4000-d000-000000000003",
  hold: "00000000-0000-4000-d000-000000000004",
  resolved: "00000000-0000-4000-d000-000000000005",
  revoked: "00000000-0000-4000-d000-000000000006",
  checksFailed: "00000000-0000-4000-d000-000000000007",
} as const;

export function buildFixtureApplications(): ManufacturerApplication[] {
  const paymentBase = buildPaymentBase();
  const submittedAt = "2026-10-08T09:00:00.000Z";
  const verifiedAt = "2026-10-08T09:01:12.000Z";
  const checksAt = "2026-10-08T09:02:30.000Z";
  const approvedAt = "2026-10-09T11:00:00.000Z";
  const obs103 = observationWindowFromApproval(approvedAt);
  const approvedHold = "2026-10-09T12:00:00.000Z";
  const obs104 = observationWindowFromApproval(approvedHold);
  const approvedResolved = "2026-09-19T11:00:00.000Z";
  const obs105 = observationWindowFromApproval(approvedResolved);
  const approvedRevoked = "2026-10-09T13:00:00.000Z";
  const obs106 = observationWindowFromApproval(approvedRevoked);

  return [
    {
      id: FIXTURE_APPLICATION_IDS.draft,
      reference: "MFG-ONB-2026-DRAFT",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "draft",
      draft: { ...baseDraft, declarationAccepted: false, agreementAccepted: false },
      payment: { ...paymentBase, receiptNumber: null, verifiedAt: null },
      automatedChecks: [],
      timeline: [{ id: "t1", at: "2026-10-07T08:00:00.000Z", title: "Draft started", detail: "Applicant saved the company registration wizard.", icon: "edit_note" }],
      directorDecisionAt: null,
      directorDecisionNote: null,
      registrationNumber: null,
      activatedAt: null,
      observationStartedAt: null,
      observationEndsAt: null,
      anomalies: [],
      applicantAccountId: "onboarding.applicant",
    },
    {
      id: FIXTURE_APPLICATION_IDS.director,
      reference: "MFG-ONB-2026-0102",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "director_review",
      draft: baseDraft,
      payment: { ...paymentBase, receiptNumber: "DEMO-RCP-2026-8812", verifiedAt: verifiedAt },
      automatedChecks: checksComplete(checksAt),
      timeline: [
        { id: "t1", at: submittedAt, title: "Registration submitted", detail: "Company registration submitted by the applicant.", icon: "send" },
        { id: "t2", at: verifiedAt, title: "Payment recorded", detail: "Simulated gateway payment captured for demonstration.", icon: "payments" },
        { id: "t3", at: checksAt, title: "Automated checks completed", detail: "Document and eligibility checks completed automatically.", icon: "rule" },
        { id: "t4", at: checksAt, title: "Awaiting Director decision", detail: "Manufacturer remains inactive until Director approval.", icon: "pending_actions" },
      ],
      directorDecisionAt: null,
      directorDecisionNote: null,
      registrationNumber: null,
      activatedAt: null,
      observationStartedAt: null,
      observationEndsAt: null,
      anomalies: [],
      applicantAccountId: "onboarding.applicant",
    },
    {
      id: FIXTURE_APPLICATION_IDS.checksFailed,
      reference: "MFG-ONB-2026-0107",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "automatic_checks_failed",
      draft: baseDraft,
      payment: { ...paymentBase, receiptNumber: "DEMO-RCP-2026-8817", verifiedAt: verifiedAt },
      automatedChecks: checksFailed(checksAt),
      timeline: [
        { id: "t1", at: submittedAt, title: "Registration submitted", detail: "Submitted for automated processing.", icon: "send" },
        { id: "t2", at: verifiedAt, title: "Payment recorded", detail: "Simulated gateway payment captured.", icon: "payments" },
        { id: "t3", at: checksAt, title: "Automated checks failed", detail: "Applicant must correct documents and resubmit.", icon: "error" },
      ],
      directorDecisionAt: null,
      directorDecisionNote: null,
      registrationNumber: null,
      activatedAt: null,
      observationStartedAt: null,
      observationEndsAt: null,
      anomalies: [],
      applicantAccountId: "onboarding.applicant",
    },
    {
      id: FIXTURE_APPLICATION_IDS.observation,
      reference: "MFG-ONB-2026-0103",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "active_observation",
      draft: baseDraft,
      payment: { ...paymentBase, receiptNumber: "DEMO-RCP-2026-8813", verifiedAt: verifiedAt },
      automatedChecks: checksComplete(checksAt),
      timeline: [
        { id: "t1", at: submittedAt, title: "Registration submitted", detail: "Company registration submitted.", icon: "send" },
        { id: "t2", at: verifiedAt, title: "Payment recorded", detail: "Simulated gateway payment captured.", icon: "payments" },
        { id: "t3", at: checksAt, title: "Automated checks completed", detail: "Rules check completed.", icon: "rule" },
        { id: "t4", at: approvedAt, title: "Automatic activation", detail: "Payment and automated checks passed.", icon: "bolt" },
        { id: "t5", at: obs103.observationStartedAt, title: "Observation started", detail: "15-day observation window opened.", icon: "schedule" },
      ],
      directorDecisionAt: null,
      directorDecisionNote: null,
      registrationNumber: "BEE/MFG/2026/AARAV-103",
      activatedAt: approvedAt,
      observationStartedAt: obs103.observationStartedAt,
      observationEndsAt: obs103.observationEndsAt,
      anomalies: [],
      applicantAccountId: "onboarding.applicant",
    },
    {
      id: FIXTURE_APPLICATION_IDS.hold,
      reference: "MFG-ONB-2026-0104",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "on_hold",
      draft: baseDraft,
      payment: { ...paymentBase, receiptNumber: "DEMO-RCP-2026-8814", verifiedAt: verifiedAt },
      automatedChecks: checksComplete(checksAt),
      timeline: [
        { id: "t1", at: approvedHold, title: "Automatic activation", detail: "Payment and automated checks passed; 15-day observation started.", icon: "bolt" },
        { id: "t2", at: "2026-10-11T06:00:00.000Z", title: "Anomaly raised", detail: "Finance raised an information anomaly — immediate hold applied.", icon: "report" },
      ],
      directorDecisionAt: null,
      directorDecisionNote: null,
      registrationNumber: "BEE/MFG/2026/AARAV-104",
      activatedAt: approvedHold,
      observationStartedAt: obs104.observationStartedAt,
      observationEndsAt: obs104.observationEndsAt,
      anomalies: [
        {
          id: "an-1",
          raisedAt: "2026-10-11T06:00:00.000Z",
          raisedByRole: "finance",
          summary: "Receipt total differs from declared fee line in Annexure 1 (demonstration anomaly).",
          holdAppliedAt: "2026-10-11T06:00:01.000Z",
          resolvedAt: null,
          resolutionNote: null,
          revokedAt: null,
          revokeReason: null,
        },
      ],
      applicantAccountId: "onboarding.applicant",
    },
    {
      id: FIXTURE_APPLICATION_IDS.resolved,
      reference: "MFG-ONB-2026-0105",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "active",
      draft: baseDraft,
      payment: { ...paymentBase, receiptNumber: "DEMO-RCP-2026-8815", verifiedAt: verifiedAt },
      automatedChecks: checksComplete(checksAt),
      timeline: [
        { id: "t1", at: "2026-09-23T10:00:00.000Z", title: "Hold cleared", detail: "Director resolved anomaly after observation ended.", icon: "check_circle" },
        { id: "t2", at: obs105.observationEndsAt, title: "Observation completed", detail: "No further anomaly during observation.", icon: "verified" },
      ],
      directorDecisionAt: approvedResolved,
      directorDecisionNote: "Approved.",
      registrationNumber: "BEE/MFG/2026/AARAV-105",
      activatedAt: approvedResolved,
      observationStartedAt: obs105.observationStartedAt,
      observationEndsAt: obs105.observationEndsAt,
      anomalies: [
        {
          id: "an-1",
          raisedAt: "2026-09-22T06:00:00.000Z",
          raisedByRole: "programme",
          summary: "Programme information query on facility address pincode (resolved).",
          holdAppliedAt: "2026-09-22T06:00:01.000Z",
          resolvedAt: "2026-09-23T10:00:00.000Z",
          resolutionNote: "Clarification accepted — resume observation.",
          revokedAt: null,
          revokeReason: null,
        },
      ],
      applicantAccountId: "onboarding.applicant",
    },
    {
      id: FIXTURE_APPLICATION_IDS.revoked,
      reference: "MFG-ONB-2026-0106",
      version: 1,
      syntheticDemo: true,
      companyCode: "AARAV",
      phase: "revoked",
      draft: baseDraft,
      payment: { ...paymentBase, receiptNumber: "DEMO-RCP-2026-8816", verifiedAt: verifiedAt },
      automatedChecks: checksComplete(checksAt),
      timeline: [
        { id: "t1", at: "2026-10-13T09:00:00.000Z", title: "Revoked by Director", detail: "Registration revoked after unresolved anomaly (demonstration).", icon: "block" },
      ],
      directorDecisionAt: approvedRevoked,
      directorDecisionNote: "Initially approved.",
      registrationNumber: "BEE/MFG/2026/AARAV-106",
      activatedAt: approvedRevoked,
      observationStartedAt: obs106.observationStartedAt,
      observationEndsAt: obs106.observationEndsAt,
      anomalies: [
        {
          id: "an-1",
          raisedAt: "2026-10-12T07:00:00.000Z",
          raisedByRole: "director",
          summary: "Director monitoring anomaly — documentation mismatch (demonstration).",
          holdAppliedAt: "2026-10-12T07:00:01.000Z",
          resolvedAt: null,
          resolutionNote: null,
          revokedAt: "2026-10-13T09:00:00.000Z",
          revokeReason: "Material misrepresentation in Annexure 1 (demonstration revoke).",
        },
      ],
      applicantAccountId: "onboarding.applicant",
    },
  ];
}
