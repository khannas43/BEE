# BEE Standards & Labelling Portal — Local Development Plan

Version: 0.4 local scope | Updated: 1 October 2026
Location: Code/docs | Status: Active planning baseline

## 0. Summary and progress (baseline 30 September 2026)

**Scope.** Develop the portal locally on one MacBook, beginning **2 October 2026**, at **8 hours per active developer per working day**. WP01–WP11 remain. WP12 external adapters, WP13 legacy migration and WP14 quality/release are explicitly out of scope. Local fixtures or stubs may support a workflow, but this plan includes no live third-party integrations, SQL Server data movement, CI/CD, formal UAT, production security audit or go-live.

**Effort snapshot.** The retained v0.3 estimates total **1,205 person-days / 9,640 hours** across **34 activities**. A separate 20% reserve is **241 person-days / 1,928 hours**, for **1,446 person-days / 11,568 hours**. These carryover estimates need a local-scope re-estimate after the first vertical slice. At one active 8-hour developer on the single workstation, the former T0+6/7/8 production schedule is infeasible; Section 15 shows the calendar implication.

**Completion snapshot.** Local work packages accepted: **1/11 (9.1%)**: WP01 is accepted as documentation and design evidence. WP02.1 sign-in/session, WP02.2 narrow model-application list/read policy, WP02.3 local TOTP demonstration with protected test identities, WP03.1 local API contract, WP03.2 BFF reads, WP03.3 contract tests/correlation, WP04.1 effective-dated masters and WP04.2a brand authorisation foundation are accepted as local activities; delegation, complete denial evidence and the WP02–WP04 package reviews remain open. RT1 passed as WP03.2 local runtime proof, while WP03 and business behavior remain unaccepted. The prototype remains input, not accepted local implementation. Document preparation: **15/15 sections and 29/29 numbered subsections drafted (100%)**. The section table tracks document status, not delivery progress.

| Section | Subsections drafted | Document status |
| --- | ---: | --- |
| 1. Objective and local scope | 2 | Drafted |
| 2. Current baseline and gaps | 2 | Drafted |
| 3. Local engineering stack | 2 | Drafted |
| 4. Delivery rules and work sequence | 1 | Drafted |
| 5. Work packages and acceptance | 1 | Drafted |
| 6. Screen consolidation and role navigation | 3 | Drafted |
| 7. AI delivery slices | 2 | Drafted |
| 8. Blockchain and certificate delivery slices | 1 | Drafted |
| 9. Local data and boundaries | 2 | Drafted |
| 10. Local development sequence | 2 | Drafted |
| 11. Local technical demonstration | 2 | Drafted |
| 12. Feature-level verification | 1 | Drafted |
| 13. Team backlog and decision log | 2 | Drafted |
| 14. Definition of done | 2 | Drafted |
| 15. Activity effort and capacity | 4 | Drafted |
| **Total** | **29** | **Drafted** |

Update accepted WP count and actual/remaining person-days weekly. See Section 15.4 for the counting rule.

## 1. Objective and local scope

### 1.1 Objective and baseline

Extend the checked-out Next.js portal into a locally runnable application with persistent business records, role-aware journeys, AI demonstrations and a local Fabric certificate proof. Preserve useful role screens and Cursor's v0.3 decisions: one primary backend runtime unless an ADR justifies a split, a frozen canonical certificate payload before chaincode, and advisory AI over seeded data.

The current RFP, Technical Solution v0.2 and Detailed Design v0.2 describe the eventual platform. They inform local domain behavior but do not turn this single-MacBook phase into a production delivery or contractual acceptance programme. The old SRS is historical business-process input. Record deliberate departures in an ADR.

### 1.2 Scope boundary

WP01–WP11 are local development tracks. WP12 (external adapters), WP13 (SQL Server migration) and WP14 (quality/release) have **zero planned effort** here and must not reappear as hidden tasks under another WP. Payment, SMS/email, eSign, ID, national-platform and existing-mobile interfaces can be represented by deterministic local stubs only where needed to demonstrate an in-scope journey. Test data is synthetic or already approved for local use. No production data, credentials, external sandbox calls, formal security certification, deployment or BEE UAT are assumed.

The prior T0+6 demonstration, T0+7 UAT and T0+8 go-live are solution/RFP programme gates; they are **not dates promised by this local plan**. A later production programme needs its own scope, people, environments and estimates.

## 2. Current baseline and gaps

### 2.1 Repository baseline

