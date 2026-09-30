import { ROLE_ORDER, RoleKey } from "./roles";
import { ALL_SCREENS } from "./screens";

/**
 * WP01.2 consolidated screen/action matrix — documentation data only.
 *
 * Nothing in the running app imports this file. It records, for every
 * catalogue screen, standalone console route and public route, the proposed
 * workspace, disposition, entry route, per-role capacity, data scope and the
 * state source that backs it today. `scripts/screen-matrix.sh` checks it and
 * regenerates docs/wp01/SCREEN_ACTION_MATRIX.md from it.
 *
 * Internal-role capacity defaults to the Annex A.1 cell in lib/screens.ts.
 * An override must carry `why`. Partner capacity is always explicit because
 * DDD Annex A.2 gives all five partner roles identical cells on every row.
 */

export type Workspace =
  | "home"
  | "work"
  | "registrations"
  | "labels"
  | "production-finance"
  | "enforcement"
  | "support"
  | "insights-admin"
  | "public"
  | "dev";

export type Disposition = "retain" | "merge" | "contextual" | "retire" | "dev-only";

export type Scope = "all" | "own-org" | "assigned" | "own-tickets" | "own-user" | "public";

export type StateSource =
  | "lifecycle-store"
  | "qr-store"
  | "cert-store"
  | "static-fixture"
  | "scaffold"
  | "none";

export type Implementation = "deep" | "scaffold" | "standalone" | "public";

export type WpRef = "WP02" | "WP03" | "WP04" | "WP05" | "WP06" | "WP07" | "WP08" | "WP09" | "WP10" | "WP11";

export interface MatrixRow {
  path: string;
  name: string;
  kind: "catalogue" | "standalone" | "public";
  workspace: Workspace;
  disposition: Disposition;
  /** Retained route that absorbs a merged, contextual or retired row. */
  target?: string;
  /** How the action is reached inside the target, e.g. "Documents tab". */
  via?: string;
  impl: Implementation;
  state: StateSource;
  /** Work package that replaces browser-local or fixture state. */
  replacedBy?: WpRef;
  /** Proposed capacity per role; "—" = no access. */
  capacity: Record<RoleKey, string>;
  /** Data scope per role that holds any capacity. */
  scope: Partial<Record<RoleKey, Scope>>;
  /** Reason for any internal capacity that differs from Annex A.1. */
  why?: string;
  /** Part of the first registration-to-model slice. */
  slice?: boolean;
  note?: string;
  /** Planned entry path for roles the current menu does not already cover (retained console routes only). */
  entry: Partial<Record<RoleKey, PlannedEntry>>;
}

/**
 * How a permitted role reaches a retained console route. A merge target by
 * itself is not an entry path.
 * - menu: a planned menu item (a proposal for policy review until adopted).
 * - task: a task link from a task source (inbox or queue) the role can reach.
 * - contextual: an action on a parent route the role can reach and use.
 */
export type PlannedEntry =
  | { kind: "menu"; label: string }
  | { kind: "task"; source: string; task: string }
  | { kind: "contextual"; parent: string; action: string };

const INTERNAL: RoleKey[] = ["admin", "programme", "reviewer", "director", "secretary", "finance", "helpdesk", "auditor"];
const NONE = "—";

type Caps = Partial<Record<RoleKey, string>>;

interface Spec {
  ws: Workspace;
  d: Disposition;
  target?: string;
  via?: string;
  state?: StateSource;
  replacedBy?: WpRef;
  /** Partner capacity (manufacturer, agency, iame, sda, laboratory). */
  p?: Caps;
  /** Internal capacity override; unspecified internal roles keep Annex A.1. */
  i?: Caps;
  /** Replace all internal capacity (unspecified internal roles get "—"). */
  iOnly?: Caps;
  why?: string;
  scope?: Partial<Record<RoleKey, Scope>>;
  slice?: boolean;
  note?: string;
}

function defaultScope(role: RoleKey): Scope {
  if (INTERNAL.includes(role)) return "all";
  if (role === "manufacturer" || role === "agency") return "own-org";
  return "assigned";
}

function build(path: string, name: string, kind: MatrixRow["kind"], impl: Implementation, annex: Caps, spec: Spec): MatrixRow {
  const capacity = {} as Record<RoleKey, string>;
  ROLE_ORDER.forEach((r) => {
    if (INTERNAL.includes(r)) {
      if (spec.iOnly) capacity[r] = spec.iOnly[r] ?? NONE;
      else capacity[r] = spec.i?.[r] ?? annex[r] ?? NONE;
    } else {
      capacity[r] = spec.p?.[r] ?? NONE;
    }
  });
  const scope: Partial<Record<RoleKey, Scope>> = {};
  ROLE_ORDER.forEach((r) => {
    if (capacity[r] !== NONE) scope[r] = spec.scope?.[r] ?? defaultScope(r);
  });
  return {
    path,
    name,
    kind,
    workspace: spec.ws,
    disposition: spec.d,
    target: spec.target,
    via: spec.via,
    impl,
    state: spec.state ?? (impl === "scaffold" ? "scaffold" : "static-fixture"),
    replacedBy: spec.replacedBy,
    capacity,
    scope,
    why: spec.why,
    slice: spec.slice,
    note: spec.note,
    entry: ENTRY_PATHS[path] ?? {},
  };
}

/* ------------------------------------------------------------------ *
 * Entry routes used as merge/contextual targets.
 * ------------------------------------------------------------------ */
const RECORD = "/app/registrations/record";
const INBOX = "/app/workflow/personal-inbox";
const APPROVALS = "/app/workflow/my-approvals";
const ACCESS = "/app/identity/access-management";
const QR = "/app/qr/batch";
const CASE = "/app/enforcement/case";
const HD = "/app/helpdesk/workspace";
const AI = "/app/ai";
const PAY = "/app/model-label/model-payment";
const DIRECTOR = "/app/model-label/director-approval";

const HOME = "/app";
const ADMIN_DASH = "/app/administration/admin-dashboard";
const REG_DASH = "/app/mis-ai/registration-dashboard";
const EXEC_MIS = "/app/mis-ai/executive-mis";
const AUDIT_SEARCH = "/app/audit/business-audit-search";
const FIN_QUEUE = "/app/finance/finance-queue";
const REPOSITORY = "/app/documents/repository";
const RATE = "/app/model-label/rating-calculation";

/* ------------------------------------------------------------------ *
 * Planned entry paths for retained console routes.
 * Only roles that the current menu does not cover need an entry here;
 * roles that already have a menu item keep it.
 * ------------------------------------------------------------------ */

