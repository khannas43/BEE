// Ends every Keycloak session of the 16 sample users. Run it before the full gate (the gate asserts those sessions are not disturbed).
// Usage: node scripts/demo/end-sessions.cjs
const totp = require("../local/totp.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");
(async () => {
  let n = 0;
  for (const u of USERS) {
    const found = await totp.admin(`/users?username=${encodeURIComponent(u.username)}&exact=true`);
    const list = Array.isArray(found) ? found : [];
    for (const x of list) {
      const s = await totp.admin(`/users/${x.id}/sessions`);
      n += Array.isArray(s) ? s.length : 0;
      await totp.admin(`/users/${x.id}/logout`, { method: "POST" });
    }
  }
  console.log("sessions ended:", n);
})().catch((e) => { console.error(e.message); process.exit(1); });
