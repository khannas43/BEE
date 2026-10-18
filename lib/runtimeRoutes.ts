/**
 * Screens backed by the real BEE service rather than prototype fixtures. Their menu
 * entries come from the Spring-reported identity (/api/runtime/me), not the development
 * preview role, and the preview display filter does not apply to them. Showing a link
 * grants nothing: Spring, through the Next.js BFF, decides every record the screen shows.
 */
export interface RuntimeRoute {
  href: string;
  en: string;
  hi: string;
  icon: string;
  /** Spring roles (from /api/runtime/me) that get the menu entry. A navigation hint only. */
  navRoles: readonly string[];
  /** Permissions (from /api/runtime/me) that also get the menu entry, whatever the role: a role given the permission later sees the screen. */
  navCapabilities?: readonly string[];
  /** What the screen actually does today, shown instead of preview access chips. */
  implemented: readonly string[];
}

export const RUNTIME_ROUTES: readonly RuntimeRoute[] = [
  {
    href: "/app/demo/executive",
    en: "Executive dashboard",
    hi: "कार्यकारी डैशबोर्ड",
    icon: "space_dashboard",
    navRoles: ["director", "secretary", "programme", "admin"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/manufacturer-360",
    en: "Manufacturer 360",
    hi: "निर्माता 360",
    icon: "hub",
    navRoles: ["manufacturer", "agency", "programme", "director", "secretary", "finance", "auditor", "admin"],
    implemented: ["Guided WP3–WP9 synthetic lifecycle; links to working demo and registration screens"],
  },
  {
    href: "/app/demo/payments",
    en: "Payments",
    hi: "भुगतान",
    icon: "payments",
    navRoles: ["manufacturer", "agency", "finance", "admin"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/qr",
    en: "QR batches and serials",
    hi: "क्यूआर बैच और सीरियल",
    icon: "qr_code_2",
    navRoles: ["manufacturer", "agency", "programme", "admin"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/ledger",
    en: "Certificate ledger",
    hi: "प्रमाणपत्र लेजर",
    icon: "link",
    navRoles: ["manufacturer", "agency", "programme", "secretary", "admin", "auditor"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/production",
    en: "Quarterly production",
    hi: "त्रैमासिक उत्पादन",
    icon: "factory",
    navRoles: ["manufacturer", "agency", "programme", "admin"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/director",
    en: "Director's dashboard",
    hi: "निदेशक डैशबोर्ड",
    icon: "dashboard",
    navRoles: ["director", "secretary", "programme", "admin"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/auditor",
    en: "Auditor's dashboard",
    hi: "लेखापरीक्षक डैशबोर्ड",
    icon: "fact_check",
    navRoles: ["auditor", "admin"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/mis",
    en: "MIS dashboard",
    hi: "एमआईएस डैशबोर्ड",
    icon: "monitoring",
    navRoles: ["programme", "director", "secretary", "admin", "auditor", "finance"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/ai",
    en: "AI use cases",
    hi: "एआई उपयोग",
    icon: "psychology",
    navRoles: ["programme", "reviewer", "director", "secretary", "admin", "auditor", "helpdesk"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/demo/notifications",
    en: "Notifications (email and SMS)",
    hi: "सूचनाएँ (ईमेल और एसएमएस)",
    icon: "notifications_active",
    navRoles: ["manufacturer", "agency", "finance", "programme", "reviewer", "director", "secretary", "admin", "auditor", "helpdesk", "iame"],
    implemented: ["Local demonstration on the owner's assumptions, not BEE rules"],
  },
  {
    href: "/app/administration/fee-rules",
    en: "Fee rules",
    hi: "शुल्क नियम",
    icon: "request_quote",
    navRoles: [],
    navCapabilities: ["fee_rule_manage"],
    implemented: ["See every fee rule and its dates", "Propose a rule from a date", "Approve or reject a colleague's proposal", "Withdraw your own proposal"],
  },
  {
    href: "/app/finance/receipt",
    en: "Fee receipts",
    hi: "शुल्क रसीदें",
    icon: "receipt_long",
    navRoles: [],
    navCapabilities: ["fee_confirmation_correct"],
    implemented: ["See the fee confirmations and any correction", "Propose a correction to a receipt reference or date", "Approve or reject a colleague's correction", "Withdraw your own correction"],
  },
  {
    href: "/app/administration/rating-formula",
    en: "Rating schemes",
    hi: "रेटिंग योजना",
    icon: "star",
    navRoles: [],
    navCapabilities: ["rating_scheme_manage"],
    implemented: ["See every rating scheme and when it starts", "Propose a scheme from a date", "Approve or reject a colleague's proposal", "Withdraw your own proposal"],
  },
  {
    href: "/app/administration/business-settings",
    en: "Business settings",
    hi: "व्यवसाय सेटिंग",
    icon: "tune",
    navRoles: [],
    navCapabilities: ["business_setting_manage"],
    implemented: ["See every business number and the value in force", "Propose a change from a date", "Approve or reject a colleague's proposal", "Withdraw your own proposal"],
  },
  {
    href: "/app/workflow/personal-inbox",
    en: "My work",
    hi: "मेरा कार्य",
    icon: "inbox",
    navRoles: ["manufacturer", "agency", "finance", "iame", "reviewer", "programme", "director", "secretary"],
    implemented: ["List the applications waiting for you", "Open the screen where each is done"],
  },
  {
    href: "/app/workflow/my-approvals",
    en: "My approvals",
    hi: "मेरे अनुमोदन",
    icon: "how_to_reg",
    navRoles: ["director", "secretary"],
    implemented: ["List the applications waiting for your decision", "Open the approval screen"],
  },
  {
    href: "/app/workflow/application-review",
    en: "Application review",
    hi: "आवेदन समीक्षा",
    icon: "rule",
    navRoles: [],
    implemented: ["List the applications in progress", "Link to your next action", "Link to the history"],
  },
  {
    href: "/app/workflow/workflow-history",
    en: "Workflow history",
    hi: "कार्यप्रवाह इतिहास",
    icon: "history",
    navRoles: [],
    implemented: ["Choose an application", "Read its steps as you are allowed to see them"],
  },
  {
    href: "/app/workflow/escalation-dashboard",
    en: "SLA and escalations",
    hi: "एसएलए एवं एस्केलेशन",
    icon: "priority_high",
    navRoles: [],
    implemented: ["Count the applications waiting at each stage (no time limits are set yet)"],
  },
  {
    href: "/app/registrations/requests",
    en: "Registration requests",
    hi: "पंजीकरण अनुरोध",
    icon: "app_registration",
    navRoles: ["manufacturer", "agency"],
    implemented: ["List your registration requests", "Open a request", "Start a new request"],
  },
  {
    href: "/app/registrations/new",
    en: "New registration request",
    hi: "नया पंजीकरण अनुरोध",
    icon: "note_add",
    navRoles: [],
    implemented: ["File a brand request", "Ask to act for a brand", "Save a draft"],
  },
  {
    href: "/app/registrations/request",
    en: "Registration request",
    hi: "पंजीकरण अनुरोध विवरण",
    icon: "description",
    navRoles: [],
    implemented: ["See the request", "Upload the trade licence", "See the fee and submit", "Follow the request until Programme review", "Recommend or return", "Approve, return or reject", "See why it was returned and resubmit"],
  },
  {
    href: "/app/registrations/fees",
    en: "Registration fees",
    hi: "पंजीकरण शुल्क",
    icon: "request_quote",
    navRoles: ["finance"],
    implemented: ["List registrations waiting for their fee", "Confirm that the fee was received"],
  },
  {
    href: "/app/registrations/reviews",
    en: "Registration reviews",
    hi: "पंजीकरण समीक्षा",
    icon: "rate_review",
    navRoles: ["programme", "director"],
    implemented: ["List requests waiting for you", "Recommend or return", "Approve, return or reject", "Read the trail"],
  },
  {
    href: "/app/registrations/register",
    en: "Register",
    hi: "रजिस्टर",
    icon: "menu_book",
    navRoles: ["programme", "director"],
    implemented: ["See registered brands and authorisations", "Propose a closure or revocation", "Approve, reject or withdraw a proposal", "Read the history"],
  },
  {
    href: "/app/model-label/model-dashboard",
    en: "My model applications",
    hi: "मेरे मॉडल आवेदन",
    icon: "view_list",
    navRoles: ["manufacturer", "agency"],
    implemented: ["List", "View detail", "Edit draft", "Submit draft", "See why it was returned", "Edit and resubmit", "See why it was rejected", "See the history"],
  },
  {
    href: "/app/model-label/new-model-application",
    en: "New model application",
    hi: "नया मॉडल आवेदन",
    icon: "note_add",
    navRoles: ["manufacturer", "agency"],
    implemented: ["Create draft", "Edit draft", "Upload test reports", "Submit draft", "Edit and resubmit a returned application"],
  },
  {
    href: "/app/model-label/notifications",
    en: "Notifications",
    hi: "सूचनाएँ",
    icon: "notifications",
    navRoles: ["manufacturer", "agency"],
    implemented: ["See updates about your applications", "Open the screen to act", "Mark one or all as read"],
  },
  {
    href: "/app/model-label/label-preview",
    en: "Certificate and label",
    hi: "प्रमाणपत्र एवं लेबल",
    icon: "verified_user",
    navRoles: ["manufacturer", "agency"],
    implemented: ["List your approved applications", "Open the printable certificate and star label", "Print or save as PDF", "A QR code that opens the public verification page"],
  },
  {
    href: "/app/finance/finance-queue",
    en: "Finance queue",
    hi: "वित्त कतार",
    icon: "payments",
    navRoles: ["finance"],
    implemented: ["List fee-due applications", "View fee and evidence", "Confirm fee received"],
  },
  {
    href: "/app/model-label/iame-scrutiny",
    en: "IAME scrutiny",
    hi: "आईएएमई जाँच",
    icon: "fact_check",
    navRoles: ["iame"],
    implemented: ["List assigned applications", "View evidence and test reports", "Record finding and forward", "Return to the applicant", "Reject permanently", "See the earlier steps and notes"],
  },
  {
    href: "/app/model-label/bee-scrutiny",
    en: "BEE scrutiny",
    hi: "बीईई जाँच",
    icon: "rule",
    navRoles: ["reviewer"],
    implemented: ["List assigned applications", "View evidence and test reports", "Forward to rating", "Return to the applicant", "Reject permanently", "See the earlier steps and notes"],
  },
  {
    href: "/app/model-label/rating-calculation",
    en: "Rating calculation",
    hi: "रेटिंग गणना",
    icon: "star",
    navRoles: ["programme"],
    implemented: ["List applications awaiting a rating", "View evidence and test reports", "Compute and record a provisional local rating", "Reject permanently", "See the earlier steps and notes"],
  },
  {
    href: "/app/model-label/director-approval",
    en: "Approval",
    hi: "अनुमोदन",
    icon: "how_to_reg",
    navRoles: ["director", "secretary"],
    implemented: ["List applications awaiting your decision", "View the rating, evidence and test reports", "Recommend approval (Director)", "Give final approval (Secretary)", "Return to the applicant", "Reject permanently", "See the earlier steps and notes"],
  },
  {
    href: "/app/manufacturer/onboarding",
    en: "Company registration (demo)",
    hi: "कंपनी पंजीकरण (डेमो)",
    icon: "factory",
    navRoles: ["manufacturer"],
    implemented: ["Optimized manufacturer/company registration wizard (demonstration fixture)", "Save and resume", "Simulated payment and automated checks on submit"],
  },
  {
    href: "/app/manufacturer/director",
    en: "Manufacturer registration decisions",
    hi: "निर्माता पंजीकरण निर्णय",
    icon: "how_to_reg",
    navRoles: ["director"],
    implemented: ["Director queue for company registration", "Approve or reject with mandatory reason", "View payment and automated-check evidence"],
  },
  {
    href: "/app/manufacturer/monitoring",
    en: "Manufacturer observation monitoring",
    hi: "निर्माता अवलोकन निगरानी",
    icon: "insights",
    navRoles: ["director", "finance", "programme"],
    implemented: ["15-day observation status", "Finance/Programme anomaly raise", "Director resolve or revoke on hold"],
  },
  {
    href: "/app/delegations",
    en: "Delegations",
    hi: "प्रत्यायोजन",
    icon: "group",
    navRoles: ["programme", "director", "finance", "admin"],
    implemented: ["Ask to delegate a role", "Withdraw or revoke your delegation", "Approve or reject a request", "See what you hold and until when"],
  },
];

const MANUFACTURER_RUNTIME_PREFIXES = ["/app/manufacturer/application/", "/app/manufacturer/360/"] as const;

export function runtimeRouteFor(pathname: string): RuntimeRoute | undefined {
  const exact = RUNTIME_ROUTES.find((r) => r.href === pathname);
  if (exact) return exact;
  if (MANUFACTURER_RUNTIME_PREFIXES.some((p) => pathname.startsWith(p))) {
    return RUNTIME_ROUTES.find((r) => r.href === "/app/manufacturer/onboarding");
  }
  return undefined;
}

/**
 * The order of the menu, whatever the role: dashboards, then the person's own work, registrations, applications and certificates, then the
 * scrutiny and approval steps, money, the demonstration screens and finally administration. A route not listed goes last, in the order above.
 */
const MENU_ORDER: string[] = [
  "/app/demo/executive", "/app/demo/manufacturer-360", "/app/demo/director", "/app/demo/auditor", "/app/demo/mis",
  "/app/workflow/personal-inbox", "/app/workflow/my-approvals", "/app/model-label/director-approval", "/app/workflow/application-review", "/app/workflow/workflow-history", "/app/workflow/escalation-dashboard",
  "/app/registrations/requests", "/app/registrations/new", "/app/registrations/request", "/app/registrations/reviews", "/app/registrations/register",
  "/app/manufacturer/onboarding", "/app/manufacturer/director", "/app/manufacturer/monitoring",
  "/app/model-label/new-model-application", "/app/model-label/model-dashboard", "/app/model-label/label-preview", "/app/model-label/notifications",
  "/app/model-label/iame-scrutiny", "/app/model-label/bee-scrutiny", "/app/model-label/rating-calculation",
  "/app/finance/finance-queue", "/app/registrations/fees", "/app/finance/receipt", "/app/demo/payments",
  "/app/demo/qr", "/app/demo/ledger", "/app/demo/production", "/app/demo/ai", "/app/demo/notifications",
  "/app/administration/fee-rules", "/app/administration/rating-formula", "/app/administration/business-settings", "/app/delegations",
];
export const menuRank = (href: string) => {
  if (href === "/app") return -1; // the landing Dashboard leads
  const i = MENU_ORDER.indexOf(href);
  return i === -1 ? MENU_ORDER.length : i;
};

/** Menu entries for a Spring identity: by role, or by a permission the roles hold; empty for no identity or no match. */
export function runtimeNavFor(
  roles: readonly { role: string }[] | null | undefined,
  capabilities: readonly string[] = [],
): RuntimeRoute[] {
  if (!roles?.length) return [];
  return RUNTIME_ROUTES.filter(
    (r) => roles.some((g) => r.navRoles.includes(g.role)) || (r.navCapabilities ?? []).some((c) => capabilities.includes(c)),
  ).sort((a, b) => menuRank(a.href) - menuRank(b.href));
}
