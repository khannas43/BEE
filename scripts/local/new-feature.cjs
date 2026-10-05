/**
 * Scaffolds a new model-application COMMAND (a POST on /api/model-applications/{id}/<segment>) and registers it
 * everywhere a route has to be registered. Nothing it generates can act until a developer implements it: the Spring
 * service denies every caller (denied_by_default) while its IMPLEMENTED flag is false.
 *
 *   node scripts/local/new-feature.cjs --name fee-confirmation --package finance \
 *        --path "/api/model-applications/{id}/fee-confirmation" [--dry-run] [--apply]
 *
 * Without --apply it writes only the new files and prints the registrations it would make. With --apply it also makes
 * them, idempotently: the security allowlist, the correlation-ID route map, the request-log unions and schema, and the
 * OpenAPI operations for both layers (cloned from the submit operations, so they are schema-valid by construction),
 * then bumps the contract version, re-pins it and runs the wiring check. See docs/kit/FEATURE_TEMPLATE.md.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = process.env.NEW_FEATURE_ROOT || path.join(__dirname, "../..");
const abs = (rel) => path.join(ROOT, rel);

// ---------- arguments ----------
function args(argv) {
  const out = { apply: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.dry = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}
const a = args(process.argv.slice(2));
const die = (m) => {
  console.error(`new-feature: ${m}`);
  process.exit(2);
};
if (!a.name || !/^[a-z][a-z0-9-]{2,40}$/.test(a.name)) die("--name is required: lowercase kebab-case, e.g. fee-confirmation");
const pkg = a.package || "application";
if (!/^[a-z]{3,20}$/.test(pkg)) die("--package must be a lowercase Java package segment, e.g. finance");
if (!a.path || !/^\/api\/model-applications\/\{id\}\/[a-z][a-z0-9-]*$/.test(a.path)) die('--path must look like "/api/model-applications/{id}/<segment>"');

const kebab = a.name;
const Pascal = kebab.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const camel = Pascal[0].toLowerCase() + Pascal.slice(1);
const UPPER = kebab.toUpperCase().replace(/-/g, "_");
const springPath = a.path;
const segment = springPath.split("/").pop();
const runtimePath = springPath.replace(/^\/api/, "/api/runtime");
const star = springPath.replace(/\{[^}]+\}/g, "*");
const regex = springPath.replace(/\{[^}]+\}/g, "[^/]+");
const nextFile = `app${runtimePath.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;

// ---------- new files ----------
const controller = `package gov.bee.api.${pkg};

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.identity.CallerResolver;
import gov.bee.api.web.ApiErrors;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Scaffolded by scripts/local/new-feature.cjs. TODO(${kebab}): describe the command. */
@RestController
public class ${Pascal}Controller {

    private final CallerResolver callers;
    private final ${Pascal}Service service;
    private final ObjectMapper json;

    public ${Pascal}Controller(CallerResolver callers, ${Pascal}Service service, ObjectMapper json) {
        this.callers = callers;
        this.service = service;
        this.json = json;
    }

    @PostMapping("${springPath}")
    public ResponseEntity<Map<String, Object>> run(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                   @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                   @RequestBody(required = false) String rawBody) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        JsonNode body = parseBody(rawBody);
        if (body == null) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        return service.run(resolved.caller(), parseId(id), idempotencyKey, body);
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return UUID.fromString("00000000-0000-4000-c000-000000000000");
        }
    }

    private JsonNode parseBody(String raw) {
        try {
            return json.readTree(raw == null ? "{}" : raw);
        } catch (Exception e) {
            return null;
        }
    }
}
`;

const service = `package gov.bee.api.${pkg};

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationDraftService;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.web.ApiErrors;
import java.security.MessageDigest;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Scaffolded by scripts/local/new-feature.cjs from the submit command's pattern. TODO(${kebab}): implement.
 *
 * The command stays DENIED for every caller until IMPLEMENTED is true and the TODOs below are done:
 *  1. who may act (role, scope, assignment) and from which state;
 *  2. the request body and its validation;
 *  3. the transition, and the audit event written in the same transaction as the state change;
 *  4. the error codes the contract documents (docs/wp03/bee-local-api.openapi.json, x-error-codes).
 */
@Service
public class ${Pascal}Service {

