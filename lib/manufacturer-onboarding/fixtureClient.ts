import { buildFixtureApplications, FIXTURE_APPLICATION_IDS } from "./fixtureSeed";
import type { ManufacturerOnboardingClient } from "./client";
import type {
  DirectorDecisionInput,
  DirectorRejectInput,
  DirectorResolveInput,
  DirectorRevokeInput,
  ManufacturerApplication,
  ManufacturerApplicationSummary,
  RaiseAnomalyInput,
  SaveDraftInput,
  SubmitApplicationInput,
} from "./types";
import { FIXTURE_OBSERVATION } from "./fixtureSeed";

function cloneApps(): ManufacturerApplication[] {
  return structuredClone(buildFixtureApplications());
}

let store: ManufacturerApplication[] | null = null;

function apps(): ManufacturerApplication[] {
  if (!store) store = cloneApps();
  return store;
}

function summary(a: ManufacturerApplication): ManufacturerApplicationSummary {
  return {
    id: a.id,
    reference: a.reference,
    phase: a.phase,
    draft: a.draft,
    registrationNumber: a.registrationNumber,
    syntheticDemo: a.syntheticDemo,
    legalName: a.draft.legalName,
  };
}

function find(id: string): ManufacturerApplication {
  const a = apps().find((x) => x.id === id);
  if (!a) throw new Error("not_found");
  return a;
}

/** Reset in-memory fixture state (tests). */
export function resetManufacturerOnboardingFixture(): void {
  store = cloneApps();
}

export function createFixtureManufacturerOnboardingClient(): ManufacturerOnboardingClient {
  return {
    async listForApplicant(): Promise<ManufacturerApplicationSummary[]> {
      return apps()
        .filter((a) => a.applicantAccountId === "onboarding.applicant")
        .map(summary);
    },
    async listDirectorQueue(): Promise<ManufacturerApplicationSummary[]> {
      return apps().filter((a) => a.phase === "awaiting_director").map(summary);
    },
    async listMonitoringQueue(): Promise<ManufacturerApplicationSummary[]> {
      return apps().filter((a) =>
        ["active_observation", "hold_anomaly", "observation_completed"].includes(a.phase),
      ).map(summary);
    },
    async getApplication(id: string): Promise<ManufacturerApplication> {
      return structuredClone(find(id));
    },
    async saveDraft(input: SaveDraftInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      if (a.phase !== "draft") throw new Error("not_editable");
      a.draft = structuredClone(input.draft);
      a.timeline.push({
        id: `t-save-${Date.now()}`,
        at: new Date().toISOString(),
        title: "Draft saved",
        detail: "Applicant saved progress in the wizard.",
        icon: "save",
      });
      return structuredClone(a);
    },
    async submit(input: SubmitApplicationInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      if (a.phase !== "draft") throw new Error("already_submitted");
      const { draft } = a;
      if (!draft.declarationAccepted || !draft.agreementAccepted) throw new Error("declaration_required");
      if (!draft.legalName.trim() || !draft.cin.trim()) throw new Error("validation_failed");
      const now = new Date().toISOString();
      a.phase = "awaiting_director";
      a.payment = {
        ...a.payment,
        receiptNumber: `DEMO-RCP-${a.reference.slice(-4)}`,
        verifiedAt: now,
      };
      a.automatedChecks = [
        {
          id: "chk-docs",
          label: "Annexure 1 document completeness",
          outcome: "pass",
          completedAt: now,
          detail: "Required Annexure 1 uploads present for demonstration.",
        },
        {
          id: "chk-elig",
          label: "Eligibility rules (demonstration ruleset)",
          outcome: "pass",
          completedAt: now,
          detail: "Automated rules check completed against the demonstration policy pack.",
        },
      ];
      a.timeline.push(
        { id: "t-sub", at: now, title: "Registration submitted", detail: "Submitted for automated processing.", icon: "send" },
        { id: "t-pay", at: now, title: "Payment recorded", detail: "Simulated gateway payment captured.", icon: "payments" },
        { id: "t-chk", at: now, title: "Automated checks completed", detail: "Checks completed automatically.", icon: "rule" },
      );
      return structuredClone(a);
    },
    async directorApprove(input: DirectorDecisionInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      if (a.phase !== "awaiting_director") throw new Error("not_awaiting_director");
      const now = new Date().toISOString();
      a.phase = "active_observation";
      a.directorDecisionAt = now;
      a.directorDecisionNote = input.note ?? "Approved.";
      a.registrationNumber = `BEE/MFG/2026/AARAV-${a.reference.slice(-3)}`;
      a.activatedAt = now;
      a.observationStartedAt = FIXTURE_OBSERVATION.observationStartedAt;
      a.observationEndsAt = FIXTURE_OBSERVATION.observationEndsAt;
      a.timeline.push({ id: "t-dir", at: now, title: "Director approval", detail: "Manufacturer activated under observation.", icon: "how_to_reg" });
      return structuredClone(a);
    },
    async directorReject(input: DirectorRejectInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      if (a.phase !== "awaiting_director") throw new Error("not_awaiting_director");
      if (!input.reason.trim()) throw new Error("reason_required");
      a.phase = "revoked";
      a.directorDecisionAt = new Date().toISOString();
      a.directorDecisionNote = input.reason;
      a.timeline.push({ id: "t-rej", at: a.directorDecisionAt, title: "Rejected by Director", detail: input.reason, icon: "cancel" });
      return structuredClone(a);
    },
    async raiseAnomaly(input: RaiseAnomalyInput): Promise<ManufacturerApplication> {
      const a = find(input.applicationId);
      if (a.phase !== "active_observation") throw new Error("not_under_observation");
      const now = new Date().toISOString();
      a.phase = "hold_anomaly";
      a.anomalies.push({
        id: `an-${Date.now()}`,
        raisedAt: now,
        raisedByRole: input.raisedByRole,
        summary: input.summary,
        holdAppliedAt: now,
        resolvedAt: null,
        resolutionNote: null,
        revokedAt: null,
        revokeReason: null,
      });
      a.timeline.push({ id: "t-hold", at: now, title: "Immediate hold", detail: "Anomaly raised — registration placed on hold.", icon: "pause_circle" });
      return structuredClone(a);
    },
    async directorResolve(input: DirectorResolveInput): Promise<ManufacturerApplication> {
      const a = find(input.applicationId);
      if (a.phase !== "hold_anomaly") throw new Error("not_on_hold");
      const now = new Date().toISOString();
      a.phase = "active_observation";
      const open = a.anomalies.find((x) => !x.resolvedAt && !x.revokedAt);
      if (open) {
        open.resolvedAt = now;
        open.resolutionNote = input.note;
      }
      a.timeline.push({ id: "t-res", at: now, title: "Hold cleared", detail: input.note, icon: "check_circle" });
      return structuredClone(a);
    },
    async directorRevoke(input: DirectorRevokeInput): Promise<ManufacturerApplication> {
      const a = find(input.applicationId);
      if (a.phase !== "hold_anomaly") throw new Error("not_on_hold");
      if (!input.reason.trim()) throw new Error("reason_required");
      const now = new Date().toISOString();
      a.phase = "revoked";
      const open = a.anomalies.find((x) => !x.revokedAt);
      if (open) {
        open.revokedAt = now;
        open.revokeReason = input.reason;
      }
      a.timeline.push({ id: "t-rev", at: now, title: "Revoked by Director", detail: input.reason, icon: "block" });
      return structuredClone(a);
    },
    async defaultDraftId(): Promise<string> {
      return FIXTURE_APPLICATION_IDS.draft;
    },
  };
}
