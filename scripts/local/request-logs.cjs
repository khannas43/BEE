/* eslint-disable */
/**
 * WP03.3: reads the structured request logs written during a live check
 * ($BEE_LOG_DIR/api-requests.jsonl from Spring, web-requests.jsonl from Next.js) and checks
 * them against docs/wp03/request-log.schema.json. Also returns all local log text
 * (structured and console) since a mark, for planted-value scans.
 */
const fs = require("fs");
const path = require("path");
const contract = require("./contract-lib.cjs");

// BEE_REQUEST_LOGS_DIR lets a unit test point the reader at a temporary directory.
const LOG_DIR = process.env.BEE_REQUEST_LOGS_DIR || path.join(__dirname, "../../.local/logs");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/wp03/request-log.schema.json"), "utf8"));
const FILES = { api: "api-requests.jsonl", web: "web-requests.jsonl", apiConsole: "api.log", webConsole: "web.log", apiConsoleBefore: "api.before-contract-restart.log" };
/** The structured logs rotate (the portal's at 5 MiB, Spring's by size and day), so a mark must survive a rotation. */
const STRUCTURED = { api: /^api-requests(\..*)?\.jsonl$/, web: /^web-requests(\..*)?\.jsonl$/ };

const stat = (f) => { try { return fs.statSync(path.join(LOG_DIR, f)); } catch { return null; } };
const size = (f) => stat(f)?.size ?? 0;
/** The current file and every rotated sibling of a structured log, oldest first (a rotation renames, so the inode follows the data). */
function family(key) {
  let names = [];
  try { names = fs.readdirSync(LOG_DIR).filter((n) => STRUCTURED[key].test(n)); } catch { return []; }
  return names.map((n) => ({ name: n, st: stat(n) })).filter((x) => x.st).sort((a, b) => a.st.mtimeMs - b.st.mtimeMs || a.name.localeCompare(b.name));
}
/**
 * Sizes now, and for the structured logs which file (by inode) the size belongs to. Text after a mark is read from there; if
 * the file was rotated meanwhile, from the rest of the marked file plus every newer file, so no line is lost to a rotation.
 */
const mark = () => ({
  ...Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, size(f)])),
  ...Object.fromEntries(Object.keys(STRUCTURED).map((k) => [`${k}Ino`, stat(FILES[k])?.ino ?? null])),
  apiConsoleBefore: 0,
});
const readFrom = (name, from) => { try { const b = fs.readFileSync(path.join(LOG_DIR, name)); return b.subarray(b.length >= from ? from : 0).toString("utf8"); } catch { return ""; } };
function since(m = {}, key) {
  if (STRUCTURED[key] && m[`${key}Ino`] != null) {
    const fam = family(key);
    const at = fam.findIndex((x) => x.st.ino === m[`${key}Ino`]);
    if (at >= 0) {
      // The marked file may have been renamed by a rotation: take the rest of it, then each newer file in full.
      return fam.slice(at).map((x, i) => readFrom(x.name, i === 0 ? m[key] || 0 : 0)).join("");
    }
    // The marked file is gone (rotated out of retention): everything that still exists is newer than the mark.
    return fam.map((x) => readFrom(x.name, 0)).join("");
  }
  return readFrom(FILES[key], m[key] || 0);
}
function lines(m, key) {
  return since(m, key).split("\n").filter(Boolean).map((text) => {
    try { return { text, line: JSON.parse(text) }; } catch { return { text, line: null }; }
  });
}
/** Problems with every structured line since the mark: not JSON, or not the documented format. */
function problems(m) {
  const out = [];
  for (const key of ["api", "web"]) {
    for (const { text, line } of lines(m, key)) {
      const e = line ? contract.validate(SCHEMA.line, line, SCHEMA) : ["not JSON"];
      if (key === "api" && line && line.layer !== "api") e.push("api file holds a web line");
      if (key === "web" && line && line.layer !== "web") e.push("web file holds an api line");
      if (e.length) out.push(`${FILES[key]}: ${e[0]} in ${text.slice(0, 120)}`);
    }
  }
  return out;
}
const count = (m) => ({ api: lines(m, "api").length, web: lines(m, "web").length });
/** Lines for one correlation ID: { web: [...], api: [...] } as parsed objects. */
function trace(id, m) {
  const pick = (key) => lines(m, key).map((x) => x.line).filter((l) => l && l.correlationId === id);
  return { web: pick("web"), api: pick("api") };
}
const describe = (l) => (l.event === "identity" ? `identity ${l.operation} ${l.status} ${l.outcome}` : `${l.event} ${l.method} ${l.route} ${l.status} ${l.outcome}`);
/** Compact form of a trace for check details and comparisons. */
const shape = (t) => ({ web: t.web.map(describe), api: t.api.map(describe) });
/** Every local log's text since the mark (structured and console). */
const allText = (m) => Object.keys(FILES).map((k) => since(m, k)).join("\n");

module.exports = { LOG_DIR, FILES, SCHEMA, mark, since, lines, problems, count, trace, describe, shape, allText };
