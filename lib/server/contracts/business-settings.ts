/**
 * Contract for the business-settings routes: GET /api/business-settings, POST /api/business-settings/proposals and
 * POST /api/business-settings/proposals/{id}/decision. Per-feature module: the BFF's validators and allowed status and code tables.
 * Keep them equal to the operations' x-error-codes in the OpenAPI artifact. The defaults are the owner's assumptions (13 October
 * 2026), not BEE rules.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const SETTING_PROPOSAL_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type SettingProposalState = (typeof SETTING_PROPOSAL_STATES)[number];

export interface SettingVersion {
  effectiveFrom: string;
  value: string;
  source: string;
}

export interface BusinessSetting {
  key: string;
  label: string;
  unit: string;
  description: string;
  warning: string | null;
  decimals: number;
  min: string;
  max: string;
  defaultValue: string;
  valueInForce: string;
  inForceFrom: string | null;
  /** Versions approved but not yet started, earliest first. */
  scheduled: SettingVersion[];
  versions: SettingVersion[];
}

export interface BusinessSettingProposal {
  id: string;
  settingKey: string;
  label: string;
  unit: string;
  effectiveFrom: string;
  value: string;
  valueBefore: string;
  sourceReference: string;
  reason: string;
  state: SettingProposalState;
  proposedBy: string;
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  applied: boolean;
}

export interface BusinessSettingsAdmin {
  today: string;
  settings: BusinessSetting[];
  pending: BusinessSettingProposal[];
  decided: BusinessSettingProposal[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,10}(\.\d{1,2})?$/;
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const isNumber = (v: unknown): v is string => isString(v) && NUMBER.test(v);
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const validVersion = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["effectiveFrom", "value", "source"]) && isDate(b.effectiveFrom) && isNumber(b.value) && isString(b.source);
};

const validSetting = (v: unknown): boolean => {
  const b = obj(v);
  return (
    b !== null &&
    exactKeys(b, ["key", "label", "unit", "description", "warning", "decimals", "min", "max", "defaultValue", "valueInForce", "inForceFrom", "scheduled", "versions"]) &&
    isString(b.key) && isString(b.label) && isString(b.unit) && isString(b.description) && nullable(b.warning, isString) &&
    (b.decimals === 0 || b.decimals === 2) && isNumber(b.min) && isNumber(b.max) && isNumber(b.defaultValue) && isNumber(b.valueInForce) &&
    nullable(b.inForceFrom, isDate) && Array.isArray(b.scheduled) && b.scheduled.every(validVersion) && Array.isArray(b.versions) && b.versions.every(validVersion)
  );
};

export const validateBusinessSettingProposal: Validator<BusinessSettingProposal> = (body) => {
  if (!exactKeys(body, ["id", "settingKey", "label", "unit", "effectiveFrom", "value", "valueBefore", "sourceReference", "reason", "state", "proposedBy",
    "proposedByYou", "proposedAt", "decidedBy", "decidedAt", "decisionNote", "applied"])) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) && isString(b.settingKey) && isString(b.label) && isString(b.unit) && isDate(b.effectiveFrom) && isNumber(b.value) &&
    isNumber(b.valueBefore) && isString(b.sourceReference) && isString(b.reason) && (SETTING_PROPOSAL_STATES as readonly unknown[]).includes(b.state) &&
    isString(b.proposedBy) && typeof b.proposedByYou === "boolean" && isInstant(b.proposedAt) && nullable(b.decidedBy, isString) &&
    nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) && typeof b.applied === "boolean" &&
    // Only an approved proposal created a version, and only a pending one is undecided.
    (b.state === "approved") === b.applied && (b.state === "pending") === (b.decidedBy === null);
  return ok ? (b as unknown as BusinessSettingProposal) : null;
};

export const validateBusinessSettingsAdmin: Validator<BusinessSettingsAdmin> = (body) => {
  if (!exactKeys(body, ["today", "settings", "pending", "decided"])) return null;
  const b = body;
  const ok =
    isDate(b.today) &&
    Array.isArray(b.settings) && b.settings.every(validSetting) &&
    Array.isArray(b.pending) && b.pending.every((p) => validateBusinessSettingProposal(obj(p) ?? {}) !== null && (p as { state: string }).state === "pending") &&
    Array.isArray(b.decided) && b.decided.every((p) => validateBusinessSettingProposal(obj(p) ?? {}) !== null && (p as { state: string }).state !== "pending");
  return ok ? (b as unknown as BusinessSettingsAdmin) : null;
};

const IDEMPOTENCY_409 = ["idempotency_key_conflict", "idempotency_in_progress"] as const;

export const SPRING_BUSINESS_SETTINGS_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  503: ["service_unavailable"],
};
export const SPRING_BUSINESS_SETTING_PROPOSAL_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  409: IDEMPOTENCY_409,
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_BUSINESS_SETTING_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", "effective_date_passed", "rule_conflict", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_BUSINESS_SETTINGS = { errors: SPRING_BUSINESS_SETTINGS_ERRORS, validate: validateBusinessSettingsAdmin };
export const SPRING_BUSINESS_SETTING_PROPOSAL = { errors: SPRING_BUSINESS_SETTING_PROPOSAL_ERRORS, validate: validateBusinessSettingProposal, successStatuses: [201] as const };
export const SPRING_BUSINESS_SETTING_DECISION = { errors: SPRING_BUSINESS_SETTING_DECISION_ERRORS, validate: validateBusinessSettingProposal, successStatuses: [200] as const };
