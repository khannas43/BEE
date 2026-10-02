/* Extends bee-local-api.openapi.json for WP05.1c review fixes; run: node scripts/local/patch-openapi-wp051c-review.cjs */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "../..");
const file = path.join(ROOT, "docs/wp03/bee-local-api.openapi.json");
const doc = JSON.parse(fs.readFileSync(file, "utf8"));

doc.info.version = "0.4.3";

const errEnum = doc.components.schemas.Error.properties.error.enum;
if (!errEnum.includes("fee_preview_conflict")) errEnum.push("fee_preview_conflict");

doc["x-bee-error-codes"].fee_preview_conflict = {
  status: 409,
  layer: "spring",
  message: "The provisional fee changed since it was reviewed.",
  when: "POST submit when resolved fee differs from expectedFee in the request body.",
};

Object.assign(doc.components.schemas, {
  ExpectedFeeSubmit: {
    type: "object",
    additionalProperties: false,
    required: ["amountInr", "feeRuleKey", "feeRuleVersion"],
    properties: {
      amountInr: { type: "string" },
      feeRuleKey: { type: "string" },
      feeRuleVersion: { type: "integer", minimum: 1 },
    },
  },
  DraftSummary: {
    type: "object",
    additionalProperties: false,
    required: ["brandName", "category", "modelNumber"],
    properties: {
      brandName: { type: "string" },
      category: { type: "string" },
      modelNumber: { type: "string" },
    },
  },
});

doc.components.schemas.ModelApplicationSubmit = {
  type: "object",
  additionalProperties: false,
  required: ["version", "expectedFee"],
  properties: {
    version: { type: "integer", minimum: 0 },
    expectedFee: { $ref: "#/components/schemas/ExpectedFeeSubmit" },
  },
};

const preview = doc.components.schemas.SubmitPreview;
preview.properties.draftSummary = { $ref: "#/components/schemas/DraftSummary" };

const modelApp = doc.components.schemas.ModelApplication;
if (modelApp && modelApp.properties) {
  modelApp.properties.submissionFee = { $ref: "#/components/schemas/SubmissionFee" };
}

const addFeePreview409 = (pathItem) => {
  for (const method of ["post"]) {
    const op = pathItem[method];
    if (!op?.responses?.[409]) return;
    const codes = op.responses[409]["x-error-codes"];
    if (codes && !codes.includes("fee_preview_conflict")) {
      op.responses[409]["x-error-codes"] = [...codes, "fee_preview_conflict"];
    }
  }
};

addFeePreview409(doc.paths["/api/model-applications/{id}/submit"]);
addFeePreview409(doc.paths["/api/runtime/model-applications/{id}/submit"]);

fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(path.join(ROOT, "scripts/local/contract-pin.json"), `${JSON.stringify({ version: "0.4.3", sha256: sha }, null, 2)}\n`);
console.log("Patched", file, "to", doc.info.version, "pin", sha.slice(0, 12) + "…");