/** Routes whose rows are task lists; a task link must start from one of them. */
export const TASK_SOURCES: string[] = [INBOX, APPROVALS, FIN_QUEUE];

type Entries = Partial<Record<RoleKey, PlannedEntry>>;
const menu = (label: string, roles: RoleKey[]): Entries =>
  Object.fromEntries(roles.map((r) => [r, { kind: "menu", label }]));
const task = (source: string, t: string, roles: RoleKey[]): Entries =>
  Object.fromEntries(roles.map((r) => [r, { kind: "task", source, task: t }]));
const ctx = (parent: string, action: string, roles: RoleKey[]): Entries =>
  Object.fromEntries(roles.map((r) => [r, { kind: "contextual", parent, action }]));

/** Registration-side views: officers open them from the model record; Helpdesk from a linked ticket. */
const fromRecord = (action: string, roles: RoleKey[]): Entries => ({
  ...ctx(RECORD, action, roles.filter((r) => r !== "helpdesk")),
  ...(roles.includes("helpdesk") ? ctx(HD, `Linked record on ticket › ${action}`, ["helpdesk"]) : {}),
});
/** Operational views that governance roles read as drill-downs from executive MIS. */
const fromMis = (action: string, roles: RoleKey[]): Entries => ({
  ...ctx(EXEC_MIS, action, roles.filter((r) => r !== "helpdesk")),
  ...(roles.includes("helpdesk") ? ctx(HD, `Linked record on ticket › ${action}`, ["helpdesk"]) : {}),
});

const GOV: RoleKey[] = ["admin", "director", "secretary"];

const ENTRY_PATHS: Record<string, Entries> = {
  [HOME]: {},
  [ADMIN_DASH]: {
    ...ctx(HOME, "Admin home: Open admin dashboard (admin only tile)", ["admin"]),
    ...ctx(HOME, "Home: Administration summary tile", ["programme", "reviewer", "director", "secretary"]),
  },
  "/app/identity/organisation-users": {
    ...ctx(ACCESS, "Organisation users tab", ["admin"]),
    ...ctx(RECORD, "Organisation profile › Users", ["director", "secretary"]),
    ...menu("My organisation › Users", ["manufacturer", "agency", "iame", "sda", "laboratory"]),
  },
  "/app/administration/appliance-master": fromRecord("Category details › Appliance master", ["programme", "reviewer", "director", "secretary"]),
  "/app/administration/rating-formula": ctx(RATE, "Formula version › Open rating formula", ["programme", "reviewer", "director", "secretary"]),
  "/app/administration/fee-rules": fromRecord("Payment tab › Fee rule", ["programme", "reviewer", "director", "secretary"]),
  "/app/administration/workflow-configuration": ctx("/app/workflow/escalation-dashboard", "Stage SLA › Workflow configuration", ["programme", "reviewer", "director", "secretary"]),
  "/app/administration/notification-templates": ctx(INBOX, "Notification preview › Template", ["programme", "reviewer", "director", "secretary"]),
  "/app/administration/reference-publication": ctx("/app/mis-ai/data-quality", "Reference data › Publication status", ["programme", "reviewer", "director", "secretary"]),
  "/app/agency-brand/brand-registration": fromRecord("Brand tab", [...GOV, "helpdesk"]),
  "/app/model-label/model-dashboard": {
    ...ctx(ADMIN_DASH, "Model registrations tile", ["admin"]),
    ...ctx(REG_DASH, "Model registrations › Open model dashboard", ["director", "secretary"]),
    ...ctx(HD, "Linked record on ticket › Model dashboard", ["helpdesk"]),
  },
  "/app/model-label/new-model-application": fromRecord("Application tab (read-only form)", [...GOV, "helpdesk"]),
  "/app/model-label/model-payment": task(FIN_QUEUE, "Fee due: confirm receipt (slice step 2)", ["finance"]),
  "/app/model-label/iame-scrutiny": {
    ...task(INBOX, "IAME scrutiny task (slice step 3)", ["iame"]),
    ...ctx(RECORD, "Scrutiny tab › IAME recommendation", ["programme", "reviewer"]),
  },
  "/app/model-label/bee-scrutiny": task(INBOX, "BEE scrutiny task (slice step 4)", ["programme", "reviewer"]),
  "/app/model-label/director-approval": {
    ...task(APPROVALS, "Model approval decision (slice steps 6 and 7)", ["director", "secretary"]),
    ...ctx(RECORD, "Approval tab", ["programme", "reviewer"]),
  },
  [RATE]: {
    ...task(INBOX, "Rating task (slice step 5)", ["programme"]),
    ...ctx(RECORD, "Rating tab", ["reviewer"]),
    ...ctx("/app/model-label/director-approval", "Rating panel › Open rating calculation", ["director", "secretary"]),
  },
  "/app/model-label/label-preview": fromRecord("Label tab", [...GOV, "finance", "helpdesk"]),
  "/app/model-label/renewal-or-degradation": fromRecord("Renewal tab", [...GOV, "helpdesk"]),
  "/app/production/quarterly-submission": fromMis("Production summary › Quarterly submissions", [...GOV, "finance", "helpdesk"]),
  "/app/production/bulk-upload": fromMis("Production summary › Bulk uploads", [...GOV, "finance", "helpdesk"]),
  "/app/production/reconciliation": fromMis("Production summary › Reconciliation", [...GOV, "finance", "helpdesk"]),
  "/app/production/compliance-exceptions": fromMis("Production summary › Compliance exceptions", [...GOV, "finance", "helpdesk"]),
  "/app/finance/finance-queue": fromMis("Revenue summary › Finance queue", [...GOV, "programme", "reviewer", "auditor"]),
  "/app/finance/transaction-search": fromMis("Revenue summary › Transactions", [...GOV, "programme", "reviewer", "auditor"]),
  "/app/finance/payment-reconciliation": fromMis("Revenue summary › Reconciliation", [...GOV, "programme", "reviewer", "auditor"]),
  "/app/finance/refund": fromMis("Revenue summary › Refunds", [...GOV, "programme", "reviewer", "auditor"]),
  "/app/finance/security-deposit-ledger": fromMis("Revenue summary › Security deposits", [...GOV, "programme", "reviewer", "auditor"]),
  [INBOX]: {},
  "/app/workflow/escalation-dashboard": {},
  "/app/withdrawal/brand-withdrawal": fromRecord("Withdrawal tab", GOV),
  "/app/enforcement/sample-plan": ctx(CASE, "Case › Sample plan", GOV),
  "/app/enforcement/laboratory-assignment": ctx(CASE, "Case › Laboratory assignment", GOV),
  "/app/enforcement/challenge-test": ctx(CASE, "Case › Challenge test", GOV),
  "/app/enforcement/enforcement-decision": ctx(CASE, "Case › Decision", GOV),
  "/app/helpdesk/raise-ticket": ctx(HOME, "Home: Help and support › Raise ticket", ["admin", "programme", "reviewer", "director", "secretary"]),
  "/app/helpdesk/sla-dashboard": fromMis("Service levels › Helpdesk SLA", ["admin", "programme", "reviewer", "director", "secretary"]),
  "/app/helpdesk/knowledge-base": ctx(HOME, "Home: Help and support › Knowledge base", ["admin", "programme", "reviewer", "director", "secretary"]),
  [REPOSITORY]: {
    ...menu("Administration › Documents", ["admin"]),
    ...ctx(RECORD, "Documents tab › Open document repository", ["programme", "reviewer", "director", "secretary"]),
    ...ctx(AUDIT_SEARCH, "Evidence › Open document repository", ["auditor"]),
  },
  "/app/documents/malware-quarantine": ctx(REPOSITORY, "Quarantined files (authorised document roles only)", ["admin", "programme", "reviewer", "director", "secretary", "auditor"]),
  "/app/mis-ai/enforcement-dashboard": fromMis("Enforcement tile", [...GOV, "finance", "auditor"]),
  "/app/audit/business-audit-search": fromMis("Audit and assurance › Business audit search", ["programme", "reviewer", "director", "secretary", "finance"]),
  "/app/audit/configuration-history": fromMis("Audit and assurance › Configuration history", ["programme", "reviewer", "director", "secretary", "finance"]),
  "/app/audit/security-event-review": fromMis("Audit and assurance › Security events", ["programme", "reviewer", "director", "secretary", "finance"]),
  "/app/audit/integration-correlation": fromMis("Audit and assurance › Integration correlation", ["programme", "reviewer", "director", "secretary", "finance"]),
  [RECORD]: {
    ...ctx(ADMIN_DASH, "Registrations tile › Open record", ["admin"]),
    ...ctx(REG_DASH, "Drill-down › Open registration record", ["director", "secretary"]),
    ...ctx(AUDIT_SEARCH, "Audited record › Open record", ["auditor"]),
    ...menu("Registrations › My model records (provisional decision D4)", ["manufacturer"]),
    ...task(INBOX, "Assigned application › Open record", ["iame"]),
  },
  [QR]: fromMis("QR issuance tile › Open batch workspace", ["admin", "auditor"]),
  [CASE]: {
    ...task(APPROVALS, "Enforcement closure decision", ["director", "secretary"]),
    ...fromMis("Enforcement summary › Open case", ["admin", "auditor"]),
    ...task(INBOX, "Show-cause notice: respond (G23)", ["manufacturer", "agency"]),
    ...task(INBOX, "Assigned test: submit report", ["laboratory"]),
  },
  [HD]: {
    ...ctx(ADMIN_DASH, "Helpdesk summary › Open workspace", ["admin"]),
    ...ctx(AUDIT_SEARCH, "Ticket audit › Open workspace", ["auditor"]),
  },
  [ACCESS]: ctx(HOME, "Profile menu › My access and delegations", ["programme", "reviewer", "director", "secretary", "auditor"]),
  [APPROVALS]: {},
  [AI]: {},
};

