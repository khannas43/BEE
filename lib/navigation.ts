/**
 * Role-based lifecycle navigation (Brief C3, owner-approved 19 October 2026).
 *
 * The one definition of the console menu: the desktop sidebar, the mobile drawer, the top-bar search, the
 * client route guard and the navigation tests all read it. The menu follows the Spring identity
 * (/api/runtime/me), never the browser preview role, and showing an entry grants nothing: Spring, through
 * the BFF, decides every record a screen shows.
 *
 * Every route comes from an existing registry, so the menu cannot point at a missing page:
 *   - `live`    a RUNTIME_ROUTES screen backed by the BEE service (state `available`);
 *   - `proto`   a lib/screens prototype with sample data (state `preview`);
 *   - `page`    a standalone page listed in STANDALONE_PAGES;
 *   - `PLANNED` no route; shown with a "Planned" label and not a link.
 */
import { canRoleAccessPath } from "./categories";
import { ROLES, type RoleKey } from "./roles";
import { RUNTIME_ROUTES } from "./runtimeRoutes";
import { screenById } from "./screens";

export type NavState = "available" | "preview" | "planned";

/** The five menu hierarchies. Admin is the demonstration umbrella profile, not a workflow actor. */
export type NavProfile = "admin" | "manufacturer" | "officer" | "director" | "finance";

export interface NavEntry {
  /** Stable ID, unique across the whole definition. */
  id: string;
  title: string;
  icon: string;
  /** Canonical existing route; absent for `planned` entries and for entries that only hold children. */
  route?: string;
  /** Spring roles the entry is shown to (unless `capabilities` is set). */
  roles: readonly RoleKey[];
  /** When set, the entry is shown to whoever holds one of these permissions, whatever the role (from the runtime registry). */
  capabilities?: readonly string[];
  state: NavState;
  /** Extra path prefixes that count as this entry for highlighting (detail pages reached from it). */
  activePrefixes?: readonly string[];
  /** Query string that picks a view of the route (several entries may share one screen), e.g. "tab=rating-trends". */
  query?: string;
  /** Other queries of the same route that also count as this entry for highlighting (a record opened from it). */
  alsoQueries?: readonly string[];
  /** The entry that stands for the route when no query picks another one. */
  isDefault?: boolean;
  /** Shown in the menu only to an organisation still going through company registration; the route itself stays open for the access check. */
  registrationOnly?: boolean;
  /** Short qualifier shown beside the title, e.g. "Advisory". */
  badge?: string;
  children?: readonly NavEntry[];
}

export interface NavGroup {
  id: string;
  title: string;
  icon: string;
  profile: NavProfile;
  children: readonly NavEntry[];
}

/** Standalone pages that are neither runtime routes nor lib/screens prototypes. */
export const STANDALONE_PAGES: Readonly<Record<string, NavState>> = {
  "/verify": "available",
  "/app/identity/access-management": "preview",
};

/** Runtime routes deliberately left out of every menu, or out of the Admin menu while another role has them, with the reason; the Admin coverage tests read this. */
export const NOT_IN_MENU: Readonly<Record<string, string>> = {
  "/app/registrations/new": "Opened from Registration requests (Start a new request).",
  "/app/architecture": "Solution architecture: opened from the icon in the top bar, for every signed-in role.",
  "/app/demo/testing": "Product testing is shown to the BEE Officer only for now; it is not in the Admin menu.",
  "/app/demo/test-results": "The manufacturer's read-only view of BEE's test results; it is not in the Admin menu.",
  "/app/registrations/request": "Detail page for one request; needs the request ID.",
  "/app/demo/mis": "Programme MIS duplicates the two dashboards (Programme at a glance, Programme performance); the page still opens by link.",
  "/app/manufacturer/director":
    "Information notice that company registration activates automatically; Observation monitoring replaces it in the menu.",
};

type Target = { route?: string; state: NavState; capabilities?: readonly string[] };

function live(href: string): Target {
  const runtime = RUNTIME_ROUTES.find((r) => r.href === href);
  if (!runtime) throw new Error(`navigation: ${href} is not a runtime route`);
  return runtime.navCapabilities?.length ? { route: href, state: "available", capabilities: runtime.navCapabilities } : { route: href, state: "available" };
}

