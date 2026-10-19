import type { ManufacturerLifecyclePhase } from "./types";

/** Owner-approved operational labels — keep wording exact for demo and tests. */
export const LABEL_AUTO_PAYMENT = "Automatically verified payment";
export const LABEL_AUTO_RULES = "Automated rules check";
export const LABEL_AWAITING_DIRECTOR = "Awaiting Director decision";
export const LABEL_ACTIVE_OBSERVATION = "Active — under 15-day observation";
export const LABEL_HOLD = "On hold — anomaly under review";
export const LABEL_OBSERVATION_DONE = "Active — observation completed";
export const LABEL_REJECTED = "Registration rejected";
export const LABEL_REVOKED = "Revoked by Director";

export const OPERATIONAL_FLOW =
  "Create applicant login → submit manufacturer/company registration → payment automatically verified → document and eligibility checks automatically completed → Director reviews → Director approval activates the manufacturer → 15-day observation → final active if no anomaly.";

export const ANOMALY_FLOW =
  "If an anomaly is raised: Active under observation → immediate hold → Director resolves to active, or Director revokes.";

export function phaseLabel(phase: ManufacturerLifecyclePhase): string {
  switch (phase) {
    case "draft":
      return "Draft — not yet submitted";
    case "submitted":
      return "Submitted — processing";
    case "automatic_checks_failed":
      return "Automated rules check — action required";
    case "director_review":
      return LABEL_AWAITING_DIRECTOR;
    case "returned":
      return "Returned to applicant";
    case "active_observation":
      return LABEL_ACTIVE_OBSERVATION;
    case "active":
      return LABEL_OBSERVATION_DONE;
    case "on_hold":
      return LABEL_HOLD;
    case "rejected":
      return LABEL_REJECTED;
    case "revoked":
      return LABEL_REVOKED;
    default:
      return phase;
  }
}

export function phaseTone(phase: ManufacturerLifecyclePhase): "neutral" | "warn" | "ok" | "danger" {
  switch (phase) {
    case "draft":
    case "submitted":
      return "neutral";
    case "automatic_checks_failed":
    case "director_review":
    case "on_hold":
      return "warn";
    case "active_observation":
    case "active":
      return "ok";
    case "rejected":
    case "revoked":
      return "danger";
    default:
      return "neutral";
  }
}
