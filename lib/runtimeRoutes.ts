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
];

export function runtimeRouteFor(pathname: string): RuntimeRoute | undefined {
  return RUNTIME_ROUTES.find((r) => r.href === pathname);
}

/** Menu entries for a Spring identity: by role, or by a permission the roles hold; empty for no identity or no match. */
export function runtimeNavFor(
  roles: readonly { role: string }[] | null | undefined,
  capabilities: readonly string[] = [],
): RuntimeRoute[] {
  if (!roles?.length) return [];
  return RUNTIME_ROUTES.filter(
    (r) => roles.some((g) => r.navRoles.includes(g.role)) || (r.navCapabilities ?? []).some((c) => capabilities.includes(c)),
  );
}