| Area | Present in this repository | Local development work |
| --- | --- | --- |
| Web | Next.js 16.3.5, React 19.2.8, TypeScript, Tailwind CSS 3; public site and role-based application shell | Accessible Hindi/English UI, local session handling, API integration, error/loading/empty states |
| Screens | 14 modules, 140 catalogue entries and 161 generated build pages; several bespoke journeys and many generic archetype screens | Rationalized workspace inventory; map every retained action to role, route, API, state and acceptance test |
| Access | Client role switcher, menu/route guard and prototype access audit | Keycloak MFA, server-side resource/action authorization and organization/case scoping; keep preview role switcher development-only |
| State | Browser localStorage and shared simulated fixtures for model, QR, certificate and AI journeys | PostgreSQL-backed transaction state, traceable local event evidence, concurrency and reconciliation |
| API | lib/platformApi.ts sketches model and public-verification calls through APISIX | Versioned local API contracts, secure session/token exchange, common errors and focused API checks |
| AI | Five simulated use cases with evidence/disposition and model-governance screens | Data pipelines, real inference, validation, human review, model registry and monitoring |
| Blockchain | Simulated Fabric transactions, statuses and public proofs | Local Fabric test-network chaincode/adapter, confirmation handling, versioned hashes and verifier behavior |
| Assurance | npm build/lint and navigation invariants; reviewed prototype flows | Focused local behavior, role boundary and regression checks within each feature |

### 2.2 Gap interpretation

Do not treat a working screen or green prototype build as proof of persistent state or server-side authorization. Review fixes in docs/REVIEW-FIXES*.md are regression scenarios to retain.

## 3. Local engineering stack

### 3.1 Components on the MacBook

| Layer | Local development choice |
| --- | --- |
| Web | Existing Next.js 16 / React 19 / TypeScript / Tailwind application |
| Backend | Spring Boot 3 on Java 17, Maven build, one deployable with domain modules; ADR-001 governs the first slice |
| Identity | Local Keycloak 26 container identifies users; Spring database owns active roles, organisation membership, assignments and record scope (ADR-001) |
| Data | Dedicated Docker PostgreSQL 16 on port 5434 with separate `bee_app` and `keycloak` databases; local versioned document folder; seeded analytical views as needed |
| Workflow | Application state machine first; add Temporal only if a demonstrated timer or long-running workflow needs it |
| Certificate | Hyperledger Fabric local test network for issue/amend/revoke and confirmation; public verifier uses confirmed local proof |
| AI | Local inference on synthetic/approved data; deterministic fixtures when a model or dataset is unavailable; record version and human decisions |
| API | Versioned OpenAPI contracts; same-origin Next.js server routes hold the httpOnly session and call Spring, which enforces every action and data scope |
| Checks | Existing npm build/lint/access audit plus focused local unit, API and browser journey tests within each WP |

### 3.2 Runtime and resource decision

The solution's 25 services and full stack are a future target catalogue, not a requirement to start 25 containers on one laptop. WP01 records the minimum runtime, memory budget and service boundaries. Run only the components needed for the active vertical slice; use an in-process module or local stub where a separate service adds no local value. APISIX, Kafka, ClickHouse, Superset, Rasa, Airflow, OpenSearch, NiFi/Debezium, Gitea/Jenkins, Argo CD, Kubernetes, OpenTofu/Ansible, Prometheus/Grafana, k6, Trivy and ZAP are not install milestones for this phase. Do not present a local stub or test-network proof as a production integration.

## 4. Delivery rules and work sequence

### 4.1 Engineering rules

- Implement complete vertical slices: UI → local identity → API → persisted domain state → traceable event → local check. Replace a mock only when the corresponding slice is demonstrable.
- Keep authoritative business state on the server. Client localStorage may hold harmless UI preferences, never role grants, payment confirmation, certificate status, AI dispositions or official records.
- Implement only the reviewed first-slice actions, required reads and denial cases in Spring; deny other actions by default. Menus and route guards reflect reviewed policy but are not the authority. The 540 matrix mismatches remain proposals for individual policy review and must not become grants by importing the matrix.
- Model approvals, payments, certificate anchoring and revocation as explicit state machines with idempotent commands and retry/reconciliation paths.
- Make rules, fees, rating formulas, checklists, notifications and workflow routing versioned configuration with effective dates and audit history.
- Give each local deliverable an owner, user action, API/state contract and reproducible local check before calling it complete.

## 5. Work packages and acceptance

### 5.1 Work package register

| ID | Local work package | Main deliverable | Local exit evidence |
| --- | --- | --- | --- |
| WP01 | Scope, UX and trace | Consolidated screen/action matrix for 13 personas; runtime ADR; slice backlog and acceptance mapping | Documented entry paths, inventory and trace; local runtime architecture, resource budget and start/seed/reset/check command contract documented (E1–E4) |
| WP02 | Identity and policy | Local identity/session, organization membership and server-side role/object policy | Direct URL/API denial, cross-organization isolation and approval segregation checked locally |
| WP03 | Platform contracts | Versioned API/error contracts, idempotency and correlation, secure web-to-API path | Browser and API use the same persisted record and return consistent errors; local start, health, seed and targeted reset proof (RT1) |
| WP04 | Registration and master data | Organization, agency, brand and rule masters | Draft-submit-review decisions and effective rules persist and are traceable |
| WP05 | Model and label lifecycle | Model/family application, evidence, rating, review, approval and label | One model ID and reproducible formula/state across the journey |
| WP06 | Document service | Local upload validation, versioning, controlled retrieval and metadata | Versions/hashes linked to case; unauthorized retrieval denied |
| WP07 | Fees and production | Local payment **simulation**, receipts, quarterly submission, bulk validation and CA evidence | Payer cannot confirm own fee; simulated callbacks are idempotent; local totals reconcile |
| WP08 | QR and public verification | QR batch/serial binding and public local verifier | Duplicate code blocked; pending/active/revoked states agree across views |
| WP09 | Certificate and Fabric | Local Fabric chaincode/adapter for issue/amend/revoke and versioned hash proof | No Active before confirmed test-network commit; retry/mismatch paths visible |
| WP10 | Enforcement and helpdesk | Case/sampling/testing flow and integrated local ticket workspace | Partner/case assignment scope and ticket resolution work with seeded records |
| WP11 | MIS and AI | Local dashboards and five use-case demonstrations with evidence and human control | Output cites data/model version; disposition and override persist; no automatic adverse decision |

