// The public verification answer: the BFF validator. No Spring or Keycloak. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePublicVerification } from "../../lib/server/contracts/verification.ts";

const OK = {
  registrationId: "BEE/RAC/2026/10001", manufacturer: "Nova Appliances Pvt Ltd", brandName: "Nova Cool", modelNumber: "NC-1", category: "RAC", stars: 4,
  verifiedIseer: "4.62", validFrom: "2026-10-06", validTo: "2029-10-05", status: "valid", localDemoCertificate: true,
};

test("a public answer carries exactly the public fields", () => {
  assert.ok(validatePublicVerification(OK));
  for (const status of ["expired", "not_yet_valid"]) assert.ok(validatePublicVerification({ ...OK, status }));
});

test("anything else is refused, including any private field", () => {
  const bad = (over) => validatePublicVerification({ ...OK, ...over });
  assert.equal(bad({ applicantEmail: "a@b.c" }), null);
  assert.equal(bad({ status: "revoked" }), null);
  assert.equal(bad({ stars: 0 }), null);
  assert.equal(bad({ stars: 6 }), null);
  assert.equal(bad({ validTo: "2026-10-06" }), null);
  assert.equal(bad({ registrationId: "nope" }), null);
  assert.equal(bad({ localDemoCertificate: false }), null);
  assert.equal(validatePublicVerification(null), null);
});
