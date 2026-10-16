// The simulated email and SMS answers: the BFF validators. No Spring or Keycloak. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMessageList, validateMessageRead, validateMessageReadAll } from "../../lib/server/contracts/messages.ts";

const EMAIL = {
  id: "3d6f0a8e-0000-4000-a000-0000000000d1", channel: "email", address: "bee.finance@bee-demo.invalid", kind: "payment_to_confirm", reference: "DEMO-PAY-0001",
  subject: "Payment to confirm: DEMO-PAY-0001", body: "INR 11800.00 was received at the simulated gateway. Simulated message: nothing was sent.", createdAt: "2026-10-16T10:00:00Z", read: false,
};
const SMS = { ...EMAIL, id: "3d6f0a8e-0000-4000-a000-0000000000d2", channel: "sms", address: "+91 9XXXXX0001 (synthetic)", subject: null, body: "BEE demo: payment received." };

test("a list holds emails with a subject and SMS without one, with exactly the shown fields", () => {
  assert.ok(validateMessageList({ unread: 0, items: [] }));
  assert.ok(validateMessageList({ unread: 2, items: [EMAIL, SMS] }));
  assert.ok(validateMessageList({ unread: 1, items: [{ ...EMAIL, reference: null }] }), "a message need not name a record");
  assert.ok(validateMessageList({ unread: 3, items: [EMAIL, { ...SMS, read: true }] }), "the unread count may exceed the items shown (only the latest 50 are listed)");
});

test("anything else is refused", () => {
  const bad = (over) => validateMessageList({ unread: 1, items: [{ ...EMAIL, ...over }] });
  assert.equal(bad({ channel: "fax" }), null);
  assert.equal(bad({ subject: null }), null, "an email needs a subject");
  assert.equal(bad({ channel: "sms" }), null, "an SMS has no subject");
  assert.equal(bad({ kind: "Payment Paid" }), null);
  assert.equal(bad({ createdAt: "yesterday" }), null);
  assert.equal(bad({ read: "no" }), null);
  assert.equal(bad({ body: "" }), null);
  assert.equal(bad({ body: "x".repeat(1001) }), null);
  assert.equal(bad({ id: "x" }), null);
  assert.equal(bad({ recipient: "someone" }), null, "no extra field");
  assert.equal(validateMessageList({ unread: 0, items: [EMAIL] }), null, "an unread item with an unread count of zero cannot be");
  assert.equal(validateMessageList({ unread: -1, items: [] }), null);
  assert.equal(validateMessageList({ unread: 51, items: Array.from({ length: 51 }, () => EMAIL) }), null, "never more than 50");
  assert.equal(validateMessageList({ unread: 0, items: [], note: "n" }), null);
});

test("the two read receipts", () => {
  assert.ok(validateMessageRead({ id: EMAIL.id, unread: 2 }));
  assert.equal(validateMessageRead({ id: "x", unread: 2 }), null);
  assert.equal(validateMessageRead({ id: EMAIL.id, unread: 2, more: 1 }), null);
  assert.ok(validateMessageReadAll({ marked: 3, unread: 0 }));
  assert.equal(validateMessageReadAll({ marked: -1, unread: 0 }), null);
  assert.equal(validateMessageReadAll({ marked: 1.5, unread: 0 }), null);
});
