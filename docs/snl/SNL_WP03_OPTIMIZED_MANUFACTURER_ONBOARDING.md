# SNL WP03 — optimized manufacturer onboarding (backend slice)

**Status:** A3 backend accepted at **`b378900`** (Flyway **V69–V75** frozen). **B2** frontend integrated on demo branch `cursor/demo-wp3-onboarding-final`. **Brief C1A (18 Oct 2026):** live upload fixed (`readStateForUpload` — no `FOR UPDATE` on application reads; append stays in `manufacturer_onboarding_trusted_append_document`); **`scripts/demo/c1-manufacturer-onboarding-journey.cjs`** passed **25/25** on presentation stack + ngrok. Production identity/payment/scheduler gaps remain **BL-261–263**. Provisional local rules, not BEE rules.

## Scope

Auditable manufacturer entity onboarding: draft application (JSONB payload), nine Annexure document kinds, fee snapshot, simulated auto-payment on submit, automated checks, director approve/reject, 15 calendar-day observation, permittee activation, finance/programme/**director** anomalies, director resolve/revoke, immutable events and command evidence.

## Backend authority (not UI copy)

| Rule | Source |
| --- | --- |
| Company registration fee | **₹5,000.00** from master fee rule `REG:manufacturer_onboarding` (version 1); submit orchestrator snapshots the rule — clients do not supply the amount. |
| Officer roles | Finance/Programme/Director actions use **role grants on the authenticated account** (`p_actor_role` / capability checks in SQL). Request bodies carry decisions and notes only, not role. |
| `rejected` vs `revoked` | **Reject** at `director_review` → terminal `rejected` (no permittee). **Revoke** via anomaly resolution `revoked` while on hold after activation path → terminal `revoked` + `organisation.permittee_lifecycle = revoked`. |
| Automated checks | Failed checks land in **`automatic_checks_failed`** (distinct from director reject). Resubmit records **`from_state`** from the persisted current state (not always `draft`). |
| Observation window | On **approve**, `started_on` and `observation_ends_on` are **15 calendar days from Director approval** (`decided_at` in IST), not from an arbitrary client clock. |
| Anomaly cleared after deadline | If `observation_ends_on` has passed, **cleared** resolves to **`active`** (closes observation, activates permittee), not back to `active_observation`. Within the window, cleared returns to `active_observation`. |
| `tradeLicenceUploaded` | **True only** when a **`trade_licence`** document version exists; other uploads do not satisfy the gate. |
| Trusted writes | `bee_runtime` has **SELECT** on application/evidence reads and **EXECUTE** on documented commands only — no direct INSERT/UPDATE on application, events, or document tables. SECURITY DEFINER commands run as the migration owner; **`bee.mob_trusted` is not used**. |
| Document upload pre-check | Spring reads application **state** with an ordinary **SELECT** (no row lock). **`manufacturer_onboarding_trusted_append_document`** locks the row, checks org ownership and editable state, and appends the version atomically. |
| Command idempotency | Each orchestrator serializes on `command_id`, compares application, purpose and a **database-canonical** payload hash, replays stored results (even after later lifecycle moves), and raises **`idempotency_key_conflict`** on cross-application, cross-purpose or changed-payload reuse. Spring maps SQL `23505` / `idempotency_key_conflict` to HTTP **409**. |
| Submit actor | Submit requires active **manufacturer** membership on the application organisation; forged role/org actors are refused before payment or evidence writes. |
| Observation close (production) | **No browser or Spring API** for manual observation close. Automatic closure after day 15 when no anomaly remains is **BL-263** (production scheduler not implemented). |
| Observation close (demo/maint) | **`manufacturer_onboarding_maint_observation_close_as_of`** and batch close are **`bee_local_maint` EXECUTE only** (internal `orchestrate_observation_close`; **`bee_runtime` has no EXECUTE**). |

## Draft payload (JSONB)

Permitted keys on create/patch (merged in SQL): `cin`, `gstin`, `declarationAccepted`, `agreementAccepted`, `registeredAddress`, `authorisedSignatory`, `facilities`, `contacts`, `annexureNotes`. Create validates active manufacturer (`own-org`), membership, eligible organisation (`permittee_lifecycle = none`), and no other live application for that org.

## Document kinds (Annexure)

`trade_licence`, `certificate_of_incorporation`, `gst_certificate`, `pan_card`, `signatory_photo_id`, `facility_address_proof`, `signed_declaration`, `signed_agreement`, `annexure_supporting` — appended only via **`manufacturer_onboarding_trusted_append_document`**.

## API routes (Spring)

| Method | Route |
| --- | --- |
| GET | `/api/manufacturer-onboarding` |
| POST | `/api/manufacturer-onboarding` |
| GET | `/api/manufacturer-onboarding/{id}` |
| PATCH | `/api/manufacturer-onboarding/{id}` |
| GET | `/api/manufacturer-onboarding/{id}/submit` |
| POST | `/api/manufacturer-onboarding/{id}/submit` |
| POST | `/api/manufacturer-onboarding/{id}/director-decision` |
| POST | `/api/manufacturer-onboarding/{id}/anomalies` |
| POST | `/api/manufacturer-onboarding/{id}/anomaly-resolution` |
| GET | `/api/manufacturer-onboarding/{id}/documents` |
| POST | `/api/manufacturer-onboarding/{id}/documents` |

## BFF (browser, `x-bee-audience: browser`)

| Method | Route |
| --- | --- |
| GET/POST | `/api/runtime/manufacturer-onboarding` |
| GET/PATCH | `/api/runtime/manufacturer-onboarding/{id}` |
| GET/POST | `/api/runtime/manufacturer-onboarding/{id}/submit` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/director-decision` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/anomalies` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/anomaly-resolution` |
| GET/POST | `/api/runtime/manufacturer-onboarding/{id}/documents` |

Detail responses include `draft`, `documents`, `fee`, `payment`, `automatedChecks`, `lifecycle`, `directorDecision`, `permitteeActivation`, `observation`, and `anomalies` where applicable. Observation completion is **read-only** in the UI until BL-263.

## Runtime EXECUTE inventory (`bee_runtime`)

1. `manufacturer_onboarding_trusted_create`
2. `manufacturer_onboarding_trusted_patch_draft`
3. `manufacturer_onboarding_trusted_append_document`
4. `manufacturer_onboarding_orchestrate_submit`
5. `manufacturer_onboarding_orchestrate_director_decision`
6. `manufacturer_onboarding_orchestrate_raise_anomaly`
7. `manufacturer_onboarding_orchestrate_resolve_anomaly`

Idempotency: each command accepts a client **`Idempotency-Key`**; replays are keyed by derived `command_id` + canonical payload hash. **Separate anomaly episodes** require **separate keys** after the prior episode is resolved — there is no one-key-per-application assumption.

## Proof

`SnlWp03OptimizedManufacturerOnboardingDatabaseTest` — migration rank, trusted-boundary guards, create/patch/document commands, trade-licence gate, cross-org refusal, **seven-command** runtime EXECUTE inventory, idempotency replay/conflict proofs, **`runtimeDocumentUploadViaTrustedAppendWithoutDirectTableUpdate`**, maint observation close, happy path, model-submit guard.

## Deferred

- **BL-261** — Production identity/KYC (CIN/GSTIN, director KYC); local simulated checks only.
- **BL-262** — Real payment gateway + Finance exception queue.
- **BL-263** — External permittee registry sync and **production observation scheduler** (auto-close at day 15). Maint/batch close exists for demo only; **the production scheduler is not implemented**.
