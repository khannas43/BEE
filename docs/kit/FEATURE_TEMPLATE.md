# Feature template — adding a command to the portal

**Status:** Built 3 October 2026 for one shape: a **POST command on `/api/model-applications/{id}/<segment>`** (Finance confirmation, IAME recommendation, Reviewer forward, rating, Director and Secretary decisions all fit). Reads, collection routes and other resources are not covered yet (BL-024). A development aid, not a BEE deliverable and not an acceptance record.

## Why it exists

A new route used to touch about 16 files by hand, and missing any one failed somewhere unrelated: a request denied by default, a log line saying `unmapped`, a schema failure, a coverage gap. WP06.1a changed 42 files; WP05.1d, with no new route, still changed 24. The template makes the mechanical part automatic and verifies the rest.

## The two tools

| Tool | Command | What it does |
| --- | --- | --- |
| Scaffolder | `node scripts/local/new-feature.cjs --name fee-confirmation --package finance --path "/api/model-applications/{id}/fee-confirmation" [--dry-run] [--apply]` | Creates the new files. With `--apply` it also registers the route in every registry, bumps and re-pins the contract and runs the wiring check. Refuses to overwrite anything. |
| Wiring check | `npm run local:wiring` (also a `wiring.routes` check in `local:check`) | Reads the OpenAPI artifact as the source of truth and verifies each documented route is registered everywhere it must be, naming the missing file. Also flags request-log entries the contract does not document. |

Run the scaffolder with `--dry-run` first: it lists every file it would create and every registration it would make, and writes nothing.

## What the scaffolder creates

| File | Role |
| --- | --- |
| `backend/.../<pkg>/<Name>Controller.java` | Spring endpoint: resolves the caller, parses the body, delegates |
| `backend/.../<pkg>/<Name>Service.java` | The command: replay rules, scoped lookup, state and version checks, idempotency begin and complete, the transition. **Denies every caller (`denied_by_default`) until `IMPLEMENTED` is true.** |
| `backend/.../<pkg>/<Name>Repository.java` | The guarded state change (expected state and version) with a marked place for the audit event |
| `app/api/runtime/model-applications/[id]/<segment>/route.ts` | The BFF route (POST, 405 for other methods) |
| `lib/server/contracts/<name>.ts` | The BFF's validator and allowed status and code table for this route, in its own module, so the shared `apiContract.ts` is not edited per feature |
| `lib/client/runtime<Name>.ts` | The browser client on `runtimeCommand`, with the payload signature for `useCommand` |
| `scripts/local/<name>.test.mjs` | Client unit tests, registered in `web:test` |

## What `--apply` registers

The Spring security allowlist (anything else is denied by default), the correlation-ID route map, the request-log unions and schema (three enums), the OpenAPI operations for both layers (cloned from the submit operations, so they are schema-valid by construction) with a `<Name>Request` schema, the contract version bump and pin, and the `web:test` script entry.

## What stays by hand

The scaffold cannot decide these, and the output ends with this list:

1. Implement the service: who may act (role, scope, assignment), from which state, the body and its validation, the audit event written in the same transaction, and any new error codes.
2. Keep `lib/server/contracts/<name>.ts` and the operation's `x-error-codes` equal. A new error code also goes in `ApiErrors`, `ERROR_MESSAGES`, the artifact's `Error` enum and `x-bee-error-codes`.
3. `SpringContractTest`: add `@MockitoBean <Name>Repository` (it mocks every repository), a documented-pairs test (copy the submit one), and map the route to it in `contract-coverage.cjs` `springEvidence()`.
4. Browser evidence for every documented pair: a live check (copy `model-submit-browser-check.cjs`), the stand-in table in `contract-check.cjs`, or a unit-evidence test.
5. A database test for the transition, a screen on the kit (`useCommand` and `CommandPanel`), the evidence note under `docs/`, and any deferred item in `docs/BACKLOG.md`.

Then `npm run local:wiring`, `npm run api:test`, `npm run web:test`, `npm run local:check`.

## How it was verified

- `new-feature.test.mjs` runs the scaffolder against a throwaway copy of the registries: a dry run writes nothing, bad names are refused, `--apply` creates the files, registers every registry, moves and re-pins the contract, passes the wiring check and leaves the service denied, and a second run refuses to overwrite.
- `wiring-check.test.mjs` doctors copies of each registry and shows the check names the missing file in every case (security allowlist, correlation filter, request-log union and schema, Next.js route file, `logged()` template, controller mapping, and a stale union entry).
- A one-off probe on a full copy of the source: the generated code type-checks, lints and compiles (`mvn test-compile`), the web tests pass with the generated test and the version bump, and a MockMvc test confirmed the generated route is reachable through the security allowlist, answers `403 denied_by_default` with a body that conforms to the generated OpenAPI operation, and answers `401` without a token.

## Limits

See BL-024 and BL-078 to BL-082 in [../BACKLOG.md](../BACKLOG.md): only POST commands on this path shape; the coverage and stand-in tables are still hard-coded per route; database and contract-test skeletons are not generated; the OpenAPI artifact is still one large file.
