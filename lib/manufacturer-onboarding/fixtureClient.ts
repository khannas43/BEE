import { buildFixtureApplications, FIXTURE_APPLICATION_IDS } from "./fixtureSeed";
import type { ManufacturerOnboardingClient } from "./client";
import type {
  DirectorDecisionInput,
  DirectorRejectInput,
  DirectorResolveInput,
  DirectorRevokeInput,
  ManufacturerApplication,
  ManufacturerApplicationSummary,
  ManufacturerOnboardingRole,
  RaiseAnomalyInput,
  SaveDraftInput,
  SubmitApplicationInput,
  UploadDocumentInput,
} from "./types";
import { DOCUMENT_KIND_LABELS, type ManufacturerOnboardingDocumentKind } from "./documentKinds";
import { observationWindowFromApproval, phaseAfterHoldResolved } from "./observation";

export type FixtureClientDeps = {
  nowIso?: () => string;
  nowMs?: () => number;
  actor?: () => { username: string; effectiveRoles: { role: string }[] };
};

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
    version: a.version,
    draft: a.draft,
    registrationNumber: a.registrationNumber,
    syntheticDemo: a.syntheticDemo,
    legalName: a.draft.legalName,
  };
}

function bumpVersion(a: ManufacturerApplication): void {
  a.version += 1;
}

function find(id: string): ManufacturerApplication {
  const a = apps().find((x) => x.id === id);
  if (!a) throw new Error("not_found");
  return a;
}

function nowIso(deps?: FixtureClientDeps): string {
  return deps?.nowIso?.() ?? new Date().toISOString();
}

function nowMs(deps?: FixtureClientDeps): number {
  return deps?.nowMs?.() ?? Date.now();
}

function anomalyActorRole(deps?: FixtureClientDeps): Exclude<ManufacturerOnboardingRole, "applicant"> {
  const roles = deps?.actor?.().effectiveRoles.map((r) => r.role) ?? ["finance"];
  if (roles.includes("director")) return "director";
  if (roles.includes("finance")) return "finance";
  if (roles.includes("programme")) return "programme";
  throw new Error("forbidden");
}

/** Reset in-memory fixture state (tests). */
export function resetManufacturerOnboardingFixture(): void {
  store = cloneApps();
}

