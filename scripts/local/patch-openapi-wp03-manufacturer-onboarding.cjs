#!/usr/bin/env node
/** One-off patch: WP03 optimized manufacturer onboarding routes and schemas in the local OpenAPI artifact. */
const fs = require("fs");
const path = require("path");

const OPENAPI = path.join(__dirname, "../../docs/wp03/bee-local-api.openapi.json");
const doc = JSON.parse(fs.readFileSync(OPENAPI, "utf8"));

doc.info.version = "0.37.0";

const errResp = (codes) => ({
  description: "Error.",
  headers: {
    "X-Correlation-Id": { $ref: "#/components/headers/CorrelationId" },
    "Cache-Control": { $ref: "#/components/headers/NoStore" },
  },
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
      examples: Object.fromEntries(
        codes.map((c) => [
          c,
          { value: { error: c, message: doc["x-bee-error-codes"][c]?.message ?? c } },
        ]),
      ),
    },
  },
  "x-error-codes": codes,
});

const moMessages = {
  organisation_not_eligible: "This organisation cannot start manufacturer onboarding in its current permittee state.",
  not_permitted: "This role cannot perform this action.",
  observation_not_ended: "The observation period has not ended yet.",
  anomaly_open: "An anomaly is already open on this application.",
  clock_override_refused: "A caller-supplied date cannot override the observation clock.",
};
for (const [code, status] of [
  ["organisation_not_eligible", 403],
  ["not_permitted", 403],
  ["observation_not_ended", 409],
  ["anomaly_open", 409],
  ["clock_override_refused", 422],
]) {
  doc["x-bee-error-codes"][code] = {
    status,
    layer: "spring",
    message: moMessages[code],
    when: "Manufacturer onboarding orchestration refusal.",
  };
}
const errEnum = doc.components.schemas.Error.properties.error.enum;
for (const code of ["organisation_not_eligible", "not_permitted", "observation_not_ended", "anomaly_open", "clock_override_refused"]) {
  if (!errEnum.includes(code)) errEnum.push(code);
}

const springServer = [{ url: "http://127.0.0.1:8090", description: "Spring API. INTERNAL." }];
const browserServer = [{ url: "http://127.0.0.1:3100", description: "Next.js portal." }];
const corr = [{ $ref: "#/components/parameters/CorrelationId" }];

const internalBase = {
  servers: springServer,
  "x-bee-audience": "internal",
};

const browserBase = {
  servers: browserServer,
  "x-bee-audience": "browser",
};

const moState = {
  type: "string",
  enum: [
    "draft", "submitted", "automatic_checks_failed", "director_review", "active_observation",
    "active", "on_hold", "rejected", "revoked",
  ],
};

doc.components.schemas.ManufacturerOnboardingItem = {
  type: "object",
  additionalProperties: false,
  required: ["id", "reference", "organisationId", "legalName", "state", "version", "tradeLicenceUploaded", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    reference: { type: "string" },
    organisationId: { type: "string", format: "uuid" },
    legalName: { type: "string" },
    state: moState,
    version: { type: "integer", minimum: 0 },
    tradeLicenceUploaded: { type: "boolean" },
    permitteeNumber: { type: "string" },
    observationEndsOn: { type: "string", format: "date" },
    createdAt: { type: "string", format: "date-time" },
    outcome: { type: "string" },
    paymentId: { type: "string", format: "uuid" },
  },
};

doc.components.schemas.ManufacturerOnboardingDetail = {
  type: "object",
  additionalProperties: false,
  required: ["id", "reference", "organisationId", "legalName", "state", "version", "tradeLicenceUploaded", "createdAt"],
  properties: {
    ...doc.components.schemas.ManufacturerOnboardingItem.properties,
    draft: { type: "object", additionalProperties: true },
    documents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["documentKind", "latestVersion", "status"],
        properties: {
          documentKind: { type: "string" },
          latestVersion: { type: "integer", minimum: 0 },
          status: { type: "string" },
          expiresOn: { type: "string", format: "date" },
        },
      },
    },
    automatedChecks: { type: "array", items: { type: "object", additionalProperties: true } },
    lifecycle: { type: "array", items: { type: "object", additionalProperties: true } },
    anomalies: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

doc.components.schemas.ManufacturerOnboardingDocumentList = {
  type: "object",
  additionalProperties: false,
  required: ["applicationId", "documents"],
  properties: {
    applicationId: { type: "string", format: "uuid" },
    documents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["documentKind", "latestVersion", "status"],
        properties: {
          documentKind: { type: "string" },
          latestVersion: { type: "integer", minimum: 0 },
          status: { type: "string" },
          expiresOn: { type: "string", format: "date" },
        },
      },
    },
  },
};

const detail200 = {
  description: "Application detail.",
  headers: {
    "X-Correlation-Id": { $ref: "#/components/headers/CorrelationId" },
    "Cache-Control": { $ref: "#/components/headers/NoStore" },
  },
  content: { "application/json": { schema: { $ref: "#/components/schemas/ManufacturerOnboardingDetail" } } },
};

