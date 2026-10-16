# BL-229, first slice: the simulated email and SMS routes join the contract (0.35.0)

**Status:** built locally; full local gate result in the commit that carries this file. **Not independently reviewed.**

The demonstration messages module (`/api/demo/messages`) is promoted into the documented API. It was the first of six modules (BL-229 option 1: promote every demo module except `ai`).

- **Spring:** `GET /api/messages` (the caller's own, newest 50, with the unread count), `POST /api/messages/{id}/read`, `POST /api/messages/read-all`. Someone else's id, an unknown id and a malformed id are one 404 `not_found`. The two writes take no Idempotency-Key (recorded in `x-bee-idempotency.x-exceptions`): a read mark never goes back. Data and triggers are V66, unchanged.
- **Portal:** `/api/runtime/messages`, `/api/runtime/messages/{id}/read`, `/api/runtime/messages/read-all`, each validated like every other upstream answer (`lib/server/contracts/messages.ts`). The channel filter moved into the browser, so the API has no query parameters.
- **Contract 0.35.0:** six operations (three internal, three browser), schemas MessageItem, MessageList, MessageRead, MessageReadAll; request-log schema and union know all six routes.
- **Evidence:** `SpringContractTest.messageOperationsDocumentedPairs` (no token, identity denials, own list, empty list, mark one twice, unknown and malformed id, mark all, database down); `messages.test.mjs` (validators); three `session_expired` unit-evidence tests; contract-check stand-in pairs and anonymous pairs; `MessagesDatabaseTest` (triggers, own-only reads, the runtime login cannot write); `MessagesDemo` and `DemoMessageBadge` UI tests.
- **Removed:** the demo module `MessagesModule` and `/api/runtime/demo/messages` (404 now).

## What is left of BL-229
`qr` (6 routes), `payments` (4), `production` (9), `mis` (3) and `ledger` (10) each need the same treatment: Spring routes in the real namespace, validators, OpenAPI operations in both audiences with every status and error code evidenced, request-log wiring, the portal routes and the screens moved over. `ai` stays demo-only by decision. Measured cost of this slice: about 35 files; plan on one slice per module, each with its own gate.
