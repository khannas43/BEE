# Demo work plan: 15 hours (15 October 2026)

**Goal.** A 30 to 45 minute client demonstration. Key items: payment simulation, QR batch and serial, Fabric certificate, quarterly production submission, MIS dashboard, five AI use cases, on top of the live registration and model-approval journeys that already work. Everything is a **local demonstration on provisional rules**, said on screen. The Fabric network is **simulated** (owner agreed, 15 Oct): real tables, a pending-to-committed state machine, a hash chain; the screens say "simulated test network". Nothing here claims to be real Fabric or a BEE rule.

**Owner decisions (15 Oct).** Simulated Fabric accepted. Per-slice independent reviews skipped for the demo build; one full gate and one rehearsal instead; a proper review follows after the demo. Cursor deploys, from a separate clone, on the demo laptop (see Deployment).

## Demo script (40 minutes)

| Min | Step | Persona | Slice |
| --- | --- | --- | --- |
| 0-3 | Sign in with one-time code; role menus; denied access to another role's screen | nova.applicant | existing |
| 3-8 | Brand registration: filed, reviewed, approved, in the register | nova.applicant, bee.programme, bee.director | existing |
| 8-14 | Model application: fee, IAME, Reviewer, Rating, Director, Secretary | six personas | existing |
| 14-18 | **Payment simulation**: applicant pays at the simulated gateway, callback arrives twice (second is ignored), receipt, Finance reconciliation totals | nova.applicant, bee.finance | S1 |
| 18-23 | **Fabric certificate**: approval issues it as pending on the simulated ledger, commit, hash chain, a failed commit retried, an amendment, a revocation | bee.secretary, bee.admin | S3 |
| 23-27 | **QR batch and serial**: batch for the approved model, serials allocated, duplicate refused, serial bound to the certificate, public verifier resolves the serial and shows pending, active or revoked | nova.applicant, public | S2 |
| 27-31 | **Quarterly production**: submission, bulk CSV with row errors, CA evidence file, totals reconcile against serials | nova.applicant | S4 |
| 31-35 | **MIS dashboard** on live data | bee.director | S5 |
| 35-42 | **Five AI use cases**, each with evidence, version, human disposition; override persists | bee.programme, bee.reviewer | S6 |

## Rules for this build

1. One integration branch `demo-pack` (this one). Slices run as isolated branches/worktrees `demo/s1`..`demo/s6` cut from the Phase-0 commit; the integrator (Claude) merges them. Slices never edit shared registries (see Phase 0).
2. Migrations per slice: S1 V52-V53, S2 V54-V55, S3 V56-V58, S4 V59-V60, S5 V61, S6 V62-V64. Never edit an applied migration. Never edit AGENTS.md or CLAUDE.md.
3. **Spring is the authority.** Every new read or write goes through a Spring endpoint with role, scope and state checks and an audit event in the same transaction. No data access from the browser or the BFF.
4. Reuse existing error codes. A slice that needs a new error code asks the integrator.
5. Every screen says what is simulated. Use the kit (`docs/kit/SCREEN_KIT.md`). Errors as `role="alert"`; results as `role="status"`.
6. Each slice delivers: its migrations, Spring service and tests (DB test on a throwaway schema), screens, a seeded demo dataset, and a 10-line note in `docs/demo/S<n>.md` (what is real, what is simulated, how to demo it). Per-slice review is skipped; the slice must still pass `tsc`, `eslint --max-warnings 0`, `web:test`, `web:test:ui`, and the default backend suite.
7. No repo file edits while the integrator runs a full gate.

## Phase 0 (hour 0 to 1): integrator only

1. Route inventory (below) scaffolded in one pass with `scripts/local/new-feature.cjs` where the shape fits; hand-wired for reads and collections. All registrations, the OpenAPI artifact and `contract-pin.json` move once, to **0.33.0**, so slices never touch them.
2. Skeleton controllers and BFF routes that deny with `denied_by_default` until a slice sets `IMPLEMENTED`.
3. Demo seed design: `local/seed/demo-seed.sql` frame with the shared people and the approved models every slice builds on (Nova: 3 approved models with certificates; Pixel: 1; payments; 4 quarters of production).
4. Slice worktrees created.

### Route inventory (fixed up front)