/** Entry-path keys that name no retained console route (checked). */
export const ENTRY_KEYS = (): string[] => Object.keys(ENTRY_PATHS);

const MA: RoleKey[] = ["manufacturer", "agency"];
const both = (code: string): Caps => ({ manufacturer: code, agency: code });
const allPartners = (code: string): Caps => ({ manufacturer: code, agency: code, iame: code, sda: code, laboratory: code });
const ownTickets: Partial<Record<RoleKey, Scope>> = { manufacturer: "own-tickets", agency: "own-tickets", iame: "own-tickets", sda: "own-tickets", laboratory: "own-tickets" };

/* ------------------------------------------------------------------ *
 * Catalogue screens — keyed "<module>/<screen-id>".
 * ------------------------------------------------------------------ */
const CATALOGUE: Record<string, Spec> = {
  // Identity
  "identity/login-and-mfa": { ws: "public", d: "retire", target: "/login", note: "Duplicates the /login page." },
  "identity/user-profile": { ws: "home", d: "contextual", target: "/app", via: "Top-bar profile", p: allPartners("V"), scope: { manufacturer: "own-user", agency: "own-user", iame: "own-user", sda: "own-user", laboratory: "own-user" } },
  "identity/organisation-users": { ws: "registrations", d: "retain", p: allPartners("C/E"), note: "Annex A.2 gives partners C/E for their own users; the current menu exposes it to internal roles only." },
  "identity/role-assignment": { ws: "insights-admin", d: "merge", target: ACCESS, via: "Role grants" },
  "identity/delegation": { ws: "insights-admin", d: "merge", target: ACCESS, via: "Delegation", p: allPartners("V") },
  "identity/access-review": { ws: "insights-admin", d: "merge", target: ACCESS, via: "Access review" },

  // Administration
  "administration/admin-dashboard": { ws: "insights-admin", d: "retain", note: "No menu entry today." },
  "administration/appliance-master": { ws: "insights-admin", d: "retain", note: "Menu label: Master data." },
  "administration/equipment-parameters": { ws: "insights-admin", d: "merge", target: "/app/administration/appliance-master", via: "Master data tab" },
  "administration/standards-master": { ws: "insights-admin", d: "merge", target: "/app/administration/appliance-master", via: "Master data tab" },
  "administration/rating-formula": { ws: "insights-admin", d: "retain", note: "Slice dependency: the effective formula version the rating step applies." },
  "administration/fee-rules": { ws: "insights-admin", d: "retain", note: "Slice dependency: the effective application fee." },
  "administration/document-checklist": { ws: "insights-admin", d: "merge", target: "/app/administration/fee-rules", via: "Fees and document requirements" },
  "administration/workflow-configuration": { ws: "insights-admin", d: "retain" },
  "administration/sla-and-calendar": { ws: "insights-admin", d: "merge", target: "/app/administration/workflow-configuration", via: "SLA tab" },
  "administration/notification-templates": { ws: "insights-admin", d: "retain" },
  "administration/laboratory-master": { ws: "insights-admin", d: "merge", target: "/app/administration/appliance-master", via: "Master data tab" },
  "administration/reference-publication": { ws: "insights-admin", d: "retain", note: "The menu labels this route 'Integrations'; the label and the screen disagree." },

  // Agency & Brand
  "agency-brand/agency-registration": { ws: "registrations", d: "merge", target: RECORD, via: "New agency record", p: both("C/E/S"), note: "Annex A.2 also grants IAME, SDA and laboratory C/E/S; they are empanelled by BEE, not self-registered." },
  "agency-brand/company-and-facility": { ws: "registrations", d: "contextual", target: RECORD, via: "Profile tab", p: both("C/E/S") },
  "agency-brand/authorised-contacts": { ws: "registrations", d: "contextual", target: RECORD, via: "Profile tab", p: both("C/E/S") },
  "agency-brand/brand-registration": { ws: "registrations", d: "retain", p: both("C/E/S"), note: "Slice precondition: an active brand owned by the applicant organisation." },
  "agency-brand/company-documents": { ws: "registrations", d: "contextual", target: RECORD, via: "Documents tab", p: both("C/E/S") },
  "agency-brand/registration-payment": { ws: "registrations", d: "contextual", target: RECORD, via: "Payment tab", p: both("V/S/D"), note: "Payer pays and downloads a receipt; confirmation stays with Finance." },
  "agency-brand/application-status": { ws: "registrations", d: "merge", target: RECORD, via: "Record list", p: both("V") },
  "agency-brand/registration-scrutiny": { ws: "registrations", d: "contextual", target: RECORD, via: "Scrutiny tab", p: both("V") },
  "agency-brand/brand-approval": { ws: "registrations", d: "contextual", target: RECORD, via: "Approval tab", p: both("V") },

  // Model & Label
  "model-label/model-dashboard": {
    ws: "registrations", d: "retain", state: "lifecycle-store", replacedBy: "WP05", p: both("V"), slice: true,
    note: "Annex A.2 grants C/E/S; the dashboard creates nothing, so partners get V.",
  },
  "model-label/new-model-application": {
    ws: "registrations", d: "retain", state: "lifecycle-store", replacedBy: "WP05", p: both("C/E/S"), slice: true,
    note: "Slice step 1. Annex A.2 also grants IAME, SDA and laboratory C/E/S; DDD 4.3 limits apply/submit to manufacturer or agency.",
  },
  "model-label/family-models": { ws: "registrations", d: "contextual", target: RECORD, via: "Model record: Family tab", state: "lifecycle-store", replacedBy: "WP05", p: { ...both("C/E/S"), iame: "V" }, slice: true },
  "model-label/test-reports": { ws: "registrations", d: "contextual", target: RECORD, via: "Model record: Evidence tab", state: "lifecycle-store", replacedBy: "WP06", p: { ...both("C/E/S"), iame: "V" }, slice: true },
  "model-label/lab-accreditation": { ws: "registrations", d: "contextual", target: RECORD, via: "Model record: Evidence tab", state: "lifecycle-store", replacedBy: "WP06", p: { ...both("C/E/S"), iame: "V" }, slice: true },
  "model-label/performance-parameters": { ws: "registrations", d: "contextual", target: RECORD, via: "Model record: Evidence tab", state: "lifecycle-store", replacedBy: "WP05", p: { ...both("C/E/S"), iame: "V" }, slice: true },
  "model-label/label-details": { ws: "labels", d: "contextual", target: "/app/model-label/label-preview", via: "Label tab", state: "lifecycle-store", replacedBy: "WP05", p: both("C/E/S") },
  "model-label/model-documents": { ws: "registrations", d: "contextual", target: RECORD, via: "Model record: Documents tab", state: "lifecycle-store", replacedBy: "WP06", p: { ...both("C/E/S"), iame: "V" }, slice: true },
  "model-label/model-payment": {
    ws: "production-finance", d: "retain", state: "lifecycle-store", replacedBy: "WP07", slice: true,
    iOnly: { finance: "V/R/X" }, p: both("V/S/D"),
    why: "REVIEW-FIXES-3: only BEE Finance opens fee confirmation and executes it (X, a recorded manual confirmation, not an approval decision); other officers see fee status on the record Payment tab. Annex A.1 has no X or A on this row.",
    note: "Slice step 2. Finance confirms the fee manually; the payer view has no confirm action (no A or X). Partner rows read the static PARTNER_PAYMENTS fixture.",
  },
  "model-label/iame-scrutiny": {
    ws: "work", d: "retain", state: "lifecycle-store", replacedBy: "WP05", slice: true,
    iOnly: { programme: "V", reviewer: "V" }, p: { iame: "V/R" },
    why: "Stage owner is IAME (STAGE_OWNERS); programme and reviewer read the recommendation, approvers see it on the approval view.",
    note: "Slice step 3. Annex A.2 grants every partner R; only the assigned IAME reviews.",
  },
  "model-label/bee-scrutiny": {
    ws: "work", d: "retain", state: "lifecycle-store", replacedBy: "WP05", slice: true,
    iOnly: { programme: "V/R", reviewer: "V/R" },
    why: "RFP Vol 2 §1.3: Project Engineer verifies applications (reviewer/programme); Finance and helpdesk have no technical review; approvers see findings on the approval view.",
    note: "Slice step 4.",
  },
  "model-label/approval-note": { ws: "work", d: "contextual", target: DIRECTOR, via: "Approval note panel", state: "lifecycle-store", replacedBy: "WP05", slice: true },
  "model-label/director-approval": {
    ws: "work", d: "retain", state: "lifecycle-store", replacedBy: "WP05", slice: true,
    iOnly: { programme: "V", reviewer: "V", director: "V/A", secretary: "V/A" },
    why: "RFP Vol 2 §1.3: Program Director recommends and approves, Secretary gives final approval; DDD 4.3: Finance has no technical approval. Annex A.1 grants A to Admin, Finance and Helpdesk as well.",
    note: "Slice steps 6 and 7. One approval view with two sequential decisions (Director, then Secretary); it shows the computed rating and its formula version.",
  },
  "model-label/secretary-approval": {
    ws: "work", d: "merge", target: DIRECTOR, via: "Secretary decision on the approval view", state: "lifecycle-store", replacedBy: "WP05", slice: true,
    iOnly: { programme: "V", reviewer: "V", director: "V/A", secretary: "V/A" },
    why: "Same decision rule as director-approval; Annex A.1 grants A to Admin, Finance and Helpdesk as well.",
    note: "Renders the same StageScreen variant as director-approval and has no inbound link.",
  },
  "model-label/approval-letter": { ws: "registrations", d: "contextual", target: RECORD, via: "Model record: Approval tab (download)", state: "lifecycle-store", replacedBy: "WP05", p: both("V/D") },
  "model-label/rating-calculation": {
    ws: "work", d: "retain", state: "lifecycle-store", replacedBy: "WP05", slice: true,
    iOnly: { programme: "V/X", reviewer: "V", director: "V", secretary: "V" },
    why: "Stage owner is programme (STAGE_OWNERS); the portal computes the rating from the effective formula, so only the owner executes it. Director and Secretary read the computed, versioned rating before deciding. Other roles read the result on the model record.",
    note: "Slice step 5, before both approvals. Stores formula ID and version, inputs and result. Annex A.2 grants partners C/E/S; the applicant declares inputs in the application and reads the rating on its model record after approval.",
  },
  "model-label/label-preview": { ws: "labels", d: "retain", state: "cert-store", replacedBy: "WP09", p: both("V/D"), note: "Out of the first slice. Also reads the lifecycle store." },
  "model-label/renewal-or-degradation": { ws: "registrations", d: "retain", state: "lifecycle-store", replacedBy: "WP05", p: both("C/E/S") },

  // QR & Verification
  "qr-verification/qr-batch-request": { ws: "labels", d: "merge", target: QR, via: "Request tab", state: "qr-store", replacedBy: "WP08", p: both("C/S") },
  "qr-verification/qr-batch-status": { ws: "labels", d: "merge", target: QR, via: "Batches tab", state: "qr-store", replacedBy: "WP08", p: both("V") },
  "qr-verification/batch-file-download": { ws: "labels", d: "merge", target: QR, via: "Batch detail (download)", state: "qr-store", replacedBy: "WP08", p: both("V/D") },
  "qr-verification/serial-upload": { ws: "labels", d: "merge", target: QR, via: "Serial binding tab", state: "qr-store", replacedBy: "WP08", p: both("C/S") },
  "qr-verification/duplicate-exceptions": { ws: "labels", d: "merge", target: QR, via: "Exceptions tab", state: "qr-store", replacedBy: "WP08", p: both("V") },
  "qr-verification/qr-download": { ws: "labels", d: "merge", target: QR, via: "Batch detail (download)", state: "qr-store", replacedBy: "WP08", p: both("V/D") },
  "qr-verification/public-verification": { ws: "public", d: "retire", target: "/verify", state: "qr-store", note: "Duplicates the public /verify page." },
  "qr-verification/certificate-verification": { ws: "public", d: "merge", target: "/verify", via: "Certificate lookup", state: "cert-store", replacedBy: "WP09" },

  // Production
  "production/quarterly-submission": { ws: "production-finance", d: "retain", p: both("C/E/S") },
  "production/bulk-upload": { ws: "production-finance", d: "retain", p: both("C/S") },
  "production/validation-results": { ws: "production-finance", d: "contextual", target: "/app/production/quarterly-submission", via: "Validation panel", p: both("V") },
  "production/ca-evidence": { ws: "production-finance", d: "contextual", target: "/app/production/quarterly-submission", via: "CA evidence tab", p: both("C/S") },
  "production/label-fee": { ws: "production-finance", d: "merge", target: PAY, via: "Partner fees view", p: both("V/S/D") },
  "production/production-payment": { ws: "production-finance", d: "merge", target: PAY, via: "Partner fees view", p: both("V/S/D") },
  "production/reconciliation": { ws: "production-finance", d: "retain" },
  "production/correction-request": { ws: "production-finance", d: "contextual", target: "/app/production/quarterly-submission", via: "Correction action", p: both("C/S") },
  "production/compliance-exceptions": { ws: "production-finance", d: "retain" },

  // Finance
  "finance/finance-queue": { ws: "production-finance", d: "retain" },
  "finance/payment-verification": { ws: "production-finance", d: "merge", target: "/app/finance/finance-queue", via: "Queue item detail", note: "Overlaps the Finance view of model-payment." },
  "finance/transaction-search": { ws: "production-finance", d: "retain" },
  "finance/payment-reconciliation": { ws: "production-finance", d: "retain" },
  "finance/failed-or-duplicate-payments": { ws: "production-finance", d: "merge", target: "/app/finance/payment-reconciliation", via: "Exceptions filter" },
  "finance/settlement": { ws: "production-finance", d: "contextual", target: "/app/finance/payment-reconciliation", via: "Settlement panel" },
  "finance/refund": { ws: "production-finance", d: "retain" },
  "finance/security-deposit-ledger": { ws: "production-finance", d: "retain", note: "Menu label: Deposits and ledgers." },
  "finance/fee-and-penalty-ledger": { ws: "production-finance", d: "merge", target: "/app/finance/security-deposit-ledger", via: "Ledger tab" },
  "finance/receipt": { ws: "production-finance", d: "contextual", target: "/app/finance/transaction-search", via: "Transaction detail" },

  // Workflow
  "workflow/personal-inbox": {
    ws: "work", d: "retain", state: "lifecycle-store", replacedBy: "WP05", slice: true,
    p: { ...both("V"), iame: "V/X", sda: "V", laboratory: "V" },
    note: "Officer entry to slice tasks; tasks are filtered by STAGE_OWNERS.",
  },
  "workflow/team-queue": { ws: "work", d: "merge", target: INBOX, via: "Team tab", state: "lifecycle-store", replacedBy: "WP05" },
  "workflow/application-review": { ws: "work", d: "contextual", target: INBOX, via: "Task detail panel", state: "lifecycle-store", replacedBy: "WP05" },
  "workflow/checklist": { ws: "work", d: "contextual", target: INBOX, via: "Task detail: Checklist", slice: true },
  "workflow/clarification-and-return": {
    ws: "work", d: "contextual", target: INBOX, via: "Task detail: Return action", slice: true,
    p: { ...both("V/S"), iame: "V/R/X" },
    note: "Slice return path: scrutiny returns a shortfall; the applicant responds and resubmits.",
  },
  "workflow/approval-note": { ws: "work", d: "merge", target: DIRECTOR, via: "Approval note panel", note: "Same name as model-label/approval-note." },
  "workflow/delegation-and-reassignment": { ws: "insights-admin", d: "merge", target: ACCESS, via: "Delegation" },
  "workflow/escalation-dashboard": { ws: "work", d: "retain", state: "lifecycle-store", replacedBy: "WP05", note: "Menu label: SLA and escalations." },
  "workflow/workflow-history": { ws: "registrations", d: "contextual", target: RECORD, via: "History tab", state: "lifecycle-store", replacedBy: "WP05", slice: true },

  // Withdrawal
  "withdrawal/brand-withdrawal": { ws: "registrations", d: "retain", p: both("C/S"), note: "Menu label: Withdrawals." },
  "withdrawal/model-withdrawal": { ws: "registrations", d: "merge", target: "/app/withdrawal/brand-withdrawal", via: "Withdrawal request (model)", p: both("C/S") },
  "withdrawal/revocation-initiation": { ws: "registrations", d: "contextual", target: RECORD, via: "Lifecycle action" },
  "withdrawal/dues-verification": { ws: "production-finance", d: "contextual", target: "/app/finance/finance-queue", via: "Dues check task" },
  "withdrawal/withdrawal-scrutiny": { ws: "work", d: "contextual", target: INBOX, via: "Task detail" },
  "withdrawal/withdrawal-approval": { ws: "work", d: "contextual", target: APPROVALS, via: "Approval item" },
  "withdrawal/deposit-release": { ws: "production-finance", d: "contextual", target: "/app/finance/finance-queue", via: "Deposit release task" },
  "withdrawal/withdrawal-letter": { ws: "registrations", d: "contextual", target: RECORD, via: "Documents tab (download)", p: both("V/D") },

  // Enforcement
  "enforcement/sample-plan": { ws: "enforcement", d: "retain", p: { sda: "V/C/S" } },
  "enforcement/sample-plan-approval": { ws: "work", d: "contextual", target: APPROVALS, via: "Approval item" },
  "enforcement/iame-or-sda-assignment": { ws: "enforcement", d: "contextual", target: CASE, via: "Assignment tab", p: { iame: "V", sda: "V" } },
  "enforcement/laboratory-assignment": { ws: "enforcement", d: "retain", p: { laboratory: "V/X" }, note: "Menu label: Laboratory testing." },
  "enforcement/chain-of-custody": { ws: "enforcement", d: "contextual", target: CASE, via: "Custody tab", p: { sda: "V/E", laboratory: "V/E" } },
  "enforcement/sample-receipt": { ws: "enforcement", d: "contextual", target: CASE, via: "Custody tab", p: { laboratory: "C/S" } },
  "enforcement/test-result": { ws: "enforcement", d: "contextual", target: CASE, via: "Testing tab", p: { laboratory: "C/S", iame: "V", sda: "V" } },
  "enforcement/test-report": { ws: "enforcement", d: "contextual", target: CASE, via: "Testing tab", p: { laboratory: "C/S", iame: "V", sda: "V" } },
  "enforcement/result-scrutiny": { ws: "enforcement", d: "contextual", target: CASE, via: "Scrutiny tab", p: { iame: "V/R", sda: "V/R" } },
  "enforcement/challenge-test": { ws: "enforcement", d: "retain", p: { iame: "V/R", laboratory: "V/C/S" } },
  "enforcement/show-cause": { ws: "enforcement", d: "contextual", target: CASE, via: "Show cause tab", p: both("V"), note: "Manufacturer has no route to its own show-cause notice today." },
  "enforcement/manufacturer-response": { ws: "enforcement", d: "contextual", target: CASE, via: "Response tab", p: both("C/S") },
  "enforcement/enforcement-decision": { ws: "enforcement", d: "retain", note: "Menu label: Closure and appeals." },
  "enforcement/penalty-or-suspension": { ws: "enforcement", d: "contextual", target: CASE, via: "Decision tab" },

  // Helpdesk
  "helpdesk/raise-ticket": { ws: "support", d: "retain", p: allPartners("C/S"), scope: ownTickets },
  "helpdesk/track-ticket": { ws: "support", d: "merge", target: "/app/helpdesk/raise-ticket", via: "My tickets", p: allPartners("V"), scope: ownTickets },
  "helpdesk/agent-queue": { ws: "support", d: "merge", target: HD, via: "Queue" },
  "helpdesk/classification": { ws: "support", d: "contextual", target: HD, via: "Ticket detail" },
  "helpdesk/assignment-and-escalation": { ws: "support", d: "contextual", target: HD, via: "Ticket detail" },
  "helpdesk/communication-history": { ws: "support", d: "contextual", target: HD, via: "Ticket thread", p: allPartners("V"), scope: ownTickets, note: "Partners read their own thread from My tickets." },
  "helpdesk/resolution-and-closure": { ws: "support", d: "contextual", target: HD, via: "Ticket detail" },
  "helpdesk/feedback": { ws: "support", d: "contextual", target: "/app/helpdesk/raise-ticket", via: "Closed ticket", p: allPartners("C/S"), scope: ownTickets },
  "helpdesk/sla-dashboard": { ws: "support", d: "retain" },
  "helpdesk/knowledge-base": { ws: "support", d: "retain", p: allPartners("V"), scope: { manufacturer: "public", agency: "public", iame: "public", sda: "public", laboratory: "public" } },

  // Documents
  "documents/repository": { ws: "insights-admin", d: "retain", note: "No inbound route today; partners see documents on their record tabs." },
  "documents/search": { ws: "insights-admin", d: "merge", target: "/app/documents/repository", via: "Search" },
  "documents/preview": { ws: "insights-admin", d: "contextual", target: "/app/documents/repository", via: "Document detail" },
  "documents/version-history": { ws: "insights-admin", d: "contextual", target: "/app/documents/repository", via: "Document detail" },
  "documents/check-in-or-out": { ws: "insights-admin", d: "contextual", target: "/app/documents/repository", via: "Document detail" },
  "documents/access-rights": { ws: "insights-admin", d: "contextual", target: "/app/documents/repository", via: "Access tab" },
  "documents/malware-quarantine": { ws: "insights-admin", d: "retain", note: "No inbound route today." },
  "documents/retention-hold": { ws: "insights-admin", d: "contextual", target: "/app/documents/repository", via: "Retention tab" },

  // MIS & AI
  "mis-ai/executive-mis": { ws: "insights-admin", d: "retain" },
  "mis-ai/registration-dashboard": { ws: "insights-admin", d: "retain", p: { sda: "V" }, note: "Menu label: Operational dashboards." },
  "mis-ai/model-dashboard": { ws: "insights-admin", d: "merge", target: "/app/mis-ai/registration-dashboard", via: "Models tab", note: "Same name as model-label/model-dashboard." },
  "mis-ai/production-and-fee-dashboard": { ws: "insights-admin", d: "merge", target: "/app/mis-ai/registration-dashboard", via: "Production tab" },
  "mis-ai/enforcement-dashboard": { ws: "enforcement", d: "retain", p: { sda: "V" } },
  "mis-ai/helpdesk-dashboard": { ws: "insights-admin", d: "merge", target: "/app/mis-ai/registration-dashboard", via: "Helpdesk tab" },
  "mis-ai/report-builder": { ws: "insights-admin", d: "retain" },
  "mis-ai/scheduled-reports": { ws: "insights-admin", d: "merge", target: "/app/mis-ai/report-builder", via: "Schedules tab" },
  "mis-ai/data-quality": { ws: "insights-admin", d: "retain" },
  "mis-ai/risk-scoring": { ws: "insights-admin", d: "contextual", target: AI, via: "Use-case card", state: "static-fixture", replacedBy: "WP11" },
  "mis-ai/production-anomaly": { ws: "insights-admin", d: "contextual", target: AI, via: "Use-case card", state: "static-fixture", replacedBy: "WP11" },
  "mis-ai/rating-trends": { ws: "insights-admin", d: "contextual", target: AI, via: "Use-case card", state: "static-fixture", replacedBy: "WP11" },
  "mis-ai/extraction-review": { ws: "insights-admin", d: "contextual", target: AI, via: "Use-case card", state: "static-fixture", replacedBy: "WP11" },
  "mis-ai/chatbot-review": { ws: "insights-admin", d: "contextual", target: AI, via: "Use-case card", state: "static-fixture", replacedBy: "WP11" },
  "mis-ai/model-monitoring": { ws: "insights-admin", d: "retain", state: "static-fixture", replacedBy: "WP11", note: "Menu label: AI model governance." },

  // Audit
  "audit/business-audit-search": { ws: "insights-admin", d: "retain" },
  "audit/configuration-history": { ws: "insights-admin", d: "retain" },
  "audit/security-event-review": { ws: "insights-admin", d: "retain" },
  "audit/integration-correlation": { ws: "insights-admin", d: "retain", state: "cert-store", replacedBy: "WP09", note: "Renders Fabric monitoring from lib/mock/certificate." },
};