function proto(moduleId: string, screenId: string): Target {
  if (!screenById(moduleId, screenId)) throw new Error(`navigation: no prototype screen ${moduleId}/${screenId}`);
  return { route: `/app/${moduleId}/${screenId}`, state: "preview" };
}

function page(href: string): Target {
  const state = STANDALONE_PAGES[href];
  if (!state) throw new Error(`navigation: ${href} is not a listed standalone page`);
  return { route: href, state };
}

const PLANNED: Target = { state: "planned" };

const ADMIN: readonly RoleKey[] = ["admin"];
/** Officer roles without a hierarchy of their own see the Admin hierarchy, narrowed to the working screens their role is given. */
const OFFICER_ROLES: readonly RoleKey[] = ["programme", "reviewer", "iame", "sda", "laboratory", "helpdesk", "auditor"];
const MFR: readonly RoleKey[] = ["manufacturer", "agency"];
const BEE_OFFICER: readonly RoleKey[] = ["officer"];
const DIRECTOR: readonly RoleKey[] = ["director"];
const FINANCE: readonly RoleKey[] = ["finance"];

function entry(
  id: string,
  title: string,
  icon: string,
  target: Target,
  roles: readonly RoleKey[],
  extra: Pick<NavEntry, "activePrefixes" | "badge" | "query" | "alsoQueries" | "isDefault" | "registrationOnly"> = {},
): NavEntry {
  return { id, title, icon, roles, ...target, ...extra };
}

/** An Admin-hierarchy entry: Admin, plus the officer roles the runtime registry already gives the screen. */
function adminEntry(id: string, title: string, icon: string, target: Target, extra: Pick<NavEntry, "activePrefixes" | "badge" | "query" | "alsoQueries" | "isDefault" | "registrationOnly"> = {}): NavEntry {
  const runtime = target.state === "available" ? RUNTIME_ROUTES.find((r) => r.href === target.route) : undefined;
  const officers = runtime ? OFFICER_ROLES.filter((r) => runtime.navRoles.includes(r)) : [];
  return entry(id, title, icon, target, [...ADMIN, ...officers], extra);
}

/** The permission-gated administration screens; any hierarchy shows them to a person whose role has been given the permission. */
function grantedSettings(prefix: string): NavEntry {
  return parent(`${prefix}.granted-settings`, "Rules and settings", "tune", [
    entry(`${prefix}.fee-rules`, "Fee rules", "request_quote", live(R.feeRules), []),
    entry(`${prefix}.rating-schemes`, "Rating schemes", "star", live(R.ratingSchemes), []),
    entry(`${prefix}.business-settings`, "Business settings", "tune", live(R.businessSettings), []),
  ]);
}

function parent(id: string, title: string, icon: string, children: readonly NavEntry[]): NavEntry {
  const roles = [...new Set(children.flatMap((c) => c.roles))];
  const state: NavState = children.some((c) => c.state === "available") ? "available" : children.some((c) => c.state === "preview") ? "preview" : "planned";
  return { id, title, icon, roles, state, children };
}

const R = {
  executive: "/app/demo/executive",
  m360: "/app/demo/manufacturer-360",
  payments: "/app/demo/payments",
  qr: "/app/demo/qr",
  ledger: "/app/demo/ledger",
  production: "/app/demo/production",
  directorDash: "/app/demo/director",
  auditorDash: "/app/demo/auditor",
  mis: "/app/demo/mis",
  ai: "/app/demo/ai",
  messages: "/app/demo/notifications",
  requests: "/app/demo/requests",
  activity: "/app/demo/activity",
  testing: "/app/demo/testing",
  testResults: "/app/demo/test-results",
  feeRules: "/app/administration/fee-rules",
  receipts: "/app/finance/receipt",
  ratingSchemes: "/app/administration/rating-formula",
  businessSettings: "/app/administration/business-settings",
  myWork: "/app/workflow/personal-inbox",
  myApprovals: "/app/workflow/my-approvals",
  inProgress: "/app/workflow/application-review",
  history: "/app/workflow/workflow-history",
  sla: "/app/workflow/escalation-dashboard",
  regRequests: "/app/registrations/requests",
  regFees: "/app/registrations/fees",
  regReviews: "/app/registrations/reviews",
  register: "/app/registrations/register",
  myModels: "/app/model-label/model-dashboard",
  newModel: "/app/model-label/new-model-application",
  modelNotices: "/app/model-label/notifications",
  certificate: "/app/model-label/label-preview",
  financeQueue: "/app/finance/finance-queue",
  iame: "/app/model-label/iame-scrutiny",
  beeScrutiny: "/app/model-label/bee-scrutiny",
  rating: "/app/model-label/rating-calculation",
  approval: "/app/model-label/director-approval",
  onboarding: "/app/manufacturer/onboarding",
  monitoring: "/app/manufacturer/monitoring",
  delegations: "/app/delegations",
} as const;

