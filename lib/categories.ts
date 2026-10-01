import { RoleKey, isExternalRole } from "./roles";

/**
 * Two-level console navigation (DDD IA revision).
 *
 * The 14 low-level modules of Annex A.1 are regrouped into 9 top-level
 * categories (A–I). Each category exposes a small, curated set of entry
 * points — NOT the full 140-screen catalogue — so an operator sees only the
 * work relevant to their role. Every item routes to an existing
 * /app/[module]/[screen] page; nothing is removed. The complete catalogue
 * stays reachable at /app/screens for reference only.
 *
 * Visibility is decided at TWO levels:
 *   1. Category grant — ROLE_CATEGORIES lists the categories a role may open.
 *   2. Item scope — each item may narrow visibility further. External partner
 *      roles (manufacturer, agency, IAME, SDA, laboratory) see ONLY the items
 *      whose `ext` list names them; they never inherit the internal officer
 *      items in a shared category. Internal roles see every item in a granted
 *      category unless the item's `hideFrom` names them.
 *
 * The same policy drives the sidebar, the route guard and the automated audit
 * (scripts/access-audit.*), so the menu and the guard can never disagree.
 */
export interface CategoryItem {
  en: string;
  hi: string;
  href: string;
  icon: string;
  /** External partner roles allowed to see this item. Absent ⇒ internal-only. */
  ext?: RoleKey[];
  /** Internal roles explicitly denied this item (rare). */
  hideFrom?: RoleKey[];
}

export interface Category {
  id: string;
  en: string;
  hi: string;
  icon: string;
  items: CategoryItem[];
}

/** All external partner roles — the default `ext` for partner-facing items. */
const ALL_EXTERNAL: RoleKey[] = ["manufacturer", "agency", "iame", "sda", "laboratory"];
/** Manufacturer + agency together own the registration/label/production journey. */
const MFR_AGENCY: RoleKey[] = ["manufacturer", "agency"];
/** All internal roles — used to scope an item to external partners only. */
const ALL_INTERNAL: RoleKey[] = ["admin", "programme", "reviewer", "director", "secretary", "finance", "helpdesk", "auditor"];

