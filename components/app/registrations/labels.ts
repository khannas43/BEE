import type { RegistrationAction, RegistrationKind, RegistrationState } from "@/lib/client/runtimeRegistrations";

/** Words for the contract's state values. The screen does not decide which state applies. */
export const REGISTRATION_STATE_LABEL: Record<RegistrationState, string> = {
  draft: "Draft",
  fee_due: "Fee due",
  programme_review: "Fee confirmed, with Programme review",
  director_approval: "With the Director",
  approved: "Approved",
  returned: "Returned",
  rejected: "Rejected",
};

export const REGISTRATION_KIND_LABEL: Record<RegistrationKind, string> = {
  brand: "Brand",
  agency: "Agency",
};

/** Fee column, keyed by the same states. The amount and the demo label still come from the fee on the record. */
export const REGISTRATION_FEE_STATE: Record<RegistrationState, string> = {
  draft: "No fee yet",
  fee_due: "Fee due",
  programme_review: "Fee confirmed",
  director_approval: "Fee confirmed",
  approved: "Fee confirmed",
  returned: "Fee confirmed",
  rejected: "Fee confirmed",
};

export const REGISTRATION_GATE_LABEL: Record<string, string> = {
  trade_licence_uploaded: "Trade licence uploaded",
  start_date_set: "Start date set",
  brand_active: "Brand still active",
  brand_name_free: "Brand name still free",
};

/** Words for a trail step. An action the table does not name is shown as the API sent it. */
export const REGISTRATION_ACTION_LABEL: Record<string, string> = {
  confirm_fee: "Fee confirmed",
  recommend: "Recommended",
  return: "Returned",
  reject: "Rejected",
  approve: "Approved",
  resubmit: "Resubmitted",
};

export const REGISTRATION_ACTOR_LABEL: Record<string, string> = {
  programme: "Programme",
  director: "the Director",
  manufacturer: "the manufacturer",
  agency: "the agency",
  finance: "Finance",
};

/**
 * Actions the role may be offered in a state. This is the brief's table, not a decision that the person may take the step:
 * Spring still refuses the wrong person, the wrong organisation and a stale version.
 */
export const REVIEW_ACTIONS: Record<string, Partial<Record<RegistrationState, readonly ("recommend" | "return" | "approve" | "reject")[]>>> = {
  programme: { programme_review: ["recommend", "return"] },
  director: { director_approval: ["approve", "return", "reject"] },
};

export function reviewActionsFor(roles: readonly string[], state: RegistrationState): ("recommend" | "return" | "approve" | "reject")[] {
  const actions: ("recommend" | "return" | "approve" | "reject")[] = [];
  for (const role of roles) {
    for (const action of REVIEW_ACTIONS[role]?.[state] ?? []) {
      if (!actions.includes(action)) actions.push(action);
    }
  }
  return actions;
}

/** States that are "Waiting for me" for these roles. A role with no row here has nothing waiting. */
export function waitingStatesFor(roles: readonly string[]): Set<RegistrationState> {
  const states = new Set<RegistrationState>();
  if (roles.includes("programme")) states.add("programme_review");
  if (roles.includes("director")) states.add("director_approval");
  return states;
}

export const DECIDED_STATES = new Set<RegistrationState>(["approved", "returned", "rejected"]);

export function applicantMayRevise(roles: readonly string[], state: RegistrationState): boolean {
  return state === "returned" && roles.some((role) => role === "manufacturer" || role === "agency");
}

export const REASON_ACTIONS = new Set<RegistrationAction>(["return", "reject"]);

export const BRAND_NAME_RULE = "1 to 120 letters, digits, space and . & ' ( ) / _ -";

/** The contract's brand-name pattern: a letter or digit, then up to 119 more of the allowed characters. */
export const BRAND_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&'()/_-]{0,119}$/u;

/** The calendar day in India, which is the day the service uses for a start date. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
