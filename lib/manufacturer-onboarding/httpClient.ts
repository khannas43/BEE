import {
  errorCodeOf,
  INVALID_RESPONSE,
  newIdempotencyKey,
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
  UploadDocumentInput,
} from "./types";
import { mapBackendDetail, mapBackendSummary, toBackendDraft, type BackendDetail } from "./mapBackend";

/** Canonical browser BFF routes (OpenAPI 0.37.1). */
export const MANUFACTURER_ONBOARDING_BFF = {
  list: "/api/runtime/manufacturer-onboarding",
  detail: (id: string) => `/api/runtime/manufacturer-onboarding/${encodeURIComponent(id)}`,
  submit: (id: string) => `/api/runtime/manufacturer-onboarding/${encodeURIComponent(id)}/submit`,
  directorDecision: (id: string) => `/api/runtime/manufacturer-onboarding/${encodeURIComponent(id)}/director-decision`,
  anomalies: (id: string) => `/api/runtime/manufacturer-onboarding/${encodeURIComponent(id)}/anomalies`,
  anomalyResolution: (id: string) => `/api/runtime/manufacturer-onboarding/${encodeURIComponent(id)}/anomaly-resolution`,
  documents: (id: string) => `/api/runtime/manufacturer-onboarding/${encodeURIComponent(id)}/documents`,
} as const;

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

function parseDetailBody(body: unknown): ManufacturerApplication | null {
  if (!body || typeof body !== "object") return null;
  return mapBackendDetail(body as BackendDetail);
}

async function parseApplication(res: Response): Promise<ManufacturerApplication> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throwFromStatus(res.status, body);
  const app = parseDetailBody(body);
  if (!app) throw new ManufacturerOnboardingHttpError("unavailable", INVALID_RESPONSE.message);
  return app;
}

async function fetchList(fetchImpl: FetchLike): Promise<ManufacturerApplicationSummary[]> {
  const res = await fetchImpl(MANUFACTURER_ONBOARDING_BFF.list, runtimeReadInit());
  const body = await res.json().catch(() => null);
  if (!res.ok) throwFromStatus(res.status, body);
  const items = (body as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) throw new ManufacturerOnboardingHttpError("unavailable", INVALID_RESPONSE.message);
  return items.map((item) => mapBackendSummary(item as BackendDetail));
}

async function commandApp(
  fetchImpl: FetchLike,
  path: string,
  payload: object | FormData,
  idempotencyKey: string,
): Promise<ManufacturerApplication> {
  const result = await runtimeCommand(path, "POST", payload, idempotencyKey, parseDetailBody, fetchImpl);
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

const MONITORING_QUEUE_PHASES = new Set(["active_observation", "active", "on_hold"]);

const DEFAULT_CREATE_LEGAL_NAME = "Aarav Appliances Pvt Ltd";

export function createManufacturerOnboardingHttpClient(fetchImpl: FetchLike = fetch): ManufacturerOnboardingClient {
  return {
    listForApplicant: async () => fetchList(fetchImpl),
    listDirectorQueue: async () => [],
    listMonitoringQueue: async () => (await fetchList(fetchImpl)).filter((x) => MONITORING_QUEUE_PHASES.has(x.phase)),
    getApplication: async (id) => parseApplication(await fetchImpl(MANUFACTURER_ONBOARDING_BFF.detail(id), runtimeReadInit())),
    saveDraft: async (input: SaveDraftInput) => {
      const payload = {
        version: input.version,
        legalName: input.draft.legalName.trim() || DEFAULT_CREATE_LEGAL_NAME,
        draft: toBackendDraft(input.draft),
      };
      const key = input.idempotencyKey ?? newIdempotencyKey();
      const result = await runtimeCommand(
        MANUFACTURER_ONBOARDING_BFF.detail(input.id),
        "PATCH",
        payload,
        key,
        parseDetailBody,
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
    },
    uploadDocument: async (input: UploadDocumentInput) => {
      const form = new FormData();
      form.append("file", input.file);
      form.append("documentKind", input.documentKind);
      form.append("label", input.label);
      if (input.issueOn) form.append("issueOn", input.issueOn);
      if (input.expiresOn) form.append("expiresOn", input.expiresOn);
      const key = input.idempotencyKey ?? newIdempotencyKey();
      return commandApp(fetchImpl, MANUFACTURER_ONBOARDING_BFF.documents(input.applicationId), form, key);
    },
    submit: async (input: SubmitApplicationInput) =>
      commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.submit(input.id),
        { version: input.version },
        input.idempotencyKey ?? newIdempotencyKey(),
      ),
    directorApprove: async (input: DirectorDecisionInput) =>
      commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.directorDecision(input.id),
        { version: input.version, decision: "approve", note: input.note ?? "" },
        input.idempotencyKey ?? newIdempotencyKey(),
      ),
    directorReject: async (input: DirectorRejectInput) =>
      commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.directorDecision(input.id),
        { version: input.version, decision: "reject", note: input.reason },
        input.idempotencyKey ?? newIdempotencyKey(),
      ),
    raiseAnomaly: async (input: RaiseAnomalyInput) =>
      commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.anomalies(input.applicationId),
        { version: input.version, reason: input.summary },
        input.idempotencyKey ?? newIdempotencyKey(),
      ),
    directorResolve: async (input: DirectorResolveInput) =>
      commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.anomalyResolution(input.applicationId),
        { version: input.version, resolution: "cleared", note: input.note },
        input.idempotencyKey ?? newIdempotencyKey(),
      ),
    directorRevoke: async (input: DirectorRevokeInput) =>
      commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.anomalyResolution(input.applicationId),
        { version: input.version, resolution: "revoked", note: input.reason },
        input.idempotencyKey ?? newIdempotencyKey(),
      ),
    defaultDraftId: async () => {
      const list = await fetchList(fetchImpl);
      const editable = list.find((x) => x.phase === "draft" || x.phase === "automatic_checks_failed");
      if (editable) return editable.id;
      const created = await commandApp(
        fetchImpl,
        MANUFACTURER_ONBOARDING_BFF.list,
        { legalName: DEFAULT_CREATE_LEGAL_NAME, draft: {} },
        newIdempotencyKey(),
      );
      return created.id;
    },
  };
}
