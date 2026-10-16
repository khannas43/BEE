# Demo-day checklist (draft)

## Before (T-60 min)
1. Stop anything else on ports 8090 / 3100 / 8180.
2. `export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false`
3. `npm run local:down && npm run local:up`
4. `node scripts/demo/login-setup.cjs apply`
5. `npm run demo:seed`
6. Open /login: chips visible, "Password for every demo account: demo123".
7. Sign in as each role used in the script; confirm landing pages.
8. Wi-Fi off once: confirm fonts and icons still render.
9. Browser: zoom 100%, notifications off, one window.

## If something breaks live
- Blank/502 screen: reload once; if the ledger screen fails run `scripts/local/ensure-runtime-role.sh`.
- Sign-in fails: check /api/runtime/demo/login returns {"enabled":true}; else env vars were not exported before local:up.
- Data looks wrong: `npm run demo:seed` is safe to re-run.

## After the demo
1. `node scripts/demo/login-setup.cjs undo`
2. Clear Keycloak sessions of seeded users.
3. `npm run local:reset` (removes demo data).
4. Unset BEE_DEMO_LOGIN / BEE_MFA_REQUIRED, restart, run `npm run local:check`.
