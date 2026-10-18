import type { ManufacturerLifecyclePhase } from "./types";

/** Owner-approved operational labels — keep wording exact for demo and tests. */
export const LABEL_AUTO_PAYMENT = "Automatically verified payment";
export const LABEL_AUTO_RULES = "Automated rules check";
export const LABEL_AWAITING_DIRECTOR = "Awaiting Director decision";
export const LABEL_ACTIVE_OBSERVATION = "Active — under 15-day observation";
export const LABEL_HOLD = "On hold — anomaly under review";
export const LABEL_OBSERVATION_DONE = "Active — observation completed";
export const LABEL_REVOKED = "Revoked by Director";

export const OPERATIONAL_FLOW =
  "Create applicant login → submit manufacturer/company registration → payment automatically verified → document and eligibility checks automatically completed → Director approval → manufacturer immediately active → 15-day observation → active if no anomaly.";

export const ANOMALY_FLOW =
  "If an anomaly is raised: Active under observation → immediate hold → Director resolves to active, or Director revokes.";

export function phaseLabel(phase: ManufacturerLifecyclePhase): string {
  switch (phase) {
    case "draft":
      return "Draft — not yet submitted";
    case "awaiting_director":
      return LABEL_AWAITING_DIRECTOR;
    case "active_observation":
      return LABEL_ACTIVE_OBSERVATION;
    case "hold_anomaly":
      return LABEL_HOLD;
    case "observation_completed":
      return LABEL_OBSERVATION_DONE;
    case "revoked":
      return LABEL_REVOKED;
    default:
      return phase;
  }
}

export function phaseTone(phase: ManufacturerLifecyclePhase): "neutral" | "warn" | "ok" | "danger" {
  switch (phase) {
    case "draft":
      return "neutral";
    case "awaiting_director":
      return "warn";
    case "active_observation":
    case "observation_completed":
      return "ok";
    case "hold_anomaly":
      return "warn";
    case "revoked":
      return "danger";
    default:
      return "neutral";
  }
}
