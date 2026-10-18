/**
 * Demo-only fixture for Manufacturer 360 guided lifecycle (Brief demo WP3–WP9).
 * Replace via future work packages — see docs/demo/MANUFACTURER_360_FIXTURE.md.
 */

export const DEMO_DISCLOSURE =
  "Demonstration preview — synthetic data, not a BEE record." as const;

export const WP9_PREVIEW_LABEL = "Demo preview; production workflow planned." as const;

export type Manufacturer360Header = {
  manufacturerName: string;
  organisationId: string;
  complianceStatus: string;
  activeBrands: number;
  registeredCategories: number;
  approvedModels: number;
  qrIssued: number;
  qrUsed: number;
  productionUnits: number;
  feesPaidInr: string;
  feesOutstandingInr: string;
  renewalsDue: number;
  openDiscrepancies: number;
};

export type LifecycleStage = {
  wp: "WP3" | "WP4" | "WP5" | "WP6" | "WP7" | "WP8" | "WP9";
  title: string;
  status: string;
  recordReference: string;
  responsiblePersona: string;
  lastAction: string;
  nextAction: string;
  screenHref: string;
  screenLabel: string;
};

export type TimelineStep = { label: string; stateOrEvent: string };

export type DiscrepancyCycle = {
  issue: string;
  returnAction: string;
  applicantResponse: string;
  disposition: string;
  slaNote: string;
  continuation: string;
};

export type FinancialReconciliation = {
  applicationFeesPaidInr: string;
  qrLabelUnitsPaidInr: string;
  serialsIssued: number;
  serialsBound: number;
  serialsUnused: number;
  productionDeclaredUnits: number;
  varianceUnits: number;
  annualDueInr: string;
  annualPaidInr: string;
};

export type Wp9PreviewCard = {
  key: string;
  title: string;
  status: string;
  detail: string;
  href: string | null;
  linkLabel: string | null;
  previewOnly: boolean;
};

export const MANUFACTURER_360_HEADER: Manufacturer360Header = {
  manufacturerName: "Nova Cool Appliances Ltd.",
  organisationId: "ORG-NOVA-001 (permittee identifier — WP3)",
  complianceStatus: "Compliant with open discrepancy (returned document cycle)",
  activeBrands: 1,
  registeredCategories: 2,
  approvedModels: 3,
  qrIssued: 1240,
  qrUsed: 892,
  productionUnits: 865,
  feesPaidInr: "₹1,77,000",
  feesOutstandingInr: "₹11,800",
  renewalsDue: 1,
  openDiscrepancies: 1,
};

export const MANUFACTURER_360_STAGES: readonly LifecycleStage[] = [
  {
    wp: "WP3",
    title: "Entity, brand and category registration",
    status: "Brand registered; category RAC enabled",
    recordReference: "REG-BR-2026-NOVA / CAT-RAC",
    responsiblePersona: "Applicant (manufacturer), Programme scrutiny",
    lastAction: "Director approved brand registration (segregation: recommender ≠ approver)",
    nextAction: "Maintain entity master and category enrolment (WP3)",
    screenHref: "/app/registrations/requests",
    screenLabel: "Registration requests",
  },
  {
    wp: "WP4",
    title: "Model registration and approval",
    status: "Approved — NC-RAC-12D",
    recordReference: "MOD-2026-10101 / BEE/RAC/2026/10101",
    responsiblePersona: "Applicant → Finance → Programme → IAME → Reviewer → Director → Secretary",
    lastAction: "Secretary issued approval letter (certificate path)",
    nextAction: "Renew or amend model record (WP4 / WP9)",
    screenHref: "/app/model-label/model-dashboard",
    screenLabel: "Model dashboard",
  },
  {
    wp: "WP5",
    title: "Fees and payment controls",
    status: "Application fee paid; label fee reconciliation open",
    recordReference: "DEMO-PAY-0001 (simulated gateway)",
    responsiblePersona: "Applicant pays; Finance confirms (segregation)",
    lastAction: "Gateway callback paid; Finance confirmed application fee",
    nextAction: "Confirm remaining fee snapshot (WP5)",
    screenHref: "/app/demo/payments",
    screenLabel: "Payments demo",
  },
  {
    wp: "WP6",
    title: "QR issuance and serial register",
    status: "Batches generated; serials bound to certificate",
    recordReference: "Batch BEEQ-NOVA-2026-07",
    responsiblePersona: "Manufacturer; Programme oversight",
    lastAction: "892 serials bound; duplicates rejected at database",
    nextAction: "Bind remaining allocated serials (WP6)",
    screenHref: "/app/demo/qr",
    screenLabel: "QR batches and serials",
  },
  {
    wp: "WP7",
    title: "Production reporting and reconciliation",
    status: "Q3 declared; variance under review",
    recordReference: "PROD-NOVA-2026-Q3",
    responsiblePersona: "Manufacturer declares; Programme reconciles to QR",
    lastAction: "Quarterly production submitted",
    nextAction: "Programme reconciles declared units vs bound QR (WP7)",
    screenHref: "/app/demo/production",
    screenLabel: "Quarterly production",
  },
  {
    wp: "WP8",
    title: "Manufacturer 360",
    status: "This guided view (demo accelerator)",
    recordReference: "M360-NOVA-2026",
    responsiblePersona: "Programme, Director, Finance, Auditor",
    lastAction: "Cross-WP snapshot assembled for demonstration",
    nextAction: "Production Manufacturer 360 read model (WP8)",
    screenHref: "/app/demo/manufacturer-360",
    screenLabel: "Manufacturer 360 (this page)",
  },
  {
    wp: "WP9",
    title: "Renewal, withdrawal and cancellation",
    status: "Renewal monitored; revocation path available",
    recordReference: "REN-2027-NC-RAC-12D (planned)",
    responsiblePersona: "Applicant; Programme → Secretary (renewal A15); Director (withdrawal)",
    lastAction: "Register revocation workflow exercised on register screen",
    nextAction: "Submit renewal before validity end (WP9)",
    screenHref: "/app/model-label/renewal-or-degradation",
    screenLabel: "Renewal or degradation",
  },
];

