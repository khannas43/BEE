# WP05 package review (14 October 2026)

**Result: accepted as a local work package, for the scope below, with corrections made.** Accepted work packages are now 5 of 11 (WP01, WP02, WP03, WP04 and WP05). Provisional local rules, not BEE rules: WP05 is accepted as local work against the owner's defaults for decisions B1 to B8 and B10; the questions that need BEE stay open in the backlog.

## Scope accepted

WP05 in the plan is "model/family application, evidence, rating, review, approval and label". The package was built in pieces owned by several packages, and this review accepts it as follows:

| Part | Where it lives | Accepted here |
| --- | --- | --- |
| WP05.1 intake: read UI, drafts, submit with the fee snapshot, evidence gates, returned applications edited and resubmitted | `docs/wp05/*`, V3, V7 to V9, V24, `application/*`, the lifecycle screens | yes |
| WP05.2 rating, review, approval and the configurable stage workflow | built as WP07.1b to WP07.1k and WP08.1c; evidence in `docs/wp07` and `docs/wp08` | the state and journey (one model identity through every stage, recorded, auditable); **the "reproducible formula" half of the exit criterion is met only conditionally: the rating formula is the owner's placeholder (BL-104)**, so acceptance rests on this:  the scheme version and its inputs are stored with every rating, not that BEE's formula is implemented |
| WP05.3 label, renewal and regression | label and certificate built as WP09.1a to d; **renewal is not built** | label yes; renewal no |
| Families and configurations, the 180-day draft purge (R13), other required documents (B6) | not built | no (deferred, BL-068 and related) |

## Method

An independent reviewer (a separate agent that had not built the package) read the package against its exit criterion in [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) Section 14 ("one model ID and reproducible formula/state across the journey") and its sub-packages: intake validation (R4), fee snapshot and state integrity, the applicant screens, stale text, and the backlog. It ran nothing. It recommended **accept with listed corrections** (rows 1 to 3, 5 and 6 and the guard in row 4 came from that review; a second focused review read the corrections afterwards and its findings are fixed in this text).

## Corrections and what was done

| # | Correction | Done |
| --- | --- | --- |
| 1 | Scope: the plan said "rating, approval and label" while the notes stop at WP05.1d | the scope table above; the plan paragraph names WP07.1 and WP09 as the owners |
| 2 | The submit preview's intake note still said evidence and accreditation "remain deferred", beside the six gates the applicant sees | replaced with a text that describes the provisional rules actually applied |
| 3 | The accreditation and standard versions were recorded only at the first submit, so an edited resubmission left them stale | a resubmission records the versions it resolved, in the same transaction as the state change; a database test proves it |
| 4 | The runtime login could write any state and change the brand, model number or category after submission; nothing in the database stopped it (BL-165 covered registrations only) | Flyway **V51**: a trigger limits the runtime login to the moves the stage services make and locks the identity of a submitted application (the owner and the maintenance login are not restricted; the fee reversal, a SECURITY DEFINER function, is exempt by that rule; inserts and deletes are not guarded); `ModelApplicationGuardDatabaseTest` |
| 5 | The intake form had no `role="alert"` on errors, showed a gate as met or unmet by icon and colour only, and the efficiency message hard-coded 99.99 (a business setting); the test-date label omitted the age limit | errors are alerts, each gate carries "Met:" or "Not met:" text for screen readers, the efficiency message no longer states the figure (the server error still names the limit), the label names the age limit. Field-level `aria-describedby` for date and efficiency errors stays in BL-052 and BL-072 |
| 6 | Stale sentences: the WP05.1, 1b, 1c and 1d notes (denied writes, 1/11, "evidence only in draft", "no maximum age", documents after a return), the acceptance map rows R3, R4 and A1, BL-053, the plan lines naming the WP05 review as open | historical banners and corrected sentences; the acceptance map restated; BL-053 restated; the plan updated |

Not blocking, recorded in docs/BACKLOG.md: BL-209 (the guard binds the runtime login only; evidence columns after submit are not locked), BL-052 and BL-072 (field-level accessibility on the intake form), BL-181 (legacy rows without a brand), BL-068 to BL-076 (family, duplicate warnings, laboratory list by date, legacy duplicates, `standard_not_available` live check), BL-104 and the BEE-dependent defaults (B1 to B8, B10, accreditation lists, official fees, the rating formula).

## Evidence

- `ModelApplicationGuardDatabaseTest` 2/2, `ReworkDatabaseTest` 29/29 (with the new test), the evidence, draft and submit database suites; `web:test:ui` 143/0.
- Full `local:check` (migrations V1 to V51, contract 0.32.2): **2173 passed, 2 failed**. Both failures were the live submit check still expecting the old efficiency message ("up to 99.99"), which this review removed from the screen; the check was corrected and `local:model-submit` was re-run alone: **104 passed, 0 failed**. The full gate was not repeated after that one-line check change.
- The V51 guard blocked no legitimate runtime path in the full gate (every stage journey passed).
