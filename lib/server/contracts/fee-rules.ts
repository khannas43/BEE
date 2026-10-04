/**
 * Contract for the fee-rule administration routes: GET /api/fee-rules, POST /api/fee-rules/proposals and
 * POST /api/fee-rules/proposals/{id}/decision. Per-feature module: the BFF's validators and allowed status and code tables.
 * Keep them equal to the operations' x-error-codes in the OpenAPI artifact; the unit tests and the live coverage gate fail
 * when they drift. Provisional local rules (the owner's assumptions A1 and C1), not BEE rules.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const PROPOSAL_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export const DECISIONS = ["approve", "reject", "withdraw"] as const;
export type Decision = (typeof DECISIONS)[number];

export interface FeeRuleVersion {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  amountInr: string;
  taxRatePercent: string;
  verification: "synthetic" | "provisional" | "verified";
  source: string;
  inForce: boolean;
}

export interface FeeRule {
  ruleKey: string;
  categoryCode: string;
  applicationType: string;
  versions: FeeRuleVersion[];
}

export interface FeeRuleProposal {
  id: string;
  ruleKey: string;
  categoryCode: string;
  applicationType: string;
  amountInr: string;
  taxRatePercent: string;
  effectiveFrom: string;
  sourceReference: string;
  reason: string;
  state: ProposalState;
  proposedBy: string;
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedVersion: number | null;
}

export interface FeeRuleAdmin {
  today: string;
  applicationTypes: { code: string; label: string }[];
  categories: { code: string; name: string }[];
  rules: FeeRule[];
  pending: FeeRuleProposal[];
  decided: FeeRuleProposal[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const validVersion = (v: unknown): boolean => {
  const b = obj(v);
  return (
    b !== null && exactKeys(b, ["version", "effectiveFrom", "effectiveTo", "amountInr", "taxRatePercent", "verification", "source", "inForce"]) &&
    Number.isInteger(b.version) && (b.version as number) >= 1 && isDate(b.effectiveFrom) && nullable(b.effectiveTo, isDate) &&
    isString(b.amountInr) && /^\d+\.\d{2}$/.test(b.amountInr) && isString(b.taxRatePercent) && /^\d{1,3}\.\d{2}$/.test(b.taxRatePercent) &&
    (b.verification === "synthetic" || b.verification === "provisional" || b.verification === "verified") && isString(b.source) && typeof b.inForce === "boolean"
  );
};

const validRule = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["ruleKey", "categoryCode", "applicationType", "versions"]) && isString(b.ruleKey) && isString(b.categoryCode) &&
    isString(b.applicationType) && b.ruleKey === `${b.categoryCode}:${b.applicationType}` && Array.isArray(b.versions) && b.versions.every(validVersion);
};

export const validateFeeRuleProposal: Validator<FeeRuleProposal> = (body) => {
  if (!exactKeys(body, ["id", "ruleKey", "categoryCode", "applicationType", "amountInr", "taxRatePercent", "effectiveFrom", "sourceReference", "reason", "state",
    "proposedBy", "proposedByYou", "proposedAt", "decidedBy", "decidedAt", "decisionNote", "appliedVersion"])) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) && isString(b.ruleKey) && isString(b.categoryCode) && isString(b.applicationType) && b.ruleKey === `${b.categoryCode}:${b.applicationType}` &&
    isString(b.amountInr) && /^\d+(\.\d{1,2})?$/.test(b.amountInr) && isString(b.taxRatePercent) && /^\d{1,3}(\.\d{1,2})?$/.test(b.taxRatePercent) &&
    isDate(b.effectiveFrom) && isString(b.sourceReference) && isString(b.reason) && (PROPOSAL_STATES as readonly unknown[]).includes(b.state) &&
    isString(b.proposedBy) && typeof b.proposedByYou === "boolean" && isInstant(b.proposedAt) &&
    nullable(b.decidedBy, isString) && nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) &&
    nullable(b.appliedVersion, (x) => Number.isInteger(x) && (x as number) >= 1) &&
    // Only an approved proposal names the version it started, and only a pending one is undecided.
    (b.state === "approved") === (b.appliedVersion !== null) && (b.state === "pending") === (b.decidedBy === null);
  return ok ? (b as unknown as FeeRuleProposal) : null;
};

export const validateFeeRuleAdmin: Validator<FeeRuleAdmin> = (body) => {
  if (!exactKeys(body, ["today", "applicationTypes", "categories", "rules", "pending", "decided"])) return null;
  const b = body;
  const pair = (keys: string[]) => (x: unknown) => {
    const o = obj(x);
    return o !== null && exactKeys(o, keys) && keys.every((k) => isString(o[k]));
  };
  const ok =
    isDate(b.today) && Array.isArray(b.applicationTypes) && b.applicationTypes.every(pair(["code", "label"])) &&
    Array.isArray(b.categories) && b.categories.every(pair(["code", "name"])) && Array.isArray(b.rules) && b.rules.every(validRule) &&
    Array.isArray(b.pending) && b.pending.every((p) => validateFeeRuleProposal(obj(p) ?? {}) !== null && (p as { state: string }).state === "pending") &&
    Array.isArray(b.decided) && b.decided.every((p) => validateFeeRuleProposal(obj(p) ?? {}) !== null && (p as { state: string }).state !== "pending");
  return ok ? (b as unknown as FeeRuleAdmin) : null;
};

const IDEMPOTENCY_409 = ["idempotency_key_conflict", "idempotency_in_progress"] as const;

export const SPRING_FEE_RULES_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  503: ["service_unavailable"],
};
export const SPRING_FEE_RULE_PROPOSAL_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  409: IDEMPOTENCY_409,
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_FEE_RULE_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", "effective_date_passed", "rule_conflict", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_FEE_RULES = { errors: SPRING_FEE_RULES_ERRORS, validate: validateFeeRuleAdmin };
export const SPRING_FEE_RULE_PROPOSAL = { errors: SPRING_FEE_RULE_PROPOSAL_ERRORS, validate: validateFeeRuleProposal, successStatuses: [201] as const };
export const SPRING_FEE_RULE_DECISION = { errors: SPRING_FEE_RULE_DECISION_ERRORS, validate: validateFeeRuleProposal, successStatuses: [200] as const };