    static final String ROUTE = "${springPath}";
    /** Flip to true only when the command is implemented and its tests exist. Until then every call is denied. */
    private static final boolean IMPLEMENTED = false;
    private static final String FROM_STATE = "TODO_FROM_STATE";
    private static final String TO_STATE = "TODO_TO_STATE";

    private final ModelApplicationRepository applications;
    private final ${Pascal}Repository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public ${Pascal}Service(ModelApplicationRepository applications, ${Pascal}Repository repository,
                            IdempotencyRepository idempotency, ObjectMapper json) {
        this.applications = applications;
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> run(Caller caller, UUID appId, String idempotencyKey, JsonNode body) {
        if (!IMPLEMENTED) {
            return error(HttpStatus.FORBIDDEN, "denied_by_default");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, appId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        // TODO(${kebab}): the rule for who may act. Scoped read is the base; add this command's role and assignment check.
        var scope = SlicePolicy.readScope(caller);
        Optional<ModelApplicationRepository.Row> found = scope.isEmpty() ? Optional.empty()
            : applications.find(appId, scope, caller.accountId()).filter(r -> SlicePolicy.canRead(scope, facts(r)));
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        ModelApplicationRepository.Row row = found.get();
        if (!FROM_STATE.equals(row.state())) {
            return error(HttpStatus.FORBIDDEN, "not_editable");
        }
        if (!body.has("version") || !body.get("version").isInt()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (row.version() != body.get("version").asInt()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        if (!repository.transition(appId, row.version(), FROM_STATE, TO_STATE)) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> view = ModelApplicationDraftService.view(applications.find(appId, scope, caller.accountId()).orElseThrow(), scope);
        idempotency.complete(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, 200, writeJson(view), row.version() + 1);
        return ResponseEntity.ok(view);
    }

    /** The replay rules every command shares: a key is required, a repeat with the same body returns the stored answer. */
    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, UUID appId, String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", ROUTE, appId, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), "POST", ROUTE, appId, key);
        if (priorHash.isEmpty() || !MessageDigest.isEqual(priorHash.get(), DraftRequestSupport.bodyHash(body))) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(s.responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(s.responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private static ApplicationFacts facts(ModelApplicationRepository.Row r) {
        return new ApplicationFacts(r.id(), r.organisationId(), r.state(), r.assignedStagesForCaller(), Set.of(), false);
    }

    private String writeJson(Map<String, Object> view) {
        try {
            return json.writeValueAsString(view);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }
}
`;

const repository = `package gov.bee.api.${pkg};

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Scaffolded by scripts/local/new-feature.cjs. TODO(${kebab}): the transition and its audit event. */
@Repository
public class ${Pascal}Repository {

    private final JdbcTemplate jdbc;

    public ${Pascal}Repository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The state change, guarded by the expected state and version so a concurrent write loses cleanly. TODO(${kebab}): also
     * INSERT the audit event here, in the same transaction (see ModelApplicationSubmitRepository). A runtime role needs
     * INSERT, SELECT only on an append-only event table: add the table, its triggers and grants in a new Flyway migration.
     */
    @Transactional
    public boolean transition(UUID applicationId, int expectedVersion, String fromState, String toState) {
        int updated = jdbc.update(
            "UPDATE model_application SET state = ?, version = version + 1 WHERE id = ? AND state = ? AND version = ?",
            toState, applicationId, fromState, expectedVersion);
        return updated == 1;
    }
}
`;

const bffRoute = `import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_${UPPER} } from "@/lib/server/contracts/${kebab}";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => \`/api/model-applications/\${springIdSegment(id)}/${segment}\`;

export const POST = logged("${runtimePath}", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_${UPPER});
});

export const GET = logged("${runtimePath}", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
`;

const contractModule = `/**
 * Contract for ${springPath} (scaffolded by scripts/local/new-feature.cjs). Per-feature, so the shared apiContract.ts
 * is not edited for every route. TODO(${kebab}): keep these tables equal to the operation's x-error-codes in the
 * OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { RESOLVER_DENIALS, type UpstreamErrors, validateModelApplication } from "@/lib/server/apiContract";

export const SPRING_${UPPER}_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_write_scope", "denied_by_default", "not_editable"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

/** A successful command returns the updated model application. */
export const SPRING_${UPPER} = { errors: SPRING_${UPPER}_ERRORS, validate: validateModelApplication, successStatuses: [200] as const };
`;

const clientModule = `/**
 * Browser client for ${runtimePath} (scaffolded by scripts/local/new-feature.cjs), on the screen kit.
 * Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";
import type { ModelApplication } from "@/lib/client/runtimeModelApplications";

export const ${camel}Path = (id: string) => \`/api/runtime/model-applications/\${encodeURIComponent(id)}/${segment}\`;

const parse = (body: unknown): ModelApplication | null =>
  body && typeof body === "object" && "id" in body && "state" in body ? (body as ModelApplication) : null;

/** TODO(${kebab}): add this command's own fields to the body. \`version\` is the record version the user saw. */
export function run${Pascal}(id: string, version: number, idempotencyKey: string) {
  return runtimeCommand(${camel}Path(id), "POST", { version }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const ${camel}Signature = (p: { id: string; version: number }) => [p.id, p.version];
`;

const clientTest = `// Scaffolded by scripts/local/new-feature.cjs. TODO(${kebab}): extend with this command's own cases. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { run${Pascal}, ${camel}Path } from "../../lib/client/runtime${Pascal}.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("${kebab}: posts the version with the idempotency key to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, { id: ID, state: "TODO" });
  };
  try {
    const r = await run${Pascal}(ID, 3, KEY);
    assert.equal(r.ok, true);
    assert.equal(seen.p, ${camel}Path(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.equal(JSON.parse(seen.init.body).version, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("${kebab}: a refusal is a typed failure and a lost response is unavailable", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json(409, { error: "version_conflict", message: "The record has changed since it was loaded." });
    const stale = await run${Pascal}(ID, 1, KEY);
    assert.deepEqual([stale.ok, stale.failure.kind, stale.failure.code], [false, "conflict", "version_conflict"]);
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await run${Pascal}(ID, 1, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});
`;

const FILES = [
  [`backend/src/main/java/gov/bee/api/${pkg}/${Pascal}Controller.java`, controller],
  [`backend/src/main/java/gov/bee/api/${pkg}/${Pascal}Service.java`, service],
  [`backend/src/main/java/gov/bee/api/${pkg}/${Pascal}Repository.java`, repository],
  [nextFile, bffRoute],
  [`lib/server/contracts/${kebab}.ts`, contractModule],
  [`lib/client/runtime${Pascal}.ts`, clientModule],
  [`scripts/local/${kebab}.test.mjs`, clientTest],
];

// ---------- registrations (idempotent text edits) ----------
const log = [];
function edit(rel, fn, what) {
  const before = fs.readFileSync(abs(rel), "utf8");
  const after = fn(before);
  if (after === before) {
    log.push(`  already present: ${what}`);
    return;
  }
  if (!a.dry && a.apply) fs.writeFileSync(abs(rel), after);
  log.push(`  ${a.apply && !a.dry ? "registered" : "would register"}: ${what}`);
}

function addToUnion(src, typeName, entry) {
  const m = src.match(new RegExp(`(export type ${typeName}\\s*=)([\\s\\S]*?);`));
  if (!m) throw new Error(`union ${typeName} not found`);
  if (m[2].includes(`"${entry}"`)) return src;
  return src.replace(m[0], `${m[1]}${m[2].replace(/\s+$/, "")}\n  | "${entry}";`);
}

/** Appends an entry to the "route" enum of the schema section that contains `marker`; a no-op if it is already there. */
function addToRouteEnum(src, marker, entry) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`request-log schema section not found: ${marker}`);
  const open = src.indexOf('"enum": [', src.indexOf('"route":', at));
  const close = src.indexOf("]", open);
  if (open < 0 || close < 0) throw new Error(`request-log schema route enum not found in: ${marker}`);
  if (src.slice(open, close).includes(`"${entry}"`)) return src;
  return `${src.slice(0, close).replace(/\s+$/, "")},\n              "${entry}"${src.slice(close)}`;
}

function register() {
  edit("backend/src/main/java/gov/bee/api/security/SecurityConfig.java", (s) => {
    const line = `.requestMatchers(HttpMethod.POST, "${star}").authenticated()`;
    if (s.includes(line)) return s;
    const anchor = "                .anyRequest().denyAll())";
    if (!s.includes(anchor)) throw new Error("SecurityConfig anchor (anyRequest().denyAll()) not found");
    return s.replace(anchor, `                ${line}\n${anchor}`);
  }, `SecurityConfig: POST ${star}`);

  edit("backend/src/main/java/gov/bee/api/web/CorrelationIdFilter.java", (s) => {
    const line = `if (path.matches("${regex}")) return "${springPath}";`;
    if (s.includes(line)) return s;
    const anchor = '        if (path.endsWith("/history")';
    if (!s.includes(anchor)) throw new Error("CorrelationIdFilter anchor (/history) not found");
    return s.replace(anchor, `        ${line}\n${anchor}`);
  }, `CorrelationIdFilter route map: ${springPath}`);

  edit("lib/server/requestLog.ts", (s) => {
    let out = addToUnion(s, "WebRoute", runtimePath);
    out = addToUnion(out, "SpringRoute", springPath);
    const fn = `  if (/^${regex.replace(/\//g, "\\/")}$/.test(p)) return "${springPath}";`;
    if (!out.includes(fn)) {
      const anchor = out.match(/^  if \(\/\^\\\/api\\\/model-applications\\\/\[\^\/\]\+\\\/submit\$\/\.test\(p\)\).*$/m);
      if (!anchor) throw new Error("requestLog.ts springRoute() anchor (submit) not found");
      out = out.replace(anchor[0], `${anchor[0]}\n${fn}`);
    }
    return out;
  }, `requestLog.ts: WebRoute, SpringRoute and springRoute() for ${springPath}`);

  edit("docs/wp03/request-log.schema.json", (s) => {
    // The request line's route enum holds Spring and browser routes; the upstream line's holds Spring routes.
    const request = "One inbound request completed (Spring or a Next.js /api route).";
    const upstream = "Next.js server call to Spring for that request.";
    return [[request, springPath], [request, runtimePath], [upstream, springPath]].reduce((out, [marker, entry]) => addToRouteEnum(out, marker, entry), s);
  }, `request-log.schema.json: the request and upstream route enums for ${springPath}`);

  // OpenAPI: clone the submit POST operations. Both layers, schema-valid by construction.
  edit("docs/wp03/bee-local-api.openapi.json", (s) => {
    const doc = JSON.parse(s);
    if (doc.paths[springPath] && doc.paths[runtimePath]) return s;
    const specs = [
      [springPath, "/api/model-applications/{id}/submit", "spring"],
      [runtimePath, "/api/runtime/model-applications/{id}/submit", "runtime"],
    ];
    const requestSchema = `${Pascal}Request`;
    doc.components.schemas[requestSchema] = {
      type: "object", additionalProperties: false, required: ["version"],
      properties: { version: { type: "integer", minimum: 0, description: "The record version the user saw; a different stored version is 409 version_conflict." } },
      description: `Request body of ${springPath}. TODO(${kebab}): add this command's own fields.`,
    };
    for (const [target, source, layer] of specs) {
      const base = JSON.parse(JSON.stringify(doc.paths[source]));
      delete base.get;
      const post = base.post;
      post.operationId = `${layer}${Pascal}`;
      post.summary = `TODO(${kebab}): ${kebab.replace(/-/g, " ")}.`;
      post.requestBody.content["application/json"].schema = { $ref: `#/components/schemas/${requestSchema}` };
      const ok = post.responses["200"];
      ok.description = "Updated model application.";
      ok.content["application/json"].schema = { $ref: "#/components/schemas/ModelApplication" };
      delete ok.headers["Idempotency-Replayed"].description;
      ok.headers["Idempotency-Replayed"].description = "true when replaying a completed idempotent command.";
      const keep = (status, codes) => {
        const r = post.responses[status];
        const ex = r.content["application/json"].examples;
        for (const c of Object.keys(ex)) if (!codes.includes(c)) delete ex[c];
        for (const c of codes) if (!ex[c]) ex[c] = { value: { error: c, message: doc["x-bee-error-codes"][c]?.message ?? c } };
        r["x-error-codes"] = codes;
      };
      keep("403", ["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "denied_by_default", "not_editable"]);
      keep("409", ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"]);
      keep("422", ["validation_failed", "idempotency_key_required"]);
      doc.paths[target] = base;
    }
    // Insert new paths right after the documents routes' neighbours to keep related routes together: simply append.
    return JSON.stringify(doc, null, 2) + "\n";
  }, `OpenAPI: operations for ${springPath} and ${runtimePath}, schema ${Pascal}Request`);
}

/** package.json lists the web tests explicitly, so a generated test is added to web:test or it would never run. */
function registerTest() {
  edit("package.json", (s) => {
    const file = `scripts/local/${kebab}.test.mjs`;
    if (s.includes(file)) return s;
    const m = s.match(/("web:test": "[^"]*?scripts\/local\/[^"]*?\.test\.mjs)"/);
    if (!m) throw new Error("package.json web:test script not found");
    return s.replace(m[1] + '"', `${m[1]} ${file}"`);
  }, `package.json web:test runs scripts/local/${kebab}.test.mjs`);
}

function bumpAndPin() {
  if (!a.apply || a.dry) return;
  const docPath = abs("docs/wp03/bee-local-api.openapi.json");
  const doc = JSON.parse(fs.readFileSync(docPath, "utf8"));
  const pinPath = abs("scripts/local/contract-pin.json");
  const pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  const contractTs = fs.readFileSync(abs("lib/server/apiContract.ts"), "utf8");
  const current = /CONTRACT_VERSION = "([^"]+)"/.exec(contractTs)[1];
  const raw = fs.readFileSync(docPath, "utf8");
  const sha = crypto.createHash("sha256").update(raw).digest("hex");
  if (pin.sha256 === sha) {
    log.push("  contract already pinned at the current content");
    return;
  }
  const [maj, min] = current.split(".").map(Number);
  const next = `${maj}.${min + 1}.0`;
  doc.info.version = next;
  const out = JSON.stringify(doc, null, 2) + "\n";
  fs.writeFileSync(docPath, out);
  fs.writeFileSync(pinPath, JSON.stringify({ version: next, sha256: crypto.createHash("sha256").update(out).digest("hex") }, null, 2) + "\n");
  fs.writeFileSync(abs("lib/server/apiContract.ts"), contractTs.replace(`CONTRACT_VERSION = "${current}"`, `CONTRACT_VERSION = "${next}"`));
  log.push(`  contract ${current} -> ${next}, re-pinned`);
}

// ---------- run ----------
const clash = FILES.filter(([rel]) => fs.existsSync(abs(rel)));
if (clash.length) die(`refusing to overwrite: ${clash.map(([r]) => r).join(", ")}`);

console.log(`Scaffolding ${Pascal} for ${springPath}${a.dry ? " (dry run: nothing is written)" : ""}`);
for (const [rel, content] of FILES) {
  if (!a.dry) {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), content);
  }
  console.log(`  ${a.dry ? "would create" : "created"}: ${rel}`);
}
register();
registerTest();
bumpAndPin();
for (const l of log) console.log(l);

if (a.apply && !a.dry) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, "wiring-check.cjs")], { env: { ...process.env, WIRING_ROOT: ROOT }, encoding: "utf8" });
    console.log(`  wiring check: ${out.trim().split("\n").pop()}`);
  } catch (e) {
    console.log(`  wiring check FAILED:\n${e.stdout?.toString() ?? e.message}`);
    process.exitCode = 1;
  }
}

console.log(`
Still by hand (the scaffold cannot decide these):
  1. Implement ${Pascal}Service (who may act, from which state, the body, the audit event) and flip IMPLEMENTED.
  2. Keep lib/server/contracts/${kebab}.ts and the OpenAPI x-error-codes equal; add any new error code to ApiErrors,
     ERROR_MESSAGES and the artifact's Error enum and x-bee-error-codes.
  3. SpringContractTest: add \`@MockitoBean ${Pascal}Repository\` (the contract test mocks every repository), a
     documented-pairs test for ${springPath} (copy the submit one), and map the route to it in
     scripts/local/contract-coverage.cjs springEvidence().
  4. Browser evidence for each documented pair: a live check (copy model-submit-browser-check.cjs), the stand-in table in
     contract-check.cjs, or a unit-evidence test in request-log.test.mjs.
  5. A database test for the transition (copy ModelApplicationEvidenceDatabaseTest as the harness), a screen on the kit
     (useCommand + CommandPanel), the evidence note under docs/, and any deferred item in docs/BACKLOG.md.
  Then: npm run local:wiring, npm run api:test, npm run web:test, npm run local:check.
`);