const APPLICATION_STATUS = ["/app/manufacturer/application/"] as const;

export const NAVIGATION: readonly NavGroup[] = [
  // ---------------------------------------------------------------- Admin (demonstration umbrella)
  {
    id: "admin.executive", title: "Dashboards", icon: "space_dashboard", profile: "admin",
    children: [
      adminEntry("admin.executive-overview", "Programme performance", "space_dashboard", live(R.executive)),
      adminEntry("admin.m360", "Manufacturer 360", "hub", live(R.m360), { activePrefixes: ["/app/manufacturer/360/"] }),
      // hidden (duplicate of the two dashboards): adminEntry("admin.mis", "Programme MIS", "monitoring", live(R.mis)),
      parent("admin.work-queue", "Officer work queue", "inbox", [
        adminEntry("admin.my-work", "My work", "inbox", live(R.myWork)),
        adminEntry("admin.my-approvals", "My approvals", "task_alt", live(R.myApprovals)),
        adminEntry("admin.in-progress", "Applications in progress", "rule", live(R.inProgress)),
        adminEntry("admin.sla", "SLA and escalations", "priority_high", live(R.sla)),
      ]),
      adminEntry("admin.requests", "Service requests", "support_agent", live(R.requests)),
      adminEntry("admin.activity", "Sign-in activity", "manage_search", live(R.activity)),
      adminEntry("admin.messages", "Notifications and messages", "notifications_active", live(R.messages)),
      adminEntry("admin.director-overview", "Programme at a glance", "dashboard", live(R.directorDash)),
    ],
  },
  {
    id: "admin.registration", title: "Registration & Applications", icon: "how_to_reg", profile: "admin",
    children: [
      adminEntry("admin.company", "Company registration", "factory", live(R.onboarding), { activePrefixes: APPLICATION_STATUS }),
      parent("admin.brand", "Brand registration", "sell", [
        adminEntry("admin.brand-requests", "Registration requests", "app_registration", live(R.regRequests)),
        adminEntry("admin.brand-reviews", "Registration reviews", "rate_review", live(R.regReviews)),
      ]),
      adminEntry("admin.category", "Product category registration", "category", PLANNED),
      parent("admin.models", "Model applications", "view_list", [
        adminEntry("admin.my-models", "Model applications", "view_list", live(R.myModels)),
        adminEntry("admin.new-model", "New model application", "note_add", live(R.newModel)),
        adminEntry("admin.approval", "Approval and recommendation", "how_to_reg", live(R.approval)),
        adminEntry("admin.model-notices", "Application notifications", "notifications", live(R.modelNotices)),
      ]),
      parent("admin.documents", "Document verification", "plagiarism", [
        adminEntry("admin.iame", "IAME evidence scrutiny", "fact_check", live(R.iame)),
        adminEntry("admin.registration-documents", "Registration documents", "folder_open", proto("agency-brand", "registration-scrutiny")),
      ]),
      parent("admin.test-reports", "Test-report scrutiny", "science", [
        adminEntry("admin.bee-scrutiny", "BEE scrutiny", "rule", live(R.beeScrutiny)),
        adminEntry("admin.rating", "Rating calculation", "star", live(R.rating)),
      ]),
      adminEntry("admin.returns", "Returns and responses", "assignment_return", proto("workflow", "clarification-and-return")),
    ],
  },
  {
    id: "admin.labels", title: "Labels & Consumer Services", icon: "qr_code_2", profile: "admin",
    children: [
      adminEntry("admin.certificates", "Certificates", "verified_user", live(R.certificate)),
      adminEntry("admin.qr", "QR batches and serials", "qr_code_2", live(R.qr)),
      adminEntry("admin.consumer-verification", "Consumer verification", "travel_explore", page("/verify")),
      adminEntry("admin.suspect-labels", "Suspect-label reports", "report", PLANNED),
      adminEntry("admin.forms", "Generated forms and letters", "description", proto("model-label", "approval-letter")),
      adminEntry("admin.templates", "Official templates", "article", PLANNED),
    ],
  },
  {
    id: "admin.operations", title: "Operations & Intelligence", icon: "insights", profile: "admin",
    children: [
      parent("admin.payments", "Payments and receipts", "payments", [
        adminEntry("admin.payment-list", "Payments", "payments", live(R.payments)),
        adminEntry("admin.receipts", "Fee receipts and corrections", "receipt_long", live(R.receipts)),
        adminEntry("admin.finance-queue", "Model fee confirmation", "account_balance_wallet", live(R.financeQueue)),
        adminEntry("admin.registration-fees", "Registration fee confirmation", "request_quote", live(R.regFees)),
      ]),
      adminEntry("admin.production", "Production reporting", "factory", live(R.production)),
      adminEntry("admin.annual-reconciliation", "Annual QR reconciliation", "balance", proto("production", "reconciliation")),
      adminEntry("admin.observation", "Observation and anomalies", "insights", live(R.monitoring)),
      parent("admin.lifecycle", "Renewal, withdrawal and revocation", "autorenew", [
        adminEntry("admin.renewals", "Renewals", "autorenew", proto("model-label", "renewal-or-degradation")),
        adminEntry("admin.withdrawals", "Withdrawals", "cancel", proto("withdrawal", "withdrawal-approval")),
        adminEntry("admin.revocation", "Register and revocation", "menu_book", live(R.register)),
      ]),
      adminEntry("admin.ai", "AI advisory use cases", "psychology", live(R.ai)),
      adminEntry("admin.ledger", "Secure evidence ledger", "link", live(R.ledger)),
      parent("admin.access", "Users and access", "manage_accounts", [
        adminEntry("admin.delegations", "Delegations", "group", live(R.delegations)),
        adminEntry("admin.access-management", "Access management", "manage_accounts", page("/app/identity/access-management")),
      ]),
      parent("admin.rules", "Rules and master data", "tune", [
        adminEntry("admin.fee-rules", "Fee rules", "request_quote", live(R.feeRules)),
        adminEntry("admin.rating-schemes", "Rating schemes", "star", live(R.ratingSchemes)),
        adminEntry("admin.business-settings", "Business settings", "tune", live(R.businessSettings)),
        adminEntry("admin.master-data", "Master data", "database", proto("administration", "appliance-master")),
      ]),
      parent("admin.audit", "Audit History", "history", [
        adminEntry("admin.workflow-history", "Audit History", "history", live(R.history)),
        adminEntry("admin.audit-overview", "Audit overview", "fact_check", live(R.auditorDash)),
      ]),
    ],
  },

  // ---------------------------------------------------------------- Manufacturer (own organisation)
  {
    id: "mfr.dashboard", title: "Dashboard", icon: "dashboard", profile: "manufacturer",
    children: [entry("mfr.m360", "Manufacturer 360", "hub", live(R.m360), MFR, { activePrefixes: ["/app/manufacturer/360/"] })],
  },
  {
    id: "mfr.registration", title: "Registration & Applications", icon: "how_to_reg", profile: "manufacturer",
    children: [
      entry("mfr.company", "Company registration", "factory", live(R.onboarding), ["manufacturer"], { registrationOnly: true }),
      entry("mfr.status", "Registration status and observation", "pending_actions", live(R.onboarding), ["manufacturer"], { activePrefixes: APPLICATION_STATUS, registrationOnly: true }),
      entry("mfr.brand", "Brand and category registration", "sell", live(R.regRequests), MFR),
      parent("mfr.models", "Model applications", "view_list", [
        entry("mfr.my-models", "My model applications", "view_list", live(R.myModels), MFR),
        entry("mfr.new-model", "New model application", "note_add", live(R.newModel), MFR),
      ]),
      // hidden (documents on file are on the Manufacturer 360 profile): entry("mfr.documents", "Document uploads", "upload_file", proto("agency-brand", "company-documents"), MFR),
      entry("mfr.returned", "Personal inbox", "assignment_return", live(R.myWork), MFR),
      entry("mfr.certificates", "Certificates", "verified_user", live(R.certificate), MFR),
    ],
  },
  {
    id: "mfr.labels", title: "Labels & Operations", icon: "qr_code_2", profile: "manufacturer",
    children: [
      entry("mfr.qr", "QR batches and serials", "qr_code_2", live(R.qr), MFR),
      entry("mfr.payments", "Payments and receipts", "payments", live(R.payments), MFR),
      entry("mfr.production", "Quarterly submission", "factory", live(R.production), MFR),
      // hidden (merged into the quarterly submission screen): entry("mfr.annual-reconciliation", "Annual QR reconciliation", "balance", proto("production", "reconciliation"), MFR),
      // hidden (not shown in the demonstration): entry("mfr.forms", "Generated forms and letters", "description", proto("model-label", "approval-letter"), MFR),
    ],
  },
  {
    id: "mfr.compliance", title: "Compliance & Support", icon: "support_agent", profile: "manufacturer",
    children: [
      entry("mfr.renewals", "Renewals", "autorenew", live(R.requests), MFR, { query: "kind=renewal" }),
      entry("mfr.withdrawals", "Withdrawals", "cancel", live(R.requests), MFR, { query: "kind=withdrawal" }),
      // hidden (not shown in the demonstration): entry("mfr.holds", "Anomalies and holds", "pause_circle", PLANNED, MFR),
      entry("mfr.messages", "Messages", "notifications_active", live(R.messages), MFR),
      entry("mfr.notices", "Application notifications", "notifications", live(R.modelNotices), MFR),
      // hidden (not shown in the demonstration): entry("mfr.templates", "Official templates", "article", PLANNED, MFR),
      entry("mfr.helpdesk", "Helpdesk", "support_agent", live(R.requests), MFR, { query: "kind=helpdesk" }),
      entry("mfr.test-results", "BEE test results", "science", live(R.testResults), MFR),
      entry("mfr.activity", "Sign-in activity", "manage_search", live(R.activity), MFR),
      grantedSettings("mfr"),
    ],
  },

  // ---------------------------------------------------------------- BEE Officer (former Director operational persona)
  {
    id: "dir.dashboard", title: "Dashboard", icon: "dashboard", profile: "officer",
    children: [
      entry("dir.overview", "Programme at a glance", "dashboard", live(R.directorDash), BEE_OFFICER),
      entry("dir.executive", "Programme performance", "space_dashboard", live(R.executive), BEE_OFFICER),
      entry("dir.m360", "Manufacturer 360", "hub", live(R.m360), BEE_OFFICER, { activePrefixes: ["/app/manufacturer/360/"] }),
      entry("dir.messages", "Notifications and messages", "notifications_active", live(R.messages), BEE_OFFICER),
    ],
  },
  {
    id: "dir.work", title: "Work Queue & Decisions", icon: "inbox", profile: "officer",
    children: [
      entry("dir.work-queue", "Officer work queue", "inbox", live(R.myWork), BEE_OFFICER),
      // "Registration observations" is hidden for now (demonstration); the screen stays reachable by URL and from "Anomalies and holds".
      entry("dir.holds", "Anomalies and holds", "pause_circle", live(R.monitoring), BEE_OFFICER),
      // "Model recommendations" is hidden (duplicates the Officer work queue); the screen opens from the queue.
      entry("dir.brand-reviews", "Brand registration reviews", "rate_review", live(R.regReviews), BEE_OFFICER),
      entry("dir.requests", "Service requests", "support_agent", live(R.requests), BEE_OFFICER),
      // "Withdrawal requests" is hidden for now (demonstration).
      entry("dir.revocation", "Rejection and revocation", "gavel", live(R.register), BEE_OFFICER, { query: "tab=pending", alsoQueries: ["tab=history", "view=proposal"] }),
    ],
  },
  {
    id: "dir.oversight", title: "Oversight & Intelligence", icon: "psychology", profile: "officer",
    children: [
      entry("dir.ai-risk", "Compliance risk", "priority_high", live(R.ai), BEE_OFFICER, { query: "tab=compliance-risk" }),
      entry("dir.ai-anomaly", "Production anomaly", "query_stats", live(R.ai), BEE_OFFICER, { query: "tab=production-anomaly" }),
      entry("dir.ai-trends", "Rating trends", "trending_up", live(R.ai), BEE_OFFICER, { query: "tab=rating-trends" }),
      entry("dir.ai-extraction", "Document extraction", "plagiarism", live(R.ai), BEE_OFFICER, { query: "tab=document-extraction" }),
      // hidden (duplicate of the two dashboards): entry("dir.mis", "Programme MIS", "monitoring", live(R.mis), BEE_OFFICER),
      entry("dir.ledger", "Secure evidence ledger", "link", live(R.ledger), BEE_OFFICER),
      entry("dir.testing-overview", "Product testing", "science", live(R.testing), BEE_OFFICER, { query: "tab=overview", isDefault: true }),
      entry("dir.testing-grievances", "Grievance inbox", "report", live(R.testing), BEE_OFFICER, { query: "tab=grievances" }),
      entry("dir.testing-selection", "Risk selection for testing", "casino", live(R.testing), BEE_OFFICER, { query: "tab=selection" }),
      entry("dir.testing-cases", "Product test cases", "biotech", live(R.testing), BEE_OFFICER, { query: "tab=cases" }),
      entry("dir.activity", "Sign-in activity", "manage_search", live(R.activity), BEE_OFFICER),
    ],
  },
  {
    id: "dir.registers", title: "Registers & Compliance", icon: "menu_book", profile: "officer",
    children: [
      entry("dir.manufacturer-register", "Manufacturer register", "factory", live(R.register), BEE_OFFICER, { query: "tab=manufacturers", alsoQueries: ["view=manufacturer"] }),
      entry("dir.brand-register", "Brand and category register", "menu_book", live(R.register), BEE_OFFICER, { query: "tab=brands", alsoQueries: ["view=brand", "view=authorisation", "tab=auths"], isDefault: true }),
      entry("dir.model-register", "Model and certificate register", "verified_user", live(R.register), BEE_OFFICER, { query: "tab=models", alsoQueries: ["view=model"] }),
      entry("dir.reconciliation", "QR and production reconciliation", "balance", live(R.register), BEE_OFFICER, { query: "tab=reconciliation", alsoQueries: ["view=reconciliation"] }),
      entry("dir.audit", "Audit History", "history", live(R.history), BEE_OFFICER),
      entry("dir.delegations", "Delegations", "group", live(R.delegations), BEE_OFFICER),
      grantedSettings("dir"),
    ],
  },

  // ---------------------------------------------------------------- Director (former Secretary operational persona — final approvals)
  {
    id: "sec.dashboard", title: "Dashboard", icon: "dashboard", profile: "director",
    children: [
      entry("sec.overview", "Programme performance", "space_dashboard", live(R.executive), DIRECTOR),
      entry("sec.messages", "Notifications and messages", "notifications_active", live(R.messages), DIRECTOR),
    ],
  },
  {
    id: "sec.approvals", title: "Final Approvals", icon: "how_to_reg", profile: "director",
    children: [
      entry("sec.models", "Model applications", "how_to_reg", live(R.approval), DIRECTOR),
      entry("sec.returned", "Returned applications", "assignment_return", PLANNED, DIRECTOR),
      entry("sec.rejections", "Rejection recommendations", "block", PLANNED, DIRECTOR),
      entry("sec.pending", "Pending final decisions", "task_alt", live(R.myApprovals), DIRECTOR),
    ],
  },
  {
    id: "sec.certificates", title: "Certificates & Formats", icon: "verified_user", profile: "director",
    children: [
      entry("sec.approved-certificates", "Approved certificates", "verified_user", live(R.ledger), DIRECTOR),
      entry("sec.letters", "Generated approval letters", "description", proto("model-label", "approval-letter"), DIRECTOR),
      entry("sec.model-register", "Model register", "menu_book", proto("mis-ai", "model-dashboard"), DIRECTOR),
      entry("sec.certificate-history", "Certificate history", "history", PLANNED, DIRECTOR),
      entry("sec.revoked", "Revoked certificates", "block", PLANNED, DIRECTOR),
    ],
  },
  {
    id: "sec.oversight", title: "Oversight & Reports", icon: "monitoring", profile: "director",
    children: [
      entry("sec.m360", "Manufacturer 360", "hub", live(R.m360), DIRECTOR, { activePrefixes: ["/app/manufacturer/360/"] }),
      entry("sec.approval-summary", "Programme at a glance", "dashboard", live(R.directorDash), DIRECTOR),
      // hidden (MIS page is not in menus): entry("sec.pending-applications", "Pending applications", "monitoring", live(R.mis), DIRECTOR),
      entry("sec.ai", "AI advisory summary", "psychology", live(R.ai), DIRECTOR),
      entry("sec.evidence", "Secure evidence status", "link", live(R.ledger), DIRECTOR),
      grantedSettings("sec"),
    ],
  },

  // ---------------------------------------------------------------- Finance (automatically verified payments, for information)
  {
    id: "fin.dashboard", title: "Dashboard", icon: "dashboard", profile: "finance",
    children: [
      entry("fin.overview", "Finance overview", "payments", live(R.payments), FINANCE),
      entry("fin.messages", "Notifications and messages", "notifications_active", live(R.messages), FINANCE),
    ],
  },
  {
    id: "fin.payments", title: "Payments & Receipts", icon: "receipt_long", profile: "finance",
    children: [
      entry("fin.registration-payments", "Registration payments", "receipt_long", proto("finance", "transaction-search"), FINANCE),
      entry("fin.model-payments", "Model application payments", "request_quote", proto("finance", "fee-and-penalty-ledger"), FINANCE),
      entry("fin.qr-payments", "QR-label payments", "qr_code_2", proto("production", "label-fee"), FINANCE),
      entry("fin.receipts", "Receipts", "receipt", live(R.receipts), FINANCE),
      entry("fin.exceptions", "Payment exceptions", "error", proto("finance", "failed-or-duplicate-payments"), FINANCE),
    ],
  },
  {
    id: "fin.reconciliation", title: "Reconciliation", icon: "balance", profile: "finance",
    children: [
      entry("fin.qr-vs-paid", "QR issued versus paid", "qr_code_2", proto("finance", "payment-reconciliation"), FINANCE),
      entry("fin.production-vs-qr", "Production versus QR usage", "factory", proto("production", "reconciliation"), FINANCE),
      entry("fin.annual", "Annual reconciliation", "event_repeat", PLANNED, FINANCE),
      entry("fin.balances", "Outstanding balances", "account_balance", proto("finance", "security-deposit-ledger"), FINANCE),
    ],
  },
  {
    id: "fin.monitoring", title: "Monitoring & Reports", icon: "insights", profile: "finance",
    children: [
      entry("fin.observation", "Manufacturer observation information", "insights", live(R.monitoring), FINANCE, { activePrefixes: APPLICATION_STATUS }),
      entry("fin.anomaly", "Raise anomaly", "report", live(R.monitoring), FINANCE),
      // hidden (MIS page is not in menus): entry("fin.reports", "Payment reports", "monitoring", live(R.mis), FINANCE),
      entry("fin.m360", "Manufacturer 360", "hub", live(R.m360), FINANCE, { activePrefixes: ["/app/manufacturer/360/"] }),
      entry("fin.audit", "Audit History", "history", live(R.history), FINANCE),
      entry("fin.delegations", "Delegations", "group", live(R.delegations), FINANCE),
      grantedSettings("fin"),
    ],
  },
];

