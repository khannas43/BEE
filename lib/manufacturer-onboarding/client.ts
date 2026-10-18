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

import type { FetchLike } from "@/lib/client/runtimeHttp";
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
import { createFixtureManufacturerOnboardingClient, type FixtureClientDeps } from "./fixtureClient";
import { createManufacturerOnboardingHttpClient } from "./httpClient";

/** Adapter surface for Agent A’s JSON contract — swap implementation here. */
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

export type ManufacturerOnboardingClientOptions = {
  fetch?: FetchLike;
  fixture?: FixtureClientDeps;
  /** Integration tests may inject Agent A’s adapter without changing UI components. */
  adapter?: ManufacturerOnboardingClient;
};

const USE_LIVE_API = process.env.NEXT_PUBLIC_MANUFACTURER_ONBOARDING_API === "1";

export function createManufacturerOnboardingClient(options?: ManufacturerOnboardingClientOptions): ManufacturerOnboardingClient {
  if (options?.adapter) return options.adapter;
  if (USE_LIVE_API) return createManufacturerOnboardingHttpClient(options?.fetch);
  return createFixtureManufacturerOnboardingClient(options?.fixture);
}