**WP02.1 activity review (30 September 2026).** Accepted for local Keycloak authorization-code/PKCE sign-in, server-held Next.js session, Spring-backed identity check, expiry/refresh and logout. Commit `d6aa367` includes the development-preview banner and browser checks that distinguish the selected preview role from the real signed-in identity. The reported local check passed 89/89 and the 16 OIDC unit tests passed on review. In-memory sessions and HTTP cookies are local-runtime limits. MFA policy/demo remains in WP02.3; role/object authorization and business screens remain in WP02.2 and later packages. This accepts no WP02 work package or screen-matrix grant.

**WP02.2 activity review (30 September 2026).** Accepted the narrow local model-application list/read policy: partner access is limited to active filing-organisation membership; IAME/Reviewer require an active assignment at the current stage; Finance, Programme, Director and Secretary read only their own stage. A stale assignment after handoff was found and corrected in SQL and Java. The focused Spring suite passed 62 tests and `local:check` passed 117/117, including the live handoff denial. Brand ownership alone gives no agency-filed read; historical internal access and Auditor evidence access need later reviewed rules. Create/edit, fee, rating, decisions, transitions and history remain denied or deferred. This accepts no WP02 work package or screen-matrix proposal.

**WP02.3 local TOTP activity review (1 October 2026).** Accepted the local MFA demonstration and protected test harness after inspecting the correction in `8d7bb53`; the reported 153/153 run and stand-in authenticator proof were not rerun during review. All 16 seeded Keycloak users must enroll and use an authenticator-app code (TOTP, single use); the browser and direct-grant flows both require it, with no role exemption and no SMS or email. The portal callback and Spring both refuse a token whose `amr` lacks `pwd` and `otp`, so a password alone creates no portal session and no API access. `local:check` no longer touches the seeded users: every check signs in as a disposable twin with the persona's Keycloak role and `bee_app` rows, removed after the run, and a before/after guard fails if any seeded OTP credential or session, or the realm flow bindings, changes. After a fresh `local:reset:identity`, with Nova and PixelCert enrolled on a stand-in phone and Nova signed in, `local:check` passed 153/153, including 31 MFA checks (enrollment, missing, wrong and replayed codes, logout, fresh challenge, retry after a rejected callback) and the Nova/PixelCert, rejected-identity, stale-stage and denied-write rechecks. Afterwards Nova's session and both phone authenticators still worked, and the checks' helper refused to replace credentials it had no secret for. The realm-misbinding check is opt-in (`local:mfa:misbind`, 7/7). `local:auth` with expiry passed 34/34; 64 Spring and 17 OIDC tests passed. The first sign-in after enrollment needs a second sign-in with a code. Brute-force limits, recovery codes and universal session revocation are not implemented. Delegation is documented as candidate rules only, with nothing granted; N1 edit, N6, N8 and full A7 remain pending. Evidence: [WP02.3_MFA.md](wp02/WP02.3_MFA.md). WP02 is not accepted; the work-package count stays 1/11.

**WP03.1 contract activity review (1 October 2026).** Reviewed and accepted the local contract, error and correlation work after the `09728cd` boundary correction. The reported live `local:check` passed 183/183; during review `web:test` passed 28/28. On branch `wp03.1-api-contract`, `docs/wp03/bee-local-api.openapi.json` (contract 0.2.0) describes the existing Spring routes as internal and the Next.js routes as browser-facing. Both layers now return one `{error, message}` body, with a 401/403/404/405/502/503 table and 409/422 reserved. `X-Correlation-Id` is validated or issued at the Next boundary, propagated to Spring and logged without sensitive data. The boundary now checks Spring's `/api/me` successes against the `Me` schema and accepts only documented error codes, including in the sign-in redirect. `npm run local:contract` passed 30/30 live cross-layer checks, including planted secret and SQL values that reached no response, redirect or log; these checks are also part of `local:check`. The evidence is in [WP03.1_CONTRACT.md](wp03/WP03.1_CONTRACT.md). No gateway was added, no route or matcher was widened, and create/edit/transition/history remain deferred with owners. The BFF model routes and idempotency remain WP03.2. This accepts no WP03 work package or screen-matrix proposal.

