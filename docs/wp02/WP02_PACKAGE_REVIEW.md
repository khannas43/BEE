# WP02 package review (14 October 2026)

**Result: accepted as a local work package, with corrections made.** Accepted work packages are now 3 of 11 (WP01, WP02 and WP04). Provisional local rules, not BEE rules: WP02 is accepted as local work against the owner's defaults. Escalation (R12) is not built and waits for BEE's time limits per stage (B14); recovery codes, step-up and remembered devices are out of scope for the local package.

## Method

An independent reviewer (a separate agent that had not built the package) read the package against its exit criterion in [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) Section 14 ("direct URL/API denial, cross-organization isolation and approval segregation checked locally") and its sub-packages WP02.1 to WP02.4: evidence, direct denial, cross-organisation isolation, segregation, session and MFA limits, backlog and decisions. It ran nothing. It recommended **accept with listed corrections** and found no engineering defect that blocks local acceptance.

## What it found sound

Default-deny (`anyRequest().denyAll()`) with a role, scope and stage check behind every authenticated route; roles effective only when both the database and the token hold them; read scope applied in SQL and re-checked in Java; unknown, out-of-scope and malformed ids all answer 404; maker-checker and stage segregation in every service, including through delegation, idempotent replay and role loss; httpOnly session cookies, PKCE, single-flight rotating refresh, MFA enforced in the portal and in Spring; brute-force detection proved on a disposable account.

## Corrections and what was done

| # | Correction | Done |
| --- | --- | --- |
| 1 | Acceptance map text and routes stale ("not started / stays denied", planned route names) | step rows now say what is built and its route; planned names kept only where `FIRST_SLICE.md` defines them; R1 restated as outside the first slice (built later as WP04.2b); the generated status line no longer says no transition exists |
| 2 | `WP02.2_POLICY.md` P7, P8 and §4 said writes stay denied | marked historical, with the built routes and the pointer to the live evidence |
| 3 | `WP02.3_MFA.md` §7, §8 and §10 said delegation and several denial cases were pending | marked historical or updated; §9's counts marked as 1 October's |
| 4 | The plan's snapshot, progress paragraph and sub-package table; BL-053 | updated (WP02.4 row, 3/11, review paragraph); BL-053 restated |
| 5 | "Complete" denial evidence overstated (the matrix covered only the model-application commands; N6/N7 in-order only unit-proved) | restated in `WP02.4_DENIAL_EVIDENCE.md`; a second matrix added to `denial-suite-check.cjs`: all 15 personas by the fee-rule, rating-scheme, business-setting, fee-correction, registration and register-revocation routes (201 further denied calls, controls that the entitled personas reach every read route, nothing created) |
| 6 | `auth-check` 31 versus 34 | reconciled in `WP02.3_MFA.md` §9 |

Not blocking, recorded in docs/BACKLOG.md: BL-200 (Origin check on BFF writes), BL-201 (live cross-organisation history probe), BL-202 (concurrency test of the segregation check), BL-203 (certificate-revocation wording), BL-204 (stale generated screen matrix), BL-192, BL-195, BL-198, and the BEE-dependent items (B14 escalation, D1, D2).

## Evidence

- `denial-suite-check` 33/33 (601 + 201 denied calls, N8 live, A7); `bruteforce-check` 8/8; `local:mfa` 31/0; `auth-check` 31/0; `local:delegation` 106/0; `SlicePolicyTest` 36; `SpringContractTest` 36/0.
- The full `local:check` on the final tree is recorded below.
