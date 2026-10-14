/**
 * Browser client for the register (WP04.2b-2b): brands, agency authorisations, and proposals to close or revoke them.
 * Provisional local rules, not BEE rules. Spring decides who may propose or decide; this only carries the request.
 */
import { type FetchLike, type ReadFailure, runtimeCommand, runtimeRead } from "@/lib/client/runtimeHttp";

export type BrandStatus = "active" | "suspended" | "revoked";
export type AuthorisationStatus = "active" | "revoked";
export type RevocationState = "pending" | "approved" | "rejected" | "withdrawn";
export type RevocationTargetKind = "brand" | "authorisation";
export type RevocationAction = "revoke" | "close";
export type RevocationDecision = "approve" | "reject" | "withdraw";

export type RegisterBrandEntry = {
  id: string;
  name: string;
  owner: string;
  status: BrandStatus;
  source: string;
};

export type RegisterAuthorisationEntry = {
  id: string;
  brandId: string;
  brandName: string;
  agency: string;
  principal: string;
  validFrom: string;
  validTo: string | null;
  status: AuthorisationStatus;
  source: string;
};

export type RegisterRevocationProposal = {
  id: string;
  targetKind: RevocationTargetKind;
  targetId: string;
  targetLabel: string;
  action: RevocationAction;
  closeOn: string | null;
  reason: string;
  state: RevocationState;
  proposedBy: string;
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type RegisterRevocations = {
  today: string;
  canPropose: boolean;
  canDecide: boolean;
  brands: RegisterBrandEntry[];
  authorisations: RegisterAuthorisationEntry[];
  pending: RegisterRevocationProposal[];
  decided: RegisterRevocationProposal[];
};

export type RegisterRevocationsResult = { ok: true; register: RegisterRevocations } | { ok: false; failure: ReadFailure };

export const REGISTER_REVOCATIONS_PATH = "/api/runtime/register-revocations";
export const registerRevocationDecisionPath = (id: string) => `${REGISTER_REVOCATIONS_PATH}/${encodeURIComponent(id)}/decision`;
export const registerHref = () => "/app/registrations/register";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseRegister(body: unknown): RegisterRevocations | null {
  if (!isRecord(body)) return null;
  if (typeof body.today !== "string" || typeof body.canPropose !== "boolean" || typeof body.canDecide !== "boolean") return null;
  if (!Array.isArray(body.brands) || !Array.isArray(body.authorisations) || !Array.isArray(body.pending) || !Array.isArray(body.decided)) return null;
  return body as unknown as RegisterRevocations;
}

function parseProposal(body: unknown): RegisterRevocationProposal | null {
  if (!isRecord(body)) return null;
  if (typeof body.id !== "string" || typeof body.state !== "string" || typeof body.action !== "string" || typeof body.targetKind !== "string") return null;
  return body as unknown as RegisterRevocationProposal;
}

export async function readRegisterRevocations(fetchImpl: FetchLike = fetch): Promise<RegisterRevocationsResult> {
  const r = await runtimeRead(REGISTER_REVOCATIONS_PATH, parseRegister, fetchImpl);
  return r.ok ? { ok: true, register: r.value } : r;
}

export type ProposeRevocationInput = {
  targetKind: RevocationTargetKind;
  targetId: string;
  action: RevocationAction;
  closeOn?: string;
  reason: string;
};

export function runProposeRevocation(p: ProposeRevocationInput, idempotencyKey: string) {
  const body: { targetKind: RevocationTargetKind; targetId: string; action: RevocationAction; reason: string; closeOn?: string } = {
    targetKind: p.targetKind,
    targetId: p.targetId,
    action: p.action,
    reason: p.reason,
  };
  if (p.action === "close" && p.closeOn) body.closeOn = p.closeOn;
  return runtimeCommand(REGISTER_REVOCATIONS_PATH, "POST", body, idempotencyKey, parseProposal);
}

export const proposeRevocationSignature = (p: ProposeRevocationInput) => [p.targetKind, p.targetId, p.action, p.action === "close" ? (p.closeOn ?? "") : "", p.reason];

export type DecideRevocationInput = { id: string; decision: RevocationDecision; note?: string };

export function runDecideRevocation(p: DecideRevocationInput, idempotencyKey: string) {
  const body: { decision: RevocationDecision; note?: string } = { decision: p.decision };
  if (p.decision !== "withdraw" && p.note) body.note = p.note;
  return runtimeCommand(registerRevocationDecisionPath(p.id), "POST", body, idempotencyKey, parseProposal);
}

export const decideRevocationSignature = (p: DecideRevocationInput) => [p.id, p.decision, p.decision === "withdraw" ? "" : (p.note ?? "")];