**WP03.2 BFF read activity review (1 October 2026).** Reviewed and accepted the local read increment in `e19415c`: the reported `local:check` passed 207/207 and `local:bff` 24/24; during review `web:test` passed 34/34. On branch `wp03.2-model-bff`, GET `/api/runtime/model-applications` and `/{id}` call the existing Spring reads with the server session's token. They validate every success body at every depth and allow only each operation's documented status/code pairs. Spring alone decides scope. Contract 0.3.0 adds both operations, removes only their deferred entry and records the idempotency/409 contract for the first write (WP05.1 or WP07.1) without building a store. `npm run local:bff` passed 24/24 with disposable twins signed in through Keycloak TOTP:
- the BFF, direct Spring and the database agree on the record set, ID, state and version (Nova 3, PixelCert 1, no cross visibility);
- the forged-session, bearer-injection, role-revocation, expired-membership, assignment, stage, outage/restart, refresh and expiry cases pass;
- 8 kinds of not-found ID give one indistinguishable 404;
- planted secret and SQL values reached no response or log.

Evidence: [WP03.2_BFF.md](wp03/WP03.2_BFF.md). No prototype screen consumes these routes yet (WP05.1). Executable idempotency is deferred to the first reviewed write command in WP05.1 or WP07.1; WP03 remains open and the work-package count stays 1/11.

**WP03.3 contract test and correlation activity review (1 October 2026): accepted locally.** Reviewed `3c65672` and independently reran `web:test` (47/47) and `api:test` (76 tests, 0 failures). The reported `local:check` (220/220) and focused suite (38 + 26 + 3) were not rerun during review. On branch `wp03.3-contract-tests`, Java and Node tests pin contract artifact 0.3.0 by version and hash. Spring MockMvc tests validate every documented Spring status and body against the artifact, and fail unless every internal pair is exercised.

- **Request logs.** Spring and Next.js write structured request logs to a documented schema, with bounded retention. Lines carry route templates and fixed outcomes, never raw queries, authorization codes, state, tokens, cookies, bodies or personal data. Next.js logs its Keycloak calls under the request's correlation ID; Keycloak itself is not sent the ID.
- **Live suite.** The live suite follows one correlation ID from browser to Next.js to Spring for reads, sign-in, sign-in failure, denials, malformed IDs, refresh, refused refresh and outage. A coverage matrix gives every documented (operation, status, code) pair evidence: 84/84. On the browser side, 42 are live, 11 live stand-in only and 3 unit only. On the Spring side, 21 are live and 7 MockMvc only.
- **Results.** `local:check` passed 220/220, `local:wp033` 38 + 26 + 3, `api:test` 76 and `web:test` 47/47. A log-leak mutation and a contract-drift mutation were each caught and reverted.
- **Defects fixed.** The new checks found and fixed two logging defects: missing outcomes on passed-through Spring errors, and Next dev printing raw request URLs.

Evidence: [WP03.3_CONTRACT_TESTS.md](wp03/WP03.3_CONTRACT_TESTS.md). No write, idempotency store, audit persistence, UI wiring, permission or gateway was added. Executable idempotency remains with the first write in WP05.1 or WP07.1. WP05.1 owns the first persisted model-application audit event, committed with its state change; WP07.1 owns fee events, with domain-specific coverage in WP04.3 and WP06.3. Diagnostic request logs do not become the authoritative audit history. WP03 remains open for its package-level exit decision and the work-package count stays 1/11.

**WP04.1 effective-dated masters review (1 October 2026): correction required before activity acceptance.** On branch `wp04.1-masters`, Flyway V4 adds versioned category, standard, laboratory-accreditation, fee-rule and rating-formula masters. Each row records its source, verification status and a half-open `[from, to)` period. Database triggers reject overlapping periods for one rule key and keep history immutable. Internal Spring service methods resolve the rule for a date and return none in a gap. The ₹1,000 local seed and the ₹24,000 D6 figure are kept as separate synthetic and provisional versions; neither is BEE-approved, and no rating is computed. `api:test:masters` passed 10/10, `api:test` 76 and `local:check` 222/222. No screen, route, permission, administration write, submission, fee confirmation or rating computation was added.

Review blocker: every current seeded key ends in an open-ended version. V4 forbids changing that end date and rejects a later version as overlapping, so the planned verified fee or formula cannot be inserted. A controlled, attributable closure/successor mechanism needs a V5 migration and database tests against both upgraded and freshly reset schemas. The BEE policy for who may initiate a closure remains pending; no UI grant is implied. Evidence: [WP04.1_MASTERS.md](wp04/WP04.1_MASTERS.md). At this initial review, WP04.1 and WP04 were not accepted; the work-package count stayed 1/11. The V5 correction review follows.

