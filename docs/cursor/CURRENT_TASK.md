# Current Cursor task

**Holder:** claude (post Brief C1A handback), 18 October 2026.

- Brief: **C1A** — fix MOB document upload + complete live acceptance journey
- Branch: `cursor/demo-wp3-onboarding-final` (commit after C1A correction)
- Worktree: `/Users/sameerkhanna/Developer/BEE-demo-rehearsal`
- Rollback: `cursor/demo-wp3-wp9-rehearsal` @ `098b05c`
- Ngrok: `https://nicola-habited-barb.ngrok-free.dev` (left running)
- Stack: `BEE_DEMO_LOGIN=1`, `BEE_MFA_REQUIRED=false`, web **3100**, API **8090**

## C1A outcome (Cursor)

**Done**

- Upload fix: `ManufacturerOnboardingDocumentRepository.readStateForUpload` (ordinary SELECT); trusted append unchanged; `runtimeDocumentUploadViaTrustedAppendWithoutDirectTableUpdate` proof test.
- Journey: `scripts/demo/c1-manufacturer-onboarding-journey.cjs` — strict BFF fetch, eight PDFs, `paid` / `fee.amountInr` / receipt, reject + revoke (anomaly→hold→revoke) + primary approve→anomaly→resolve; React field setter for textareas; **25/25 pass**.
- Evidence: `.local/run/c1-journey-evidence.json` (not committed).
- Gates: default `mvn test`, `SpringContractTest`, `SnlWp03OptimizedManufacturerOnboardingDatabaseTest`, `npx tsc --noEmit`, `npm run web:test` (264), `web:test:ui` (239), `npm run build`, OpenAPI pin, `demo:wp3-wp9-check` (21/21), `git diff --check 098b05c..HEAD`.

**Not done / notes**

- Full `mvn test -Dgroups=db -Dbee.test.excludedGroups=none`: **589 run, 4 failures + 2 errors** in unrelated classes (RegistrationDatabaseTest, MessagesDatabaseTest, FeeRuleDatabaseTest, SnlWp02bModelForward*); not caused by C1A diff — Claude to triage on merge.
- BL-261–263 remain open; BL-264 unchanged (deferred).
- WP3 **optimized onboarding slice** marked accepted in SNL plan; broad WP3 checklist (category, deposit, MCA adapters) still open.

## Evidence paths

- Journey script: `scripts/demo/c1-manufacturer-onboarding-journey.cjs`
- Live evidence: `.local/run/c1-journey-evidence.json`