/** Which hierarchy a Spring identity gets. The four operational roles keep their own; other officer roles use Admin's, narrowed by role. */
export function navProfileFor(roles: readonly string[]): NavProfile | null {
  if (!roles.length) return null;
  if (roles.includes("admin")) return "admin";
  if (roles.includes("officer")) return "officer";
  if (roles.includes("director")) return "director";
  if (roles.includes("finance")) return "finance";
  if (roles.includes("manufacturer") || roles.includes("agency")) return "manufacturer";
  if (roles.some((r) => (OFFICER_ROLES as readonly string[]).includes(r))) return "admin";
  return null;
}

function narrow(entries: readonly NavEntry[], roles: readonly string[], capabilities: readonly string[]): NavEntry[] {
  return entries.flatMap((e) => {
    if (e.children) {
      const children = narrow(e.children, roles, capabilities);
      return children.length ? [{ ...e, children }] : [];
    }
    const shown = e.capabilities ? e.capabilities.some((c) => capabilities.includes(c)) : e.roles.some((r) => roles.includes(r));
    return shown ? [e] : [];
  });
}

/** The menu for a Spring identity: at most four groups, each holding only the entries its roles or permissions are given. Empty when signed out. */
export function navigationFor(roles: readonly { role: string }[] | null | undefined, capabilities: readonly string[] = [], display?: { registering: boolean }): NavGroup[] {
  const names = (roles ?? []).map((g) => g.role);
  const profile = navProfileFor(names);
  if (!profile) return [];
  // Only the displayed menu is trimmed (the access check calls this without `display`): the company-registration entries are for an organisation still registering.
  const trim = (entries: readonly NavEntry[]): NavEntry[] => (display?.registering === false ? entries.filter((e) => !e.registrationOnly) : [...entries]);
  return NAVIGATION.filter((g) => g.profile === profile)
    .map((g) => ({ ...g, children: narrow(trim(g.children), names, capabilities) }))
    .filter((g) => g.children.length > 0);
}

