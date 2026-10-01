/* One-off helper to extend bee-local-api.openapi.json for WP05.1c; run: node scripts/local/patch-openapi-wp051c.cjs */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const file = path.join(ROOT, "docs/wp03/bee-local-api.openapi.json");
const doc = JSON.parse(fs.readFileSync(file, "utf8"));

doc.info.version = "0.4.2";
doc.info.description = doc.info.description.replace(
  /Draft create\/edit are operational[^.]*\./,
  "Draft create, edit and submit (draft → fee_due with a provisional local-demo fee snapshot) are operational on the routes documented here.",
);

const err = doc.components.schemas.Error;
doc["x-bee-error-codes"].not_submittable = {
  status: 403,
  layer: "spring",
  message: "Only draft applications can be submitted.",
  when: "Submit when state is not draft.",
};
doc["x-bee-error-codes"].rule_not_available = {
  status: 422,
  layer: "spring",
  message: "Required category, standard or fee rules are not available.",
  when: "Effective master rules missing at submit time (fail closed).",
};

Object.assign(doc.components.schemas, {
  ModelApplicationSubmit: {
    type: "object",
    additionalProperties: false,
    required: ["version"],
    properties: { version: { type: "integer", minimum: 0 } },
  },
  SubmissionFee: {
    type: "object",
    additionalProperties: false,
    required: ["amountInr", "currency", "feeRuleKey", "feeRuleVersion", "verificationStatus", "localDemoFee", "label"],
    properties: {
      amountInr: { type: "string" },
      currency: { const: "INR" },
      feeRuleKey: { type: "string" },
      feeRuleVersion: { type: "integer", minimum: 1 },
      verificationStatus: { type: "string" },
      localDemoFee: { type: "boolean" },
      label: { type: "string" },
      sourceReference: { type: "string" },
    },
  },
  SubmitPreview: {
    type: "object",
    additionalProperties: false,
    required: ["ready", "version", "intakeNote"],
    properties: {
      ready: { type: "boolean" },
      version: { type: "integer", minimum: 0 },
      intakeNote: { type: "string" },
      submissionFee: { $ref: "#/components/schemas/SubmissionFee" },
    },
  },
  ModelApplicationSubmitted: {
    allOf: [{ $ref: "#/components/schemas/ModelApplication" }, {
      type: "object",
      additionalProperties: false,
      required: ["submissionFee"],
      properties: { submissionFee: { $ref: "#/components/schemas/SubmissionFee" } },
    }],
  },
});

const denyHdr = {
  "X-Correlation-Id": { $ref: "#/components/headers/CorrelationId" },
  "Cache-Control": { $ref: "#/components/headers/NoStore" },
};
const errResp = (codes) => ({
  description: "Error.",
  headers: denyHdr,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  "x-error-codes": codes,
});

const internalSubmit = {
  servers: [{ url: "http://127.0.0.1:8090", description: "Spring API. INTERNAL: bound to 127.0.0.1 and called only by Next.js server code with the session's access token." }],
  "x-bee-audience": "internal",
  get: {
    operationId: "springSubmitPreview",
    tags: ["spring-internal"],
    security: [{ springBearer: [] }],
    summary: "Preview draft submit readiness and provisional fee.",
    parameters: [{ $ref: "#/components/parameters/CorrelationId" }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: {
      200: {
        description: "Preview.",
        headers: denyHdr,
        content: { "application/json": { schema: { $ref: "#/components/schemas/SubmitPreview" } } },
      },
      401: errResp(["unauthenticated"]),
      403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "not_submittable"]),
      404: errResp(["not_found"]),
      503: errResp(["service_unavailable"]),
    },
  },
  post: {
    operationId: "springSubmitModelApplication",
    tags: ["spring-internal"],
    security: [{ springBearer: [] }],
    summary: "Submit draft → fee_due with fee snapshot.",
    parameters: [
      { $ref: "#/components/parameters/CorrelationId" },
      { $ref: "#/components/parameters/IdempotencyKey" },
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/ModelApplicationSubmit" } } },
    },
    responses: {
      200: {
        description: "Submitted.",
        headers: { ...denyHdr, "Idempotency-Replayed": { schema: { type: "string" }, description: "true when replaying a completed idempotent submit." } },
        content: { "application/json": { schema: { $ref: "#/components/schemas/ModelApplicationSubmitted" } } },
      },
      401: errResp(["unauthenticated"]),
      403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "brand_not_permitted", "not_submittable"]),
      404: errResp(["not_found"]),
      409: errResp(["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"]),
      422: errResp(["validation_failed", "idempotency_key_required", "rule_not_available"]),
      503: errResp(["service_unavailable"]),
    },
  },
};

const browserSubmit = JSON.parse(JSON.stringify(internalSubmit));
browserSubmit.servers = [{ url: "http://127.0.0.1:3100", description: "Next.js portal. BROWSER-FACING same-origin routes; the browser never holds a token." }];
browserSubmit["x-bee-audience"] = "browser";
browserSubmit.get.operationId = "runtimeSubmitPreview";
browserSubmit.get.tags = ["next-browser"];
browserSubmit.get.security = [{ portalSession: [] }];
browserSubmit.get.responses[401]["x-error-codes"] = ["no_session", "session_expired", "unauthenticated"];
browserSubmit.post.operationId = "runtimeSubmitModelApplication";
browserSubmit.post.tags = ["next-browser"];
browserSubmit.post.security = [{ portalSession: [] }];
browserSubmit.post.responses[401]["x-error-codes"] = ["no_session", "session_expired", "unauthenticated"];

doc.paths["/api/model-applications/{id}/submit"] = internalSubmit;
doc.paths["/api/runtime/model-applications/{id}/submit"] = browserSubmit;

doc["x-bee-idempotency"].status = "implemented in bee_app (WP05.1b draft create/edit; WP05.1c submit); see Flyway V7 idempotency_record";
doc["x-bee-idempotency"].owner = "WP05.1c";
doc["x-bee-default-deny"].spring = doc["x-bee-default-deny"].spring.replace(
  "Includes POST /api/model-applications/{id}/submit, history",
  "Includes GET /api/model-applications/{id}/history",
);
doc["x-bee-deferred"] = doc["x-bee-deferred"].filter((d) => d.route !== "POST /api/model-applications/{id}/submit");

fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
console.log("Patched", file, "to", doc.info.version);
