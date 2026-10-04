// The history read: the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the read itself is proven by SpringContractTest, ReworkDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_ACTION_LABELS, historyPath, readModelHistory } from "../../lib/client/runtimeModelHistory.ts";
import { HISTORY_ACTIONS, SPRING_HISTORY, validateApplicationHistory } from "../../lib/server/contracts/history.ts";

const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const step = (n, action, from, to, extra = {}) => ({
  sequence: n, at: "2026-10-04T10:00:00Z", action, fromState: from, toState: to, actorRole: "finance", actorOrganisation: "BEE", facts: [], withheld: false, ...extra,
});
const OFFICER = {
  applicationId: ID, reference: "LOCAL-MA-0100", viewedAs: "officer", count: 3,
  items: [
    step(1, "submit", "draft", "fee_due", { actorRole: "manufacturer", actorName: "Nova Applicant", actorOrganisation: "NOVA" }),
    step(2, "confirm_fee", "fee_due", "iame_scrutiny", { actorName: "BEE Finance", facts: [{ label: "Receipt reference", value: "UTR-1" }] }),
    step(3, "iame_recommend", "iame_scrutiny", "bee_scrutiny", { actorRole: "iame", actorName: "IAME Officer", actorOrganisation: "IAME", note: "Report matches." }),
  ],
};
const APPLICANT = {
  ...OFFICER, viewedAs: "applicant",
  items: [
    step(1, "submit", "draft", "fee_due", { actorRole: "manufacturer", actorOrganisation: "NOVA" }),
    step(2, "confirm_fee", "fee_due", "iame_scrutiny", { facts: [{ label: "Receipt reference", value: "UTR-1" }] }),
    step(3, "iame_recommend", "iame_scrutiny", "bee_scrutiny", { actorRole: "iame", actorOrganisation: "IAME", withheld: true }),
  ],
};

test("the client reads the history of one application with the cookie, from the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, OFFICER);
  };
  try {
    const r = await readModelHistory(ID);
    assert.equal(r.ok, true);
    assert.equal(r.history.count, 3);
    assert.equal(seen.p, historyPath(ID));
    assert.equal(seen.init.method, "GET");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.cache, "no-store");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each documented refusal is a typed read failure, and a lost response is 'unavailable'", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const [status, error, kind] of [[401, "no_session", "session"], [403, "no_read_scope", "forbidden"], [404, "not_found", "not_found"], [503, "service_unavailable", "unavailable"]]) {
      globalThis.fetch = async () => json(status, { error, message: "x" });
      const r = await readModelHistory(ID);
      assert.deepEqual([r.ok, r.failure.kind], [false, kind], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await readModelHistory(ID)).failure.kind, "unavailable");
    globalThis.fetch = async () => json(200, { nope: true });
    assert.equal((await readModelHistory(ID)).ok, false, "a body that is not a history is refused");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("every step Spring can record has plain words, and the validator knows exactly the same set", () => {
  assert.deepEqual(Object.keys(HISTORY_ACTION_LABELS).sort(), [...HISTORY_ACTIONS].sort());
  for (const label of Object.values(HISTORY_ACTION_LABELS)) assert.ok(label.length > 5);
});

test("the BFF accepts both views and refuses anything inconsistent", () => {
  assert.deepEqual(validateApplicationHistory(OFFICER), OFFICER);
  assert.deepEqual(validateApplicationHistory(APPLICANT), APPLICANT);
  assert.equal(validateApplicationHistory({ ...OFFICER, secret: "x" }), null, "an extra field is refused");
  assert.equal(validateApplicationHistory({ ...OFFICER, count: 2 }), null, "count must match the items");
  assert.equal(validateApplicationHistory({ ...OFFICER, viewedAs: "auditor" }), null);
  assert.equal(validateApplicationHistory({ ...OFFICER, items: [OFFICER.items[1], OFFICER.items[0], OFFICER.items[2]] }), null, "sequence must run 1, 2, 3 in order");
  assert.equal(validateApplicationHistory({ ...OFFICER, items: [OFFICER.items[0], { ...OFFICER.items[1], sequence: 3 }, OFFICER.items[2]] }), null, "no gaps");
  // The applicant's privacy rules are enforced by the validator, not only by Spring.
  assert.equal(validateApplicationHistory({ ...APPLICANT, items: [{ ...APPLICANT.items[0], actorName: "Nova Applicant" }, ...APPLICANT.items.slice(1)] }), null, "the applicant never gets a personal name");
  assert.equal(validateApplicationHistory({ ...APPLICANT, items: [...APPLICANT.items.slice(0, 2), { ...APPLICANT.items[2], note: "Report matches." }] }), null, "a withheld step carries no note");
  assert.equal(validateApplicationHistory({ ...APPLICANT, items: [...APPLICANT.items.slice(0, 2), { ...APPLICANT.items[2], facts: [{ label: "a", value: "b" }] }] }), null, "and no facts");
  for (const bad of [{ action: "approve" }, { fromState: "nowhere" }, { toState: "" }, { at: "yesterday" }, { sequence: 0 }, { facts: [{ label: "x" }] }, { withheld: "no" }, { actorOrganisation: 5 }]) {
    assert.equal(validateApplicationHistory({ ...OFFICER, items: [{ ...OFFICER.items[0], ...bad }, ...OFFICER.items.slice(1)] }), null, JSON.stringify(bad));
  }
  assert.equal(validateApplicationHistory({ ...OFFICER, applicationId: "nope" }), null);
  assert.ok(validateApplicationHistory({ ...OFFICER, items: [], count: 0 }), "an empty history is valid");
  for (const code of ["no_read_scope", "not_found", "service_unavailable"]) {
    assert.ok(Object.values(SPRING_HISTORY.errors).flat().includes(code), code);
  }
});
