/**
 * Which registration the public entry links open. "account" (default) creates the sign-in first and fills the form inside the portal; "sop" follows
 * section 1.1 of the SOP: a public form, a Reference ID, then "Pay Registration Fee" and credentials after the payment. Set NEXT_PUBLIC_BEE_REGISTRATION_FLOW=sop
 * and restart the web server to switch. Local demonstration.
 */
export const SOP_REGISTRATION_FLOW = process.env.NEXT_PUBLIC_BEE_REGISTRATION_FLOW === "sop";
export const REGISTRATION_HREF = SOP_REGISTRATION_FLOW ? "/register/agency" : "/register/manufacturer";