**WP04.1 correction review (1 October 2026): accepted as a local activity.** Reviewed `3ff05e3`; `api:test` was independently rerun (76 tests, 0 failures). The reported real-PostgreSQL `api:test:masters` (12/12) and `local:check` (222/222) were not rerun during review.
- **Mechanism.** Flyway V5 adds `master_closure` and `master_supersede()`. In one statement, they close an open-ended version of any of the five masters and insert its successor from the closure date. The closure records the closure date, actor, source and reason. The original row is unchanged. A second closure, an overlap, an invalid date and a direct closure insert are refused.
- **Tests.** Throwaway-schema tests run on both upgraded and freshly reset schemas. They close the seeded fee v2 and formula v1 (and the other three keys), and show the old version resolving the day before the boundary and the test-only successor on it. Failed attempts leave no closure or successor. Repeat seeding and a reset still produce the seeded state.
- **Results.** `api:test:masters` passed 12/12, `api:test` 76 and `local:check` 222/222. Nothing is seeded as verified or closed.
- **Scope.** No route, permission or UI was added. Who may close a version remains BEE decision M6.

WP04.1 is accepted as an internal local master-data activity. WP04 remains open for brand/agency workflows, master administration policy and audit coverage; the work-package count stays 1/11.

**WP04.2a brand authorisation foundation review (1 October 2026): accepted as a local activity.** The branch was rebased onto the reviewed V5 tip and V6 migrated and seeded the shared local schema in order. V6 adds brand ownership and time bounded agency authorisations with organisation kind, principal ownership and overlap guards; an internal Spring service resolves a named agency, principal, brand and date. Synthetic Nova Cool and PixelCert fixtures are not BEE approvals. No route, registration workflow, model submission permission, screen grant or brand-owner read was added. Focused brand DB tests passed 7/7; combined brand and master DB tests passed 19/19. `api:test` passed 76, matrix 24, access audit 9, typecheck and build passed. `local:check` passed 220 items; two coverage items were stale after the test edits, then `api:test` plus `local:coverage` passed all 84/84 contract pairs. Protected identities were unchanged and no test identity remained. Evidence: [WP04.2_BRAND_AUTH.md](wp04/WP04.2_BRAND_AUTH.md). WP04.2a is a foundation only; WP04 remains open and the accepted work-package count is 1/11.

**Excluded work packages:** WP12 external adapters, WP13 migration and WP14 quality/release. Feature-level local checks remain part of WP01–WP11; they do not imply a CI/CD pipeline, audit, load campaign, formal UAT or production release.

## 6. Screen consolidation and role navigation

### 6.1 Screen matrix

WP01 produces a local screen matrix with columns: workspace, route/view, task/action, internal and partner role capacities (view/create/edit/submit/review/approve/execute/download), data scope, API, state, and disposition (retain, merge, contextual view, retire). Use the Detailed Design Annex A as a candidate inventory and validate it against actual workflows.

### 6.2 Consolidated workspaces

| Workspace | Consolidation direction | Primary roles |
| --- | --- | --- |
| My work and approvals | One inbox with assignment-filtered tasks; detail panel holds checklist, history and decisions | Programme, reviewer, director, secretary, finance, IAME |
| Registrations | Organization/brand/model list and record detail with step-based forms, documents, fees and timeline | Manufacturer, agency, programme, reviewer |
| Labels, QR and certificates | One model record with label/QR, certificate/ledger proof, version history and lifecycle actions; batch operations separate | Manufacturer, agency, programme, auditor |
| Production and finance | Submission/upload with validation; finance queue with reconciliation, receipts and refunds | Manufacturer/agency (own records), finance, programme |
| Enforcement | Case workspace with sampling, custody, testing, challenge and decision tabs | Programme, IAME, SDA, laboratory, reviewer |
| Support | Partner raise/track view and agent queue/detail; shared knowledge base | All permitted users, helpdesk |
| Insights and administration | Role-specific dashboards, reports, AI review and versioned configuration | BEE administration, programme, auditor, director |

### 6.3 Route reachability

Keep public verification accessible without a console login. Retained detail/action routes need not each be a left-nav entry: each must be reachable from a visible role workspace, task link or record action, with a documented path and automated navigation check. Catalogue and role switcher remain development-only.

## 7. AI delivery slices

### 7.1 Five use cases

The five solution use cases are: compliance risk scoring; grievance chatbot assist; document extraction/intake assist; production anomaly/fraud detection; and star-rating trend analytics. Ship useful evidence and officer decisions before optimizing model sophistication. Distinguish real local inference from deterministic demonstration output on every view.

The local AI demonstration shows evidence, confidence, human disposition, and governance state on synthetic or approved seeded local data. Document extraction and helpdesk assist may use real inference earlier. Compliance risk, production anomaly, and star-rating trends stay advisory and demonstrations only until suitable labelled history exists.

| Slice | Data and output | Human control and proof |
| --- | --- | --- |
| Risk | Joined production, submissions, QR and enforcement history; ranked cases with contributing evidence | Officer reviews underlying rows, records disposition; score is advisory |
| Helpdesk assist | Approved FAQ, rules and case-safe status retrieval via RAG/intent routing | Draft with citations and confidence; agent approves send; shadow mode cannot send |
| Document intelligence | OCR/layout extraction from test and CA documents with field-level confidence | Operator corrects fields against source document; accepted values are traced |
| Production anomaly | Outlier and duplicate patterns over submissions, fees, scans and prior periods | Analyst investigates, records explanation, escalates only after review |
| Rating trends | Category/year/star distribution and change drivers in warehouse | Drill-down to source cohort; suppress small/private group leakage |

