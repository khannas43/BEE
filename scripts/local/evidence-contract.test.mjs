// WP05.1d: the BFF validators for the evidence fields, the laboratory choices and the submit preview gates,
// plus the new allowed status/code pairs. No Spring or Keycloak. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ERROR_MESSAGES,
  EVIDENCE_GATE_CODES,
  SPRING_SUBMIT_ERRORS,
  validateEligibleBrandList,
  validateModelApplication,
  validateModelApplicationSubmitted,
  validateSubmitPreview,
} from "../../lib/server/apiContract.ts";

const contract = JSON.parse(readFileSync(new URL("../../docs/wp03/bee-local-api.openapi.json", import.meta.url), "utf8"));
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const APP = {
  id: ID, reference: "LOCAL-MA-0100", organisation: "NOVA", brandName: "Nova Cool", category: "RAC", modelNumber: "NC-1",
  state: "draft", version: 1, readBasis: ["own-org"],
};
const gates = (unmet = []) => EVIDENCE_GATE_CODES.map((code) => ({ code, met: !unmet.includes(code) }));

test("a model application may carry the evidence fields, and malformed ones are refused", () => {
  const full = { ...APP, laboratoryCode: "LAB", testedOn: "2026-09-01", declaredIseer: 4.5 };
  assert.deepEqual(validateModelApplication(full), full);
  assert.notEqual(validateModelApplication(APP), null, "all three are optional");
  for (const bad of [
    { laboratoryCode: "lab" }, { laboratoryCode: "" }, { laboratoryCode: 1 },
    { testedOn: "01/09/2026" }, { testedOn: 20260901 },
    { declaredIseer: 0 }, { declaredIseer: -1 }, { declaredIseer: 100 }, { declaredIseer: "4.5" },
  ]) {
    assert.equal(validateModelApplication({ ...APP, ...bad }), null, JSON.stringify(bad));
  }
});

test("a submitted application carries the same optional evidence fields", () => {
  const fee = { amountInr: "24000.00", currency: "INR", feeRuleKey: "RAC:new_model", feeRuleVersion: 2, verificationStatus: "provisional", localDemoFee: true, label: "x" };
  const body = { ...APP, state: "fee_due", laboratoryCode: "LAB", testedOn: "2026-09-01", declaredIseer: 4.5, submissionFee: fee };
  assert.notEqual(validateModelApplicationSubmitted(body), null);
});

test("the eligible-brands body requires the laboratory list and checks each entry", () => {
  const brand = { brandId: ID, brandName: "Nova Cool", principalOrganisation: "NOVA", principalOrganisationId: ID };
  const ok = { items: [brand], count: 1, authority: "spring-database", laboratories: [{ code: "LAB", name: "Synthetic Test Laboratory" }] };
  assert.notEqual(validateEligibleBrandList(ok), null);
  assert.notEqual(validateEligibleBrandList({ ...ok, laboratories: [] }), null, "an empty list is valid");
  const { laboratories, ...without } = ok;
  void laboratories;
  assert.equal(validateEligibleBrandList(without), null, "the list is required");
  assert.equal(validateEligibleBrandList({ ...ok, laboratories: [{ code: "lab", name: "x" }] }), null);
  assert.equal(validateEligibleBrandList({ ...ok, laboratories: [{ code: "LAB", name: "x", extra: 1 }] }), null);
});

test("the submit preview lists the six gates in order, and anything else is refused", () => {
  const preview = { ready: false, version: 1, intakeNote: "note", evidenceGates: gates(["test_report_required"]) };
  assert.notEqual(validateSubmitPreview(preview), null);
  assert.equal(validateSubmitPreview({ ...preview, evidenceGates: undefined }), null);
  assert.equal(validateSubmitPreview({ ...preview, evidenceGates: gates().slice(1) }), null, "all six are required");
  assert.equal(validateSubmitPreview({ ...preview, evidenceGates: [...gates()].reverse() }), null, "order is part of the contract");
  assert.equal(validateSubmitPreview({ ...preview, evidenceGates: gates().map((g) => ({ ...g, met: "yes" })) }), null);
});

test("submit may answer each gate with its documented status, and the artifact says the same", () => {
  const codes422 = ["test_report_required", "declared_efficiency_required", "test_date_invalid", "laboratory_not_accredited", "standard_not_available"];
  for (const c of codes422) assert.ok(SPRING_SUBMIT_ERRORS[422].includes(c), c);
  assert.ok(SPRING_SUBMIT_ERRORS[409].includes("duplicate_model"));
  for (const path of ["/api/model-applications/{id}/submit", "/api/runtime/model-applications/{id}/submit"]) {
    const responses = contract.paths[path].post.responses;
    for (const c of codes422) assert.ok(responses["422"]["x-error-codes"].includes(c), `${path} ${c}`);
    assert.ok(responses["409"]["x-error-codes"].includes("duplicate_model"), path);
  }
  for (const c of [...codes422, "duplicate_model"]) {
    assert.equal(contract["x-bee-error-codes"][c].message, ERROR_MESSAGES[c], `${c}: one message in code and artifact`);
  }
});
