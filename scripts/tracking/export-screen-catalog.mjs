/**
 * One-off export for docs/tracking/BEE-portal-status.xlsx (Tab 1 source).
 * Run: node scripts/tracking/export-screen-catalog.mjs > /tmp/bee-screens.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { MODULES } from "../../lib/screens.ts";
import { RUNTIME_ROUTES } from "../../lib/runtimeRoutes.ts";
import { ROLES } from "../../lib/roles.ts";

/** WP01 disposition → owner-facing Screen handling (Tab 1). */
function dispositionToHandling(disposition) {
  if (disposition === "retire") return "retire";
  if (disposition === "merge" || disposition === "contextual") return "merge";
  return "keep";
}

/** Loaded from docs/wp01/SCREEN_ACTION_MATRIX.md (generated from lib/screenMatrix.ts). */
function loadHandlingByAppPath() {
  const md = readFileSync(`${process.cwd()}/docs/wp01/SCREEN_ACTION_MATRIX.md`, "utf8");
  const map = new Map();
  for (const line of md.split("\n")) {
    if (!line.startsWith("| `/app/")) continue;
    if (line.includes(" --- ")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 4) continue;
    const path = parts[1].replaceAll("`", "");
    const match = parts[3].match(/^(retain|merge|contextual|retire|dev-only)/);
    if (!match) continue;
    map.set(path, dispositionToHandling(match[1]));
  }
  return map;
}

const handlingByPath = loadHandlingByAppPath();

function screenHandlingFor(screenId, status) {
  const fromMatrix = handlingByPath.get(`/app/${screenId}`);
  if (fromMatrix) return fromMatrix;
  if (screenId === "administration/business-settings") return "keep";
  if (status === "Live – BEE service" || status === "Planned") return "keep";
  return "";
}

function hrefToScreenId(href) {
  return href.replace(/^\/app\//, "") || null;
}

const liveById = new Map();
for (const r of RUNTIME_ROUTES) {
  const id = hrefToScreenId(r.href);
  if (id) liveById.set(id, r);
}

const rows = [];
for (const m of MODULES) {
  for (const sc of m.screens) {
    const screenId = `${m.id}/${sc.id}`;
    const live = liveById.get(screenId);
    const status = live ? "Live – BEE service" : "Prototype (preview/sample data)";
    const rolesAccess = ROLES.filter((r) => {
      const cell = sc.perms[r.key];
      return cell && cell !== "—";
    }).map((r) => r.short);

    let remarks = "";
    if (live) {
      const caps = live.navCapabilities?.length ? ` Permission: ${live.navCapabilities.join(", ")}.` : "";
      const nav =
        live.navRoles.length > 0
          ? ` Spring menu roles include: ${live.navRoles.join(", ")}.`
          : caps
            ? ""
            : " Spring menu by role or permission.";
      remarks = `${nav}${caps} Capabilities today: ${live.implemented.join("; ")}.`;
    } else {
      remarks = "Catalogue / preview screen; not wired to the live BEE service list for this feature.";
    }

    rows.push({
      screenId,
      screenName: sc.name,
      moduleName: m.name,
      rolesAccess,
      status,
      screenHandling: screenHandlingFor(screenId, status),
      remarks,
    });
  }
}

const seen = new Set(rows.map((r) => r.screenId));
for (const [id, live] of liveById) {
  if (seen.has(id)) continue;
  const [mod] = id.split("/");
  rows.push({
    screenId: id,
    screenName: live.en,
    moduleName: mod.replace(/-/g, " "),
    rolesAccess: live.navRoles.length ? live.navRoles : live.navCapabilities ?? [],
    status: "Live – BEE service",
    screenHandling: screenHandlingFor(id, "Live – BEE service"),
    remarks: `Runtime screen (not in the 141-screen catalogue). Capabilities: ${live.implemented.join("; ")}.`,
  });
  seen.add(id);
}

if (!seen.has("administration/business-settings")) {
  rows.push({
    screenId: "administration/business-settings",
    screenName: "Business settings",
    moduleName: "Administration",
    rolesAccess: ["BEE Admin"],
    status: "Planned",
    screenHandling: "keep",
    remarks: "WP08.1h / Brief 12; frontend after backend merge. Provisional business numbers (efficiency cap, report age, tolerances, certificate validity).",
  });
}

rows.sort((a, b) => a.screenId.localeCompare(b.screenId));

const out = `${process.cwd()}/docs/tracking/.screen-catalog.json`;
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
console.log(`Wrote ${rows.length} screens to ${out}`);
