/**
 * Internal BEE / control roles — the 8 columns of DDD Annex A.1.
 * Order here is the canonical order used by every screen's permission tuple.
 */
export const ROLES = [
  // Internal BEE / control roles — indices 0–7 map to the Annex A.1 permission
  // tuples (keep these first so existing 8-cell perms stay aligned).
  { key: "admin", short: "BEE Admin", name: "BEE Administrator", kind: "internal" },
  { key: "programme", short: "Programme", name: "Programme Officer", kind: "internal" },
  { key: "reviewer", short: "Reviewer", name: "Reviewer & Approver", kind: "internal" },
  { key: "director", short: "Director", name: "Director", kind: "internal" },
  { key: "secretary", short: "Secretary", name: "Secretary", kind: "internal" },
  { key: "finance", short: "Finance", name: "BEE Finance", kind: "internal" },
  { key: "helpdesk", short: "Helpdesk", name: "Helpdesk Agent", kind: "internal" },
  { key: "auditor", short: "Auditor", name: "Auditor", kind: "internal" },
  // External partner roles — scoped to their own organisation / assignments.
  // They get no internal-screen access by default (perms fall through to "—").
  { key: "manufacturer", short: "Manufacturer", name: "Manufacturer", kind: "external" },
  { key: "agency", short: "Agency", name: "Registered Agency", kind: "external" },
  { key: "iame", short: "IAME", name: "IAME (Independent Assessor)", kind: "external" },
  { key: "sda", short: "SDA", name: "State Designated Agency", kind: "external" },
  { key: "laboratory", short: "Laboratory", name: "Testing Laboratory", kind: "external" },
] as const;

export type RoleKey = (typeof ROLES)[number]["key"];
export type RoleKind = (typeof ROLES)[number]["kind"];

export const isExternalRole = (key: string) => ROLES.find((r) => r.key === key)?.kind === "external";

export const ROLE_ORDER: RoleKey[] = ROLES.map((r) => r.key) as RoleKey[];

/** Brief C3B: header role selector shows only these five personas (display labels are client-facing; seed accounts for other roles stay for automation). */
export const VISIBLE_SELECTOR_ROLES = [
  { key: "manufacturer" as const, label: "Manufacturer" },
  { key: "finance" as const, label: "Finance" },
  { key: "director" as const, label: "Director" },
  { key: "secretary" as const, label: "Secretary" },
  { key: "admin" as const, label: "Admin" },
];

export const VISIBLE_SELECTOR_ROLE_KEYS: RoleKey[] = VISIBLE_SELECTOR_ROLES.map((r) => r.key);

export function roleByKey(key: string) {
  return ROLES.find((r) => r.key === key) ?? ROLES[0];
}

/** Legend for the Annex-A access codes. */
export const ACCESS_CODES: Record<string, string> = {
  V: "View",
  C: "Create",
  E: "Edit",
  S: "Submit",
  R: "Review",
  A: "Approve or reject",
  X: "Execute action",
  G: "Configure or administer",
  D: "Download or export",
  P: "Public access",
};

/** Split a permission cell like "V/R" or "G/A" into individual codes. */
export function splitCodes(cell: string): string[] {
  if (!cell || cell === "—") return [];
  return cell.split("/").filter(Boolean);
}