### 7.2 Model assurance and human decisions

Create labelled datasets, baseline metrics and validation thresholds for each use case. Store model/version, input snapshot, explanation, reviewer, decision, override and drift results; record a local model version and a reproducible fallback; defer MLflow deployment. AI output must never issue a certificate, penalty or payment instruction by itself. Separate training/test periods to prevent leakage; document false-positive handling and retraining approval.

## 8. Blockchain and certificate delivery slices

### 8.1 Certificate transaction sequence

1. Define canonical certificate payload and version identity: registration, model, status, validity, document hash, previous version and actor; exclude PII and full documents from chain.
2. On approved issuance, generate signed document and hash; persist a pending request and idempotency key; submit to Fabric; wait for orderer commit and validate transaction receipt before marking the certificate Active.
3. Amend, suspend and revoke as new version/status events. Never overwrite a previous proof. The label, certificate PDF, monitoring and public verifier must resolve the same current version.
4. Verification recomputes the document hash, checks confirmed ledger proof and current revocation/validity state; show Pending, Mismatch or Unavailable distinctly from Genuine. Fail closed on missing confirmation.
5. Reconcile portal and ledger on a schedule; alert on retrying, submitted-pending, missing and hash mismatch without double counting. Retain transaction, correlation and remediation evidence.
6. Exercise network outage, duplicate submit, delayed commit, chaincode error, revocation propagation and recovery in an isolated test network. Document the test-network configuration and reset steps; production governance is outside this phase.

Stand up the local Fabric test network after the canonical payload ADR and the model journey are stable. Chaincode for issue, amend, and revoke starts only after ticket 6 freezes the canonical certificate payload and versioned hash. Do not build that chaincode while rating rules and the model journey are still changing the payload. Active remains blocked until the transaction commit is confirmed.

## 9. Local data and boundaries

### 9.1 Data and capacity

Use synthetic or explicitly approved local datasets. Define seed records for organizations, models, documents, payments, QR serials, certificate versions, production submissions, cases and AI evidence. Preserve stable IDs across screens and reset scripts for repeatable demonstrations. PostgreSQL and local document storage hold application data; record migrations for the new schema only.

The SQL Server 2019+ legacy stack, T-SQL conversion, data cleansing, historical correction, Debezium/CDC, cutover and rollback belong to excluded WP13. The solution's roughly 60 crore annual appliance count and 12 TB allocation are production sizing questions, not laptop load targets. Keep units and cardinality as open assumptions; do not claim capacity validation on this MacBook.

### 9.2 External interfaces

The local payment adapter may simulate success, failure, duplicate callback and refund, but it must be clearly labelled simulated and cannot contact a gateway. SMS/email, eSign, ID checks, NSWS/API Setu/Entity Locker and the existing BEE mobile app are interface contracts or local stubs only if a retained screen needs them. There are no credentials, external sandboxes, partner certification or production APIs in scope. A separate mobile application is not planned.

## 10. Local development sequence

### 10.1 Dependency order

| Stage | Work packages | Local outcome | Exit check |
| --- | --- | --- | --- |
| A — foundation | WP01–WP03 | Screen/role matrix, runtime ADR, local identity, persistent API skeleton | Role and cross-organization denial; repeatable start/reset |
| B — core journeys | WP04–WP06 | Registration, model/rating/approval and versioned documents | One model journey keeps identity, state and evidence |
| C — trust and transactions | WP07–WP09 | Simulated fees/production, QR/public verification and local Fabric proof | No self-confirmed fee or premature Active certificate |
| D — cases and insight | WP10–WP11 | Enforcement/helpdesk, local MIS and AI evidence/disposition | Assigned-case scope and five clearly labelled AI demos |

This is a dependency order, not four simultaneous teams or an eight-month commitment. Work on one runnable vertical slice at a time and record actual person-days weekly. Start with the narrow registration→model→certificate path, then expand role coverage and AI. Section 15 carries the effort and one-workstation calendar.

### 10.2 Excluded programme gates

The prior current-portal O&M/KT track, migration rehearsal, external adapter approval, formal BEE demo milestone, UAT clearance and go-live do not apply to this local development phase. The team may demonstrate the local application at any agreed checkpoint; that demonstration is not contractual acceptance.

## 11. Local technical demonstration

### 11.1 Business storyline

From a clean seed, switch through authorized personas to create an organization/model application, review and rate it, record a simulated Finance confirmation, approve it, generate a label/QR and anchor a certificate on the local Fabric test network. Show confirmed versus pending proof, amendment/revocation, public verification and a cross-organization denial. Then show a helpdesk or enforcement case and selected AI evidence with confidence, model/version and human disposition.