/* ------------------------------------------------------------------ *
 * Standalone console routes (no Annex A.1 cell; capacity is explicit).
 * ------------------------------------------------------------------ */
interface StandaloneSpec extends Spec {
  name: string;
}

const STANDALONE: Record<string, StandaloneSpec> = {
  "/app": {
    name: "Console home", ws: "home", d: "retain", state: "lifecycle-store", replacedBy: "WP05",
    iOnly: { admin: "V", programme: "V", reviewer: "V", director: "V", secretary: "V", finance: "V", helpdesk: "V", auditor: "V" },
    p: allPartners("V"),
  },
  "/app/screens": {
    name: "Screen catalogue", ws: "dev", d: "dev-only", state: "none",
    iOnly: { admin: "V" },
    why: "Development reference only; today every role can open it.",
  },
  [RECORD]: {
    name: "Registration record workspace", ws: "registrations", d: "retain", state: "static-fixture", replacedBy: "WP04", slice: true,
    iOnly: { admin: "V", programme: "V/R", reviewer: "V/R", director: "V", secretary: "V", finance: "V", auditor: "V" },
    p: { ...both("V/C/E/S"), iame: "V" },
    note: "Target model record for the slice; model approval decisions stay on the approval view. Today it reads its own RECORDS fixture, its Approve/Reject/Return buttons do nothing, and only the agency role has a menu entry.",
  },
  [QR]: {
    name: "QR batch workspace", ws: "labels", d: "retain", state: "static-fixture", replacedBy: "WP08",
    iOnly: { admin: "V", programme: "V/X", reviewer: "V", auditor: "V" }, p: both("V/C/S/D"),
    note: "Uses its own batch fixture (QRB-2026-0731), separate from QRStore (QB-2026-0231).",
  },
  [CASE]: {
    name: "Enforcement case workspace", ws: "enforcement", d: "retain", replacedBy: "WP10",
    iOnly: { admin: "V", programme: "V/R/X", reviewer: "V/R/X", director: "V/A", secretary: "V/A", auditor: "V" },
    p: { ...both("V/S"), iame: "V/R", sda: "V/R", laboratory: "V/S" },
    note: "Manufacturer and agency need this route for show-cause and response; the current menu does not give it to them.",
  },
  [HD]: {
    name: "Helpdesk agent workspace", ws: "support", d: "retain", replacedBy: "WP10",
    iOnly: { admin: "V", helpdesk: "V/R/X", auditor: "V" },
  },
  [ACCESS]: {
    name: "Users, roles and delegation", ws: "insights-admin", d: "retain", replacedBy: "WP02",
    iOnly: { admin: "G/A", programme: "V", reviewer: "V", director: "V", secretary: "V", auditor: "V" },
    note: "DDD 4.3: maker-checker for privileged role grants; an administrator cannot self-approve a grant.",
  },
  [APPROVALS]: {
    name: "My approvals", ws: "work", d: "retain", replacedBy: "WP05",
    iOnly: { programme: "V/R", reviewer: "V/R", director: "V/A", secretary: "V/A", finance: "V/A" },
    note: "Static ITEMS list, not the lifecycle store, so slice approvals do not appear here; one item is dated \"18 Oct\" while the others are dated 23–24 Sep 2026.",
  },
  [AI]: {
    name: "AI insights", ws: "insights-admin", d: "retain", replacedBy: "WP11",
    iOnly: { admin: "V", programme: "V/R", reviewer: "V/R", director: "V", secretary: "V", finance: "V", auditor: "V" },
  },
};

