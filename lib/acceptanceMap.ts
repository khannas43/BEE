/**
 * WP01.3 acceptance mapping — documentation data only.
 *
 * Nothing in the running app imports this file. It maps the WP01 exit
 * criteria, the first-slice steps, proposed acceptance checks and denial
 * cases, and requirements R1–R15 to their evidence and owning activity.
 * `scripts/screen-matrix.sh` checks its structure and regenerates
 * docs/wp01/ACCEPTANCE_MAPPING.md. Those checks validate the mapping's
 * structure; they are not business acceptance.
 */

/** Activities from docs/DEVELOPMENT_PLAN.md §15.2. */
export type Activity =
  | "WP01.1" | "WP01.2" | "WP01.3"
  | "WP02.1" | "WP02.2" | "WP02.3"
  | "WP03.1" | "WP03.2" | "WP03.3"
  | "WP04.1" | "WP04.2" | "WP04.3"
  | "WP05.1" | "WP05.2" | "WP05.3"
  | "WP06.1" | "WP06.2" | "WP06.3"
  | "WP07.1" | "WP07.2" | "WP07.3";

/** WP01 document evidence versus a check the application must pass later. */
export type Evidence = "wp01-document" | "future-application-check";

export type CheckType = "document-review" | "structure-script" | "unit" | "api" | "browser" | "command";

export type Status =
  | "passed-documentation-review"
  | "pending-documentation-review"
  | "passed-local-proof"
  | "not-started";

export type ItemKind = "exit" | "step" | "acceptance" | "denial" | "runtime";

export interface AcceptanceItem {
  id: string;
  kind: ItemKind;
  title: string;
  requirements: string[];
  owner: Activity;
  evidence: Evidence;
  checkType: CheckType;
  /** Name of the document, script or planned test. */
  check: string;
  status: Status;
  /** Must be satisfied before WP01 can be accepted. */
  blocksWp01: boolean;
  /** FIRST_SLICE.md §3 step number. */
  step?: number;
  /** FIRST_SLICE.md §8 denial case or §9 acceptance check number. */
  ref?: number;
  api?: string[];
  records?: string[];
  note?: string;
}

export type Coverage = "slice" | "partial" | "deferred";

export interface RequirementTrace {
  id: string;
  summary: string;
  coverage: Coverage;
  /** What the first slice demonstrates (slice and partial only). */
  inSlice?: string;
  /** Parts owned elsewhere (partial and deferred). */
  deferred?: { part: string; owner: Activity }[];
}

/** FIRST_SLICE.md §7 API outline. */
export const API = {
  create: "POST /api/model-applications",
  edit: "PATCH /api/model-applications/{id}",
  submit: "POST /api/model-applications/{id}/submit",
  fee: "POST /api/model-applications/{id}/fee/confirm",
  recommend: "POST /api/model-applications/{id}/recommend",
  rating: "POST /api/model-applications/{id}/rating",
  decision: "POST /api/model-applications/{id}/decision",
  ret: "POST /api/model-applications/{id}/return",
  reject: "POST /api/model-applications/{id}/reject",
  list: "GET /api/model-applications",
  read: "GET /api/model-applications/{id}",
  history: "GET /api/model-applications/{id}/history",
} as const;

export const API_ENDPOINTS: string[] = Object.values(API);

const FUTURE = { evidence: "future-application-check", status: "not-started", blocksWp01: false } as const;

