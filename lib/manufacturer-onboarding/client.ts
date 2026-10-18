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
  UploadDocumentInput,
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
  UploadDocumentInput,
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
  uploadDocument(input: UploadDocumentInput): Promise<ManufacturerApplication>;
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

/** Explicit fixture adapter for isolated UI tests and demos — default is the real BFF HTTP client. */
export const MANUFACTURER_ONBOARDING_USE_FIXTURE = process.env.NEXT_PUBLIC_MANUFACTURER_ONBOARDING_FIXTURE === "1";

export function createManufacturerOnboardingClient(options?: ManufacturerOnboardingClientOptions): ManufacturerOnboardingClient {
  if (options?.adapter) return options.adapter;
  if (MANUFACTURER_ONBOARDING_USE_FIXTURE) return createFixtureManufacturerOnboardingClient(options?.fixture);
  return createManufacturerOnboardingHttpClient(options?.fetch);
}
