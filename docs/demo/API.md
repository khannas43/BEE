# Demonstration API reference (`/api/demo/**`)

**Status:** demonstration only, deliberately outside the OpenAPI contract (`docs/wp03/bee-local-api.openapi.json`), the contract coverage matrix and the request-log wiring check (BL-220). These routes are owner assumptions for the client demonstration, not BEE rules, and are not meant to survive into the real build unchanged. If any of them is kept, it must first be added to the OpenAPI artifact with tests (BL-229, which promotes the modules one at a time: messages is done). `scripts/local/demo-api-doc.test.mjs` fails when a module, route action or role set in the Spring code is missing from this file.

## Conventions
- **Only in the demonstration deployment:** `/api/demo/**` answers 404 unless the API's environment has `BEE_DEMO_LOGIN=1` (the same variable that turns on the demo sign-in in the portal), and the simulated ledger changes the public verification answer ("pending", "revoked") only under the same condition (`DemoSwitch`, BL-232).
- **Roles and scope:** the oversight roles (programme, director, secretary, admin, auditor, finance, helpdesk) count only when held for all records. The Reviewer's scope is "assigned", so the Reviewer may run only the helpdesk and the document check, and the document check only for an application assigned to them (BL-231).
- **Path:** `/api/demo/{module}[/{id}[/{action}]]` on Spring; the browser reaches it as `/api/runtime/demo/...` through one pass-through route (`app/api/runtime/demo/[...path]/route.ts`, GET and POST only; PUT, PATCH, DELETE answer 405).
- **Who:** only a signed-in person with an effective role gets through (`DemoController`); the module then decides what that person may see or do. Scope comes from the database, never from the request.
- **Writes** (`POST`) take a JSON body, run in one transaction with their audit rows, and answer with the new state. Unlike the contract routes they do **not** use an `Idempotency-Key`: the browser client sends one, but the portal pass-through does not forward it and Spring does not read it. A repeated start of a payment or a repeated row commit is refused by the database (409 or a duplicate-row error), and a payment callback is replay-safe through its nonce. Every body of a success carries `"demonstration": true`.
- **Path segments** are checked in the portal pass-through the same way as in the contract routes (`springIdSegment`): a segment that is empty, `.` or `..`, or holds anything outside letters, digits, `.`, `_`, `~` and `-`, becomes `-` and Spring answers 404.
- **Errors** use the closed list in `ApiErrors`: `role_not_permitted` (403), `not_found` (404, the same for unknown and out-of-scope ids), `validation_failed` (400, with a short `detail`), `version_conflict` (409), `segregation_refused` (403). `detail`, when present, is text meant for the screen.
- **Seeds** that write audit rows switch the message triggers off with `SET bee.demo_seeding = 'on'` (V66).

## Modules

### `payments` (simulated gateway; V52, V53)
| Route | Who | What |
|---|---|---|
| `GET payments` | manufacturer, agency (own organisation); finance, admin, auditor, director, secretary, programme (all, read only) | payments and, for payers, the applications whose fee is due |
| `GET payments/reconciliation` | finance, admin, auditor, director, secretary, programme | paid versus confirmed totals, differences, receipts |
| `POST payments` | manufacturer, agency, own organisation only | start a payment of exactly the fee snapshot total (`applicationId`; any amount in the body is ignored) |
| `POST payments/{id}/callback` | the person who started it | the simulated gateway callback (`gatewayRef`, `outcome` paid or failed, `nonce`); a replay with the same nonce is recognised and has no effect |

### `qr` (batches and serials; V54, V55)
Writers: manufacturer and agency (own organisation). All-batch readers: programme, admin, auditor (read only).
| Route | What |
|---|---|
| `GET qr` | batches in scope and the approved models that can have a batch |
| `POST qr` | create a batch for an approved model with a certificate (`applicationId`, `quantity` 1 to 5000); at most 100,000 serials over all batches of one certificate, and none for a certificate revoked on the simulated ledger (409) |
| `GET qr/{batch}` | batch detail with serials (`offset`, `limit` up to 200) |
| `POST qr/{batch}/serials` | allocate serials (`count`, blank for all remaining); refused (409) for a certificate revoked on the simulated ledger |
| `POST qr/{batch}/bind` | bind serials to the certificate (`serials`); a serial already bound is counted as already bound |
| `POST qr/{batch}/void` | void one serial with a reason |