/** Every leaf entry under a list of entries, depth first. */
export function leaves(entries: readonly NavEntry[]): NavEntry[] {
  return entries.flatMap((e) => (e.children ? leaves(e.children) : [e]));
}

function matches(e: NavEntry, pathname: string): boolean {
  if (!e.route || e.state === "planned") return false;
  return e.route === pathname || (e.activePrefixes ?? []).some((p) => pathname.startsWith(p));
}

/** The entry for the current page (the first in menu order, exact route before a prefix) and the group holding it. */
export function activeEntry(groups: readonly NavGroup[], pathname: string, search = ""): { group: NavGroup; entry: NavEntry } | null {
  const params = new URLSearchParams(search);
  const one = (q: string) => [...new URLSearchParams(q).entries()].every(([k, v]) => params.get(k) === v);
  const queryMatches = (e: NavEntry) => Boolean(e.query) && [e.query!, ...(e.alsoQueries ?? [])].some(one);
  for (const exact of [true, false]) {
    const hits = groups.flatMap((group) => leaves(group.children).filter((e) => (exact ? e.route === pathname && e.state !== "planned" : matches(e, pathname))).map((entry) => ({ group, entry })));
    // An entry whose query matches the address wins; else one without a query (the plain screen); else the first.
    const hit = hits.find((h) => queryMatches(h.entry)) ?? hits.find((h) => h.entry.isDefault) ?? hits.find((h) => !h.entry.query) ?? hits[0];
    if (hit) return hit;
  }
  return null;
}