export const ACCEPTANCE_ITEMS: AcceptanceItem[] = [
  /* ---------- WP01 exit criteria (document evidence) ---------- */
  {
    id: "E1", kind: "exit", title: "Required actions are reachable from role workspaces (documented entry paths)",
    requirements: ["R11"], owner: "WP01.2", evidence: "wp01-document", checkType: "structure-script",
    check: "docs/wp01/SCREEN_ACTION_MATRIX.md; scripts/screen-matrix.cjs entry-path check", status: "passed-documentation-review", blocksWp01: true,
    note: "Planned entry paths denied by the current client policy are proposals for policy review, not grants.",
  },
  {
    id: "E2", kind: "exit", title: "Local runtime architecture, resource budget and start/seed/reset/check command contract documented",
    requirements: [], owner: "WP01.3", evidence: "wp01-document", checkType: "document-review",
    check: "docs/wp01/ADR-001-local-runtime.md", status: "passed-documentation-review", blocksWp01: true,
    note: "Replaces \"local runtime starts reproducibly\" as the WP01 exit criterion. The executable proof is RT1 (WP03).",
  },
  {
    id: "E3", kind: "exit", title: "Inventory, gap register and slice requirement trace documented",
    requirements: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15"],
    owner: "WP01.1", evidence: "wp01-document", checkType: "document-review",
    check: "docs/wp01/INVENTORY.md", status: "passed-documentation-review", blocksWp01: true,
  },
  {
    id: "E4", kind: "exit", title: "Acceptance mapping from slice to future application checks documented",
    requirements: [], owner: "WP01.3", evidence: "wp01-document", checkType: "structure-script",
    check: "docs/wp01/ACCEPTANCE_MAPPING.md; scripts/screen-matrix.cjs acceptance-map checks", status: "passed-documentation-review", blocksWp01: true,
  },

  /* ---------- Slice steps (future application checks) ---------- */
  { id: "S1", kind: "step", step: 1, title: "Applicant submits a model application under its own organisation and active brand", requirements: ["R2", "R4", "R11", "R13", "R15"], owner: "WP05.1", checkType: "api", check: "api: submit model application", api: [API.create, API.submit], records: ["model_application", "fee_rule", "transition"], ...FUTURE },
  { id: "S2", kind: "step", step: 2, title: "Finance confirms the fee manually (X)", requirements: ["R5", "R6"], owner: "WP07.1", checkType: "api", check: "api: manual fee confirmation", api: [API.fee], records: ["fee_confirmation", "transition"], ...FUTURE },
  { id: "S3", kind: "step", step: 3, title: "IAME scrutinises and recommends", requirements: ["R7", "R12", "R15"], owner: "WP05.2", checkType: "api", check: "api: IAME recommend", api: [API.recommend], records: ["assignment", "transition"], ...FUTURE },
  { id: "S4", kind: "step", step: 4, title: "Reviewer verifies and forwards to rating", requirements: ["R8", "R15"], owner: "WP05.2", checkType: "api", check: "api: reviewer forward", api: [API.recommend], records: ["transition"], ...FUTURE },
  { id: "S5", kind: "step", step: 5, title: "Programme computes the rating from a versioned formula", requirements: ["R10"], owner: "WP05.2", checkType: "unit", check: "unit: rating computation stores formula version and inputs", api: [API.rating], records: ["rating_formula", "rating_result", "transition"], ...FUTURE },
  { id: "S6", kind: "step", step: 6, title: "Director reviews the rating and recommends", requirements: ["R9", "R10", "R15"], owner: "WP05.2", checkType: "api", check: "api: director decision bound to rating result", api: [API.decision], records: ["approval_decision", "transition"], ...FUTURE },
  { id: "S7", kind: "step", step: 7, title: "Secretary reviews the rating and gives final approval", requirements: ["R3", "R9", "R10", "R15"], owner: "WP05.2", checkType: "api", check: "api: secretary final approval", api: [API.decision], records: ["approval_decision", "transition"], ...FUTURE },

  /* ---------- Proposed acceptance checks, FIRST_SLICE.md §9 ---------- */
  { id: "A1", kind: "acceptance", ref: 1, title: "Submission gives a server-issued ID, state fee_due and a fee with its rule ID", requirements: ["R2", "R5"], owner: "WP05.1", checkType: "api", check: "api: submission response and stored fee", api: [API.submit, API.read], records: ["model_application", "fee_rule"], ...FUTURE },
  { id: "A2", kind: "acceptance", ref: 2, title: "Finance confirms; the applicant sees Payment confirmed and has no confirm action", requirements: ["R5", "R6"], owner: "WP07.1", checkType: "browser", check: "browser: payer fee view after confirmation", api: [API.fee, API.read], records: ["fee_confirmation"], ...FUTURE },
  { id: "A3", kind: "acceptance", ref: 3, title: "IAME return, applicant resubmit to iame_scrutiny, then recommend and forward to rating", requirements: ["R7", "R12", "R15"], owner: "WP05.2", checkType: "api", check: "api: return and resubmit to returning stage", api: [API.ret, API.edit, API.submit, API.recommend], records: ["model_application", "transition"], ...FUTURE },
  { id: "A4", kind: "acceptance", ref: 4, title: "Rating result stores formula ID and version, inputs and stars; state director_review", requirements: ["R10"], owner: "WP05.2", checkType: "api", check: "api: rating result persisted", api: [API.rating, API.read], records: ["rating_result"], ...FUTURE },
  { id: "A5", kind: "acceptance", ref: 5, title: "Director and Secretary see the versioned rating; decisions record the rating result ID; final state approved", requirements: ["R3", "R9", "R10"], owner: "WP05.2", checkType: "browser", check: "browser: approval view shows rating and records decision", api: [API.read, API.decision], records: ["approval_decision"], ...FUTURE },
  { id: "A6", kind: "acceptance", ref: 6, title: "History lists every transition with actor, role, organisation and server time", requirements: ["R12"], owner: "WP05.2", checkType: "api", check: "api: ordered transition history", api: [API.history], records: ["transition"], ...FUTURE },
  { id: "A7", kind: "acceptance", ref: 7, title: "Every denial case fails and leaves history unchanged", requirements: ["R11"], owner: "WP02.3", checkType: "api", check: "api: denial suite N1–N10", api: [API.history], records: ["transition"], ...FUTURE },
  { id: "A8", kind: "acceptance", ref: 8, title: "Project checks pass; changed files lint clean against the recorded baseline", requirements: [], owner: "WP03.3", checkType: "command", check: "command: access audit, matrix, tsc, build, lint on changed files", ...FUTURE },
  { id: "A9", kind: "acceptance", ref: 9, title: "End-to-end run repeats after a targeted app-data reset", requirements: ["R15"], owner: "WP03.2", checkType: "command", check: "command: local:reset then replay slice", ...FUTURE, note: "Uses the targeted reset from ADR-001 D-RT5, not volume deletion." },

  /* ---------- Denial cases, FIRST_SLICE.md §8 ---------- */
  { id: "N1", kind: "denial", ref: 1, title: "Cross-organisation list, read or edit (Nova Cool vs PixelCert) is denied", requirements: ["R11"], owner: "WP02.2", checkType: "api", check: "api: organisation scope from Spring membership", api: [API.list, API.read, API.edit], records: ["organisation", "user_account", "role_assignment"], ...FUTURE, note: "Scope comes from Spring's membership tables, never from a Keycloak attribute alone (ADR-001 D-RT3)." },
  { id: "N2", kind: "denial", ref: 2, title: "Agency submission for a brand without active authorisation is denied", requirements: ["R4", "R11"], owner: "WP02.2", checkType: "api", check: "api: agency authorisation required", api: [API.create, API.submit], records: ["agency_authorisation"], ...FUTURE },
  { id: "N3", kind: "denial", ref: 3, title: "Anyone other than Finance confirming the fee is denied", requirements: ["R5", "R6", "R11"], owner: "WP02.3", checkType: "api", check: "api: fee confirm denied for payer and non-Finance", api: [API.fee], ...FUTURE },
  { id: "N4", kind: "denial", ref: 4, title: "Finance recommending, rating or approving is denied", requirements: ["R6"], owner: "WP02.3", checkType: "api", check: "api: Finance has no technical action", api: [API.recommend, API.rating, API.decision], ...FUTURE },
  { id: "N5", kind: "denial", ref: 5, title: "IAME approving, or acting on an unassigned application, is denied", requirements: ["R7", "R11"], owner: "WP02.3", checkType: "api", check: "api: IAME assignment and no approval", api: [API.recommend, API.decision], records: ["assignment"], ...FUTURE },
  { id: "N6", kind: "denial", ref: 6, title: "Deciding before a rating exists, or on a superseded rating, is denied", requirements: ["R9", "R10"], owner: "WP05.2", checkType: "api", check: "api: decision requires current rating result", api: [API.decision], records: ["rating_result"], ...FUTURE },
  { id: "N7", kind: "denial", ref: 7, title: "Director final approval, or Secretary acting before Director recommendation, is denied", requirements: ["R9"], owner: "WP05.2", checkType: "api", check: "api: two-stage decision order", api: [API.decision], ...FUTURE },
  { id: "N8", kind: "denial", ref: 8, title: "The same user acting at two stages of one application is denied", requirements: ["R11", "R12"], owner: "WP02.3", checkType: "api", check: "api: segregation of duties per application", api: [API.recommend, API.rating, API.decision], ...FUTURE },
  { id: "N9", kind: "denial", ref: 9, title: "Acting on an application outside the role's current stage is denied", requirements: ["R12"], owner: "WP05.2", checkType: "api", check: "api: stage ownership", api: [API.recommend, API.rating, API.decision, API.fee], ...FUTURE },
  { id: "N10", kind: "denial", ref: 10, title: "Helpdesk, Admin or Auditor performing any slice transition is denied", requirements: ["R6", "R11"], owner: "WP02.3", checkType: "api", check: "api: default-deny for non-slice roles", api: [API.fee, API.recommend, API.rating, API.decision], ...FUTURE, note: "Implements only reviewed slice rules; no matrix capacity is imported (ADR-001 D-RT4)." },

  /* ---------- Runtime proof (moved to WP03, does not block WP01) ---------- */
  { id: "RT1", kind: "runtime", title: "Local runtime starts, seeds, resets and passes health checks reproducibly; memory and ports measured", requirements: [], owner: "WP03.2", checkType: "command", check: "command: npm run local:rt1 -- --allow-destroy; docs/wp03/RT1_PROOF.md", ...FUTURE, status: "passed-local-proof", note: "Executable proof of ADR-001 on this MacBook. WP03 is not accepted; recheck under slice load." },
];