const PUBLIC: Record<string, string> = {
  "/": "Public home",
  "/about": "About",
  "/programmes": "Programmes",
  "/directory": "Appliance directory",
  "/verify": "Public verification",
  "/calculator": "Energy calculator",
  "/notifications": "Notifications",
  "/contact": "Contact",
  "/login": "Sign in",
};

/**
 * Catalogue keys with a bespoke component in components/app/deepScreens.tsx.
 * The matrix check compares this list with that file.
 */
export const DEEP_KEYS_LIST: string[] = [
  "model-label/model-dashboard", "model-label/new-model-application", "model-label/model-payment",
  "model-label/iame-scrutiny", "model-label/bee-scrutiny", "model-label/director-approval",
  "model-label/secretary-approval", "model-label/rating-calculation", "model-label/label-preview",
  "model-label/test-reports", "model-label/model-documents", "model-label/performance-parameters",
  "model-label/lab-accreditation", "model-label/label-details", "model-label/approval-note",
  "model-label/approval-letter", "model-label/renewal-or-degradation", "model-label/family-models",
  "qr-verification/qr-batch-request", "qr-verification/qr-batch-status", "qr-verification/batch-file-download",
  "qr-verification/serial-upload", "qr-verification/duplicate-exceptions", "qr-verification/qr-download",
  "qr-verification/public-verification", "qr-verification/certificate-verification",
  "workflow/personal-inbox", "workflow/team-queue", "workflow/application-review",
  "workflow/escalation-dashboard", "workflow/workflow-history",
  "mis-ai/risk-scoring", "mis-ai/production-anomaly", "mis-ai/extraction-review",
  "mis-ai/chatbot-review", "mis-ai/rating-trends", "mis-ai/model-monitoring",
  "audit/integration-correlation",
];
const DEEP_KEYS = new Set(DEEP_KEYS_LIST);

