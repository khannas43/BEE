/**
 * Contract for the register-revocation routes (WP04.2b-2b): GET /api/register-revocations, POST /api/register-revocations and
 * POST /api/register-revocations/{id}/decision. The BFF's validators and the allowed status and code tables; keep them equal to the
 * operations' x-error-codes in the OpenAPI artifact. Provisional local rules, not BEE rules.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const REVOCATION_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type RevocationState = (typeof REVOCATION_STATES)[number];

export interface RegisterBrandEntry {
  id: string;
  name: string;
  owner: string;
  status: "active" | "suspended" | "revoked";
  source: string;
}

export interface RegisterAuthorisationEntry {
  id: string;
  brandId: string;
  brandName: string;
  agency: string;
  principal: string;
  validFrom: string;
  validTo: string | null;
  status: "active" | "revoked";
  source: string;
}

export interface RegisterRevocationProposal {
  id: string;
  targetKind: "brand" | "authorisation";
  targetId: string;
  targetLabel: string;
  action: "revoke" | "close";
  closeOn: string | null;
  reason: string;
  state: RevocationState;
  proposedBy: string;
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface RegisterRevocations {
  today: string;
  canPropose: boolean;
  canDecide: boolean;
  brands: RegisterBrandEntry[];
  authorisations: RegisterAuthorisationEntry[];
  pending: RegisterRevocationProposal[];
  decided: RegisterRevocationProposal[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v: unknown): v is string => isString(v) && UUID.test(v);
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export const validateRegisterRevocationProposal: Validator<RegisterRevocationProposal> = (body) => {
  if (!exactKeys(body, ["id", "targetKind", "targetId", "targetLabel", "action", "closeOn", "reason", "state", "proposedBy", "proposedByYou", "proposedAt",
    "decidedBy", "decidedAt", "decisionNote"])) return null;
  const b = body;
  const ok =
    isUuid(b.id) && (b.targetKind === "brand" || b.targetKind === "authorisation") && isUuid(b.targetId) && isString(b.targetLabel) &&
    (b.action === "revoke" || b.action === "close") && nullable(b.closeOn, isDate) && isString(b.reason) &&
    (REVOCATION_STATES as readonly unknown[]).includes(b.state) && isString(b.proposedBy) && typeof b.proposedByYou === "boolean" && isInstant(b.proposedAt) &&
    nullable(b.decidedBy, isString) && nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) &&
    // A brand can only be revoked; only a closure carries a date; only a pending proposal is undecided.
    (b.targetKind === "authorisation" || b.action === "revoke") && (b.action === "close") === (b.closeOn !== null) && (b.state === "pending") === (b.decidedBy === null);
  return ok ? (b as unknown as RegisterRevocationProposal) : null;
};

const validBrand = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["id", "name", "owner", "status", "source"]) && isUuid(b.id) && isString(b.name) && isString(b.owner) &&
    (b.status === "active" || b.status === "suspended" || b.status === "revoked") && isString(b.source);
};

const validAuthorisation = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["id", "brandId", "brandName", "agency", "principal", "validFrom", "validTo", "status", "source"]) && isUuid(b.id) &&
    isUuid(b.brandId) && isString(b.brandName) && isString(b.agency) && isString(b.principal) && isDate(b.validFrom) && nullable(b.validTo, isDate) &&
    (b.status === "active" || b.status === "revoked") && isString(b.source);
};

const proposals = (v: unknown, pending: boolean): boolean =>
  Array.isArray(v) && v.every((p) => validateRegisterRevocationProposal(obj(p) ?? {}) !== null && ((p as { state: string }).state === "pending") === pending);

export const validateRegisterRevocations: Validator<RegisterRevocations> = (body) => {
  if (!exactKeys(body, ["today", "canPropose", "canDecide", "brands", "authorisations", "pending", "decided"])) return null;
  const b = body;
  const ok =
    isDate(b.today) && typeof b.canPropose === "boolean" && typeof b.canDecide === "boolean" &&
    Array.isArray(b.brands) && b.brands.every(validBrand) && Array.isArray(b.authorisations) && b.authorisations.every(validAuthorisation) &&
    proposals(b.pending, true) && proposals(b.decided, false);
  return ok ? (b as unknown as RegisterRevocations) : null;
};

const IDEMPOTENCY_409 = ["idempotency_key_conflict", "idempotency_in_progress"] as const;
const DENIALS = [...RESOLVER_DENIALS, "role_not_permitted"] as const;

export const SPRING_REGISTER_REVOCATIONS_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: DENIALS, 503: ["service_unavailable"] };
export const SPRING_REGISTER_REVOCATION_PROPOSE_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: DENIALS,
  404: ["not_found"],
  409: [...IDEMPOTENCY_409, "revocation_pending", "target_not_active"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_REGISTER_REVOCATION_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...DENIALS, "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", "closing_date_passed", "target_not_active", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_REGISTER_REVOCATIONS = { errors: SPRING_REGISTER_REVOCATIONS_ERRORS, validate: validateRegisterRevocations };
export const SPRING_REGISTER_REVOCATION_PROPOSE = { errors: SPRING_REGISTER_REVOCATION_PROPOSE_ERRORS, validate: validateRegisterRevocationProposal, successStatuses: [201] as const };
export const SPRING_REGISTER_REVOCATION_DECISION = { errors: SPRING_REGISTER_REVOCATION_DECISION_ERRORS, validate: validateRegisterRevocationProposal, successStatuses: [200] as const };