/** Routes the identity's menu reaches (planned entries excluded). Spring still decides the records. */
export function menuRoutesFor(groups: readonly NavGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => leaves(g.children)).filter((e) => e.route && e.state !== "planned").map((e) => e.route!));
}

const isRoleKey = (r: string): r is RoleKey => ROLES.some((x) => x.key === r);

function isPrototypePath(pathname: string): boolean {
  const [, app, moduleId, screenId, ...rest] = pathname.split("/");
  return app === "app" && !!moduleId && !!screenId && rest.length === 0 && !!screenById(moduleId, screenId);
}

/**
 * Whether the client opens a prototype or standalone console page for a Spring identity (runtime routes are
 * exempt: Spring scopes their records). Decided from the Spring roles only, so a preview role can never widen
 * it: the identity's own menu, plus the existing per-role screen policy (lib/categories) applied to each Spring
 * role. Admin, the demonstration umbrella, opens every prototype.
 */
export function canOpenConsolePath(
  roles: readonly { role: string }[] | null | undefined,
  capabilities: readonly string[],
  pathname: string,
): boolean {
  const names = (roles ?? []).map((g) => g.role);
  const groups = navigationFor(roles, capabilities);
  if (!groups.length) return false;
  if (pathname === "/app") return true;
  if (pathname === "/app/screens") return names.includes("admin");
  if (leaves(groups.flatMap((g) => g.children)).some((e) => matches(e, pathname))) return true;
  if (names.includes("admin") && (isPrototypePath(pathname) || pathname in STANDALONE_PAGES)) return true;
  return names.some((r) => isRoleKey(r) && canRoleAccessPath(r, pathname));
}