Real inference must be labelled as such. Synthetic data, stubbed payments and local Fabric proof are visibly identified; the demo makes no assertion about live gateways, BEE migration or production issuance.

### 11.2 Engineering evidence

Show the local persisted record, API authorization result, certificate hash/version and a repeatable reset/replay. Basic unit/API/browser checks can support the demonstration. Live DevOps, container management, monitoring, load, Trivy or OWASP ZAP walkthroughs and formal scan reports are excluded with WP14.

## 12. Feature-level verification

### 12.1 Local checks inside WP01–WP11

- Run the existing lint/build and navigation audit when relevant; add focused unit/API/browser checks for each changed business rule or role boundary.
- Exercise direct-route/API denial, organization scoping, maker/checker separation, idempotent simulated payment, duplicate QR, Fabric pending/confirmed/revoked states and human AI disposition.
- Check English/Hindi labels and keyboard behavior on screens changed in this phase where practical, and record known gaps. Formal GIGW/WCAG certification, load/security testing, CI/CD, external penetration/CERT-In audit, UAT packs and release sign-off are excluded WP14.
- Keep a clean seed/reset path and mark every fixture, model output and external response as real-local, synthetic or simulated. A green local build is not production certification.

## 13. Team backlog and decision log

### 13.1 First ten local tickets

1. Inventory routes/fixtures and map retained actions to role workspaces.
2. Consolidate the screen/role/action matrix and close dead or duplicated paths.
3. Choose the smallest one-Mac runtime, primary backend language, session/BFF design and memory budget in an ADR.
4. Define local identity, organization grants and direct API denial checks.
5. Publish model, simulated payment, certificate and verifier contracts.
6. Freeze canonical certificate IDs, versioned hash payload and status state machine before chaincode.
7. Build one registration→model slice with PostgreSQL persistence and traceable decisions.
8. Implement deterministic local payment and document/QR seeds with reset scripts.
9. Stand up and verify a local Fabric test network against the frozen payload.
10. Define synthetic AI datasets, human dispositions and clear real-versus-simulated output labels.

### 13.2 Local decisions

| Decision | Needed before | Owner |
| --- | --- | --- |
| One active developer versus additional people sharing the machine; available hours | Reforecast | Development lead |
| Laptop RAM/storage and which services run together; verify ADR-001 estimates | WP03.2 runtime proof | Developer |
| Spring Boot/Keycloak selection (ADR-001); measure resources and pin container versions | WP03.2 | Developer/architect |
| Canonical certificate payload, signing/hash and test-network reset | WP09 | Domain lead |
| Which AI cases use real local inference versus fixtures | WP11 | AI lead |
| Approved synthetic/seed data and demo personas | WP04 onward | Product owner |
| Any later production programme or external integration request | Separate plan | BEE/SI |

## 14. Definition of done

### 14.1 Local acceptance

WP01 is complete on reviewed documentation evidence E1–E4: inventory and slice trace, proposed role entry paths, ADR-001 with a resource budget and command contract, and the machine-checked acceptance map. Its 540 reachability mismatches remain policy proposals; no app behavior or runtime start is accepted by WP01. For WP02–WP11, a local WP is complete when its retained persona journey uses persistent local state, enforces the relevant API action/data rule, handles expected errors and retries, can be reproduced from a clean seed, and has a focused check and demonstration note. A simulated external action is labelled simulated. Local completion does not mean RFP compliance, formal UAT or production readiness.

### 14.2 Source baseline

This v0.4 revises Cursor's v0.3 planning locks and preserves its runtime simplification, AI advisory scope and payload-before-chaincode dependency. Source context: Technical Solution v0.2, Detailed Design v0.2, the current repository and docs/REVIEW-FIXES*.md. The explicit local boundary in Section 1.2 governs this plan when a source describes production delivery.

## 15. Activity effort and capacity

### 15.1 Estimating assumptions

Planning starts **Friday, 2 October 2026**. One person-day is **8 hours**; a nominal workweek is Monday–Friday. The start day is included as a working day as requested. Holiday, leave and equipment downtime are not deducted. These are the v0.3 activity estimates for WP01–WP11 carried forward, with wording narrowed to local behavior; re-estimate after the first vertical slice because full-platform estimates may overstate or misallocate laptop work. WP12–WP14 and their effort are removed, not reassigned.

### 15.2 Activity estimates

