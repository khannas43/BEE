/**
 * WP03.1: loads docs/wp03/bee-local-api.openapi.json and checks values against it with a
 * small, strict JSON Schema subset (the keywords the artifact uses; an unknown keyword is
 * an error, so the artifact cannot drift into something this checker silently ignores).
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../docs/wp03/bee-local-api.openapi.json");
const load = () => JSON.parse(fs.readFileSync(FILE, "utf8"));

const KNOWN = new Set(["$ref", "type", "enum", "const", "required", "properties", "additionalProperties", "items", "minItems", "minimum", "oneOf", "format", "pattern", "description"]);
const FORMATS = {
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  "date-time": (s) => !Number.isNaN(Date.parse(s)) && /T/.test(s),
};
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const typeOk = (want, v) => [].concat(want).some((t) => t === typeOf(v) || (t === "number" && typeof v === "number"));

/** Returns a list of "path: problem" strings; empty means valid. */
function validate(schema, value, doc, at = "$") {
  const errs = [];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) errs.push(`${at}: schema uses unsupported keyword ${k}`);
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], doc);
    return target ? validate(target, value, doc, at) : [`${at}: unresolved ${schema.$ref}`];
  }
  if (schema.oneOf) {
    const ok = schema.oneOf.filter((s) => validate(s, value, doc, at).length === 0).length;
    if (ok !== 1) errs.push(`${at}: matches ${ok} of ${schema.oneOf.length} oneOf branches`);
    return errs;
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errs.push(`${at}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (schema.type && !typeOk(schema.type, value)) return [...errs, `${at}: expected ${schema.type}, got ${typeOf(value)}`];
  if (typeof value === "string") {
    if (schema.format && !(FORMATS[schema.format] || (() => false))(value)) errs.push(`${at}: not ${schema.format}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === "number" && "minimum" in schema && value < schema.minimum) errs.push(`${at}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if ("minItems" in schema && value.length < schema.minItems) errs.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, doc, `${at}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const r of schema.required || []) if (!(r in value)) errs.push(`${at}: missing ${r}`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, doc, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}: unexpected property ${k}`);
      else if (typeof schema.additionalProperties === "object") errs.push(...validate(schema.additionalProperties, v, doc, `${at}.${k}`));
    }
  }
  return errs;
}

/**
 * Checks a live response against the contract operation: the status is documented, the body
 * matches its schema, an error code is one this operation lists, and the required headers
 * are present. Returns problems (empty = conforms).
 */
function conforms(doc, route, method, res) {
  const errs = check(doc, route, method, res);
  const spec = doc.paths[route]?.[method.toLowerCase()]?.responses?.[String(res.status)];
  record({ route, method: method.toUpperCase(), status: res.status, code: spec?.["x-error-codes"] ? res.json?.error ?? null : "-", ok: errs.length === 0 });
  return errs;
}

function check(doc, route, method, res) {
  const op = doc.paths[route]?.[method.toLowerCase()];
  if (!op) return [`${method} ${route} is not in the contract`];
  const spec = op.responses[String(res.status)];
  if (!spec) return [`HTTP ${res.status} is not documented for ${method} ${route}`];
  const errs = [];
  for (const [name, h] of Object.entries(spec.headers || {})) {
    const hs = h.$ref ? h.$ref.split("/").slice(1).reduce((o, k) => o[k], doc) : h;
    const v = res.headers.get(name);
    if (hs.required && v == null) errs.push(`missing header ${name}`);
    else if (v != null && hs.schema?.pattern && !new RegExp(hs.schema.pattern).test(v)) errs.push(`header ${name}=${v} does not match ${hs.schema.pattern}`);
  }
  const schema = spec.content?.["application/json"]?.schema;
  if (schema) {
    if (!/^application\/json/.test(res.headers.get("content-type") || "")) errs.push(`content-type ${res.headers.get("content-type")}`);
    errs.push(...validate(schema, res.json, doc));
    if (spec["x-error-codes"] && !spec["x-error-codes"].includes(res.json?.error)) errs.push(`error ${res.json?.error} not listed for ${res.status}`);
    if (res.json?.error && res.json.message !== doc["x-bee-error-codes"][res.json.error]?.message) errs.push(`message for ${res.json.error} differs from the contract`);
  }
  return errs;
}

/**
 * WP03.3 coverage evidence: when $CONTRACT_OBSERVED is set, every conforms() result (and
 * every record() for the default-deny and catch-all rules) is appended as one JSON line,
 * labelled with the current source: "live" (real Spring, Keycloak and database) or
 * "live-stand-in" (real Next.js boundary, controlled stand-in on Spring's port).
 */
let source = "live";
const setSource = (s) => { source = s; };
function record(o) {
  /* only the live check scripts record; unit tests importing this file (ESM, no require.main) never do */
  if (!process.env.CONTRACT_OBSERVED || !require.main?.filename) return;
  fs.appendFileSync(process.env.CONTRACT_OBSERVED, JSON.stringify({ ...o, source, suite: path.basename(require.main.filename) }) + "\n");
}

/** Build a conforms() input from headers captured in the browser (page.eval fetch). */
function observationFromBrowserFetch(r) {
  const headers = new Headers();
  if (r?.headers) {
    if (typeof r.headers.forEach === "function") r.headers.forEach((v, k) => headers.set(k, v));
    else for (const [k, v] of Object.entries(r.headers)) headers.set(k, v);
  }
  return {
    status: r.status,
    json: r.body ?? null,
    text: JSON.stringify(r.body ?? {}),
    headers,
  };
}

module.exports = { FILE, load, validate, conforms, record, setSource, observationFromBrowserFetch };