export const REQUIREMENTS: RequirementTrace[] = [
  { id: "R1", summary: "Online agency and brand registration with documents, fee and approval workflow", coverage: "deferred", deferred: [{ part: "Agency and brand registration workflow; the slice uses seeded, already-active brands", owner: "WP04.2" }] },
  { id: "R2", summary: "Model applications evaluated, approved and listed with energy data and rating", coverage: "slice", inSlice: "Model application from submission to approved with computed rating" },
  { id: "R3", summary: "Multi-page model application, test-report upload, auto star label, note-sheet, approval workflow", coverage: "partial", inSlice: "Approval workflow only", deferred: [{ part: "Multi-page application form", owner: "WP05.1" }, { part: "Test-report upload", owner: "WP06.1" }, { part: "Star label generation", owner: "WP05.3" }, { part: "IAME note-sheet (provisional decision D5)", owner: "WP05.2" }] },
  { id: "R4", summary: "Intake validation: brand, configuration, uniqueness, standard, accreditation, test dates, documents", coverage: "partial", inSlice: "Brand ownership or agency authorisation only", deferred: [{ part: "Model and family uniqueness, standard and test-date validation", owner: "WP05.1" }, { part: "Laboratory accreditation master", owner: "WP04.1" }, { part: "Document validation", owner: "WP06.1" }] },
  { id: "R5", summary: "Fee computed and confirmed settlement recorded, with ledger and receipt", coverage: "partial", inSlice: "Fee from one seeded rule; manual Finance confirmation", deferred: [{ part: "Simulated payment, receipt and reconciliation", owner: "WP07.1" }, { part: "Effective-dated fee rules per category (provisional decision D6)", owner: "WP04.1" }] },
  { id: "R6", summary: "Finance verifies payments and has no technical approval", coverage: "slice", inSlice: "Finance confirms the fee (X) and is denied every technical action" },
  { id: "R7", summary: "IAME scrutiny with return or recommend and no final approval", coverage: "slice", inSlice: "IAME recommends or returns; IAME approval denied" },
  { id: "R8", summary: "Project Engineer verifies applications", coverage: "slice", inSlice: "Reviewer forwards to rating" },
  { id: "R9", summary: "Director recommends; Secretary gives final approval", coverage: "slice", inSlice: "Two ordered decisions (provisional decision D1)" },
  { id: "R10", summary: "Rating computed from the approved, effective formula with inputs retained", coverage: "partial", inSlice: "Rating stored with formula ID, version and inputs, using formula version 0-unverified", deferred: [{ part: "BEE-approved formulas per category (provisional decision D3)", owner: "WP04.1" }] },
  { id: "R11", summary: "Users reach only authorised functions and data; partners never see another organisation", coverage: "slice", inSlice: "Server-side organisation scope and slice denial cases" },
  { id: "R12", summary: "Allocation, routing, shortfall, reassignment, escalation; time-stamped audit", coverage: "partial", inSlice: "Stage routing, return for shortfall, append-only time-stamped history", deferred: [{ part: "Allocation role (provisional decision D2) and reassignment", owner: "WP05.2" }, { part: "Delegation and escalation", owner: "WP02.3" }] },
  { id: "R13", summary: "Temporary save of incomplete applications, purged after the prescribed period", coverage: "partial", inSlice: "Draft state before submission", deferred: [{ part: "180-day purge", owner: "WP05.1" }] },
  { id: "R14", summary: "Three years of production and sales data at model registration", coverage: "deferred", deferred: [{ part: "Production and sales data capture", owner: "WP07.2" }] },
  { id: "R15", summary: "Demo: submit, IAME/BEE scrutiny, return, resubmit, approve", coverage: "slice", inSlice: "Full step sequence including return and resubmit" },
];