/* ------------------------------------------------------------------ *
 * Assembled matrix.
 * ------------------------------------------------------------------ */
const catalogueRows: MatrixRow[] = ALL_SCREENS.map((sc) => {
  const key = `${sc.module}/${sc.id}`;
  const spec = CATALOGUE[key];
  const impl: Implementation = DEEP_KEYS.has(key) ? "deep" : "scaffold";
  if (!spec) {
    return build(`/app/${key}`, sc.name, "catalogue", impl, sc.perms, { ws: "dev", d: "retire", note: "UNMAPPED — no matrix entry." });
  }
  return build(`/app/${key}`, sc.name, "catalogue", impl, sc.perms, spec);
});

const standaloneRows: MatrixRow[] = Object.entries(STANDALONE).map(([path, spec]) =>
  build(path, spec.name, "standalone", "standalone", {}, spec)
);

const publicRows: MatrixRow[] = Object.entries(PUBLIC).map(([path, name]) =>
  build(path, name, "public", "public", {}, { ws: "public", d: "retain", state: path === "/verify" ? "lifecycle-store" : "none", replacedBy: path === "/verify" ? "WP08" : undefined, iOnly: {}, note: "No console login." })
);

export const MATRIX: MatrixRow[] = [...catalogueRows, ...standaloneRows, ...publicRows];

