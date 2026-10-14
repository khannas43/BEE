/**
 * Browser client for delegation (WP02.4c): a stage role handed to a colleague for a short period.
 * Provisional local rules, not BEE rules. Spring decides who may ask, approve, withdraw or revoke; this only carries the request.
 */
import { type FetchLike, type ReadFailure, runtimeCommand, runtimeRead } from "@/lib/client/runtimeHttp";

export type DelegationState = "pending" | "approved" | "rejected" | "withdrawn" | "revoked";
export type DelegableRole = "director" | "finance" | "programme";
export type DelegationDecision = "approve" | "reject" | "withdraw" | "revoke";

export type Delegation = {
  id: string;
  delegator: string;
  delegate: string;
  role: DelegableRole;
  reason: string;
  validFrom: string;
  validTo: string;
  state: DelegationState;
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
};

export type DelegationColleague = {
  id: string;
  displayName: string;
  roles: string[];
};

export type Delegations = {
  today: string;
  canApprove: boolean;
  delegableRoles: DelegableRole[];
  colleagues: DelegationColleague[];
  mine: Delegation[];
  pending: Delegation[];
  decided: Delegation[];
};

export type DelegationsResult = { ok: true; delegations: Delegations } | { ok: false; failure: ReadFailure };

export const DELEGATIONS_PATH = "/api/runtime/delegations";
export const delegationDecisionPath = (id: string) => `${DELEGATIONS_PATH}/${encodeURIComponent(id)}/decision`;
export const delegationsHref = () => "/app/delegations";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseDelegations(body: unknown): Delegations | null {
  if (!isRecord(body)) return null;
  if (typeof body.today !== "string" || typeof body.canApprove !== "boolean") return null;
  if (!Array.isArray(body.delegableRoles) || !Array.isArray(body.colleagues) || !Array.isArray(body.mine) || !Array.isArray(body.pending) || !Array.isArray(body.decided)) return null;
  return body as unknown as Delegations;
}

function parseDelegation(body: unknown): Delegation | null {
  if (!isRecord(body)) return null;
  if (typeof body.id !== "string" || typeof body.state !== "string" || typeof body.role !== "string") return null;
  return body as unknown as Delegation;
}

export async function readDelegations(fetchImpl: FetchLike = fetch): Promise<DelegationsResult> {
  const r = await runtimeRead(DELEGATIONS_PATH, parseDelegations, fetchImpl);
  return r.ok ? { ok: true, delegations: r.value } : r;
}

export type RequestDelegationInput = {
  delegateId: string;
  role: DelegableRole;
  validFrom: string;
  validTo: string;
  reason: string;
};

export function runRequestDelegation(p: RequestDelegationInput, idempotencyKey: string) {
  return runtimeCommand(DELEGATIONS_PATH, "POST", p, idempotencyKey, parseDelegation);
}

export const requestDelegationSignature = (p: RequestDelegationInput) => [p.delegateId, p.role, p.validFrom, p.validTo, p.reason];

export type DecideDelegationInput = { id: string; decision: DelegationDecision; note?: string };

export function runDecideDelegation(p: DecideDelegationInput, idempotencyKey: string) {
  const body: { decision: DelegationDecision; note?: string } = { decision: p.decision };
  if ((p.decision === "reject" || p.decision === "revoke") && p.note) body.note = p.note;
  return runtimeCommand(delegationDecisionPath(p.id), "POST", body, idempotencyKey, parseDelegation);
}

export const decideDelegationSignature = (p: DecideDelegationInput) => [p.id, p.decision, p.decision === "reject" || p.decision === "revoke" ? (p.note ?? "") : ""];
