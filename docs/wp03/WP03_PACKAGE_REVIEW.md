# WP03 package review (14 October 2026)

**Result: accepted as a local work package, with corrections made.** Accepted work packages are now 4 of 11 (WP01, WP02, WP03 and WP04). Provisional local rules, not BEE rules: WP03 is a local contract, web-to-API path and test mechanism; it contains no BEE decision. Gateway, log shipping and central retention are WP14 and out of scope.

## Method

An independent reviewer (a separate agent that had not built the package) read the package against its exit criterion in [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) Section 14 ("browser and API use the same persisted record and return consistent errors; local start, health, seed and targeted reset proof (RT1)") and its sub-packages WP03.1 to WP03.3: route sets, error tables, response validators, correlation and the request log, the contract tests and their coverage credit, the runtime proof, and the backlog. It recommended **accept with listed corrections** and found the mechanism sound.

## What it verified

All 58 Spring method and path pairs in `SecurityConfig` equal the artifact's internal operations (nothing extra either way); every artifact browser operation has a route handler, and unsupported methods and unmatched paths answer in the contract body. The 58 error codes are identical across `ApiErrors.java` (messages byte-equal to the artifact), `apiContract.ts` and the artifact. Of 54 browser error tables, 51 equal an operation's documented codes exactly. Response validators use `exactKeys` and match the schemas on the spot-checked set. The correlation ID is set on every Spring and portal response and no token, path or query reaches the log (route templates are closed enums). The MockMvc evidence asserts status, header, no-store, schema and the fixed message before a pair is recorded, and the `@AfterAll` fails on any unexercised or undocumented pair, so the hard-coded coverage map cannot credit a pair wrongly.

## Corrections and what was done

| # | Correction | Done |
| --- | --- | --- |
| 1 | Stale text in the artifact (default-deny wording naming history, the unmatched-route example that now exists, the denied-by-default description, the description line, the version policy, the correlation header text) | rewritten; contract **0.32.1**, then **0.32.2**, re-pinned |
| 2 | WP03.1, WP03.2 and WP03.3 notes and two plan lines said writes, history, idempotency and screens do not exist | each note carries a "historical, written 1 October" banner pointing to the artifact and this review; the plan lines are dated |
| 3 | RT1 evidence was of 30 September (35 checks, Flyway V2, one route, memory idle) | addendum to `RT1_PROOF.md` with the current memory measurements (total 1747 MB of a 3600 MB budget; web 597 MB of 1500 MB) and the statement that the destructive rebuild was not repeated (BL-205) |
| 4 | Acceptance checks A8 and A9 still "not started" | progress text in the acceptance map says what evidences each and what does not (BL-204, BL-205) |
| 5 | An exception escaping a portal handler produced Next's bare 500 without the correlation ID or the contract body | `logged` now turns an exception escaping a data handler under `/api/runtime` into `502 api_error` (a code those operations already document) with the header, no-store and the log line (no exception text); the health probe and the auth routes keep Next's own error, as they document no 502; a unit test proves both. The second review made this narrower; the contract is 0.32.2 |

Not blocking, recorded in docs/BACKLOG.md: BL-167 (no contract-only check), BL-206 (a generic static validator-versus-artifact test), BL-207 (three over-allowed error tables), BL-208 (key check before session; correlation route label), BL-200 (Origin check on BFF writes), BL-079 to BL-081 (hard-coded coverage maps).

## Evidence

- `web:test` 240/0 (including the new escaped-exception test, which also proves the health probe and the auth routes keep Next's own error); `SpringContractTest` 36/0 on the 0.32.2 artifact.
- A second, focused independent review of the corrections found no high defect; its fixes are in (the 502 answer limited to the operations that document it, the RT1 and A9 claims softened, the empty budget cells), and the version-history sentence was checked against the pin history.
- The full `local:check` on the final tree: **2175 passed, 0 failed** (migrations V1 to V50, contract 0.32.2).
