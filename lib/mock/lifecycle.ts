/**
 * Shared, stateful mock domain for the Model & Label lifecycle and the
 * Workflow module. A single store (LifecycleStore) drives every deep screen so
 * actions on one screen (submit, scrutinise, approve, rate, label) are visible
 * on the others — the same object flowing through the pipeline.
 */

import { RoleKey } from "@/lib/roles";

export type Stage =
  | "fee_due"
  | "iame_scrutiny"
  | "bee_scrutiny"
  | "approval"
  | "rating"
  | "label"
  | "active"
  | "rejected";

export interface TimelineEntry {
  at: string;
  label: string;
  actor: string;
}

export interface Finding {
  text: string;
  ok: boolean;
}

export interface DocRef {
  name: string;
  version: string;
  scan: "clean" | "scanning";
}

export interface ModelApplication {
  id: string;
  brand: string;
  model: string;
  family: string;
  category: string;
  capacityW: number;
  powerInputW: number;
  declaredIseer: number;
  standard: string;
  lab: string;
  testDate: string;
  stage: Stage;
  returned: boolean;
  createdAt: string;
  updatedAt: string;
  fee: number;
  feePaid: boolean;
  rating?: number;
  ratingIseer?: number;
  labelGenerated: boolean;
  qrBatch?: string;
  regId?: string;
  findings: Finding[];
  documents: DocRef[];
  timeline: TimelineEntry[];
}

/* ------------------------------------------------------------------ *
 * Stage metadata — order, labels, tones, and the queue each belongs to
 * ------------------------------------------------------------------ */
export const STAGE_ORDER: Stage[] = [
  "fee_due",
  "iame_scrutiny",
  "bee_scrutiny",
  "approval",
  "rating",
  "label",
  "active",
];

export const STAGE_META: Record<
  Stage,
  { label: string; short: string; tone: string; queue: string }
> = {
  fee_due: { label: "Awaiting fee", short: "Fee due", tone: "bg-solar-gold-light text-solar-gold-dark", queue: "Finance" },
  iame_scrutiny: { label: "IAME scrutiny", short: "IAME", tone: "bg-secondary-fixed text-on-secondary-fixed", queue: "IAME" },
  bee_scrutiny: { label: "BEE scrutiny", short: "BEE scrutiny", tone: "bg-secondary-fixed text-on-secondary-fixed", queue: "BEE Reviewer" },
  approval: { label: "Pending approval", short: "Approval", tone: "bg-navy-subtle text-navy-dark", queue: "Director / Secretary" },
  rating: { label: "Rating calculation", short: "Rating", tone: "bg-forest-light text-forest-dark", queue: "Programme" },
  label: { label: "Label generation", short: "Label", tone: "bg-forest-light text-forest-dark", queue: "Programme" },
  active: { label: "Active permission", short: "Active", tone: "bg-forest-light text-forest-dark", queue: "—" },
  rejected: { label: "Rejected", short: "Rejected", tone: "bg-error-container text-on-error-container", queue: "—" },
};

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function nextStage(stage: Stage): Stage {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0 || i >= STAGE_ORDER.length - 1) return stage;
  return STAGE_ORDER[i + 1];
}

/* ------------------------------------------------------------------ *
 * Domain calculations
 * ------------------------------------------------------------------ */
export function computeStars(iseer: number): number {
  if (iseer >= 5.0) return 5;
  if (iseer >= 4.5) return 4;
  if (iseer >= 3.99) return 3;
  if (iseer >= 3.5) return 2;
  return 1;
}

export function feeForCategory(): number {
  return 24000;
}

export function makeAppId(seq: number): string {
  return `APP-2026-${(4820 + seq).toString().padStart(5, "0")}`;
}

export function makeRegId(seq: number): string {
  return `BEE/RAC/2026/${(10000 + seq).toString()}`;
}