export const CATEGORIES: Category[] = [
  {
    id: "home",
    en: "Home",
    hi: "मुख्य",
    icon: "home",
    items: [
      { en: "Dashboard", hi: "डैशबोर्ड", href: "/app", icon: "dashboard", ext: ALL_EXTERNAL },
      { en: "My work", hi: "मेरा कार्य", href: "/app/workflow/personal-inbox", icon: "inbox", ext: ALL_EXTERNAL },
      { en: "Approvals", hi: "अनुमोदन", href: "/app/workflow/my-approvals", icon: "task_alt" },
      { en: "SLA and escalations", hi: "एसएलए एवं एस्केलेशन", href: "/app/workflow/escalation-dashboard", icon: "priority_high" },
    ],
  },
  {
    id: "registrations",
    en: "Registrations",
    hi: "पंजीकरण",
    icon: "how_to_reg",
    items: [
      { en: "Organisations and users", hi: "संगठन एवं उपयोगकर्ता", href: "/app/identity/organisation-users", icon: "groups" },
      { en: "Agency registrations", hi: "एजेंसी पंजीकरण", href: "/app/registrations/record", icon: "domain", ext: ["agency"] },
      { en: "Brands", hi: "ब्रांड", href: "/app/agency-brand/brand-registration", icon: "sell", ext: MFR_AGENCY },
      { en: "Model applications", hi: "मॉडल आवेदन", href: "/app/model-label/new-model-application", icon: "note_add", ext: MFR_AGENCY },
      { en: "My model applications", hi: "मेरे मॉडल आवेदन", href: "/app/model-label/model-dashboard", icon: "view_list", ext: MFR_AGENCY },
      { en: "Renewals and changes", hi: "नवीनीकरण एवं परिवर्तन", href: "/app/model-label/renewal-or-degradation", icon: "autorenew", ext: MFR_AGENCY },
      { en: "Withdrawals", hi: "वापसी", href: "/app/withdrawal/brand-withdrawal", icon: "cancel", ext: MFR_AGENCY },
      // Partner-only: an applicant's own fee status and receipts for their
      // applications. Internal finance uses the Finance workspace instead.
      { en: "Payments and receipts", hi: "भुगतान एवं रसीदें", href: "/app/model-label/model-payment", icon: "receipt_long", ext: MFR_AGENCY, hideFrom: ALL_INTERNAL },
    ],
  },
  {
    id: "labels-production",
    en: "Labels and Production",
    hi: "लेबल एवं उत्पादन",
    icon: "label",
    items: [
      { en: "Labels and certificates", hi: "लेबल एवं प्रमाणपत्र", href: "/app/model-label/label-preview", icon: "verified_user", ext: MFR_AGENCY },
      { en: "QR batches", hi: "QR बैच", href: "/app/qr/batch", icon: "qr_code_2", ext: MFR_AGENCY },
      { en: "Production submissions", hi: "उत्पादन प्रस्तुति", href: "/app/production/quarterly-submission", icon: "factory", ext: MFR_AGENCY },
      { en: "Bulk uploads", hi: "बल्क अपलोड", href: "/app/production/bulk-upload", icon: "upload_file", ext: MFR_AGENCY },
      { en: "Validation and reconciliation", hi: "सत्यापन एवं समाधान", href: "/app/production/reconciliation", icon: "rule" },
      { en: "Compliance exceptions", hi: "अनुपालन अपवाद", href: "/app/production/compliance-exceptions", icon: "report" },
    ],
  },
  {
    id: "compliance",
    en: "Compliance and Enforcement",
    hi: "अनुपालन एवं प्रवर्तन",
    icon: "gavel",
    items: [
      { en: "Enforcement dashboard", hi: "प्रवर्तन डैशबोर्ड", href: "/app/mis-ai/enforcement-dashboard", icon: "monitoring", ext: ["sda"] },
      { en: "Sampling plans", hi: "नमूना योजनाएँ", href: "/app/enforcement/sample-plan", icon: "science", ext: ["sda"] },
      { en: "Enforcement cases", hi: "प्रवर्तन प्रकरण", href: "/app/enforcement/case", icon: "folder_special", ext: ["iame", "sda"] },
      { en: "Laboratory testing", hi: "प्रयोगशाला परीक्षण", href: "/app/enforcement/laboratory-assignment", icon: "biotech", ext: ["laboratory"] },
      { en: "Challenge testing", hi: "चुनौती परीक्षण", href: "/app/enforcement/challenge-test", icon: "fact_check", ext: ["iame", "laboratory"] },
      { en: "Show-cause and penalties", hi: "कारण बताओ एवं दंड", href: "/app/enforcement/show-cause", icon: "gavel" },
      { en: "Closure and appeals", hi: "समापन एवं अपील", href: "/app/enforcement/enforcement-decision", icon: "how_to_vote" },
    ],
  },
  {
    id: "finance",
    en: "Finance",
    hi: "वित्त",
    icon: "payments",
    items: [
      { en: "Finance work queue", hi: "वित्त कार्य कतार", href: "/app/finance/finance-queue", icon: "inbox" },
      { en: "Transactions", hi: "लेन-देन", href: "/app/finance/transaction-search", icon: "receipt_long" },
      { en: "Reconciliation", hi: "समाधान", href: "/app/finance/payment-reconciliation", icon: "rule" },
      { en: "Refunds and exceptions", hi: "रिफंड एवं अपवाद", href: "/app/finance/refund", icon: "undo" },
      { en: "Deposits and ledgers", hi: "जमा एवं बहीखाते", href: "/app/finance/security-deposit-ledger", icon: "account_balance" },
    ],
  },
  {
    id: "support",
    en: "Support",
    hi: "सहायता",
    icon: "support_agent",
    items: [
      { en: "Raise / track ticket", hi: "टिकट दर्ज / ट्रैक", href: "/app/helpdesk/raise-ticket", icon: "confirmation_number", ext: ALL_EXTERNAL },
      { en: "Agent workspace", hi: "एजेंट कार्यक्षेत्र", href: "/app/helpdesk/workspace", icon: "headset_mic" },
      { en: "Knowledge base", hi: "ज्ञान आधार", href: "/app/helpdesk/knowledge-base", icon: "menu_book", ext: ALL_EXTERNAL },
      { en: "SLA dashboard", hi: "एसएलए डैशबोर्ड", href: "/app/helpdesk/sla-dashboard", icon: "speed" },
    ],
  },
  {
    id: "insights",
    en: "Insights and AI",
    hi: "अंतर्दृष्टि एवं एआई",
    icon: "insights",
    items: [
      { en: "Executive MIS", hi: "कार्यकारी एमआईएस", href: "/app/mis-ai/executive-mis", icon: "leaderboard" },
      { en: "Operational dashboards", hi: "परिचालन डैशबोर्ड", href: "/app/mis-ai/registration-dashboard", icon: "dashboard", ext: ["sda"] },
      { en: "Report builder", hi: "रिपोर्ट बिल्डर", href: "/app/mis-ai/report-builder", icon: "build" },
      { en: "Scheduled reports", hi: "अनुसूचित रिपोर्ट", href: "/app/mis-ai/scheduled-reports", icon: "schedule" },
      { en: "AI Insights", hi: "एआई अंतर्दृष्टि", href: "/app/ai", icon: "auto_awesome" },
      { en: "Data quality", hi: "डेटा गुणवत्ता", href: "/app/mis-ai/data-quality", icon: "verified" },
      { en: "AI model governance", hi: "एआई मॉडल गवर्नेंस", href: "/app/mis-ai/model-monitoring", icon: "shield" },
    ],
  },
  {
    id: "administration",
    en: "Administration",
    hi: "प्रशासन",
    icon: "settings",
    items: [
      { en: "Users, roles and delegation", hi: "उपयोगकर्ता, भूमिका एवं प्रत्यायोजन", href: "/app/identity/access-management", icon: "manage_accounts" },
      { en: "Master data", hi: "मास्टर डेटा", href: "/app/administration/appliance-master", icon: "database" },
      { en: "Rules and formulas", hi: "नियम एवं सूत्र", href: "/app/administration/rating-formula", icon: "functions" },
      { en: "Workflow and SLA configuration", hi: "कार्यप्रवाह एवं एसएलए कॉन्फ़िग", href: "/app/administration/workflow-configuration", icon: "account_tree" },
      { en: "Fees and document requirements", hi: "शुल्क एवं दस्तावेज़ आवश्यकताएँ", href: "/app/administration/fee-rules", icon: "request_quote" },
      { en: "Notifications and templates", hi: "अधिसूचना एवं टेम्पलेट", href: "/app/administration/notification-templates", icon: "mail" },
      { en: "Integrations", hi: "एकीकरण", href: "/app/administration/reference-publication", icon: "hub" },
    ],
  },
  {
    id: "audit",
    en: "Audit",
    hi: "अंकेक्षण",
    icon: "policy",
    items: [
      { en: "Business audit", hi: "व्यावसायिक अंकेक्षण", href: "/app/audit/business-audit-search", icon: "search" },
      { en: "Security events", hi: "सुरक्षा घटनाएँ", href: "/app/audit/security-event-review", icon: "security" },
      { en: "Configuration changes", hi: "कॉन्फ़िगरेशन परिवर्तन", href: "/app/audit/configuration-history", icon: "history" },
      { en: "Integration monitoring", hi: "एकीकरण निगरानी", href: "/app/audit/integration-correlation", icon: "lan" },
    ],
  },
];

