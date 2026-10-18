# Brief 19C-B1 — registration repeat-cycle and proof corrections

## Status

**Implemented / ChatGPT review pending.** Brief 19C-B is **not** accepted.

## Branch

`cursor/snl-wp02c-registration-service-wiring` from `main` @ `ae63275` (V73 + 19C-A accepted).

## Scope

- V74 trusted read `registration_return_response_latest_open_cycle_return` (ordered by `returned_at DESC, id DESC`); runtime EXECUTE only; revoke runtime SELECT on `registration_return_response_cycle_return`.
- Resubmit task owner from bound return row (V74), not latest return transition.
- Service proofs: repeat-cycle journey, UUID-order guard, assignee rollback snapshot, Java↔V73 hash parity.

## Out of scope

19C-C, 19D, V69–V73 edits.

## Gates

Same as 19C-B plus Flyway V74.

## Handback

`/bee-handback`; baton → `claude`; do not push.