/** Specs that name a catalogue key that does not exist (checked by the audit). */
export const UNKNOWN_SPEC_KEYS: string[] = Object.keys(CATALOGUE).filter(
  (k) => !ALL_SCREENS.some((sc) => `${sc.module}/${sc.id}` === k)
);

/* ------------------------------------------------------------------ *
 * First registration-to-model vertical slice.
 * ------------------------------------------------------------------ */
export interface SliceStep {
  n: number;
  actor: RoleKey;
  action: string;
  /** Capacity code the actor must hold on `row`. */
  code: string;
  row: string;
  from: string;
  to: string;
  manual?: string;
  /** Record the step must persist. */
  records?: string;
}

const RATING = "/app/model-label/rating-calculation";

export const SLICE_STEPS: SliceStep[] = [
  { n: 1, actor: "manufacturer", action: "Submit model application under own organisation and active brand", code: "S", row: "/app/model-label/new-model-application", from: "draft", to: "fee_due" },
  { n: 2, actor: "finance", action: "Confirm application fee received", code: "X", row: PAY, from: "fee_due", to: "iame_scrutiny", manual: "Manual Finance confirmation; no payment adapter; the payer has no confirm action.", records: "fee confirmation (fee rule, amount due and received, reference, confirmed by and at)" },
  { n: 3, actor: "iame", action: "IAME scrutiny: recommend (or return a shortfall)", code: "R", row: "/app/model-label/iame-scrutiny", from: "iame_scrutiny", to: "bee_scrutiny" },
  { n: 4, actor: "reviewer", action: "BEE scrutiny by Project Engineer: forward (or return)", code: "R", row: "/app/model-label/bee-scrutiny", from: "bee_scrutiny", to: "rating" },
  { n: 5, actor: "programme", action: "Compute star rating from the effective formula", code: "X", row: RATING, from: "rating", to: "director_review", records: "rating result (formula ID and version, inputs, result, computed by and at)" },
  { n: 6, actor: "director", action: "Program Director reviews the rating and recommends approval", code: "A", row: DIRECTOR, from: "director_review", to: "secretary_approval" },
  { n: 7, actor: "secretary", action: "Secretary reviews the rating and gives final approval", code: "A", row: DIRECTOR, from: "secretary_approval", to: "approved" },
];