/**
 * Category grants (DDD IA revision, §1). Operators never see the whole
 * catalogue — only the categories relevant to their function. External partner
 * roles are additionally narrowed to the partner items inside each category
 * (see `ext` above), so a manufacturer never sees the BEE finance queue, the
 * helpdesk agent workspace or the internal approval queue.
 */
export const ROLE_CATEGORIES: Record<RoleKey, string[]> = {
  // Internal BEE roles
  admin: ["home", "administration", "audit", "insights"],
  programme: ["home", "registrations", "labels-production", "compliance", "insights"],
  reviewer: ["home", "registrations", "labels-production", "compliance", "insights"],
  director: ["home", "insights"],
  secretary: ["home", "insights"],
  finance: ["home", "finance", "registrations", "insights"],
  helpdesk: ["home", "support"],
  auditor: ["home", "audit", "insights"],
  // External partner roles — own organisation / assignments only.
  manufacturer: ["home", "registrations", "labels-production", "support"],
  agency: ["home", "registrations", "labels-production", "support"],
  iame: ["home", "compliance", "support"],
  sda: ["home", "compliance", "insights", "support"],
  laboratory: ["home", "compliance", "support"],
};

/**
 * Workflow action screens are reachable by the roles that own that step, even
 * when the screen's module is not otherwise in their menu — so a personal-inbox
 * task never resolves to a "Not available for your role" page. Partners get
 * their own scoped read (e.g. a manufacturer viewing its own fee/receipt).
 */
