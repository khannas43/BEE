# WP04 package review (14 October 2026)

**Result: accepted as a local work package, with corrections made.** Accepted work packages are now 2 of 11 (WP01 and WP04). Provisional local rules, not BEE rules: WP04 is accepted as local work against the owner's defaults; BEE's own rules for registration documents, fees and approval are still to be decided (BEE_DECISIONS).

## Method

An independent reviewer (a separate agent that had not built the package) read the package against its exit criterion in [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) Section 14 and its three sub-packages, covering evidence, traceability, validation, document consistency and the open backlog. It ran nothing. It recommended **accept with listed corrections**.

## Findings and what was done

| # | Finding | Done |
| --- | --- | --- |
| 1 | WP04.3 had no evidence | [WP04.3_AUDIT_VALIDATION.md](WP04.3_AUDIT_VALIDATION.md) and `Wp04AuditValidationDatabaseTest` |
| 2 | Revocation records were mutable, with no from/to status and no revoker; cascades had no rows | `register_status_event` (V47), append-only, one row per change and per cascaded authorisation; readable through the API |
| 3 | Name reuse after a revocation was probably broken | confirmed by the new test, which found a second cause; fixed in V47 and V48 |
| 4 | BL-177: approval did not re-check an agency period | fixed in V47; tested |
| 5 | Stale documents (R1 and N2 in the acceptance map, the plan's snapshot, the evidence notes' test counts and status lines, BL-054) | corrected; the acceptance map is regenerated from `lib/acceptanceMap.ts` |

Not blocking, recorded in docs/BACKLOG.md: BL-189 (master closure actor as text), BL-190 (organisation registration), BL-188, BL-186, BL-175, BL-176, BL-178, BL-179, BL-182 to BL-185, BL-187, and the BEE-dependent rules BL-041, BL-161, BL-174.

## Evidence

- Database tests: `Wp04AuditValidationDatabaseTest` 3/3, `RegistrationDatabaseTest` 13/13, `RegistrationReviewDatabaseTest` 6/6, `RevocationDatabaseTest` 4/4, `BrandAuthDatabaseTest` 6/6, `MastersDatabaseTest` 12/12; `SpringContractTest` 35/0; web unit tests 236/0.
- Live checks: `local:registrations` 178/0, `local:registration-review` 122/0, `local:register-revocation` 100/0.
- The full `local:check` on the final tree is recorded below.
