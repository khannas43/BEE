/**
 * Browser client for the business-settings routes, on the screen kit: read the definitions and proposals, propose a
 * value, decide a proposal. The defaults are the owner's assumptions, not BEE rules. Spring decides who may do what;
 * this only carries the request.
 */
import { type FetchLike, type ReadFailure, runtimeCommand, runtimeRead } from "@/lib/client/runtimeHttp";

export type SettingProposalState = "pending" | "approved" | "rejected" | "withdrawn";
export type SettingDecision = "approve" | "reject" | "withdraw";

export type SettingVersion = {
  effectiveFrom: string;
  value: string;
  source: string;
};

export type BusinessSetting = {
  key: string;
  label: string;
  unit: string;
  description: string;
  warning: string | null;
  decimals: 0 | 2;
  min: string;
  max: string;
  defaultValue: string;
  valueInForce: string;
  inForceFrom: string | null;
  /** Versions approved but not yet started, earliest first. */
  scheduled: SettingVersion[];
  versions: SettingVersion[];
};

export type BusinessSettingProposal = {
  id: string;
  settingKey: string;
  label: string;
  unit: string;
  effectiveFrom: string;
  value: string;
  /** The value in force the day before this one starts. */
  valueBefore: string;
  sourceReference: string;
  reason: string;
  state: SettingProposalState;
  proposedBy: string;
  /** True when the signed-in person proposed it: they cannot approve or reject it. */
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  applied: boolean;
};

export type BusinessSettingsAdmin = {
  today: string;
  settings: BusinessSetting[];
  pending: BusinessSettingProposal[];
  decided: BusinessSettingProposal[];
};

export type BusinessSettingsResult = { ok: true; admin: BusinessSettingsAdmin } | { ok: false; failure: ReadFailure };

export const BUSINESS_SETTINGS_PATH = "/api/runtime/business-settings";
export const SETTING_PROPOSALS_PATH = "/api/runtime/business-settings/proposals";
export const settingDecisionPath = (id: string) => `/api/runtime/business-settings/proposals/${encodeURIComponent(id)}/decision`;

const parseAdmin = (body: unknown): BusinessSettingsAdmin | null =>
  body && typeof body === "object" && Array.isArray((body as BusinessSettingsAdmin).settings) && Array.isArray((body as BusinessSettingsAdmin).pending)
    ? (body as BusinessSettingsAdmin)
    : null;

const parseProposal = (body: unknown): BusinessSettingProposal | null =>
  body && typeof body === "object" && "id" in body && "state" in body && "value" in body && "valueBefore" in body && "effectiveFrom" in body
    ? (body as BusinessSettingProposal)
    : null;

export async function readBusinessSettings(fetchImpl: FetchLike = fetch): Promise<BusinessSettingsResult> {
  const r = await runtimeRead(BUSINESS_SETTINGS_PATH, parseAdmin, fetchImpl);
  return r.ok ? { ok: true, admin: r.value } : r;
}

export type ProposeSettingInput = {
  settingKey: string;
  value: string;
  effectiveFrom: string;
  sourceReference: string;
  reason: string;
};

export function runProposeSetting(p: ProposeSettingInput, idempotencyKey: string) {
  return runtimeCommand(SETTING_PROPOSALS_PATH, "POST", p, idempotencyKey, parseProposal);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const proposeSettingSignature = (p: ProposeSettingInput) => [p.settingKey, p.value, p.effectiveFrom, p.sourceReference, p.reason];

export type DecideSettingInput = { id: string; decision: SettingDecision; note?: string };

export function runDecideSetting(p: DecideSettingInput, idempotencyKey: string) {
  return runtimeCommand(settingDecisionPath(p.id), "POST", p.note ? { decision: p.decision, note: p.note } : { decision: p.decision }, idempotencyKey, parseProposal);
}

export const decideSettingSignature = (p: DecideSettingInput) => [p.id, p.decision, p.note ?? ""];
