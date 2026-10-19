# SNL WP03 — optimized manufacturer onboarding (backend slice)

**Status:** **Brief WP3-D1 (19 Oct 2026) is the current owner-approved activation policy for new manufacturer applications.** Guest public signup plus Director-gated activation is implemented with **V78**. Successful payment and automated checks still run automatically, but the application **stops at `director_review`**; Director approval activates the organisation, issues the permittee number and starts the 15-day IST observation. **V77 automatic-activation records are historical evidence and are not rewritten.** C2/V77 automatic activation is superseded for new registrations only. Production identity/payment and external-registry gaps remain **BL-261–263**. Provisional local rules, not BEE rules.

## Scope

Auditable manufacturer entity onboarding: public guest signup (simulated OTP), draft application (JSONB payload), nine Annexure document kinds, fee snapshot, simulated auto-payment on submit, automated checks, Director review/return/reject/approve, permittee activation on Director approval, 15-calendar-day observation, Finance/Programme/Director anomaly flags, immediate hold, Director clear/revoke, scheduled clean-window completion, immutable events and command evidence.

## Backend authority (not UI copy)

| Rule | Source |
| --- | --- |
| Company registration fee | **₹5,000.00** from master fee rule `REG:manufacturer_onboarding` (version 1); submit orchestrator snapshots the rule — clients do not supply the amount. |
| Officer roles | Finance/Programme/Director actions use **role grants on the authenticated account** (`p_actor_role` / capability checks in SQL). Request bodies carry decisions and notes only, not role. |
| Cancellation authority | Before activation the Director may **return** or **reject** with a reason of at least 8 characters; the manufacturer stays inactive. After Director approval, an anomaly applies an immediate hold; the Director may clear it or **revoke** with a recorded reason. |
| Automated checks | Failed checks land in **`automatic_checks_failed`** (distinct from director reject). Resubmit records **`from_state`** from the persisted current state (not always `draft`). |
| Observation window | On **Director approval**, `started_on` and `observation_ends_on` are **15 calendar days from the persisted approval instant in IST**, not from a client clock. Historic V77 rows keep the automatic-activation instant they already stored. |
| Anomaly cleared after deadline | If `observation_ends_on` has passed, **cleared** resolves to **`active`** (closes observation, activates permittee), not back to `active_observation`. Within the window, cleared returns to `active_observation`. |
| `tradeLicenceUploaded` | **True only** when a **`trade_licence`** document version exists; other uploads do not satisfy the gate. |
| Trusted writes | `bee_runtime` has **SELECT** on application/evidence reads and **EXECUTE** on documented commands only — no direct INSERT/UPDATE on application, events, or document tables. SECURITY DEFINER commands run as the migration owner; **`bee.mob_trusted` is not used**. |
| Document upload pre-check | Spring reads application **state** with an ordinary **SELECT** (no row lock). **`manufacturer_onboarding_trusted_append_document`** locks the row, checks org ownership and editable state, and appends the version atomically. |
| Command idempotency | Each orchestrator serializes on `command_id`, compares application, purpose and a **database-canonical** payload hash, replays stored results (even after later lifecycle moves), and raises **`idempotency_key_conflict`** on cross-application, cross-purpose or changed-payload reuse. Spring maps SQL `23505` / `idempotency_key_conflict` to HTTP **409**. |
| Submit actor | Submit requires active **manufacturer** membership on the application organisation; forged role/org actors are refused before payment or evidence writes. |
| Observation close | **No browser or Spring API** for manual observation close. A Spring scheduler invokes the constrained database command after day 15; only clean `active_observation` rows without an open anomaly become `active`. Maint-only proof helpers remain available for controlled testing. |

## Draft payload (JSONB)

Permitted keys on create/patch (merged in SQL): `cin`, `gstin`, `declarationAccepted`, `agreementAccepted`, `registeredAddress`, `authorisedSignatory`, `facilities`, `contacts`, `annexureNotes`. Create validates active manufacturer (`own-org`), membership, eligible organisation (`permittee_lifecycle = none`), and no other live application for that org.

## Document kinds (Annexure)

`trade_licence`, `certificate_of_incorporation`, `gst_certificate`, `pan_card`, `signatory_photo_id`, `facility_address_proof`, `signed_declaration`, `signed_agreement`, `annexure_supporting` — appended only via **`manufacturer_onboarding_trusted_append_document`**.

## API routes (Spring)

| Method | Route |
| --- | --- |
| POST | `/api/public/manufacturer-signup` |
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
| POST | `/api/runtime/public/manufacturer-signup` |
| GET/POST | `/api/runtime/manufacturer-onboarding` |
| GET/PATCH | `/api/runtime/manufacturer-onboarding/{id}` |
| GET/POST | `/api/runtime/manufacturer-onboarding/{id}/submit` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/director-decision` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/anomalies` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/anomaly-resolution` |
| GET/POST | `/api/runtime/manufacturer-onboarding/{id}/documents` |

Detail responses include `draft`, `documents`, `fee`, `payment`, `automatedChecks`, `lifecycle`, `permitteeActivation`, `observation`, and `anomalies` where applicable. New successful submissions enter `director_review`. The Director queue lists those registrations and records approve / return / reject. V77 automatic-activation rows stay as history.

## Runtime EXECUTE inventory (`bee_runtime`)

1. `manufacturer_onboarding_trusted_create`
2. `manufacturer_onboarding_trusted_patch_draft`
3. `manufacturer_onboarding_trusted_append_document`
4. `manufacturer_onboarding_orchestrate_submit`
5. `manufacturer_onboarding_orchestrate_director_decision`
6. `manufacturer_onboarding_orchestrate_raise_anomaly`
7. `manufacturer_onboarding_orchestrate_resolve_anomaly`
8. `manufacturer_onboarding_orchestrate_public_signup`
9. `manufacturer_onboarding_system_close_expired_observations` (scheduler only; no browser route)

Idempotency: each command accepts a client **`Idempotency-Key`**; replays are keyed by derived `command_id` + canonical payload hash. **Separate anomaly episodes** require **separate keys** after the prior episode is resolved — there is no one-key-per-application assumption.

## Proof

`SnlWp03OptimizedManufacturerOnboardingDatabaseTest` — Flyway rank **78**; pinned definer search paths; trusted-boundary guards; public signup + cleanup; submit → `director_review`; Director approve/return/reject; historic V77 `automatic_activation` rows retained; create/patch/document commands; trade-licence gate; cross-org refusal; runtime command inventory; idempotency replay/conflict proofs; anomaly hold/clear/revoke; anomaly refusal after day 15; scheduler close after day 15; model-submit guard.

Live browser proof (`scripts/demo/c1-manufacturer-onboarding-journey.cjs`) waits for a coordinated window so V78 can be applied on the shared ngrok/demo stack without restarting it from this worktree. Isolated database tests are the gate until then.

## Deferred

- **BL-261** — Production identity/KYC (CIN/GSTIN, director KYC); local simulated checks only.
- **BL-262** — Real payment gateway + Finance exception queue.
- **BL-263** — External permittee registry sync remains deferred. The in-portal day-15 scheduler is implemented in V77/Spring; external registry synchronization remains open.
