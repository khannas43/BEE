import type { RegistrationKind, RegistrationState } from "@/lib/client/runtimeRegistrations";

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

export const BRAND_NAME_RULE = "1 to 120 letters, digits, space and . & ' ( ) / _ -";

/** The contract's brand-name pattern: a letter or digit, then up to 119 more of the allowed characters. */
export const BRAND_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&'()/_-]{0,119}$/u;

/** The calendar day in India, which is the day the service uses for a start date. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
