/**
 * Contract for GET /api/model-applications/{id}/history. Per-feature module: the BFF's validator for the history and the
 * allowed status and code table (the same read errors as every model read). Keep it equal to the operation's x-error-codes
 * in the OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, MODEL_STATES, SPRING_READ_ERRORS, UUID, type Validator } from "@/lib/server/apiContract";

export const HISTORY_ACTIONS = [
  "submit", "confirm_fee", "iame_recommend", "reviewer_forward", "compute_rating", "director_recommend", "secretary_approve", "return", "resubmit", "reject",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export interface HistoryFact {
  label: string;
  value: string;
}

export interface HistoryEvent {
  sequence: number;
  at: string;
  action: HistoryAction;
  fromState: (typeof MODEL_STATES)[number];
  toState: (typeof MODEL_STATES)[number];
  actorRole: string;
  actorName?: string;
  actorOrganisation: string;
  note?: string;
  facts: HistoryFact[];
  withheld: boolean;
}

export interface ApplicationHistory {
  applicationId: string;
  reference: string;
  viewedAs: "applicant" | "officer";
  items: HistoryEvent[];
  count: number;
}

const validFact = (f: unknown): boolean => {
  if (typeof f !== "object" || f === null) return false;
  const b = f as Record<string, unknown>;
  return exactKeys(b, ["label", "value"]) && isString(b.label) && isString(b.value);
};

const validEvent = (e: unknown, viewedAs: unknown): boolean => {
  if (typeof e !== "object" || e === null) return false;
  const b = e as Record<string, unknown>;
  if (!exactKeys(b, ["sequence", "at", "action", "fromState", "toState", "actorRole", "actorOrganisation", "facts", "withheld"], ["actorName", "note"])) return false;
  return (
    Number.isInteger(b.sequence) && (b.sequence as number) >= 1 &&
    isString(b.at) && !Number.isNaN(Date.parse(b.at)) &&
    (HISTORY_ACTIONS as readonly unknown[]).includes(b.action) &&
    (MODEL_STATES as readonly unknown[]).includes(b.fromState) && (MODEL_STATES as readonly unknown[]).includes(b.toState) &&
    isString(b.actorRole) && isString(b.actorOrganisation) &&
    Array.isArray(b.facts) && b.facts.every(validFact) && typeof b.withheld === "boolean" &&
    (b.note === undefined || isString(b.note)) &&
    (b.actorName === undefined || isString(b.actorName)) &&
    // The applicant never sees a personal name, and a withheld step shows neither a note nor facts.
    (viewedAs !== "applicant" || b.actorName === undefined) &&
    (!b.withheld || (b.note === undefined && (b.facts as unknown[]).length === 0))
  );
};

export const validateApplicationHistory: Validator<ApplicationHistory> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "viewedAs", "items", "count"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    (b.viewedAs === "applicant" || b.viewedAs === "officer") &&
    Array.isArray(b.items) && b.items.every((e) => validEvent(e, b.viewedAs)) &&
    b.count === (b.items as unknown[]).length &&
    // Oldest first, numbered from 1 without gaps.
    (b.items as { sequence: number }[]).every((e, i) => e.sequence === i + 1);
  return ok ? (b as unknown as ApplicationHistory) : null;
};

export const SPRING_HISTORY_ERRORS = SPRING_READ_ERRORS;
export const SPRING_HISTORY = { errors: SPRING_HISTORY_ERRORS, validate: validateApplicationHistory };
