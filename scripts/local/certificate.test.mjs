// The certificate on the application detail read: the BFF validator. No Spring or Keycloak.
// Issuing it (same transaction as the approval, the numbering, the validity) is proven by SecretaryApprovalDatabaseTest and the live checks.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateApplicationCertificate, validateModelApplication } from "../../lib/server/apiContract.ts";

const CERT = {
  registrationId: "BEE/RAC/2026/10001", validFrom: "2026-10-06", validTo: "2029-10-05", status: "valid", stars: 4, declaredIseer: "4.50", verifiedIseer: "4.62",
  schemeKey: "RAC-ISEER-DEMO-1", localDemoCertificate: true, issuedAt: "2026-10-06T10:00:00Z",
};
const APP = {
  id: "3d6f0a8e-0000-4000-a000-000000000001", reference: "LOCAL-MA-0001", organisation: "NOVA", brandName: "Nova Cool", category: "RAC", modelNumber: "NC-1", state: "approved", version: 8,
  readBasis: ["own-org"], certificate: CERT,
};

test("an approved application may carry its certificate and nothing else is accepted in its place", () => {
  assert.ok(validateApplicationCertificate(CERT));
  assert.ok(validateModelApplication(APP));
  assert.ok(validateModelApplication({ ...APP, certificate: undefined, state: "fee_due" }), "the certificate is optional");
});

test("each field of the certificate is checked", () => {
  const bad = (over) => validateApplicationCertificate({ ...CERT, ...over });
  assert.equal(bad({ registrationId: "BEE/RAC/2026/1" }), null, "the number has at least five digits");
  assert.equal(bad({ registrationId: "RAC/2026/10001" }), null);
  assert.equal(bad({ validTo: "2026-10-06" }), null, "it must end after it starts");
  assert.equal(bad({ validFrom: "6 October 2026" }), null);
  assert.equal(bad({ status: "revoked" }), null, "revoked is not built");
  assert.equal(bad({ stars: 0 }), null);
  assert.equal(bad({ stars: 6 }), null);
  assert.equal(bad({ localDemoCertificate: false }), null, "it is always a local demonstration");
  assert.equal(bad({ issuedAt: "yesterday" }), null);
  assert.equal(bad({ extra: 1 }), null);
  assert.equal(validateModelApplication({ ...APP, certificate: { ...CERT, stars: 7 } }), null);
});