export function createFixtureManufacturerOnboardingClient(deps?: FixtureClientDeps): ManufacturerOnboardingClient {
  return {
    async listForApplicant(): Promise<ManufacturerApplicationSummary[]> {
      const roles = deps?.actor?.().effectiveRoles.map((r) => r.role) ?? ["manufacturer"];
      if (!roles.includes("manufacturer")) return [];
      return apps().filter((a) => a.companyCode === "AARAV").map(summary);
    },
    async listDirectorQueue(): Promise<ManufacturerApplicationSummary[]> {
      return apps().filter((a) => a.phase === "director_review").map(summary);
    },
    async listMonitoringQueue(): Promise<ManufacturerApplicationSummary[]> {
      return apps().filter((a) => ["active_observation", "on_hold", "active"].includes(a.phase)).map(summary);
    },
    async getApplication(id: string): Promise<ManufacturerApplication> {
      return structuredClone(find(id));
    },
    async uploadDocument(input: UploadDocumentInput): Promise<ManufacturerApplication> {
      const a = find(input.applicationId);
      if (a.phase !== "draft" && a.phase !== "automatic_checks_failed") throw new Error("not_editable");
      const label = DOCUMENT_KIND_LABELS[input.documentKind as ManufacturerOnboardingDocumentKind] ?? input.label;
      const doc = a.draft.annexureDocuments.find((d) => d.id === input.documentKind);
      const now = nowIso(deps);
      if (doc) {
        doc.uploadedAt = now;
        doc.fileName = input.file.name;
        doc.kind = label;
      }
      bumpVersion(a);
      return structuredClone(a);
    },
    async saveDraft(input: SaveDraftInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      if (a.phase !== "draft" && a.phase !== "automatic_checks_failed") throw new Error("not_editable");
      a.draft = structuredClone(input.draft);
      bumpVersion(a);
      if (a.phase === "automatic_checks_failed") a.phase = "draft";
      a.timeline.push({
        id: `t-save-${nowMs(deps)}`,
        at: nowIso(deps),
        title: "Draft saved",
        detail: "Applicant saved progress in the wizard.",
        icon: "save",
      });
      return structuredClone(a);
    },
    async submit(input: SubmitApplicationInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      bumpVersion(a);
      if (a.phase !== "draft" && a.phase !== "automatic_checks_failed") throw new Error("already_submitted");
      const { draft } = a;
      if (!draft.declarationAccepted || !draft.agreementAccepted) throw new Error("declaration_required");
      if (!draft.legalName.trim() || !draft.cin.trim()) throw new Error("validation_failed");
      const now = nowIso(deps);
      const docFail = draft.annexureDocuments.some((d) => !d.uploadedAt);
      a.payment = {
        ...a.payment,
        receiptNumber: `DEMO-RCP-${a.reference.slice(-4)}`,
        verifiedAt: now,
      };
      if (docFail) {
        a.phase = "automatic_checks_failed";
        a.automatedChecks = [
          {
            id: "chk-docs",
            label: "Annexure 1 document completeness",
            outcome: "fail",
            completedAt: now,
            detail: "Required Annexure 1 uploads missing or incomplete.",
          },
        ];
        a.timeline.push(
          { id: "t-sub", at: now, title: "Registration submitted", detail: "Submitted for automated processing.", icon: "send" },
          { id: "t-pay", at: now, title: "Payment recorded", detail: "Simulated gateway payment captured.", icon: "payments" },
          { id: "t-fail", at: now, title: "Automated checks failed", detail: "Correct the application and submit again.", icon: "error" },
        );
      } else {
        a.phase = "director_review";
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
      }
      return structuredClone(a);
    },
    async directorApprove(input: DirectorDecisionInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      bumpVersion(a);
      if (a.phase !== "director_review") throw new Error("not_awaiting_director");
      const now = nowIso(deps);
      const window = observationWindowFromApproval(now);
      a.phase = "active_observation";
      a.directorDecisionAt = now;
      a.directorDecisionNote = input.note ?? "Approved.";
      a.registrationNumber = `BEE/MFG/2026/AARAV-${a.reference.slice(-3)}`;
      a.activatedAt = now;
      a.observationStartedAt = window.observationStartedAt;
      a.observationEndsAt = window.observationEndsAt;
      a.timeline.push({ id: "t-dir", at: now, title: "Director approval", detail: "Manufacturer activated under observation.", icon: "how_to_reg" });
      return structuredClone(a);
    },
    async directorReject(input: DirectorRejectInput): Promise<ManufacturerApplication> {
      const a = find(input.id);
      bumpVersion(a);
      if (a.phase !== "director_review") throw new Error("not_awaiting_director");
      if (!input.reason.trim()) throw new Error("reason_required");
      a.phase = "rejected";
      a.directorDecisionAt = nowIso(deps);
      a.directorDecisionNote = input.reason;
      a.timeline.push({ id: "t-rej", at: a.directorDecisionAt, title: "Registration rejected", detail: input.reason, icon: "cancel" });
      return structuredClone(a);
    },
    async raiseAnomaly(input: RaiseAnomalyInput): Promise<ManufacturerApplication> {
      const a = find(input.applicationId);
      bumpVersion(a);
      if (a.phase !== "active_observation") throw new Error("not_under_observation");
      const now = nowIso(deps);
      a.phase = "on_hold";
      a.anomalies.push({
        id: `an-${nowMs(deps)}`,
        raisedAt: now,
        raisedByRole: anomalyActorRole(deps),
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
      bumpVersion(a);
      if (a.phase !== "on_hold") throw new Error("not_on_hold");
      const now = nowIso(deps);
      a.phase = phaseAfterHoldResolved(a.observationEndsAt, nowMs(deps));
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
      bumpVersion(a);
      if (a.phase !== "on_hold") throw new Error("not_on_hold");
      if (!input.reason.trim()) throw new Error("reason_required");
      const now = nowIso(deps);
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
