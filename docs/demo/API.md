# Demonstration API reference (`/api/demo/**`)

**Status:** demonstration only, deliberately outside the OpenAPI contract (`docs/wp03/bee-local-api.openapi.json`), the contract coverage matrix and the request-log wiring check (BL-220). These routes are owner assumptions for the client demonstration, not BEE rules, and are not meant to survive into the real build unchanged. If any of them is kept, it must first be added to the OpenAPI artifact with tests (BL-229, which promotes the modules one at a time: messages is done). `scripts/local/demo-api-doc.test.mjs` fails when a module, route action or role set in the Spring code is missing from this file.

## Conventions
- **Path:** `/api/demo/{module}[/{id}[/{action}]]` on Spring; the browser reaches it as `/api/runtime/demo/...` through one pass-through route (`app/api/runtime/demo/[...path]/route.ts`, GET and POST only; PUT, PATCH, DELETE answer 405).
- **Who:** only a signed-in person with an effective role gets through (`DemoController`); the module then decides what that person may see or do. Scope comes from the database, never from the request.
- **Writes** (`POST`) take a JSON body and an `Idempotency-Key` header, run in one transaction with their audit rows, and answer with the new state. Every body of a success carries `"demonstration": true`.
- **Errors** use the closed list in `ApiErrors`: `role_not_permitted` (403), `not_found` (404, the same for unknown and out-of-scope ids), `validation_failed` (400, with a short `detail`), `version_conflict` (409), `segregation_refused` (403). `detail`, when present, is text meant for the screen.
- **Seeds** that write audit rows switch the message triggers off with `SET bee.demo_seeding = 'on'` (V66).

## Modules

### `payments` (simulated gateway; V52, V53)
| Route | Who | What |
|---|---|---|
| `GET payments` | manufacturer, agency (own organisation); finance, admin (all) | payments and, for payers, the applications whose fee is due |
| `GET payments/reconciliation` | finance, admin | paid versus confirmed totals, differences, receipts |
| `POST payments` | manufacturer, agency, own organisation only | start a payment of exactly the fee snapshot total (`applicationId`; any amount in the body is ignored) |
| `POST payments/{id}/callback` | the person who started it | the simulated gateway callback (`gatewayRef`, `outcome` paid or failed, `nonce`); a replay with the same nonce is recognised and has no effect |

### `qr` (batches and serials; V54, V55)
Writers: manufacturer and agency (own organisation). All-batch readers: programme, admin, auditor (read only).
| Route | What |
|---|---|
| `GET qr` | batches in scope and the approved models that can have a batch |
| `POST qr` | create a batch for an approved model with a certificate (`applicationId`, `quantity` 1 to 5000) |
| `GET qr/{batch}` | batch detail with serials (`offset`, `limit` up to 200) |
| `POST qr/{batch}/serials` | allocate serials (`count`, blank for all remaining) |
| `POST qr/{batch}/bind` | bind serials to the certificate (`serials`); a serial already bound is counted as already bound |
| `POST qr/{batch}/void` | void one serial with a reason |

### `ledger` (simulated Fabric; V56 to V58)
Readers: programme, secretary, admin, auditor (all), manufacturer (own). Writers: programme, secretary, admin. A second person must commit what the first sent (`segregation_refused` otherwise).
| Route | What |
|---|---|
| `GET ledger` | certificates and their ledger status |
| `GET ledger/transactions` | the block explorer, newest block first |
| `GET ledger/{certificate}` | detail, transactions, audit trail, the allowed actions and why not |
| `GET ledger/{certificate}/verify` | recompute every hash: MATCH or MISMATCH with the first bad sequence |
| `POST ledger/{certificate}/submit` | send the issue |
| `POST ledger/{certificate}/commit` | commit what another person sent |
| `POST ledger/{certificate}/fail` | simulate a failed commit (`reason`) |
| `POST ledger/{certificate}/retry` | retry a failed transaction |
| `POST ledger/{certificate}/amend` | amend the valid-to date (`validTo`, `reason`) |
| `POST ledger/{certificate}/revoke` | revoke (`reason`) |

### `production` (quarterly production; V59, V60)
Own-organisation writers: manufacturer, agency. All-submission readers: programme, admin, auditor, director. Reviewers: programme and admin outside the submitting organisation.
| Route | What |
|---|---|
| `GET production` | submissions in scope |
| `POST production` | create a submission for a quarter (`quarter`, for example 2026-Q4) |
| `GET production/{id}` | detail with rows, evidence and history |
| `GET production/{id}/reconciliation` | declared units against bound QR serials; `margin` sets the percentage |
| `GET production/{id}/evidence` | the evidence record (`content=1` adds the file) |
| `POST production/{id}/rows` | validate or store CSV rows (`csv`, `commit`); all or nothing |
| `POST production/{id}/evidence` | attach CA evidence (name, membership number, statement, file), stored with its SHA-256, not verified |
| `POST production/{id}/submit` | send for review; editing closes |
| `POST production/{id}/review` | `decision` accepted or query (a query needs a `note`) |

### `mis` (dashboard; V61)
Read only. Full view: programme, director, secretary, admin, auditor. Finance sees the finance panel only.
| Route | What |
|---|---|
| `GET mis` | the panels the caller may open |
| `GET mis/{panel}` | summary, applications, finance, production or certificates (`from`, `to`, at most 36 months) |
| `GET mis/export?panel=` | the same panel as CSV text with a file name |

### `ai` (five advisory models; V62 to V64)
Run rights per use case are in `AiDemoModule` (`RUN` and `READ_EXTRA`); every output is advisory and writes nothing to an application, certificate or fee.
| Route | What |
|---|---|
| `GET ai/models` | the model cards and what the caller may read or run |
| `GET ai/{use-case}/runs` | stored runs of compliance-risk, production-anomaly, rating-trends, helpdesk-assist or document-extraction |
| `POST ai/{use-case}/runs` | run the model (`inputRef`, or `category` for rating trends, `question` for helpdesk) |
| `GET ai/{run}` | one run with its evidence |
| `POST ai/{run}/disposition` | record accept, override (own value and reason required) or reject; the model output is never changed |

### `messages` (promoted, no longer part of this family)
The simulated email and SMS routes were promoted by BL-229 into the documented contract: Spring `GET /api/messages`, `POST /api/messages/{id}/read` and `POST /api/messages/read-all`, and the portal's `/api/runtime/messages` routes, in `docs/wp03/bee-local-api.openapi.json` (0.35.0) with the same evidence as every other operation. They are not under `/api/demo/**` any more.