doc.components.schemas.ManufacturerOnboardingList = {
  type: "object",
  additionalProperties: false,
  required: ["items", "count", "authority"],
  properties: {
    items: { type: "array", items: { $ref: "#/components/schemas/ManufacturerOnboardingItem" } },
    count: { type: "integer", minimum: 0 },
    authority: { type: "string", const: "spring-database" },
  },
};

doc.components.schemas.ManufacturerOnboardingSubmitPreview = {
  type: "object",
  additionalProperties: false,
  required: ["applicationId", "state", "version", "tradeLicenceUploaded", "expectedFee"],
  properties: {
    applicationId: { type: "string", format: "uuid" },
    state: { $ref: "#/components/schemas/ManufacturerOnboardingItem/properties/state" },
    version: { type: "integer", minimum: 0 },
    tradeLicenceUploaded: { type: "boolean" },
    expectedFee: {
      type: "object",
      additionalProperties: false,
      required: ["amountInr", "feeRuleKey", "feeRuleVersion"],
      properties: {
        amountInr: { type: "string" },
        feeRuleKey: { type: "string" },
        feeRuleVersion: { type: "integer", minimum: 0 },
      },
    },
  },
};

const listGet = {
  operationId: "springListManufacturerOnboarding",
  tags: ["spring-internal"],
  security: [{ springBearer: [] }],
  summary: "List manufacturer onboarding applications the caller may read.",
  parameters: corr,
  responses: {
    200: {
      description: "Applications.",
      headers: {
        "X-Correlation-Id": { $ref: "#/components/headers/CorrelationId" },
        "Cache-Control": { $ref: "#/components/headers/NoStore" },
      },
      content: { "application/json": { schema: { $ref: "#/components/schemas/ManufacturerOnboardingList" } } },
    },
    401: errResp(["unauthenticated"]),
    403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_read_scope"]),
    503: errResp(["service_unavailable"]),
  },
};

const itemGet = {
  operationId: "springGetManufacturerOnboarding",
  tags: ["spring-internal"],
  security: [{ springBearer: [] }],
  summary: "Read one manufacturer onboarding application.",
  parameters: [...corr, { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
  responses: {
    200: {
      description: "Application.",
      headers: {
        "X-Correlation-Id": { $ref: "#/components/headers/CorrelationId" },
        "Cache-Control": { $ref: "#/components/headers/NoStore" },
      },
      content: { "application/json": { schema: { $ref: "#/components/schemas/ManufacturerOnboardingDetail" } } },
    },
    401: errResp(["unauthenticated"]),
    403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_read_scope"]),
    404: errResp(["not_found"]),
    503: errResp(["service_unavailable"]),
  },
};
itemGet.responses[200] = detail200;

doc.paths["/api/manufacturer-onboarding"] = { ...internalBase, get: listGet, post: { ...listGet, operationId: "springCreateManufacturerOnboarding", summary: "Create draft application." } };
doc.paths["/api/manufacturer-onboarding/{id}"] = {
  ...internalBase,
  get: itemGet,
  patch: {
    ...itemGet,
    operationId: "springPatchManufacturerOnboarding",
    summary: "Patch draft legal name on a manufacturer onboarding application.",
  },
};
doc.paths["/api/manufacturer-onboarding/{id}/submit"] = {
  ...internalBase,
  get: {
    ...itemGet,
    operationId: "springPreviewManufacturerOnboardingSubmit",
    summary: "Preview draft submit readiness and provisional fee for manufacturer onboarding.",
    responses: {
      ...itemGet.responses,
      200: {
        description: "Preview.",
        headers: itemGet.responses[200].headers,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ManufacturerOnboardingSubmitPreview" } } },
      },
      403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "not_submittable"]),
      422: errResp(["rule_not_available"]),
    },
  },
  post: {
    ...itemGet,
    operationId: "springSubmitManufacturerOnboarding",
    summary: "Submit with simulated payment and checks.",
    responses: {
      ...itemGet.responses,
      403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "organisation_not_eligible", "not_submittable"]),
      409: errResp(["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"]),
      422: errResp(["validation_failed", "idempotency_key_required", "rule_not_available"]),
    },
  },
};

