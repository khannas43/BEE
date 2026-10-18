# Brief 19C-B — registration return/resubmit service integration

## Status

Implementation slice; superseded for review by **Brief 19C-B1** (repeat-cycle corrections). **Not accepted.**

## Branch

`cursor/snl-wp02c-registration-service-wiring` from `main` @ `ae63275` (V73 and 19C-A accepted at `ae63275`).

## Scope

Wire accepted V73 `RegistrationReturnResponseWiringRepository` into `RegistrationReviewService` for Programme/Director **return** and applicant **resubmit** in one Spring transaction per command.

## Out of scope

19C-C forward closure, 19D, OpenAPI/UI/BFF changes, V69–V73 migration edits.

## Required controls

- Legacy transition then V73 orchestrate in same `@Transactional` boundary; wiring failure → `setRollbackOnly()` before mapped HTTP errors.
- Programme and Director return paths; manufacturer/agency resubmit.
- Trusted persisted context for transition ids, timestamps, actors, policy, due dates, command ids; canonical wiring hashes via SQL functions.
- HTTP idempotency preserved; wiring conflicts → 409 `idempotency_key_conflict` without `idempotency.abandon` on wiring conflict paths.
- Service/database proofs: success return/resubmit (Programme + Director), replay, changed-payload conflict, concurrency, assignee/role failure, mid-workflow injected rollback with **no residue** (legacy transition, notification, task, clock, discrepancy, cycle, response, binding, evidence).

## Gates

`cd backend && mvn test`; `mvn test -Dgroups=db -Dbee.test.excludedGroups=none`; `npx tsc --noEmit`; `npm run web:test`; `npm run build`; `git diff --check ae63275..HEAD`; `npm run local:down`.

## Handback

`/bee-handback`; baton → `claude`; do not push.
