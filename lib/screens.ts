import { ROLE_ORDER, RoleKey } from "./roles";

/**
 * Screen archetypes drive the generic scaffold body so each of the 140
 * screens renders realistic, distinct content without 140 bespoke files.
 */
export type Archetype =
  | "dashboard"
  | "table"
  | "form"
  | "detail"
  | "approval"
  | "config"
  | "wizard"
  | "ledger"
  | "verify"
  | "inbox"
  | "upload"
  | "search";

export interface Screen {
  id: string; // slug, unique within module
  name: string;
  module: string; // module id
  archetype: Archetype;
  /** permission cell per role, in ROLE_ORDER; "—" means no access. */
  perms: Record<RoleKey, string>;
}

export interface Module {
  id: string;
  name: string;
  icon: string; // Material Symbols name
  blurb: string;
  screens: Screen[];
}

/* ------------------------------------------------------------------ *
 * Permission patterns (Annex A.1). Order: admin, programme, reviewer,
 * director, secretary, finance, helpdesk, auditor.
 * ------------------------------------------------------------------ */
type Cells = [string, string, string, string, string, string, string, string];

const P = {
  IDENT_V: ["V", "V", "V", "V", "V", "—", "—", "—"],
  ROLE_ASSIGN: ["G/A", "G/A", "G/A", "V", "V", "—", "—", "—"],
  ACCESS_REVIEW: ["G/R", "G/R", "G/R", "V", "V", "—", "—", "—"],
  ADMIN_DASH: ["G/V", "G/V", "G/V", "G/V", "G/V", "—", "—", "—"],
  GA5: ["G/A", "G/A", "G/A", "G/A", "G/A", "—", "—", "—"],
  VR: ["V/R", "V/R", "V/R", "V", "V", "V/R", "V/R", "—"],
  REG_PAY: ["V", "V", "V", "V", "V", "V", "V", "—"],
  APPROVE_ALL: ["A", "A", "A", "A", "A", "A", "A", "—"],
  APPROVAL_NOTE: ["V/R", "V/R", "V/R", "V/A", "V/A", "V/R", "V/R", "—"],
  RATING: ["X/V", "X/V", "X/V", "V", "V", "X/V", "X/V", "—"],
  QR: ["V/G", "V/G", "V/G", "V", "V", "—", "V/G", "—"],
  RECON: ["R/A", "R/A", "R/A", "V", "V", "R/A", "R/A", "—"],
  COMPLIANCE: ["R/X", "R/X", "R/X", "V", "V", "R/X", "R/X", "—"],
  FIN_RX: ["R/X", "R/X", "R/X", "V", "V", "R/X", "—", "V"],
  FIN_RA: ["R/A", "R/A", "R/A", "V", "V", "R/A", "—", "V"],
  FIN_V: ["V", "V", "V", "V", "V", "V", "—", "V"],
  WF: ["V/R/X", "V/R/X", "V/R/X", "V", "V", "—", "—", "V"],
  WF_APPROVE: ["V/R/X", "V/R/X", "V/R/X", "V/A", "V/A", "—", "—", "V"],
  WF_DELEG: ["G/X", "G/X", "G/X", "V", "V", "—", "—", "V"],
  WD_VR: ["V/R", "V/R", "V/R", "V", "V", "V/R", "—", "—"],
  WD_APPROVE: ["A", "A", "A", "A", "A", "A", "—", "—"],
  WD_DEPOSIT: ["R/A", "R/A", "R/A", "V", "V", "R/A", "—", "—"],
  ENF: ["V/R/X", "V/R/X", "V/R/X", "V", "V", "—", "—", "—"],
  ENF_APPROVE: ["A", "A", "A", "A", "A", "—", "—", "—"],
  HD_V: ["V", "V", "V", "V", "V", "—", "V", "—"],
  HD_RX: ["R/X", "R/X", "R/X", "V", "V", "—", "R/X", "—"],
  HD_SLA: ["V/D", "V/D", "V/D", "V", "V", "—", "V/D", "—"],
  HD_KB: ["G", "G", "G", "V", "V", "—", "G", "—"],
  DOC_VG: ["V/G", "V/G", "V/G", "V", "V", "—", "—", "V"],
  DOC_MAL: ["R/X", "R/X", "R/X", "V", "V", "—", "—", "V"],
  MIS_VD: ["V/D", "V/D", "V/D", "V", "V", "V", "—", "V"],
  MIS_RB: ["G/V", "G/V", "G/V", "V", "V", "V", "—", "V"],
  MIS_SR: ["G", "G", "G", "V", "V", "V", "—", "V"],
  MIS_MM: ["G/R", "G/R", "G/R", "V", "V", "V", "—", "V"],
  AUD_V: ["V", "V", "V", "V", "V", "V", "—", "V"],
  AUD_SEC: ["R", "R", "R", "R", "R", "V", "—", "V"],
} satisfies Record<string, string[]>;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function permsFrom(cells: string[]): Record<RoleKey, string> {
  const out = {} as Record<RoleKey, string>;
  ROLE_ORDER.forEach((r, i) => (out[r] = cells[i] ?? "—"));
  return out;
}

