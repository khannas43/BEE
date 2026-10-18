# Current Cursor task

**Holder:** claude (post Brief C1 handback), 18 October 2026.

- Brief: **C1** — final WP3 integration, live browser journey, ngrok readiness
- Branch: `cursor/demo-wp3-onboarding-final` @ `ce3b46a` + C1 fix commits (Cursor)
- Worktree: `/Users/sameerkhanna/Developer/BEE-demo-rehearsal`
- Rollback: `cursor/demo-wp3-wp9-rehearsal` @ `098b05c`
- Ngrok: `https://nicola-habited-barb.ngrok-free.dev` (unchanged)
- Stack: left running with `BEE_DEMO_LOGIN=1`, `BEE_MFA_REQUIRED=false`, web 3100, API 8090

## C1 outcome (Cursor)

**Done**

- Merge `aeafc7c` into demo final → `ce3b46a` (normal merge; V69–V75 untouched).
- Runtime prep: `local:up`, `local:reset` + `ensure-runtime-role`, `login-setup apply`, `demo:seed` ×2 (idempotent), `demo:ngrok`.
- **Blocker fixed:** `scripts/local/ensure-runtime-role.sh` now re-applies V75 manufacturer-onboarding orchestrator `EXECUTE` grants after the blanket revoke (without this, `POST /api/manufacturer-onboarding` returned 503 `BadSqlGrammarException` / permission denied).
- Ngrok routes verified (200): `/`, `/login`, `/register/manufacturer`, onboarding/director/monitoring, `/app/demo/manufacturer-360`, `/verify` — no redirects to localhost/8180.
- `npm run demo:wp3-wp9-check`: **21/21 pass**, 0 skipped.
- `npx tsc --noEmit`: pass.
- `npm run web:test`: **264/264** pass.
- `SnlWp03OptimizedManufacturerOnboardingDatabaseTest`: pass (isolated schema).
- BL-264 recorded (idempotency retry / PayloadKeyGate deferred). BL-261–263 remain open.

**Not done / deferred to Claude**

- Full live browser journey (§5–7): `scripts/demo/c1-manufacturer-onboarding-journey.cjs` runs sign-in and seeds draft + document uploads via BFF; **wizard Submit did not reach lifecycle** in automation (director queue empty). Needs manual or script fix (client validation / reload after upload), then Director / Finance / anomaly paths.
- Remaining §10 gates: full `mvn test`, full `db` suite, `SpringContractTest`, `web:test:ui`, `npm run build`, OpenAPI checksum, `git diff --check` from `098b05c`, optional `local:check`.
- WP3 **not** marked complete in SNL plan until real applicant → submit → director → observation → anomaly journey passes in UI.
- No push / no merge to `main`.

## Evidence paths

- Pre-integration snapshot: `.local/run/c1-prestore.txt`
- Journey script (WIP): `scripts/demo/c1-manufacturer-onboarding-journey.cjs`
- Expected evidence file when green: `.local/run/c1-journey-evidence.json`
