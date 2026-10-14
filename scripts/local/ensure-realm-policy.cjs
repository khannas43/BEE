/* eslint-disable */
/**
 * Idempotent: applies the realm settings that the Keycloak import cannot change on an existing realm (the import only runs for a realm that does
 * not exist yet). Today that is brute-force detection (WP02.4). Values come from local/generate-fixtures.cjs, the same list the import file is
 * generated from, so the two cannot drift. Run by `npm run local:up`.
 */
const totp = require("./totp.cjs");
const { BRUTE_FORCE } = require("../../local/generate-fixtures.cjs");

(async () => {
  const realm = await totp.admin("");
  const differs = Object.entries(BRUTE_FORCE).filter(([k, v]) => realm[k] !== v);
  if (differs.length === 0) {
    console.log("realm policy: brute-force detection already applied");
    return;
  }
  const token = await totp.adminToken();
  const KC = `http://127.0.0.1:${process.env.BEE_KC_PORT || "8180"}`;
  const r = await fetch(`${KC}/admin/realms/${process.env.BEE_REALM || "bee-local"}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...realm, ...BRUTE_FORCE }),
  });
  if (!r.ok) throw new Error(`realm policy update failed: HTTP ${r.status} ${await r.text()}`);
  console.log(`realm policy: brute-force detection applied (${differs.map(([k]) => k).join(", ")})`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