| Slice | Routes |
| --- | --- |
| S1 | POST `/api/model-applications/{id}/payments` (start), POST `/api/payments/callback` (simulated gateway, signed, idempotent), GET `/api/payments`, GET `/api/payments/reconciliation` |
| S2 | POST/GET `/api/qr-batches`, GET `/api/qr-batches/{id}`, POST `/api/qr-batches/{id}/serials`; public: GET `/api/public/verification?serial=` |
| S3 | GET `/api/certificates`, GET `/api/certificates/{id}`, POST `/api/certificates/{id}/ledger/commit`, `/ledger/retry`, `/amend`, `/revoke`; GET `/api/ledger/transactions` |
| S4 | POST/GET `/api/production-submissions`, POST `/api/production-submissions/{id}/rows` (bulk CSV), POST `/api/production-submissions/{id}/evidence`, GET `/api/production-submissions/{id}/reconciliation` |
| S5 | GET `/api/mis/summary`, `/api/mis/applications`, `/api/mis/finance`, `/api/mis/production`, `/api/mis/certificates` |
| S6 | GET `/api/ai/models`, GET `/api/ai/{useCase}/runs`, POST `/api/ai/{useCase}/runs`, POST `/api/ai/runs/{id}/disposition` (accept, override, reject; reason required); use cases: `compliance-risk`, `production-anomaly`, `document-extraction`, `helpdesk-assist`, `rating-trends` |

### Shared data contract (so parallel slices agree)

- `payment(id, application_id, amount_inr, status: initiated|paid|failed, gateway_ref unique, created_at)`; `payment_callback(id, gateway_ref, payload_sha256 unique, received_at)`.
- `qr_batch(id, model_application_id, certificate_id, quantity, status)`; `qr_serial(serial unique, batch_id, certificate_id, state: allocated|bound|void)`.
- `ledger_tx(id, certificate_id, seq, kind: issue|amend|revoke, state: pending|committed|failed, prev_hash, hash, created_at, committed_at)`; certificate status derived: pending until the issue tx is committed, revoked after a committed revoke.
- `production_submission(id, organisation_id, quarter, state)`, `production_row(submission_id, serial or model, units)`.
- `ai_run(id, use_case, model_version, data_version, input_ref, output jsonb, confidence, created_at)`; `ai_disposition(run_id, actor, decision, reason, at)`.
- MIS reads only existing tables plus the above.

## Timeline (H0 = now)

| Hour | What | Gate/checkpoint |
| --- | --- | --- |
| 0-1 | Phase 0 (integrator). Cursor: deployment runbook in a separate clone | contract 0.33.0 builds; skeletons deny |
| 1-7 | S1 to S6 in parallel (S6 split in two agents: data-driven models; document and helpdesk) | each slice self-checks |
| 7-9 | Integration: merge slices, regenerate registries, fix conflicts, `mvn test`, `tsc`, `eslint`, `web:test` | integrated build green |
| 9-11 | Demo seed final; browser rehearsal #1 of the full script, fix list | script runs end to end |
| 11-12.5 | Full `local:check` (about 30 minutes) and fixes; second run if needed | gate green |
| 12.5-13 | Merge to main; code freeze | main = demo build |
| 13-14 | Cursor deploys the final build on the demo laptop; smoke test; OTP enrolment | demo laptop runs script |
| 14-15 | Rehearsal #2, buffer | |

## Cut lines (drop in this order if behind at hour 7 or 9)

1. S6: document extraction and helpdesk assist become labelled stubs with fixed outputs (the three data-driven use cases stay real).
2. S4: CA evidence upload and bulk CSV (keep single-row submission and reconciliation).
3. S3: retry and mismatch path (keep issue, commit, revoke).
4. S2: bulk serial allocation; keep one batch and public serial verification.
5. S1: reconciliation view (keep pay, callback, idempotency, receipt).

Never cut: the live registration and model journeys; the public verifier; "simulated" labelling.

## Deployment (Cursor)

Container mode on the demo laptop only (`npm run local:app:up`), separate clone `~/Developer/BEE-demo`, no baton, no push. Sign-in issuer is `127.0.0.1` (BL-130): a hosted server is not in scope. The dev runtime on this Mac and the demo containers share ports 8090, 3100, 8180, so the final deployment happens only at hour 13, on the demo laptop.

## Risks

1. The contract gate (route coverage 1606 pairs, denial-by-default, wiring) is the biggest schedule risk for 20 new routes; Phase 0 exists to take it once. If the gate cannot be made green by hour 12.5, the demo runs from the branch (labelled), and main is updated after the demo.
2. Parallel slices touching shared screens (`runtimeRoutes`, `screenMatrix`, menus): the integrator owns these.
3. Seed data coupling across slices (S4 needs S2 serials; S5, S6 read everything): the shared data contract above is fixed and not changed by slices.
4. One-time-code enrolment of each demo person must be done before the demo.