| Activity | Work package | Local activity | Stage | Person-days | Hours |
| --- | --- | --- | --- | ---: | ---: |
| WP01.1 | Scope/trace | RFP-to-feature inventory and gap register | Stage A | 18 | 144 |
| WP01.2 | Scope/trace | Screen and role/action matrix | Stage A | 12 | 96 |
| WP01.3 | Scope/trace | Architecture decisions and acceptance mapping | Stage A | 10 | 80 |
| WP02.1 | Identity | Local Keycloak authorization-code/PKCE sign-in, Next.js server session and Spring identity check | Stage A | 25 | 200 |
| WP02.2 | Identity | Organization and object authorization | Stage A | 35 | 280 |
| WP02.3 | Identity | Local MFA policy/demo, delegation, denial and access tests | Stage A | 20 | 160 |
| WP03.1 | Contracts | Gateway and OpenAPI/error standards | Stage A | 25 | 200 |
| WP03.2 | Contracts | Common service/BFF integration | Stage A | 30 | 240 |
| WP03.3 | Contracts | Contract tests and correlation | Stage A | 20 | 160 |
| WP04.1 | Registration | Masters and effective-date rules | Stage B | 35 | 280 |
| WP04.2 | Registration | Organization, agency and brand workflows | Stage B | 45 | 360 |
| WP04.3 | Registration | Scrutiny, validation and audit tests | Stage B | 25 | 200 |
| WP05.1 | Model lifecycle | Application, family and evidence journey | Stage B | 55 | 440 |
| WP05.2 | Model lifecycle | Rating, approval and configurable workflow | Stage B | 55 | 440 |
| WP05.3 | Model lifecycle | Label, renewal and regression | Stage B | 40 | 320 |
| WP06.1 | Documents | Upload, metadata and versioning | Stage B | 30 | 240 |
| WP06.2 | Documents | Quarantine, rights and retention | Stage B | 25 | 200 |
| WP06.3 | Documents | Document audit and tests | Stage B | 15 | 120 |
| WP07.1 | Fees/production | Simulated payment/callback and reconciliation | Stage C | 45 | 360 |
| WP07.2 | Fees/production | Production, bulk and CA evidence | Stage C | 50 | 400 |
| WP07.3 | Fees/production | Local refunds, label fees and finance checks | Stage C | 35 | 280 |
| WP08.1 | QR/verification | Batch, serial and duplicate controls | Stage C | 35 | 280 |
| WP08.2 | QR/verification | Local public verification API | Stage C | 35 | 280 |
| WP08.3 | QR/verification | Cross-view consistency checks | Stage C | 25 | 200 |
| WP09.1 | Fabric | Chaincode, version/hash and adapter | Stage C | 45 | 360 |
| WP09.2 | Fabric | Issuance, amendment and revocation | Stage C | 55 | 440 |
| WP09.3 | Fabric | Pending/retry/reconciliation and proof checks | Stage C | 35 | 280 |
| WP10.1 | Cases/support | Enforcement and partner assignment flows | Stage D | 45 | 360 |
| WP10.2 | Cases/support | Ticket/agent and knowledge journeys | Stage D | 45 | 360 |
| WP10.3 | Cases/support | Case/SLA and role checks | Stage D | 25 | 200 |
| WP11.1 | MIS/AI | Local data views and MIS reports | Stage D | 45 | 360 |
| WP11.2 | MIS/AI | Risk, anomaly and trend models | Stage D | 60 | 480 |
| WP11.3 | MIS/AI | Helpdesk assist and document extraction | Stage D | 60 | 480 |
| WP11.4 | MIS/AI | Model evidence, governance and evaluation | Stage D | 45 | 360 |
| **Base total** | **11 WPs** | **34 activities** | **A–D** | **1,205** | **9,640** |
| **20% planning reserve** | — | Unknowns/defects; separate from activity rows | A–D | **241** | **1,928** |
| **Indicative total** | — | Base plus reserve | A–D | **1,446** | **11,568** |

### 15.3 One-workstation capacity

The 2 October 2026–2 June 2027 former eight-month window has **174 weekdays** before holidays. One 8-hour developer on the MacBook supplies at most **174 person-days / 1,392 hours** in that window. The retained base is **1,205 person-days**, or **6.93 full-time developers** over that window; base plus reserve is **1,446 person-days**, or **8.31 full-time developers**. One active workstation cannot supply that concurrency.

If one developer works sequentially on this one MacBook at 8 hours on every weekday, the carryover base reaches approximately **15 May 2031** and base plus reserve **16 April 2032**, before holidays, leave or dependency delay. These dates expose the mismatch; they are **not commitments**. Re-scope or re-estimate a smaller local increment before assigning a calendar deadline. Stages A–D in Section 10 can be used as separately demonstrable increments.

### 15.4 Progress calculation and change control

Delivery progress is accepted WP01–WP11 against Section 14: currently **1/11 (9.1%)**, WP01 documentation and design only. WP02.1 sign-in/session, WP02.2 narrow model-application list/read policy, WP02.3 local TOTP demonstration, WP03.1 API contract, WP03.2 BFF reads, WP03.3 contract tests/correlation, WP04.1 effective-dated masters and WP04.2a brand authorisation foundation are accepted as local activities. Delegation, complete denial evidence, brand/agency workflows and other object and action rules remain in their owning activities; WP02, WP03 and WP04 are not accepted. RT1 is passed local evidence under WP03.2, not WP03 acceptance. Actual person-days and the local-scope remaining estimate have not yet been reconciled. The Section 0 table describes drafted document sections only. Track actual person-days, remaining estimate, accepted WPs and the next locally runnable increment weekly. When an estimate or scope changes, record old and new totals and the reason; do not hide excluded WP12–WP14 effort inside another row.
