import {
  errorCodeOf,
  INVALID_RESPONSE,
  readFailure,
  runtimeCommand,
  runtimeReadInit,
  type FetchLike,
  type ReadFailure,
} from "@/lib/client/runtimeHttp";
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
import { normalizeManufacturerPhase } from "./phaseMapping";

const BASE = "/api/manufacturer-onboarding";

export class ManufacturerOnboardingHttpError extends Error {
  constructor(
    readonly kind: "session" | "forbidden" | "not_found" | "unavailable" | "validation" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ManufacturerOnboardingHttpError";
  }
}

function throwFromFailure(f: ReadFailure): never {
  if (f.kind === "session") throw new ManufacturerOnboardingHttpError("session", f.message);
  if (f.kind === "forbidden") throw new ManufacturerOnboardingHttpError("forbidden", f.message);
  if (f.kind === "not_found") throw new ManufacturerOnboardingHttpError("not_found", f.message);
  throw new ManufacturerOnboardingHttpError("unavailable", f.message);
}

function throwFromStatus(status: number, body: unknown): never {
  const code = errorCodeOf(body);
  if (status === 422 || code === "validation_failed") {
    throw new ManufacturerOnboardingHttpError("validation", "Validation failed. Check the form and try again.");
  }
  if (status === 409 || code === "version_conflict" || code === "idempotency_key_conflict") {
    throw new ManufacturerOnboardingHttpError("conflict", "This action conflicted with a recent change. Refresh and try again.");
  }
  throwFromFailure(readFailure(status, body));
}

function normalizeApp(raw: ManufacturerApplication): ManufacturerApplication {
  return { ...raw, phase: normalizeManufacturerPhase(raw.phase) };
}

async function parseApplication(res: Response): Promise<ManufacturerApplication> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throwFromStatus(res.status, body);
  if (!body || typeof body !== "object") throw new ManufacturerOnboardingHttpError("unavailable", INVALID_RESPONSE.message);
  return normalizeApp(body as ManufacturerApplication);
}

async function parseList(res: Response): Promise<ManufacturerApplicationSummary[]> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throwFromStatus(res.status, body);
  const items = (body as { items?: ManufacturerApplicationSummary[] })?.items;
  if (!Array.isArray(items)) throw new ManufacturerOnboardingHttpError("unavailable", INVALID_RESPONSE.message);
  return items.map((item) => ({ ...item, phase: normalizeManufacturerPhase(item.phase) }));
}

async function commandApp(
  fetchImpl: FetchLike,
  path: string,
  payload: object,
  idempotencyKey: string,
): Promise<ManufacturerApplication> {
  const result = await runtimeCommand(
    `${BASE}${path}`,
    "POST",
    payload,
    idempotencyKey,
    (body) => (body && typeof body === "object" ? normalizeApp(body as ManufacturerApplication) : null),
    fetchImpl,
  );
  if (!result.ok) {
    const f = result.failure;
    if (f.kind === "validation") throw new ManufacturerOnboardingHttpError("validation", f.message);
    if (f.kind === "conflict") throw new ManufacturerOnboardingHttpError("conflict", f.message);
    if (f.kind === "denied") throw new ManufacturerOnboardingHttpError("forbidden", f.message);
    if (f.kind === "session") throw new ManufacturerOnboardingHttpError("session", f.message);
    if (f.kind === "not_found") throw new ManufacturerOnboardingHttpError("not_found", f.message);
    throw new ManufacturerOnboardingHttpError("unavailable", f.message);
  }
  return result.value;
}

export function createManufacturerOnboardingHttpClient(fetchImpl: FetchLike = fetch): ManufacturerOnboardingClient {
  return {
    listForApplicant: async () =>
      parseList(await fetchImpl(`${BASE}/applications`, runtimeReadInit())),
    listDirectorQueue: async () =>
      parseList(await fetchImpl(`${BASE}/director/queue`, runtimeReadInit())),
    listMonitoringQueue: async () =>
      parseList(await fetchImpl(`${BASE}/monitoring/queue`, runtimeReadInit())),
    getApplication: async (id) =>
      parseApplication(await fetchImpl(`${BASE}/applications/${encodeURIComponent(id)}`, runtimeReadInit())),
    saveDraft: async (input: SaveDraftInput) =>
      parseApplication(
        await fetchImpl(`${BASE}/applications/${encodeURIComponent(input.id)}/draft`, {
          ...runtimeReadInit({ "Content-Type": "application/json" }),
          method: "PUT",
          body: JSON.stringify(input.draft),
        }),
      ),
    submit: async (input: SubmitApplicationInput) =>
      commandApp(fetchImpl, `/applications/${encodeURIComponent(input.id)}/submit`, {}, `submit-${input.id}`),
    directorApprove: async (input: DirectorDecisionInput) =>
      commandApp(fetchImpl, `/applications/${encodeURIComponent(input.id)}/director/approve`, { note: input.note ?? "" }, `approve-${input.id}`),
    directorReject: async (input: DirectorRejectInput) =>
      commandApp(fetchImpl, `/applications/${encodeURIComponent(input.id)}/director/reject`, { reason: input.reason }, `reject-${input.id}`),
    raiseAnomaly: async (input: RaiseAnomalyInput) =>
      commandApp(
        fetchImpl,
        `/applications/${encodeURIComponent(input.applicationId)}/anomalies`,
        { summary: input.summary },
        `anomaly-${input.applicationId}`,
      ),
    directorResolve: async (input: DirectorResolveInput) =>
      commandApp(
        fetchImpl,
        `/applications/${encodeURIComponent(input.applicationId)}/director/resolve`,
        { note: input.note },
        `resolve-${input.applicationId}`,
      ),
    directorRevoke: async (input: DirectorRevokeInput) =>
      commandApp(
        fetchImpl,
        `/applications/${encodeURIComponent(input.applicationId)}/director/revoke`,
        { reason: input.reason },
        `revoke-${input.applicationId}`,
      ),
    defaultDraftId: async () => {
      const list = await parseList(await fetchImpl(`${BASE}/applications`, runtimeReadInit()));
      const draft = list.find((x) => x.phase === "draft");
      if (!draft) throw new ManufacturerOnboardingHttpError("not_found", "No draft application is available.");
      return draft.id;
    },
  };
}
