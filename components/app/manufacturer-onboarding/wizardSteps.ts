/**
 * The steps of the company registration, in the order of the Company Registration Form of section 1.1 of the SOP for the BEE S&L portal:
 * the disclaimer, the company and its equipment, the business address, the manufacturing facilities, the contact persons, the company registration
 * and financial details, the documents, the payment (registration charge and security deposit), and the review.
 */
export const MANUFACTURER_REGISTRATION_STEPS = [
  {
    id: "disclaimer",
    title: "Disclaimer",
    icon: "policy",
    blurb: "Read the disclaimer and the limitation of liability, then accept to move forward.",
  },
  {
    id: "company",
    title: "Company & equipment details",
    icon: "corporate_fare",
    blurb: "Name of the firm, category, scale of industry, the equipment and the brand being registered. Each brand is treated as an individual company.",
  },
  {
    id: "business",
    title: "Business address & contact",
    icon: "home_pin",
    blurb: "Where the business is located and how BEE can reach it.",
  },
  {
    id: "facilities",
    title: "Manufacturing facilities",
    icon: "factory",
    blurb: "Each manufacturing or assembly site, with its ISO 9001 validity.",
  },
  {
    id: "contacts",
    title: "Contact persons",
    icon: "contacts",
    blurb: "The persons BEE will contact. The first one is also the authorised signatory.",
  },
  {
    id: "registration",
    title: "Company registration & financial details",
    icon: "badge",
    blurb: "Company registration number and date, PAN and annual turnover.",
  },
  {
    id: "annexure",
    title: "Documents",
    icon: "folder_open",
    blurb: "Upload the documents of the registration. PDF or image, up to 6 MB each.",
  },
  {
    id: "payment",
    title: "Registration charge & security deposit",
    icon: "payments",
    blurb: "Pay the company registration charge and, for a large-scale industry, the label security deposit.",
  },
  {
    id: "review",
    title: "Review & submit",
    icon: "fact_check",
    blurb: "Review the agency information, then submit all if it is in order.",
  },
] as const;

export type ManufacturerRegistrationStepId = (typeof MANUFACTURER_REGISTRATION_STEPS)[number]["id"];

export function stepIndexForId(id: ManufacturerRegistrationStepId): number {
  return MANUFACTURER_REGISTRATION_STEPS.findIndex((s) => s.id === id);
}