/* ------------------------------------------------------------------ *
 * Derived workflow tasks
 * ------------------------------------------------------------------ */
export interface WorkflowTask {
  id: string;
  appId: string;
  title: string;
  subject: string;
  stage: Stage;
  queue: string;
  priority: "High" | "Medium" | "Low";
  due: string;
  overdue: boolean;
  actionModule: string;
  actionScreen: string;
  /** Roles that can act on this task (the stage owner). Drives the personal
   *  inbox filter so a role never sees — or clicks into — another queue's work. */
  ownerRoles: RoleKey[];
}

/** Which role(s) own each workflow stage. The personal inbox and the route
 *  guard both read this, so a visible task always resolves to a screen the
 *  role can open. */
export const STAGE_OWNERS: Record<Stage, RoleKey[]> = {
  fee_due: ["finance"],
  iame_scrutiny: ["iame"],
  bee_scrutiny: ["reviewer"],
  approval: ["director", "secretary"],
  rating: ["programme"],
  label: ["programme"],
  active: [],
  rejected: [],
};

const STAGE_SCREEN: Record<Stage, { module: string; screen: string; verb: string }> = {
  fee_due: { module: "model-label", screen: "model-payment", verb: "Confirm fee for" },
  iame_scrutiny: { module: "model-label", screen: "iame-scrutiny", verb: "IAME scrutiny of" },
  bee_scrutiny: { module: "model-label", screen: "bee-scrutiny", verb: "BEE scrutiny of" },
  approval: { module: "model-label", screen: "director-approval", verb: "Approve" },
  rating: { module: "model-label", screen: "rating-calculation", verb: "Compute rating for" },
  label: { module: "model-label", screen: "label-preview", verb: "Generate label for" },
  active: { module: "model-label", screen: "model-dashboard", verb: "" },
  rejected: { module: "model-label", screen: "model-dashboard", verb: "" },
};

export function deriveTasks(apps: ModelApplication[]): WorkflowTask[] {
  return apps
    .filter((a) => a.stage !== "active" && a.stage !== "rejected")
    .map((a, i) => {
      const s = STAGE_SCREEN[a.stage];
      const priority: WorkflowTask["priority"] =
        a.stage === "approval" ? "High" : a.returned ? "High" : i % 3 === 0 ? "Medium" : "Low";
      return {
        id: `TSK-${2300 + i}`,
        appId: a.id,
        title: `${s.verb} ${a.model}`,
        subject: `${a.brand} — ${a.model}`,
        stage: a.stage,
        queue: STAGE_META[a.stage].queue,
        priority,
        due: ["2h", "4h", "1d", "2d", "6h", "1d", "3d"][i % 7],
        overdue: a.returned || i % 5 === 0,
        actionModule: s.module,
        actionScreen: s.screen,
        ownerRoles: STAGE_OWNERS[a.stage],
      };
    });
}

/* ------------------------------------------------------------------ *
 * Seed data — applications spread across the pipeline
 * ------------------------------------------------------------------ */
function tl(entries: [string, string, string][]): TimelineEntry[] {
  return entries.map(([at, label, actor]) => ({ at, label, actor }));
}

const CLEAN_DOCS: DocRef[] = [
  { name: "Test report.pdf", version: "v2", scan: "clean" },
  { name: "Lab accreditation.pdf", version: "v1", scan: "clean" },
  { name: "Label artwork.pdf", version: "v1", scan: "clean" },
];

