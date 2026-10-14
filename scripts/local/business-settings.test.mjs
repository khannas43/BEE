// Business settings (WP08.1h): the BFF validators and the status and code tables. No Spring or Keycloak.
// The rules themselves (two people, not in the past, the range of each setting, the default) are proven by BusinessSettingDatabaseTest,
// SpringContractTest and the live check; the browser client belongs to the screen (Brief 12).
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPRING_BUSINESS_SETTING_DECISION, SPRING_BUSINESS_SETTING_PROPOSAL, SPRING_BUSINESS_SETTINGS, validateBusinessSettingProposal, validateBusinessSettingsAdmin,
} from "../../lib/server/contracts/business-settings.ts";

const ID = "3d6f0a8e-0000-4000-a000-0000000000f3";
const PROPOSAL = {
  id: ID, settingKey: "payment_tolerance_amount", label: "Difference allowed", unit: "rupees", effectiveFrom: "2026-10-14", value: "50.00", valueBefore: "0.00",
  sourceReference: "Circular 2026/14", reason: "Revised tolerance", state: "pending", proposedBy: "BEE Admin", proposedByYou: true, proposedAt: "2026-10-04T10:00:00Z",
  decidedBy: null, decidedAt: null, decisionNote: null, applied: false,
};
const VERSION = { effectiveFrom: "2026-01-01", value: "10.00", source: "Local note" };
const SETTING = {
  key: "payment_tolerance_amount", label: "Difference allowed", unit: "rupees", description: "Within this many rupees.", warning: null, decimals: 2, min: "0.00", max: "1000.00",
  defaultValue: "0.00", valueInForce: "10.00", inForceFrom: "2026-01-01", scheduled: [{ ...VERSION, effectiveFrom: "2026-12-01", value: "20.00" }], versions: [VERSION],
};
const ADMIN = {
  today: "2026-10-04", settings: [SETTING], pending: [PROPOSAL],
  decided: [{ ...PROPOSAL, state: "approved", proposedByYou: false, decidedBy: "BEE Finance", decidedAt: "2026-10-04T11:00:00Z", applied: true }],
};

test("the BFF validators accept the documented shapes and refuse anything else", () => {
  assert.ok(validateBusinessSettingProposal(PROPOSAL));
  assert.ok(validateBusinessSettingsAdmin(ADMIN));
  assert.ok(validateBusinessSettingsAdmin({ ...ADMIN, settings: [{ ...SETTING, warning: "Saved drafts may become unsubmittable.", inForceFrom: null, scheduled: [], versions: [] }] }), "the default applies when no version has started");
  assert.equal(validateBusinessSettingProposal({ ...PROPOSAL, applied: true }), null, "only an approved proposal created a version");
  assert.equal(validateBusinessSettingProposal({ ...PROPOSAL, state: "approved", decidedBy: "x", decidedAt: "2026-10-04T11:00:00Z", applied: false }), null);
  assert.equal(validateBusinessSettingProposal({ ...PROPOSAL, value: "fifty" }), null);
  assert.equal(validateBusinessSettingProposal({ ...PROPOSAL, extra: 1 }), null);
  assert.equal(validateBusinessSettingsAdmin({ ...ADMIN, pending: [{ ...PROPOSAL, state: "rejected", decidedBy: "x" }] }), null, "a decided proposal is not in the pending list");
  assert.equal(validateBusinessSettingsAdmin({ ...ADMIN, settings: [{ ...SETTING, decimals: 3 }] }), null, "precision is 0 or 2");
  assert.equal(validateBusinessSettingsAdmin({ ...ADMIN, settings: [{ ...SETTING, scheduled: [{ ...VERSION, value: "x" }] }] }), null);
  assert.equal(validateBusinessSettingsAdmin({ ...ADMIN, settings: [{ ...SETTING, next: null }] }), null, "unknown field");
});

test("the status and code tables are the documented ones", () => {
  assert.ok(SPRING_BUSINESS_SETTINGS.errors[403].includes("role_not_permitted") && !SPRING_BUSINESS_SETTINGS.errors[403].includes("segregation_refused"));
  assert.deepEqual(SPRING_BUSINESS_SETTING_PROPOSAL.successStatuses, [201]);
  assert.deepEqual(SPRING_BUSINESS_SETTING_DECISION.successStatuses, [200]);
  assert.deepEqual(SPRING_BUSINESS_SETTING_DECISION.errors[409], ["proposal_not_pending", "effective_date_passed", "rule_conflict", "idempotency_key_conflict", "idempotency_in_progress"]);
  assert.ok(SPRING_BUSINESS_SETTING_DECISION.errors[403].includes("segregation_refused"));
});