export const WORKFLOW_ACCESS: Record<string, RoleKey[]> = {
  "/app/model-label/model-payment": ["finance", "manufacturer", "agency"],
  "/app/model-label/iame-scrutiny": ["iame", "reviewer", "programme"],
  "/app/model-label/bee-scrutiny": ["reviewer", "programme"],
  "/app/model-label/director-approval": ["director", "secretary"],
  "/app/model-label/secretary-approval": ["secretary", "director"],
  "/app/model-label/rating-calculation": ["programme"],
};

/** Whether a single item is visible to a role (item-level scope). */
export function itemVisibleTo(item: CategoryItem, role: RoleKey): boolean {
  if (isExternalRole(role)) return !!item.ext?.includes(role);
  return !item.hideFrom?.includes(role);
}

/**
 * The role's actual menu: granted categories, each with only the items the
 * role may see, and categories with no visible item removed. This is the
 * single source the sidebar renders and the audit checks.
 */
export function categoriesForRole(role: RoleKey): Category[] {
  const allowed = ROLE_CATEGORIES[role] ?? CATEGORIES.map((c) => c.id);
  return CATEGORIES
    .filter((c) => allowed.includes(c.id))
    .map((c) => ({ ...c, items: c.items.filter((it) => itemVisibleTo(it, role)) }))
    .filter((c) => c.items.length > 0);
}

/** The exact menu item for a path within a category, if any. */
function exactItem(cat: Category, pathname: string): CategoryItem | undefined {
  return cat.items.find((it) => it.href.split("?")[0] === pathname);
}

/**
 * Single access decision for a console path — the same policy the sidebar,
 * the route guard and the tests use. Default deny: an unknown path, a
 * category the role is not granted, or (for partners) a path that is not one
 * of their curated items is refused.
 */
export function canRoleAccessPath(role: RoleKey, pathname: string): boolean {
  // Console shell + dev catalogue are always reachable once authenticated.
  if (pathname === "/app" || pathname === "/app/screens") return true;
  // Workflow action screens: reachable by the step's owner roles.
  if (WORKFLOW_ACCESS[pathname]?.includes(role)) return true;
  const cat = categoryForPath(pathname);
  if (!cat) return false;                       // unmapped protected path → deny
  const allowed = ROLE_CATEGORIES[role] ?? [];
  if (!allowed.includes(cat.id)) return false;  // category not granted → deny
  const item = exactItem(cat, pathname);
  if (isExternalRole(role)) {
    // Partners reach ONLY their curated, visible items — nothing else.
    return !!item && itemVisibleTo(item, role);
  }
  // Internal roles: category-level access, minus any explicitly hidden item.
  return item ? itemVisibleTo(item, role) : true;
}

/** Which category a given /app path belongs to (for active-state + auto-open). */
export function categoryForPath(pathname: string): Category | undefined {
  // exact item match first (handles screens shared across categories)
  const exact = CATEGORIES.find((c) => c.items.some((it) => it.href === pathname));
  if (exact) return exact;
  // The mis-ai module is split across categories: the enforcement dashboard is
  // an exact Compliance item (handled above), while every other MIS/AI screen —
  // including the AI use-case detail pages reached from the AI Insights
  // landing (risk-scoring, chatbot-review, anomaly-detection, …) — belongs to
  // Insights. Resolve those to Insights instead of the first segment match.
  if (pathname.startsWith("/app/mis-ai/")) return CATEGORIES.find((c) => c.id === "insights");
  // else match by /app/<module> segment
  const seg = pathname.split("/").slice(0, 3).join("/"); // "/app/<module>"
  return CATEGORIES.find((c) =>
    c.items.some((it) => it.href === seg || it.href.startsWith(seg + "/"))
  );
}
