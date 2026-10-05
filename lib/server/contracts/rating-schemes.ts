/**
 * Contract for the rating-scheme administration routes: GET /api/rating-schemes, POST /api/rating-schemes/proposals and
 * POST /api/rating-schemes/proposals/{id}/decision. Per-feature module: the BFF's validators and allowed status and code tables.
 * Keep them equal to the operations' x-error-codes in the OpenAPI artifact. Provisional local demonstration (the owner's
 * assumption A2), not a BEE formula.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const SCHEME_PROPOSAL_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type SchemeProposalState = (typeof SCHEME_PROPOSAL_STATES)[number];

export interface RatingBand {
  stars: number;
  minIseer: string;
}

export interface RatingScheme {
  schemeKey: string;
  categoryCode: string;
  effectiveFrom: string;
  bands: RatingBand[];
  source: string;
  inForce: boolean;
}

export interface RatingSchemeProposal {
  id: string;
  categoryCode: string;
  effectiveFrom: string;
  minIseer: string[];
  sourceReference: string;
  reason: string;
  state: SchemeProposalState;
  proposedBy: string;
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedScheme: string | null;
}

export interface RatingSchemeAdmin {
  today: string;
  categories: { code: string; name: string }[];
  schemes: RatingScheme[];
  pending: RatingSchemeProposal[];
  decided: RatingSchemeProposal[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIGURE = /^\d{1,2}\.\d{2}$/;
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** Five figures, each above the one before. */
const rising = (v: unknown): boolean => Array.isArray(v) && v.length === 5 && v.every((x) => isString(x) && FIGURE.test(x)) && v.every((x, i) => i === 0 || Number(x) > Number(v[i - 1]));

const validScheme = (v: unknown): boolean => {
  const b = obj(v);
  return (
    b !== null && exactKeys(b, ["schemeKey", "categoryCode", "effectiveFrom", "bands", "source", "inForce"]) &&
    isString(b.schemeKey) && isString(b.categoryCode) && isDate(b.effectiveFrom) && isString(b.source) && typeof b.inForce === "boolean" &&
    Array.isArray(b.bands) && b.bands.length === 5 &&
    b.bands.every((x, i) => {
      const o = obj(x);
      return o !== null && exactKeys(o, ["stars", "minIseer"]) && o.stars === i + 1 && isString(o.minIseer) && FIGURE.test(o.minIseer);
    }) &&
    rising((b.bands as { minIseer: string }[]).map((x) => x.minIseer))
  );
};

export const validateRatingSchemeProposal: Validator<RatingSchemeProposal> = (body) => {
  if (!exactKeys(body, ["id", "categoryCode", "effectiveFrom", "minIseer", "sourceReference", "reason", "state", "proposedBy", "proposedByYou", "proposedAt",
    "decidedBy", "decidedAt", "decisionNote", "appliedScheme"])) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) && isString(b.categoryCode) && isDate(b.effectiveFrom) && rising(b.minIseer) && isString(b.sourceReference) && isString(b.reason) &&
    (SCHEME_PROPOSAL_STATES as readonly unknown[]).includes(b.state) && isString(b.proposedBy) && typeof b.proposedByYou === "boolean" && isInstant(b.proposedAt) &&
    nullable(b.decidedBy, isString) && nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) && nullable(b.appliedScheme, isString) &&
    // Only an approved proposal names the scheme it created, and only a pending one is undecided.
    (b.state === "approved") === (b.appliedScheme !== null) && (b.state === "pending") === (b.decidedBy === null);
  return ok ? (b as unknown as RatingSchemeProposal) : null;
};

export const validateRatingSchemeAdmin: Validator<RatingSchemeAdmin> = (body) => {
  if (!exactKeys(body, ["today", "categories", "schemes", "pending", "decided"])) return null;
  const b = body;
  const ok =
    isDate(b.today) &&
    Array.isArray(b.categories) && b.categories.every((x) => { const o = obj(x); return o !== null && exactKeys(o, ["code", "name"]) && isString(o.code) && isString(o.name); }) &&
    Array.isArray(b.schemes) && b.schemes.every(validScheme) &&
    Array.isArray(b.pending) && b.pending.every((p) => validateRatingSchemeProposal(obj(p) ?? {}) !== null && (p as { state: string }).state === "pending") &&
    Array.isArray(b.decided) && b.decided.every((p) => validateRatingSchemeProposal(obj(p) ?? {}) !== null && (p as { state: string }).state !== "pending");
  return ok ? (b as unknown as RatingSchemeAdmin) : null;
};

const IDEMPOTENCY_409 = ["idempotency_key_conflict", "idempotency_in_progress"] as const;

export const SPRING_RATING_SCHEMES_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  503: ["service_unavailable"],
};
export const SPRING_RATING_SCHEME_PROPOSAL_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  409: IDEMPOTENCY_409,
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_RATING_SCHEME_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", "effective_date_passed", "rule_conflict", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_RATING_SCHEMES = { errors: SPRING_RATING_SCHEMES_ERRORS, validate: validateRatingSchemeAdmin };
export const SPRING_RATING_SCHEME_PROPOSAL = { errors: SPRING_RATING_SCHEME_PROPOSAL_ERRORS, validate: validateRatingSchemeProposal, successStatuses: [201] as const };
export const SPRING_RATING_SCHEME_DECISION = { errors: SPRING_RATING_SCHEME_DECISION_ERRORS, validate: validateRatingSchemeProposal, successStatuses: [200] as const };