export const SEED_APPLICATIONS: ModelApplication[] = [
  {
    id: "APP-2026-04821", brand: "Daikin India Ltd.", model: "FTKM50U 1.5T Inverter", family: "FTKM Series",
    category: "Room ACs", capacityW: 5280, powerInputW: 1010, declaredIseer: 5.4, standard: "IS 1391 / ISO 5151",
    lab: "NABL-BLR-014", testDate: "28 Aug 2026", stage: "iame_scrutiny", returned: false,
    createdAt: "12 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: true, labelGenerated: false,
    findings: [
      { text: "Test report matches declared model", ok: true },
      { text: "Lab accreditation valid on test date", ok: true },
      { text: "Performance within formula range", ok: true },
      { text: "Label artwork bilingual & correct", ok: false },
    ],
    documents: CLEAN_DOCS,
    timeline: tl([
      ["12 Sep, 10:24", "Application submitted", "Daikin India"],
      ["12 Sep, 10:41", "Fee confirmed", "System"],
      ["12 Sep, 14:02", "Assigned to IAME", "System"],
      ["13 Sep, 09:10", "Under IAME scrutiny", "R. Menon"],
    ]),
  },
  {
    id: "APP-2026-04820", brand: "Voltas", model: "Maha Adjustable 185V DAZ", family: "Maha Series",
    category: "Room ACs", capacityW: 5100, powerInputW: 1000, declaredIseer: 5.1, standard: "IS 1391",
    lab: "NABL-MUM-007", testDate: "20 Aug 2026", stage: "bee_scrutiny", returned: false,
    createdAt: "10 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: true, labelGenerated: false,
    findings: [
      { text: "IAME recommendation received", ok: true },
      { text: "Test evidence complete", ok: true },
      { text: "Fee reconciled", ok: true },
    ],
    documents: CLEAN_DOCS,
    timeline: tl([
      ["10 Sep, 11:00", "Application submitted", "Voltas"],
      ["10 Sep, 11:20", "Fee confirmed", "System"],
      ["11 Sep, 16:30", "IAME recommended", "S. Iyer"],
      ["12 Sep, 09:00", "Forwarded to BEE scrutiny", "System"],
    ]),
  },
  {
    id: "APP-2026-04819", brand: "LG Electronics India", model: "AI DUAL TS-Q19YNZE", family: "AI DUAL",
    category: "Room ACs", capacityW: 5000, powerInputW: 952, declaredIseer: 5.25, standard: "IS 1391",
    lab: "NABL-DEL-002", testDate: "18 Aug 2026", stage: "approval", returned: false,
    createdAt: "08 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: true, labelGenerated: false,
    findings: [
      { text: "IAME recommendation received", ok: true },
      { text: "BEE scrutiny cleared", ok: true },
      { text: "Ready for Director approval", ok: true },
    ],
    documents: CLEAN_DOCS,
    timeline: tl([
      ["08 Sep, 09:15", "Application submitted", "LG Electronics"],
      ["08 Sep, 09:40", "Fee confirmed", "System"],
      ["09 Sep, 14:00", "IAME recommended", "S. Iyer"],
      ["11 Sep, 10:30", "BEE scrutiny cleared", "R. Menon"],
    ]),
  },
  {
    id: "APP-2026-04818", brand: "Blue Star Ltd.", model: "Precision IC518YBTU", family: "Precision",
    category: "Room ACs", capacityW: 5050, powerInputW: 1006, declaredIseer: 5.02, standard: "IS 1391",
    lab: "NABL-BLR-014", testDate: "15 Aug 2026", stage: "rating", returned: false,
    createdAt: "06 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: true, labelGenerated: false,
    findings: [{ text: "Approved by Director", ok: true }, { text: "Awaiting rating computation", ok: true }],
    documents: CLEAN_DOCS,
    timeline: tl([
      ["06 Sep, 10:00", "Application submitted", "Blue Star"],
      ["07 Sep, 12:00", "IAME recommended", "S. Iyer"],
      ["09 Sep, 15:00", "BEE scrutiny cleared", "R. Menon"],
      ["12 Sep, 11:00", "Approved by Director", "Director"],
    ]),
  },
  {
    id: "APP-2026-04817", brand: "Havells India (Lloyd)", model: "Stellar GLS18I5FWRBP", family: "Stellar",
    category: "Room ACs", capacityW: 5150, powerInputW: 1014, declaredIseer: 5.08, standard: "IS 1391",
    lab: "NABL-DEL-002", testDate: "10 Aug 2026", stage: "label", returned: false,
    createdAt: "04 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: true,
    rating: 5, ratingIseer: 5.08, labelGenerated: false,
    findings: [{ text: "Rating computed: 5★", ok: true }, { text: "Awaiting label generation", ok: true }],
    documents: CLEAN_DOCS,
    timeline: tl([
      ["04 Sep, 09:00", "Application submitted", "Havells"],
      ["06 Sep, 12:00", "BEE scrutiny cleared", "R. Menon"],
      ["09 Sep, 10:00", "Approved by Secretary", "Secretary"],
      ["12 Sep, 16:00", "Rating computed 5★", "Programme"],
    ]),
  },
  {
    id: "APP-2026-04816", brand: "Godrej & Boyce", model: "Turbo 5-in-1 18TC3-WWR", family: "Turbo",
    category: "Room ACs", capacityW: 5000, powerInputW: 971, declaredIseer: 5.15, standard: "IS 1391",
    lab: "NABL-MUM-007", testDate: "02 Aug 2026", stage: "active", returned: false,
    createdAt: "28 Aug 2026", updatedAt: "10 Sep 2026", fee: 24000, feePaid: true,
    rating: 5, ratingIseer: 5.15, labelGenerated: true, qrBatch: "QB-2026-0231", regId: "BEE/RAC/2026/10016",
    findings: [{ text: "Label generated & hashed", ok: true }, { text: "QR batch allocated", ok: true }],
    documents: CLEAN_DOCS,
    timeline: tl([
      ["28 Aug, 09:00", "Application submitted", "Godrej"],
      ["01 Sep, 12:00", "Approved by Director", "Director"],
      ["03 Sep, 16:00", "Rating computed 5★", "Programme"],
      ["05 Sep, 10:00", "Label generated", "Programme"],
      ["06 Sep, 11:00", "QR batch QB-2026-0231 allocated", "System"],
    ]),
  },
  {
    id: "APP-2026-04815", brand: "Panasonic India", model: "CS/CU-KU18YKYF", family: "KU Series",
    category: "Room ACs", capacityW: 5200, powerInputW: 1130, declaredIseer: 4.6, standard: "IS 1391",
    lab: "NABL-DEL-002", testDate: "22 Aug 2026", stage: "iame_scrutiny", returned: true,
    createdAt: "11 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: true, labelGenerated: false,
    findings: [
      { text: "Test report matches declared model", ok: true },
      { text: "Declared ISEER inconsistent with test data", ok: false },
    ],
    documents: [
      { name: "Test report.pdf", version: "v1", scan: "clean" },
      { name: "Lab accreditation.pdf", version: "v1", scan: "clean" },
    ],
    timeline: tl([
      ["11 Sep, 10:00", "Application submitted", "Panasonic"],
      ["11 Sep, 10:20", "Fee confirmed", "System"],
      ["12 Sep, 14:00", "Returned for clarification (ISEER)", "R. Menon"],
    ]),
  },
  {
    id: "APP-2026-04814", brand: "Hitachi", model: "Kaze Plus RSNG518HDEA", family: "Kaze",
    category: "Room ACs", capacityW: 5100, powerInputW: 1063, declaredIseer: 4.8, standard: "IS 1391",
    lab: "NABL-BLR-014", testDate: "25 Aug 2026", stage: "fee_due", returned: false,
    createdAt: "13 Sep 2026", updatedAt: "13 Sep 2026", fee: 24000, feePaid: false, labelGenerated: false,
    findings: [{ text: "Awaiting fee confirmation", ok: false }],
    documents: [{ name: "Test report.pdf", version: "v1", scan: "scanning" }],
    timeline: tl([["13 Sep, 09:30", "Application submitted", "Hitachi"]]),
  },
];
