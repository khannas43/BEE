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

const LOG_DIR = path.join(__dirname, "../../.local/logs");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/wp03/request-log.schema.json"), "utf8"));
const FILES = { api: "api-requests.jsonl", web: "web-requests.jsonl", apiConsole: "api.log", webConsole: "web.log", apiConsoleBefore: "api.before-contract-restart.log" };

const size = (f) => { try { return fs.statSync(path.join(LOG_DIR, f)).size; } catch { return 0; } };
/** Current sizes; text after a mark is read from there, or from 0 if the file was rotated or recreated. */
const mark = () => ({ ...Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, size(f)])), apiConsoleBefore: 0 });
function since(m = {}, key) {
  const f = path.join(LOG_DIR, FILES[key]);
  try {
    const buf = fs.readFileSync(f);
    return buf.subarray(buf.length >= (m[key] || 0) ? m[key] || 0 : 0).toString("utf8");
  } catch { return ""; }
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
