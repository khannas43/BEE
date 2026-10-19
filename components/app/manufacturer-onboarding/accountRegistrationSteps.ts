/** Public guest account step — same chrome as the in-app wizard, before the 7 application steps. */
export const MANUFACTURER_ACCOUNT_REGISTRATION_STEPS = [
  {
    id: "account",
    title: "Create applicant account",
    icon: "person_add",
    blurb:
      "Enter your details to start a manufacturer/company registration application. Email and mobile verification are simulated automatically for this demonstration.",
  },
] as const;
