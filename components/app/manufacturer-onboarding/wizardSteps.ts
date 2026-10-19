export const MANUFACTURER_REGISTRATION_STEPS = [
  {
    id: "company",
    title: "Company & registered office",
    icon: "corporate_fare",
    blurb: "Legal entity identifiers and the registered office address as they should appear on your company registration record.",
  },
  {
    id: "facilities",
    title: "Manufacturing facilities",
    icon: "factory",
    blurb: "Each manufacturing or assembly site that will be listed on your registration.",
  },
  {
    id: "contacts",
    title: "Contacts & signatory",
    icon: "contacts",
    blurb: "Authorised signatory KYC details and an optional day-to-day company contact.",
  },
  {
    id: "annexure",
    title: "Annexure 1 documents",
    icon: "folder_open",
    blurb: "Upload stamped copies and certificates required under Annexure 1. PDF or image, up to 6 MB each.",
  },
  {
    id: "declaration",
    title: "Declaration & agreement",
    icon: "gavel",
    blurb: "Confirm the accuracy of your submission and accept the registration terms.",
  },
  {
    id: "fee",
    title: "Fee summary",
    icon: "receipt_long",
    blurb: "Review the registration fee before final submission.",
  },
  {
    id: "review",
    title: "Review & submit",
    icon: "fact_check",
    blurb: "Check every section, then submit your company registration application.",
  },
] as const;

export type ManufacturerRegistrationStepId = (typeof MANUFACTURER_REGISTRATION_STEPS)[number]["id"];

export function stepIndexForId(id: ManufacturerRegistrationStepId): number {
  return MANUFACTURER_REGISTRATION_STEPS.findIndex((s) => s.id === id);
}
