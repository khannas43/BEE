# Current Cursor task

**Holder:** claude (post Brief C1B handback), 18 October 2026.

- Brief: **C1B** — close full database gate after WP3 live acceptance
- Branch: `cursor/demo-wp3-onboarding-final` (commit after C1B correction)
- Worktree: `/Users/sameerkhanna/Developer/BEE-demo-rehearsal`
- Rollback: `cursor/demo-wp3-wp9-rehearsal` @ `098b05c`
- Ngrok: `https://nicola-habited-barb.ngrok-free.dev` (left running)
- Stack: `BEE_DEMO_LOGIN=1`, `BEE_MFA_REQUIRED=false`, web **3100**, API **8090**, Flyway **76** on `app`

## C1B outcome (Cursor)

**Done**

- **V76** `V76__snl_wp03_security_definer_search_path.sql` — pins eleven WP3 SECURITY DEFINER functions to `<schema>, pg_catalog, pg_temp` (`pg_temp` last); no grant changes.
- Migration-rank assertions **75 → 76** (“V1 through V76”) in full-schema database tests; V71/V72 historical proofs unchanged.
- **Seed backward compatibility:** `local/generate-fixtures.cjs` + regenerated `local/seed/seed.sql` — base organisation upsert without `permittee_lifecycle`; conditional dynamic UPDATE when column exists (`v71ReturnsBackfillIntoMigratedCycle` green).
- **Expectations:** `RegistrationDatabaseTest` (3 REG rules incl. `manufacturer_onboarding`); `FeeRuleDatabaseTest` (`manufacturer_onboarding` fee type, Finance `manufacturer_onboarding_anomaly` capability, wording fixes).
- **WP3 proofs:** V76 installed, search_path order test, seven runtime EXECUTE commands, observation-close revoke, upload trusted-boundary test.
- **Database gate:** `mvn test -Dgroups=db -Dbee.test.excludedGroups=none` — **590 run, 0 failures, 0 errors**.
- **Presentation:** API jar rebuilt/restarted; `ensure-runtime-role.sh`; Flyway **76** confirmed; C1 **25/25**; `demo:wp3-wp9-check` **21/21**; ngrok eight routes green.

**Gates (18 Oct 2026)**

| Gate | Result |
| --- | --- |
| Default `mvn test` | **161/161** with `BEE_MFA_REQUIRED=true` (required because presentation sets `BEE_MFA_REQUIRED=false`) |
| Full db suite | **590/590** |
| `SpringContractTest` | **38/38** (with `BEE_MFA_REQUIRED=true`) |
| `npx tsc --noEmit` | pass |
| ESLint (changed JS) | pass (`generate-fixtures.cjs`; Java test files ignored by eslint config) |
| `npm run web:test` | **264/264** |
| `npm run web:test:ui` | **239/239** |
| `npm run build` | pass |
| OpenAPI pin | pass (`contract-artifact.test.mjs`) |
| `npm run demo:seed` ×2 | pass (idempotent) |
| `npm run demo:wp3-wp9-check` | **21/21** |
| `git diff --check 098b05c..HEAD` | clean (after commit) |

**Still open**

- BL-261–264 unchanged.
- Broad WP3 checklist items (category deposit, MCA adapters, etc.) remain open in the implementation plan.

## Evidence paths

- Journey script: `scripts/demo/c1-manufacturer-onboarding-journey.cjs`
- Live evidence: `.local/run/c1-journey-evidence.json`
- Migration: `backend/src/main/resources/db/migration/V76__snl_wp03_security_definer_search_path.sql`