### `ledger` (simulated Fabric; V56 to V58)
Readers: programme, secretary, director, admin, auditor (all), manufacturer (own). Writers: programme, secretary, admin. A second person must commit what the first sent (`segregation_refused` otherwise).
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
| `POST ledger/{certificate}/amend` | amend the valid-to date (`validTo`, at most 10 years from today, and `reason`) |
| `POST ledger/{certificate}/revoke` | revoke (`reason`) |

### `production` (quarterly production; V59, V60)
Own-organisation writers: manufacturer, agency. All-submission readers: programme, admin, auditor, director, officer (read only). Reviewers: programme and admin outside the submitting organisation.
| Route | What |
|---|---|
| `GET production` | submissions in scope |
| `POST production` | create a submission for a quarter (`quarter`, for example 2026-Q4) |
| `GET production/{id}` | detail with rows, evidence and history |
| `GET production/{id}/reconciliation` | declared units against bound QR serials; `margin` sets the percentage (a finite number from 0 to 1000) |
| `GET production/{id}/evidence` | the evidence record (`content=1` adds the file) |
| `POST production/{id}/rows` | validate or store CSV rows (`csv`, `commit`); all or nothing; two different periods of one model may not overlap; `replace: true` (only while the submission has a query) swaps every stored row for the new ones |
| `POST production/{id}/evidence` | attach CA evidence (name, membership number, statement, file; at most 5 files, 1 MiB each, standard base64, no slash or control character in the name), stored with its SHA-256, not verified |
| `POST production/{id}/submit` | send for review; editing closes |
| `POST production/{id}/review` | `decision` accepted or query (a query needs a `note`, at most 800 characters) |

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

