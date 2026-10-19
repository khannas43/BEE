/**
 * Contract for the delegation routes (WP02.4c): GET /api/delegations, POST /api/delegations and POST /api/delegations/{id}/decision. The BFF's
 * validators and the allowed status and code tables; keep them equal to the operations' x-error-codes in the OpenAPI artifact. Provisional local
 * rules, not BEE rules.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const DELEGATION_STATES = ["pending", "approved", "rejected", "withdrawn", "revoked"] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];
export const DELEGABLE_ROLES = ["officer", "finance", "programme"] as const;
export type DelegableRole = (typeof DELEGABLE_ROLES)[number];

export interface Delegation {
  id: string;
  delegator: string;
  delegate: string;
  role: DelegableRole;
  reason: string;
  validFrom: string;
  validTo: string;
  state: DelegationState;
  /** True when the delegate holds the role today: approved, inside the period, and the delegator still holds the role. */
  inForce: boolean;
  asDelegator: boolean;
  asDelegate: boolean;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeNote: string | null;
  uses: number;
}

export interface DelegationColleague {
  id: string;
  displayName: string;
  roles: string[];
}

export interface Delegations {
  today: string;
  canApprove: boolean;
  delegableRoles: DelegableRole[];
  colleagues: DelegationColleague[];
  mine: Delegation[];
  pending: Delegation[];
  decided: Delegation[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v: unknown): v is string => isString(v) && UUID.test(v);
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export const validateDelegation: Validator<Delegation> = (body) => {
  if (!exactKeys(body, ["id", "delegator", "delegate", "role", "reason", "validFrom", "validTo", "state", "inForce", "asDelegator", "asDelegate", "requestedAt",
    "decidedBy", "decidedAt", "decisionNote", "revokedBy", "revokedAt", "revokeNote", "uses"])) return null;
  const b = body;
  const ok =
    isUuid(b.id) && isString(b.delegator) && isString(b.delegate) && (DELEGABLE_ROLES as readonly unknown[]).includes(b.role) && isString(b.reason) &&
    isDate(b.validFrom) && isDate(b.validTo) && (DELEGATION_STATES as readonly unknown[]).includes(b.state) && typeof b.inForce === "boolean" &&
    typeof b.asDelegator === "boolean" && typeof b.asDelegate === "boolean" && isInstant(b.requestedAt) && nullable(b.decidedBy, isString) &&
    nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) && nullable(b.revokedBy, isString) && nullable(b.revokedAt, isInstant) &&
    nullable(b.revokeNote, isString) && Number.isInteger(b.uses) && (b.uses as number) >= 0 &&
    // Only an approved delegation is in force; only a pending one is undecided; only a revoked one carries a revoker.
    (b.inForce !== true || b.state === "approved") && (b.state === "pending") === (b.decidedBy === null) && (b.state === "revoked") === (b.revokedBy !== null) &&
    (b.validFrom as string) < (b.validTo as string);
  return ok ? (b as unknown as Delegation) : null;
};

const validColleague = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["id", "displayName", "roles"]) && isUuid(b.id) && isString(b.displayName) && Array.isArray(b.roles) && b.roles.every(isString);
};

const delegations = (v: unknown, pending: boolean | null): boolean =>
  Array.isArray(v) && v.every((d) => validateDelegation(obj(d) ?? {}) !== null && (pending === null || ((d as { state: string }).state === "pending") === pending));

export const validateDelegations: Validator<Delegations> = (body) => {
  if (!exactKeys(body, ["today", "canApprove", "delegableRoles", "colleagues", "mine", "pending", "decided"])) return null;
  const b = body;
  const ok =
    isDate(b.today) && typeof b.canApprove === "boolean" && Array.isArray(b.delegableRoles) && b.delegableRoles.every((r) => (DELEGABLE_ROLES as readonly unknown[]).includes(r)) &&
    Array.isArray(b.colleagues) && b.colleagues.every(validColleague) && delegations(b.mine, null) && delegations(b.pending, true) && delegations(b.decided, false) &&
    // Colleagues are listed only to someone who can delegate.
    (b.delegableRoles.length > 0 || b.colleagues.length === 0);
  return ok ? (b as unknown as Delegations) : null;
};

const IDEMPOTENCY_409 = ["idempotency_key_conflict", "idempotency_in_progress"] as const;
const DENIALS = [...RESOLVER_DENIALS, "role_not_permitted"] as const;

export const SPRING_DELEGATIONS_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: RESOLVER_DENIALS, 503: ["service_unavailable"] };
export const SPRING_DELEGATION_PROPOSE_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: DENIALS,
  404: ["not_found"],
  409: [...IDEMPOTENCY_409, "delegate_not_eligible", "delegation_exists"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_DELEGATION_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...DENIALS, "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", "delegation_not_active", "effective_date_passed", "delegate_not_eligible", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_DELEGATIONS = { errors: SPRING_DELEGATIONS_ERRORS, validate: validateDelegations };
export const SPRING_DELEGATION_PROPOSE = { errors: SPRING_DELEGATION_PROPOSE_ERRORS, validate: validateDelegation, successStatuses: [201] as const };
export const SPRING_DELEGATION_DECISION = { errors: SPRING_DELEGATION_DECISION_ERRORS, validate: validateDelegation, successStatuses: [200] as const };