/** Build a screen; archetype inferred from name unless overridden. */
function s(
  module: string,
  name: string,
  cells: string[],
  archetype?: Archetype
): Screen {
  return {
    id: slug(name),
    name,
    module,
    archetype: archetype ?? inferArchetype(module, name),
    perms: permsFrom(cells),
  };
}

function inferArchetype(moduleId: string, name: string): Archetype {
  const n = name.toLowerCase();
  if (n.includes("dashboard") || n === "executive mis") return "dashboard";
  if (["risk scoring", "production anomaly", "rating trends", "model monitoring"].includes(n))
    return "dashboard";
  if (moduleId === "administration" && n !== "admin dashboard") return "config";
  if (n.includes("knowledge base") || n.includes("report builder") || n.includes("scheduled reports"))
    return "config";
  if (
    n.includes("approval") ||
    n.includes("approve") ||
    n === "reconciliation" ||
    n === "payment reconciliation" ||
    n === "deposit release" ||
    n === "enforcement decision" ||
    n === "payment verification" ||
    n === "refund" ||
    n === "compliance exceptions" ||
    n === "result scrutiny" ||
    n === "malware quarantine"
  )
    return "approval";
  if (n.includes("ledger") || n.includes("settlement") || n.includes("receipt") || n.includes("payment") || n.includes("label fee"))
    return "ledger";
  if (n.includes("search") || n.includes("transaction search")) return "search";
  if (n.includes("queue") || n.includes("inbox")) return "inbox";
  if (n.includes("upload") || n.includes("bulk")) return "upload";
  if (n.includes("verification") || n.includes("verify")) return "verify";
  if (n === "rating calculation" || n.includes("renewal") || n.includes("label preview"))
    return "wizard";
  if (
    n.includes("scrutiny") ||
    n.includes("review") ||
    n.includes("documents") ||
    n.includes("letter") ||
    n.includes("custody") ||
    n.includes("receipt") ||
    n.includes("response") ||
    n.includes("preview") ||
    n.includes("details") ||
    n.includes("version history") ||
    n.includes("correction") ||
    n.includes("test report") ||
    n.includes("test result") ||
    n.includes("evidence") ||
    n.includes("validation results") ||
    n.includes("show cause") ||
    n.includes("challenge") ||
    n.includes("communication history") ||
    n.includes("extraction review") ||
    n.includes("chatbot review") ||
    n.includes("resolution") ||
    n.includes("data quality") ||
    n.includes("configuration history") ||
    n.includes("integration correlation") ||
    n.includes("performance parameters") ||
    n.includes("lab accreditation")
  )
    return "detail";
  if (
    n.includes("registration") ||
    n.includes("application") ||
    n.includes("submission") ||
    n.includes("contacts") ||
    n.includes("facility") ||
    n.includes("raise ticket") ||
    n.includes("track ticket") ||
    n.includes("sample plan") ||
    n.includes("revocation") ||
    n.includes("dues") ||
    n.includes("assignment") ||
    n.includes("delegation") ||
    n.includes("role assignment") ||
    n.includes("access review") ||
    n.includes("profile") ||
    n.includes("feedback") ||
    n.includes("classification") ||
    n.includes("family models") ||
    n.includes("label details") ||
    n.includes("withdrawal") ||
    n.includes("penalty")
  )
    return "form";
  return "table";
}

/* ------------------------------------------------------------------ *
 * The 14 modules and their 140 screens (DDD Annex A.1).
 * ------------------------------------------------------------------ */
