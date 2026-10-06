// The notification answers: the BFF validators. No Spring or Keycloak. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNotificationList, validateNotificationRead, validateNotificationReadAll } from "../../lib/server/contracts/notifications.ts";

const ITEM = {
  id: "3d6f0a8e-0000-4000-a000-0000000000b1", kind: "returned", message: "LOCAL-MA-0002 (Nova Cool NC-1) was returned to you: Wrong report. Edit it and send it again.",
  applicationId: "3d6f0a8e-0000-4000-a000-000000000001", reference: "LOCAL-MA-0002", createdAt: "2026-10-06T10:00:00Z", read: false,
};

test("a list holds the four kinds with exactly the shown fields", () => {
  assert.ok(validateNotificationList({ unread: 0, items: [] }));
  for (const kind of ["returned", "rejected", "fee_due", "approved"]) assert.ok(validateNotificationList({ unread: 1, items: [{ ...ITEM, kind }] }), kind);
  assert.ok(validateNotificationList({ unread: 3, items: [ITEM, { ...ITEM, read: true }] }), "the unread count may exceed the items shown (only the latest 50 are listed)");
});

test("anything else is refused", () => {
  const bad = (over) => validateNotificationList({ unread: 1, items: [{ ...ITEM, ...over }] });
  assert.equal(bad({ kind: "approved_by_secretary" }), null);
  assert.equal(bad({ createdAt: "yesterday" }), null);
  assert.equal(bad({ read: "no" }), null);
  assert.equal(bad({ message: "" }), null);
  assert.equal(bad({ recipient: "someone" }), null, "no extra field");
  assert.equal(validateNotificationList({ unread: 0, items: [ITEM] }), null, "an unread item with an unread count of zero cannot be");
  assert.equal(validateNotificationList({ unread: -1, items: [] }), null);
  assert.equal(validateNotificationList({ unread: 51, items: Array.from({ length: 51 }, () => ITEM) }), null, "never more than 50");
  assert.equal(validateNotificationList({ unread: 0, items: [], extra: 1 }), null);
});

test("the two read receipts", () => {
  assert.ok(validateNotificationRead({ id: ITEM.id, unread: 2 }));
  assert.equal(validateNotificationRead({ id: "x", unread: 2 }), null);
  assert.equal(validateNotificationRead({ id: ITEM.id, unread: 2, more: 1 }), null);
  assert.ok(validateNotificationReadAll({ marked: 3, unread: 0 }));
  assert.equal(validateNotificationReadAll({ marked: -1, unread: 0 }), null);
  assert.equal(validateNotificationReadAll({ marked: 1.5, unread: 0 }), null);
});
