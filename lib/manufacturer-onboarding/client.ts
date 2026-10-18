export type {
  ManufacturerApplication,
  ManufacturerApplicationSummary,
  ManufacturerDraft,
  ManufacturerOnboardingRole,
  SaveDraftInput,
  SubmitApplicationInput,
  DirectorDecisionInput,
  DirectorRejectInput,
  RaiseAnomalyInput,
  DirectorResolveInput,
  DirectorRevokeInput,
} from "./types";

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
import { createFixtureManufacturerOnboardingClient } from "./fixtureClient";

/** Adapter surface for Agent A’s future JSON contract — swap implementation here. */
export interface ManufacturerOnboardingClient {
  listForApplicant(): Promise<ManufacturerApplicationSummary[]>;
  listDirectorQueue(): Promise<ManufacturerApplicationSummary[]>;
  listMonitoringQueue(): Promise<ManufacturerApplicationSummary[]>;
  getApplication(id: string): Promise<ManufacturerApplication>;
  saveDraft(input: SaveDraftInput): Promise<ManufacturerApplication>;
  submit(input: SubmitApplicationInput): Promise<ManufacturerApplication>;
  directorApprove(input: DirectorDecisionInput): Promise<ManufacturerApplication>;
  directorReject(input: DirectorRejectInput): Promise<ManufacturerApplication>;
  raiseAnomaly(input: RaiseAnomalyInput): Promise<ManufacturerApplication>;
  directorResolve(input: DirectorResolveInput): Promise<ManufacturerApplication>;
  directorRevoke(input: DirectorRevokeInput): Promise<ManufacturerApplication>;
  defaultDraftId(): Promise<string>;
}

const USE_LIVE_API = process.env.NEXT_PUBLIC_MANUFACTURER_ONBOARDING_API === "1";

export function createManufacturerOnboardingClient(): ManufacturerOnboardingClient {
  if (USE_LIVE_API) {
    // Placeholder: Agent A wires HTTP calls here without changing UI components.
    throw new Error("manufacturer_onboarding_api_not_wired");
  }
  return createFixtureManufacturerOnboardingClient();
}