export const MODULES: Module[] = [
  {
    id: "identity",
    name: "Identity",
    icon: "badge",
    blurb: "Login, profiles, role mapping, delegation and access review.",
    screens: [
      s("identity", "Login and MFA", P.IDENT_V, "detail"),
      s("identity", "User profile", P.IDENT_V, "form"),
      s("identity", "Organisation users", P.IDENT_V, "table"),
      s("identity", "Role assignment", P.ROLE_ASSIGN, "form"),
      s("identity", "Delegation", P.IDENT_V, "form"),
      s("identity", "Access review", P.ACCESS_REVIEW, "table"),
    ],
  },
  {
    id: "administration",
    name: "Administration",
    icon: "settings",
    blurb: "Reference masters, rating formula, fee rules and workflow config.",
    screens: [
      s("administration", "Admin dashboard", P.ADMIN_DASH),
      s("administration", "Appliance master", P.GA5),
      s("administration", "Equipment parameters", P.GA5),
      s("administration", "Standards master", P.GA5),
      s("administration", "Rating formula", P.GA5),
      s("administration", "Fee rules", P.GA5),
      s("administration", "Document checklist", P.GA5),
      s("administration", "Workflow configuration", P.GA5),
      s("administration", "SLA and calendar", P.GA5),
      s("administration", "Notification templates", P.GA5),
      s("administration", "Laboratory master", P.GA5),
      s("administration", "Reference publication", P.GA5),
    ],
  },
  {
    id: "agency-brand",
    name: "Agency & Brand",
    icon: "domain",
    blurb: "Organisation, facilities, brand registration, scrutiny and approval.",
    screens: [
      s("agency-brand", "Agency registration", P.VR),
      s("agency-brand", "Company and facility", P.VR),
      s("agency-brand", "Authorised contacts", P.VR),
      s("agency-brand", "Brand registration", P.VR),
      s("agency-brand", "Company documents", P.VR, "detail"),
      s("agency-brand", "Registration payment", P.REG_PAY, "ledger"),
      s("agency-brand", "Application status", P.VR, "table"),
      s("agency-brand", "Registration scrutiny", P.VR, "detail"),
      s("agency-brand", "Brand approval", P.APPROVE_ALL, "approval"),
    ],
  },
  {
    id: "model-label",
    name: "Model & Label",
    icon: "label",
    blurb: "Model application, scrutiny, approval, rating and label lifecycle.",
    screens: [
      s("model-label", "Model dashboard", P.VR, "dashboard"),
      s("model-label", "New model application", P.VR, "form"),
      s("model-label", "Family models", P.VR, "table"),
      s("model-label", "Test reports", P.VR, "detail"),
      s("model-label", "Lab accreditation", P.VR, "detail"),
      s("model-label", "Performance parameters", P.VR, "detail"),
      s("model-label", "Label details", P.VR, "form"),
      s("model-label", "Model documents", P.VR, "detail"),
      s("model-label", "Model payment", P.VR, "ledger"),
      s("model-label", "IAME scrutiny", P.VR, "detail"),
      s("model-label", "BEE scrutiny", P.VR, "detail"),
      s("model-label", "Approval note", P.APPROVAL_NOTE, "detail"),
      s("model-label", "Director approval", P.APPROVE_ALL, "approval"),
      s("model-label", "Secretary approval", P.APPROVE_ALL, "approval"),
      s("model-label", "Approval letter", P.APPROVAL_NOTE, "detail"),
      s("model-label", "Rating calculation", P.RATING, "wizard"),
      s("model-label", "Label preview", P.VR, "wizard"),
      s("model-label", "Renewal or degradation", P.VR, "wizard"),
    ],
  },
  {
    id: "qr-verification",
    name: "QR & Verification",
    icon: "qr_code_2",
    blurb: "QR batch allocation, serial binding and public verification.",
    screens: [
      s("qr-verification", "QR batch request", P.QR, "form"),
      s("qr-verification", "QR batch status", P.QR, "table"),
      s("qr-verification", "Batch file download", P.QR, "table"),
      s("qr-verification", "Serial upload", P.QR, "upload"),
      s("qr-verification", "Duplicate exceptions", P.QR, "table"),
      s("qr-verification", "QR download", P.QR, "table"),
      s("qr-verification", "Public verification", P.QR, "verify"),
      s("qr-verification", "Certificate verification", P.QR, "verify"),
    ],
  },
  {
    id: "production",
    name: "Production",
    icon: "factory",
    blurb: "Quarterly production, CA evidence, label fees and reconciliation.",
    screens: [
      s("production", "Quarterly submission", P.VR, "form"),
      s("production", "Bulk upload", P.VR, "upload"),
      s("production", "Validation results", P.VR, "detail"),
      s("production", "CA evidence", P.VR, "detail"),
      s("production", "Label fee", P.VR, "ledger"),
      s("production", "Production payment", P.VR, "ledger"),
      s("production", "Reconciliation", P.RECON, "approval"),
      s("production", "Correction request", P.VR, "detail"),
      s("production", "Compliance exceptions", P.COMPLIANCE, "approval"),
    ],
  },
  {
    id: "finance",
    name: "Finance",
    icon: "payments",
    blurb: "Payment verification, reconciliation, refunds and ledgers.",
    screens: [
      s("finance", "Finance queue", P.FIN_RX, "inbox"),
      s("finance", "Payment verification", P.FIN_RA, "approval"),
      s("finance", "Transaction search", P.FIN_V, "search"),
      s("finance", "Payment reconciliation", P.FIN_RX, "approval"),
      s("finance", "Failed or duplicate payments", P.FIN_V, "table"),
      s("finance", "Settlement", P.FIN_V, "ledger"),
      s("finance", "Refund", P.FIN_RA, "approval"),
      s("finance", "Security deposit ledger", P.FIN_V, "ledger"),
      s("finance", "Fee and penalty ledger", P.FIN_V, "ledger"),
      s("finance", "Receipt", P.FIN_V, "ledger"),
    ],
  },
  {
    id: "workflow",
    name: "Workflow",
    icon: "account_tree",
    blurb: "Task inbox, team queues, escalation and transition history.",
    screens: [
      s("workflow", "Personal inbox", P.WF, "inbox"),
      s("workflow", "Team queue", P.WF, "inbox"),
      s("workflow", "Application review", P.WF, "detail"),
      s("workflow", "Checklist", P.WF, "detail"),
      s("workflow", "Clarification and return", P.WF, "detail"),
      s("workflow", "Approval note", P.WF_APPROVE, "detail"),
      s("workflow", "Delegation and reassignment", P.WF_DELEG, "form"),
      s("workflow", "Escalation dashboard", P.WF, "dashboard"),
      s("workflow", "Workflow history", P.WF, "table"),
    ],
  },
  {
    id: "withdrawal",
    name: "Withdrawal",
    icon: "cancel",
    blurb: "Brand/model withdrawal, revocation, dues and deposit release.",
    screens: [
      s("withdrawal", "Brand withdrawal", P.WD_VR, "form"),
      s("withdrawal", "Model withdrawal", P.WD_VR, "form"),
      s("withdrawal", "Revocation initiation", P.WD_VR, "form"),
      s("withdrawal", "Dues verification", P.WD_VR, "detail"),
      s("withdrawal", "Withdrawal scrutiny", P.WD_VR, "detail"),
      s("withdrawal", "Withdrawal approval", P.WD_APPROVE, "approval"),
      s("withdrawal", "Deposit release", P.WD_DEPOSIT, "approval"),
      s("withdrawal", "Withdrawal letter", P.WD_VR, "detail"),
    ],
  },
  {
    id: "enforcement",
    name: "Enforcement",
    icon: "gavel",
    blurb: "Sampling, lab testing, challenge tests and enforcement actions.",
    screens: [
      s("enforcement", "Sample plan", P.ENF, "form"),
      s("enforcement", "Sample plan approval", P.ENF_APPROVE, "approval"),
      s("enforcement", "IAME or SDA assignment", P.ENF, "form"),
      s("enforcement", "Laboratory assignment", P.ENF, "form"),
      s("enforcement", "Chain of custody", P.ENF, "detail"),
      s("enforcement", "Sample receipt", P.ENF, "detail"),
      s("enforcement", "Test result", P.ENF, "detail"),
      s("enforcement", "Test report", P.ENF, "detail"),
      s("enforcement", "Result scrutiny", P.ENF, "approval"),
      s("enforcement", "Challenge test", P.ENF, "detail"),
      s("enforcement", "Show cause", P.ENF, "detail"),
      s("enforcement", "Manufacturer response", P.ENF, "detail"),
      s("enforcement", "Enforcement decision", P.ENF_APPROVE, "approval"),
      s("enforcement", "Penalty or suspension", P.ENF, "form"),
    ],
  },
  {
    id: "helpdesk",
    name: "Helpdesk",
    icon: "support_agent",
    blurb: "Ticketing, SLA, communications, resolution and knowledge base.",
    screens: [
      s("helpdesk", "Raise ticket", P.HD_V, "form"),
      s("helpdesk", "Track ticket", P.HD_V, "table"),
      s("helpdesk", "Agent queue", P.HD_RX, "inbox"),
      s("helpdesk", "Classification", P.HD_RX, "form"),
      s("helpdesk", "Assignment and escalation", P.HD_RX, "form"),
      s("helpdesk", "Communication history", P.HD_V, "detail"),
      s("helpdesk", "Resolution and closure", P.HD_RX, "detail"),
      s("helpdesk", "Feedback", P.HD_V, "form"),
      s("helpdesk", "SLA dashboard", P.HD_SLA, "dashboard"),
      s("helpdesk", "Knowledge base", P.HD_KB, "config"),
    ],
  },
  {
    id: "documents",
    name: "Documents",
    icon: "folder",
    blurb: "Repository, versioning, malware quarantine and retention holds.",
    screens: [
      s("documents", "Repository", P.DOC_VG, "table"),
      s("documents", "Search", P.DOC_VG, "search"),
      s("documents", "Preview", P.DOC_VG, "detail"),
      s("documents", "Version history", P.DOC_VG, "detail"),
      s("documents", "Check in or out", P.DOC_VG, "table"),
      s("documents", "Access rights", P.DOC_VG, "config"),
      s("documents", "Malware quarantine", P.DOC_MAL, "approval"),
      s("documents", "Retention hold", P.DOC_VG, "config"),
    ],
  },
  {
    id: "mis-ai",
    name: "MIS & AI",
    icon: "insights",
    blurb: "Executive dashboards, report builder and responsible-AI outputs.",
    screens: [
      s("mis-ai", "Executive MIS", P.MIS_VD, "dashboard"),
      s("mis-ai", "Registration dashboard", P.MIS_VD, "dashboard"),
      s("mis-ai", "Model dashboard", P.MIS_VD, "dashboard"),
      s("mis-ai", "Production and fee dashboard", P.MIS_VD, "dashboard"),
      s("mis-ai", "Enforcement dashboard", P.MIS_VD, "dashboard"),
      s("mis-ai", "Helpdesk dashboard", P.MIS_VD, "dashboard"),
      s("mis-ai", "Report builder", P.MIS_RB, "config"),
      s("mis-ai", "Scheduled reports", P.MIS_SR, "config"),
      s("mis-ai", "Data quality", P.MIS_VD, "detail"),
      s("mis-ai", "Risk scoring", P.MIS_VD, "dashboard"),
      s("mis-ai", "Production anomaly", P.MIS_VD, "dashboard"),
      s("mis-ai", "Rating trends", P.MIS_VD, "dashboard"),
      s("mis-ai", "Extraction review", P.MIS_VD, "detail"),
      s("mis-ai", "Chatbot review", P.MIS_VD, "detail"),
      s("mis-ai", "Model monitoring", P.MIS_MM, "dashboard"),
    ],
  },
  {
    id: "audit",
    name: "Audit",
    icon: "policy",
    blurb: "Business audit, configuration history and security event review.",
    screens: [
      s("audit", "Business audit search", P.AUD_V, "search"),
      s("audit", "Configuration history", P.AUD_V, "detail"),
      s("audit", "Security event review", P.AUD_SEC, "table"),
      s("audit", "Integration correlation", P.AUD_V, "detail"),
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Lookups & helpers.
 * ------------------------------------------------------------------ */
export const ALL_SCREENS: Screen[] = MODULES.flatMap((m) => m.screens);

export const SCREEN_COUNT = ALL_SCREENS.length; // must equal 140

export function moduleById(id: string): Module | undefined {
  return MODULES.find((m) => m.id === id);
}

export function screenById(moduleId: string, screenId: string): Screen | undefined {
  return moduleById(moduleId)?.screens.find((sc) => sc.id === screenId);
}

/** A screen is visible to a role when its permission cell is not "—". */
export function canRoleSee(screen: Screen, role: RoleKey): boolean {
  return (screen.perms[role] ?? "—") !== "—";
}

/** Modules (with filtered screens) visible to a role. */
export function modulesForRole(role: RoleKey): Module[] {
  return MODULES.map((m) => ({
    ...m,
    screens: m.screens.filter((sc) => canRoleSee(sc, role)),
  })).filter((m) => m.screens.length > 0);
}

export function countForRole(role: RoleKey): number {
  return ALL_SCREENS.filter((sc) => canRoleSee(sc, role)).length;
}
