/**
 * Browser client for the rating-scheme administration routes, on the screen kit: read the schemes and proposals, propose a
 * scheme, decide a proposal. Provisional local demonstration (the owner's assumption A2), not a BEE formula. Spring decides who may
 * do what; this only carries the request.
 */
import { type FetchLike, type ReadFailure, runtimeCommand, runtimeRead } from "@/lib/client/runtimeHttp";

export type SchemeProposalState = "pending" | "approved" | "rejected" | "withdrawn";
export type SchemeDecision = "approve" | "reject" | "withdraw";

export type RatingBand = { stars: number; minIseer: string };
export type RatingScheme = { schemeKey: string; categoryCode: string; effectiveFrom: string; bands: RatingBand[]; source: string; inForce: boolean };

export type RatingSchemeProposal = {
  id: string;
  categoryCode: string;
  effectiveFrom: string;
  /** The lowest efficiency figure that earns 1 to 5 stars, in that order. */
  minIseer: string[];
  sourceReference: string;
  reason: string;
  state: SchemeProposalState;
  proposedBy: string;
  /** True when the signed-in person proposed it: they cannot approve or reject it. */
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedScheme: string | null;
};

export type RatingSchemeAdmin = {
  today: string;
  categories: { code: string; name: string }[];
  schemes: RatingScheme[];
  pending: RatingSchemeProposal[];
  decided: RatingSchemeProposal[];
};

export type RatingSchemesResult = { ok: true; admin: RatingSchemeAdmin } | { ok: false; failure: ReadFailure };

export const RATING_SCHEMES_PATH = "/api/runtime/rating-schemes";
export const SCHEME_PROPOSALS_PATH = "/api/runtime/rating-schemes/proposals";
export const schemeDecisionPath = (id: string) => `/api/runtime/rating-schemes/proposals/${encodeURIComponent(id)}/decision`;

const parseAdmin = (body: unknown): RatingSchemeAdmin | null =>
  body && typeof body === "object" && Array.isArray((body as RatingSchemeAdmin).schemes) && Array.isArray((body as RatingSchemeAdmin).pending) ? (body as RatingSchemeAdmin) : null;

const parseProposal = (body: unknown): RatingSchemeProposal | null =>
  body && typeof body === "object" && "id" in body && "state" in body && "minIseer" in body ? (body as RatingSchemeProposal) : null;

export async function readRatingSchemes(fetchImpl: FetchLike = fetch): Promise<RatingSchemesResult> {
  const r = await runtimeRead(RATING_SCHEMES_PATH, parseAdmin, fetchImpl);
  return r.ok ? { ok: true, admin: r.value } : r;
}

export type ProposeSchemeInput = {
  categoryCode: string;
  effectiveFrom: string;
  /** Five figures, each higher than the one before. */
  minIseer: string[];
  sourceReference: string;
  reason: string;
};

export function runProposeScheme(p: ProposeSchemeInput, idempotencyKey: string) {
  return runtimeCommand(SCHEME_PROPOSALS_PATH, "POST", p, idempotencyKey, parseProposal);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const proposeSchemeSignature = (p: ProposeSchemeInput) => [p.categoryCode, p.effectiveFrom, ...p.minIseer, p.sourceReference, p.reason];

export type DecideSchemeInput = { id: string; decision: SchemeDecision; note?: string };

export function runDecideScheme(p: DecideSchemeInput, idempotencyKey: string) {
  return runtimeCommand(schemeDecisionPath(p.id), "POST", p.note ? { decision: p.decision, note: p.note } : { decision: p.decision }, idempotencyKey, parseProposal);
}

export const decideSchemeSignature = (p: DecideSchemeInput) => [p.id, p.decision, p.note ?? ""];
