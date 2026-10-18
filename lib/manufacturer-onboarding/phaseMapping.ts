import type { ManufacturerLifecyclePhase } from "./types";

/** Map Agent A cosmetic / legacy phase names to the UI contract. */
const BACKEND_PHASE_ALIASES: Record<string, ManufacturerLifecyclePhase> = {
  awaiting_director: "director_review",
  hold_anomaly: "on_hold",
  observation_completed: "active",
};

export function normalizeManufacturerPhase(raw: string): ManufacturerLifecyclePhase {
  return (BACKEND_PHASE_ALIASES[raw] ?? raw) as ManufacturerLifecyclePhase;
}