for (const suffix of ["director-decision", "anomalies", "anomaly-resolution", "observation/close"]) {
  const cmd422 =
    suffix === "observation/close"
      ? ["validation_failed", "idempotency_key_required", "clock_override_refused"]
      : ["validation_failed", "idempotency_key_required"];
  doc.paths[`/api/manufacturer-onboarding/{id}/${suffix}`] = {
    ...internalBase,
    post: {
      operationId: `springManufacturerOnboarding_${suffix.replace(/\//g, "_")}`,
      tags: ["spring-internal"],
      security: [{ springBearer: [] }],
      summary: `Manufacturer onboarding ${suffix}.`,
      parameters: [...corr, { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        200: itemGet.responses[200],
        401: errResp(["unauthenticated"]),
        403: errResp(["mfa_required", "no_active_account", "no_effective_role", "not_permitted", "segregation_refused"]),
        404: errResp(["not_found"]),
        409: errResp(["version_conflict", "idempotency_key_conflict", "idempotency_in_progress", "observation_not_ended", "anomaly_open"]),
        422: errResp(cmd422),
        503: errResp(["service_unavailable"]),
      },
    },
  };
}

doc.paths["/api/manufacturer-onboarding/{id}/documents"] = {
  ...internalBase,
  get: {
    operationId: "springListManufacturerOnboardingDocuments",
    tags: ["spring-internal"],
    security: [{ springBearer: [] }],
    summary: "List document metadata for a manufacturer onboarding application.",
    parameters: [...corr, { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
    responses: {
      200: {
        description: "Documents.",
        headers: itemGet.responses[200].headers,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ManufacturerOnboardingDocumentList" } } },
      },
      401: errResp(["unauthenticated"]),
      403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_read_scope"]),
      404: errResp(["not_found"]),
      503: errResp(["service_unavailable"]),
    },
  },
  post: {
    operationId: "springUploadManufacturerOnboardingDocument",
    tags: ["spring-internal"],
    security: [{ springBearer: [] }],
    summary: "Upload trade licence PDF.",
    parameters: [...corr, { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
    responses: {
      200: itemGet.responses[200],
      401: errResp(["unauthenticated"]),
      403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "not_editable"]),
      404: errResp(["not_found"]),
      422: errResp(["validation_failed"]),
      503: errResp(["service_unavailable"]),
    },
  },
};

doc.paths["/api/runtime/manufacturer-onboarding"] = {
  ...browserBase,
  get: { ...listGet, operationId: "runtimeListManufacturerOnboarding", tags: ["next-browser"], security: [{ portalSession: [] }] },
  post: {
    ...listGet,
    operationId: "runtimeCreateManufacturerOnboarding",
    summary: "Create draft manufacturer onboarding application.",
    tags: ["next-browser"],
    security: [{ portalSession: [] }],
  },
};
doc.paths["/api/runtime/manufacturer-onboarding/{id}"] = {
  ...browserBase,
  get: { ...itemGet, operationId: "runtimeGetManufacturerOnboarding", tags: ["next-browser"], security: [{ portalSession: [] }] },
  patch: {
    ...itemGet,
    operationId: "runtimePatchManufacturerOnboarding",
    summary: "Patch draft legal name on a manufacturer onboarding application (browser).",
    tags: ["next-browser"],
    security: [{ portalSession: [] }],
  },
};
doc.paths["/api/runtime/manufacturer-onboarding/{id}/submit"] = {
  ...browserBase,
  get: doc.paths["/api/manufacturer-onboarding/{id}/submit"].get,
  post: doc.paths["/api/manufacturer-onboarding/{id}/submit"].post,
};
for (const k of ["get", "post"]) {
  doc.paths["/api/runtime/manufacturer-onboarding/{id}/submit"][k].tags = ["next-browser"];
  doc.paths["/api/runtime/manufacturer-onboarding/{id}/submit"][k].security = [{ portalSession: [] }];
  doc.paths["/api/runtime/manufacturer-onboarding/{id}/submit"][k].operationId =
    `runtimeManufacturerOnboardingSubmit_${k}`;
}

doc.paths["/api/manufacturer-onboarding"].post.responses = {
  201: {
    description: "Created draft.",
    headers: listGet.responses[200].headers,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ManufacturerOnboardingDetail" } } },
  },
  401: errResp(["unauthenticated"]),
  403: errResp(["mfa_required", "no_active_account", "no_effective_role", "no_read_scope"]),
  409: errResp(["idempotency_key_conflict", "idempotency_in_progress"]),
  422: errResp(["validation_failed", "idempotency_key_required"]),
  503: errResp(["service_unavailable"]),
};
doc.paths["/api/runtime/manufacturer-onboarding"].post.responses = doc.paths["/api/manufacturer-onboarding"].post.responses;

for (const suffix of ["director-decision", "anomalies", "anomaly-resolution", "observation/close", "documents"]) {
  const spring = doc.paths[`/api/manufacturer-onboarding/{id}/${suffix}`];
  doc.paths[`/api/runtime/manufacturer-onboarding/{id}/${suffix}`] = {
    ...spring,
    ...browserBase,
  };
  for (const k of Object.keys(spring)) {
    if (spring[k].operationId) {
      doc.paths[`/api/runtime/manufacturer-onboarding/{id}/${suffix}`][k] = {
        ...spring[k],
        operationId: `runtimeManufacturerOnboarding_${suffix.replace(/\//g, "_")}_${k}`,
        tags: ["next-browser"],
        security: [{ portalSession: [] }],
      };
    }
  }
}

fs.writeFileSync(OPENAPI, `${JSON.stringify(doc, null, 2)}\n`);
console.log("Patched", OPENAPI, "to", doc.info.version);