/** Final state of the slice. Label, QR and certificate follow in later work packages. */
export const SLICE_FINAL_STATE = "approved";
export const SLICE_RATING_ROW = RATING;
export const SLICE_FEE_ROW = PAY;

/** Roles whose own action must never approve or confirm their own submission. */
export const SLICE_SUBMITTERS: RoleKey[] = MA;

/* ------------------------------------------------------------------ *
 * Provisional decisions used by the local demo until BEE decides.
 * ------------------------------------------------------------------ */
export interface ProvisionalDecision {
  id: string;
  question: string;
  provisional: string;
  basis: string;
  status: "provisional, pending BEE decision";
}

export const PROVISIONAL_DECISIONS: ProvisionalDecision[] = [
  { id: "D1", question: "Is Secretary approval always required, or delegable to the Director for some categories?", provisional: "Always required: Director recommends, Secretary gives final approval.", basis: "RFP Vol 2 §1.3; DDD §5.3 (\"per delegation\")", status: "provisional, pending BEE decision" },
  { id: "D2", question: "Who allocates applications to IAME and Reviewer users?", provisional: "Seeded round-robin assignment; no allocator role in the slice.", basis: "RFP Vol 2 §1.3 (Data Analyst); gap G12", status: "provisional, pending BEE decision" },
  { id: "D3", question: "Which approved star-rating formula and version applies per category?", provisional: "Current computeStars thresholds, recorded as formula version \"0-unverified\".", basis: "RFP Vol 2 SoW (b); corrigendum row 70; gap G13", status: "provisional, pending BEE decision" },
  { id: "D4", question: "Does /app/registrations/record become the applicant's model record?", provisional: "Yes, scoped to the applicant's organisation.", basis: "Gap G02", status: "provisional, pending BEE decision" },
  { id: "D5", question: "Is the IAME verifier (note-sheet) a separate step from IAME scrutiny?", provisional: "Single IAME step in the slice.", basis: "RFP Vol 2 §1.3; DDD §4.3; gap G11", status: "provisional, pending BEE decision" },
  { id: "D6", question: "Which fee rule applies per category and application type?", provisional: "One seeded rule: ₹24,000 for room air conditioners.", basis: "DDD §5.3; gap G08", status: "provisional, pending BEE decision" },
];