### `dashboard` (Director's and Auditor's dashboards)
Read only; everything is computed from the live tables on each call. Programme at a glance (the Director's dashboard): director, secretary, programme or admin. Auditor's dashboard: auditor or admin. Each role held for all records. Every route takes an optional date range, `from` and `to` (yyyy-mm-dd, India time); a bad date or a start after the end is `validation_failed`.
| Route | What |
|---|---|
| `GET dashboard` | the dashboards the caller may open (`views`) |
| `GET dashboard/executive` | the one executive dashboard (Director view roles): eight headline figures and ten charts (received against issued by month, pipeline now, decisions, star ratings, fees by month, certificates by manufacturer, ledger state, waiting time, accepted production by quarter, payments), the six open applications waiting longest and the highest compliance risks. Optional `from`, `to` (yyyy-mm-dd) and `organisation` (one manufacturer's identifier) narrow every figure; with no dates the monthly charts show the last twelve months |
| `GET dashboard/{director\|auditor}` | the six tiles: figure, unit, icon, colour tone, the columns, the first five rows and the charts (a donut, ranked bars and a monthly trend, each following the date range; the trend is the last twelve months when no range is set) |
| `GET dashboard/{view}/{tile}` | the full list behind a tile (up to 200 rows, with the true total) and the same charts. Director tiles: `awaiting_approval`, `certificates`, `ledger_attention`, `production_review`, `fees_unconfirmed`, `ai_risk`. Auditor tiles: `ledger_integrity` (every chain re-verified, broken ones first), `two_person_proof`, `overrides`, `payment_trail`, `production_reviews`, `activity` (all recorded steps, newest first) |

`ai_risk` lists only the high-risk band, highest score first, with the column "Why it is high" (the two biggest reasons in words) and a `details` list, one entry per row, of every factor with its points, its weight and its reason ("33% of its applications were rejected (full weight at 34%)"); the points add up to the score. The scores use each organisation's whole history, so a date range lists the organisations that had application activity in that period (demonstration organisations without dates count as current).

### `manufacturers` (Manufacturer 360; read only)
`GET /api/demo/manufacturers` answers `{ manufacturers: [...], count }`, every manufacturer organisation the caller may see (staff roles held for all records see all; a manufacturer sees only its own organisation; anyone else gets 403). Each entry is assembled from the database: the company registration and activation (`manufacturer_onboarding_*`), brands from the register with, for a suspended or revoked brand, `reason` (the latest `register_status_event` for that status, else the brand's `note`) and `changedOn`, models with the latest rating and certificate, payments, QR serials (`qr_batch`, `qr_serial`), production quarters (`production_submission`, `production_row`), anomalies, flags and a short timeline. `status` is one of Compliant, Under observation, On hold, Registration pending, Suspended, Revoked. The Manufacturer 360 screen and the register screen read this one list, so both show the same manufacturers and the same brand statuses and reasons. A brand also carries `registeredOn`, a model carries `applicationId`, `brandId` and `brandName`, its stars fall back to the certificate when no rating record exists, every manufacturer lists at least the category RAC, and a failed payment is shown as Failed and left out of `fees.outstanding`.

### `model-technical` (product details of a model application; V81)
`GET /api/demo/model-technical/{applicationId}` answers the details (`acType`, `compressorType`, `refrigerant`, `coolingCapacityW`, `powerInputW`, `ratedVoltage`, `testReportNumber`, a computed `eer`), `saved` and `canEdit`. `POST` on the same path saves them (all fields optional, an empty one clears it; `acType` split, window, cassette or portable; `compressorType` fixed or inverter; `refrigerant` R32, R410A, R290 or R22; capacity 500 to 30000, power 100 to 15000, voltage 180 to 260, report number 3 to 60 characters). Staff roles read every application and a manufacturer its own; only the filing manufacturer may save, and only while the application is a draft or returned. Stored in `model_technical_detail` (no foreign key, so a disposable application can be removed without it). Outside the contract-listed model application routes, which are unchanged; the details are not checked against a BEE standard.

### `quarterly-test` (BEE test result per product per quarter; V82)
`GET /api/demo/quarterly-test` (optional `quarter=2026-Q3`) answers `{ results: [...], canRecord }`: a manufacturer reads its own results, staff roles every organisation's. `POST` records one (BEE Officer or Programme; the Admin demonstration profile is read only): `quarter`, `registrationId` (the product's certificate), `result` (pass, fail or retest), `testedOn` (not in the future), optional `measuredIseer`, `laboratoryCode` and `remarks` (500 characters). A new record for the same product and quarter replaces the earlier one. Stored in `quarterly_test_result`. Shown beside each product on the Quarterly submission screen and recorded on the page of a QR reconciliation submission.

### `service-requests` (renewals, withdrawals and helpdesk; V82)
`GET /api/demo/service-requests` answers `{ requests, staff, canRespond, canCreate }`: a manufacturer reads its own, staff roles all. `POST` raises one (manufacturer only): `kind` renewal, withdrawal or helpdesk, `subject` (3 to 160 characters), `message` (needed for a withdrawal and for helpdesk), optional `subjectRef` (a certificate) and `category`. `POST service-requests/{id}/respond` answers it (BEE Officer, Director, Programme or Helpdesk; not the Admin demonstration profile): `status` acknowledged, resolved or declined (a decline needs a note) and a `note`. Stored in `service_request`.

### `activity` (sign-in and action trail; V83)
`POST /api/demo/activity` records a sign-in or an action for the caller: `kind` (login or action), `action` (up to 200 characters, required), optional `ip` (the address the person came from; anything that is not an address becomes "unknown") and `target`. The portal server sends it, with the address of the browser request, after each demonstration sign-in and after each successful write it makes for a person (the action is the route in words, for example "Submit (model applications)"); the API adds the person, role and organisation from the token. `GET /api/demo/activity` answers `{ events, people, organisations, scope }`: a manufacturer reads its own organisation's people (`scope` own); officer, director, secretary, admin, auditor and programme, held for all records, read everyone (`scope` all, the consolidated view) and may narrow by `organisation` (code), `username` and `kind`. `events` is the latest 500, newest first; `people` has one line per person with sign-in and action counts, last seen and last address. Stored in `access_activity`, insert-only for the runtime role. Reads are not recorded. Local demonstration; an address behind a proxy is whatever the portal server sees.

### `product-testing` (random testing of products by BEE; V84)
BEE buys units from the market and tests them at its own cost; the manufacturer takes no part. Products are chosen from compliance risk and customer grievances, or by a risk-weighted random draw. For now only the BEE Officer (held for all records) works it; the Administrator demonstration profile and every other role get 403. Routes, all under `/api/demo/product-testing/`:
| Route | Who | What |
|---|---|---|
| `GET overview` | officer | open grievances, grievances in 30 days, products flagged (score 60 or more), results this quarter, cases per stage, grievances by source and by category, the five highest-priority products |
| `GET grievances` | officer | up to 500 grievances, newest first, with source, category, product, manufacturer, complainant and contact, and a status (open, in testing, closed) |
| `GET selection` | officer | every valid certificate ranked by review priority (score 0 to 100, band, and the points behind it): 30% of the manufacturer's compliance risk score (`AiEngines.complianceRisk`), 5 points per grievance in 90 days (at most 40), 10 for a repeated complaint (3 or more of one category), the latest BEE test (fail 25, retest 15, never tested 10); the first 60 are returned |
| `GET cases` | officer | test cases with their stage history |
| `GET product?reg=` | officer | one product in one answer: the risk score with its points, the production anomaly check for that model (`AiEngines.productionAnomaly`: quarterly units, flags, QR serials bound; `found` false when no production is reported), the grievances against it (total, last 90 days, by category and channel, latest five) and its test cases |
| `POST cases` | officer | add a product to the shortlist (`registrationId`, optional `reason`; stage `shortlisted`); 409 if it already has an open case |
| `POST draw` | officer | `size` 1 to 10: a risk-weighted random draw among products without an open case (weight is the score plus 5); the drawn products join the shortlist; the seed, size and weights are stored in `selection_draw` |
| `POST {caseId}/decide` | officer | the Officer's decision on a shortlisted product: `decision` approve (stage `selected`, the product goes for testing) or decline (stage `not_approved`), with `remarks` (5 to 500 characters, required); 409 when the case is not waiting for a decision; a case that was not approved can still be approved later, but not declined again |
| `POST {caseId}/advance` | officer | move an approved case one stage (409 while it is still only shortlisted): selected to bought (`procuredFrom`), to laboratory (`laboratory`), to result in (`result` pass, fail or retest, `measuredIseer`, `testedOn`; also written to `quarterly_test_result`), to closed (`recommendation` none, review or hold, only "none" after a pass; closing also closes the product's open grievances) |
| `GET mine` | manufacturer (own organisation) | its certified products with BEE's test results (once a result is in) and the grievance count (total, last 90 days) by category; never the complainant, the source or the text, and never a recommendation |
A failed test leads only to a recommendation; a hold is decided elsewhere. Stored in `grievance`, `test_case`, `test_case_event`, `selection_draw` (no foreign keys). Local demonstration; names and contacts in the seed are made up.

### `messages` (promoted, no longer part of this family)
The simulated email and SMS routes were promoted by BL-229 into the documented contract: Spring `GET /api/messages`, `POST /api/messages/{id}/read` and `POST /api/messages/read-all`, and the portal's `/api/runtime/messages` routes, in `docs/wp03/bee-local-api.openapi.json` (0.35.0) with the same evidence as every other operation. They are not under `/api/demo/**` any more. "Mark all as read" marks every unread message of the person, including those beyond the 50 the list shows.