export const MANUFACTURER_360_TIMELINE: readonly TimelineStep[] = [
  { label: "Entity verified", stateOrEvent: "organisation_master.active" },
  { label: "Brand registered", stateOrEvent: "registered_active" },
  { label: "Category enabled", stateOrEvent: "category_enrolment.rac" },
  { label: "Model filed", stateOrEvent: "model_application.submitted" },
  { label: "Fee paid", stateOrEvent: "fee_due → programme_review" },
  { label: "Discrepancy returned", stateOrEvent: "returned (document query)" },
  { label: "Applicant responded", stateOrEvent: "resubmit → programme_review" },
  { label: "Programme / Director / Secretary approval", stateOrEvent: "approved" },
  { label: "Certificate issued", stateOrEvent: "certificate + ledger anchor" },
  { label: "QR batch generated", stateOrEvent: "serials allocated" },
  { label: "Units produced", stateOrEvent: "production_declared" },
  { label: "Production reported", stateOrEvent: "quarterly_return filed" },
  { label: "Fee reconciled", stateOrEvent: "label_fee vs production variance" },
  { label: "Renewal monitored", stateOrEvent: "renewal_due_soon" },
];

export const MANUFACTURER_360_DISCREPANCY: DiscrepancyCycle = {
  issue: "Trade licence PDF missing expiry date (Annexure 1-A enclosure)",
  returnAction: "Programme return with note — applicant must upload corrected trade licence",
  applicantResponse: "Applicant replaced document and resubmitted (neutral resubmit body)",
  disposition: "Reviewer disposition accepted after resubmit; approval chain continued",
  slaNote: "Officer SLA clock paused while applicant responsible (return → resubmit)",
  continuation: "Programme recommend → Director approve → Secretary certificate issue",
};

export const MANUFACTURER_360_FINANCE: FinancialReconciliation = {
  applicationFeesPaidInr: "₹35,400 (3 × ₹11,800 incl. tax — aligns with demo payments)",
  qrLabelUnitsPaidInr: "₹1,41,600 (label units — synthetic fixture)",
  serialsIssued: 1240,
  serialsBound: 892,
  serialsUnused: 348,
  productionDeclaredUnits: 865,
  varianceUnits: 27,
  annualDueInr: "₹24,000 (rating fee — WP5 planned)",
  annualPaidInr: "₹24,000",
};

export const MANUFACTURER_360_WP9_CARDS: readonly Wp9PreviewCard[] = [
  {
    key: "renewal-due",
    title: "Renewal due",
    status: "Due in 90 days",
    detail: "Model NC-RAC-12D validity window — Table 2 / §3.5 (WP9)",
    href: "/app/model-label/renewal-or-degradation",
    linkLabel: "Open renewal screen",
    previewOnly: true,
  },
  {
    key: "renewal-submitted",
    title: "Renewal submitted",
    status: "Programme scrutiny (planned)",
    detail: "Renewal scrutiny → Programme → Secretary (Assumption A15)",
    href: null,
    linkLabel: null,
    previewOnly: true,
  },
  {
    key: "voluntary-withdrawal",
    title: "Voluntary withdrawal",
    status: "Not initiated",
    detail: "§3.7 grounds; financial clearance + Director approval",
    href: "/app/withdrawal/brand-withdrawal",
    linkLabel: "Open withdrawal screen",
    previewOnly: true,
  },
  {
    key: "cancellation-non-response",
    title: "Cancellation for non-response",
    status: "Not applicable (monitoring)",
    detail: "Table 2 row 5 / §3.4 — 60-day job deferred (BL-253, BL-256)",
    href: null,
    linkLabel: null,
    previewOnly: true,
  },
  {
    key: "revocation-active",
    title: "Active revocation workflow",
    status: "Working — register two-person rule",
    detail: "Programme proposes; Director decides — existing register revocation",
    href: "/app/registrations/register",
    linkLabel: "Open register & revocation",
    previewOnly: false,
  },
];

/** Extra working-screen links shown in the story panel (not duplicated on every stage). */
export const MANUFACTURER_360_EXTRA_LINKS = [
  { href: "/app/registrations/reviews", label: "Registration reviews (Programme/Director)" },
  { href: "/app/model-label/label-preview", label: "Label preview" },
  { href: "/app/demo/mis", label: "MIS dashboard" },
  { href: "/verify", label: "Public verify (shopper)" },
] as const;
