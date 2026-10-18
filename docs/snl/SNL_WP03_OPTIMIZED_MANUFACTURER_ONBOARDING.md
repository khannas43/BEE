# SNL WP03 — optimized manufacturer onboarding (backend slice)

**Status:** Implemented on branch `cursor/wp3-fast-manufacturer-onboarding-backend` (Flyway **V75** only). Provisional local rules, not BEE rules.

## Scope

Auditable manufacturer entity onboarding: draft application (JSONB payload), nine Annexure document kinds, fee snapshot, simulated auto-payment on submit, automated checks, director approve/reject, 15 calendar-day observation, permittee activation, finance/programme/**director** anomalies, director resolve/revoke, immutable events and command evidence.

## Backend authority (not UI copy)

| Rule | Source |
| --- | --- |
| Company registration fee | **₹5,000.00** from master fee rule `REG:manufacturer_onboarding` (version 1); submit orchestrator snapshots the rule — clients do not supply the amount. |
| Officer roles | Finance/Programme/Director actions use **role grants on the authenticated account** (`p_actor_role` / capability checks in SQL). Request bodies carry decisions and notes only, not role. |
| `rejected` vs `revoked` | **Reject** at `director_review` → terminal `rejected` (no permittee). **Revoke** via anomaly resolution `revoked` while on hold after activation path → terminal `revoked` + `organisation.permittee_lifecycle = revoked`. |
| Automated checks | Failed checks land in **`automatic_checks_failed`** (distinct from director reject). |
| Observation window | On **approve**, `started_on` and `observation_ends_on` are **15 calendar days from Director approval** (`decided_at` in IST), not from an arbitrary client clock. |
| Anomaly cleared after deadline | If `observation_ends_on` has passed, **cleared** resolves to **`active`** (closes observation, activates permittee), not back to `active_observation`. Within the window, cleared returns to `active_observation`. |
| `tradeLicenceUploaded` | **True only** when a **`trade_licence`** document version exists; other uploads do not satisfy the gate. |
| Trusted writes | `bee_runtime` has **SELECT** on application/evidence reads and **EXECUTE** on documented commands only — no direct INSERT/UPDATE on application, events, or document tables. SECURITY DEFINER commands run as the migration owner; **`bee.mob_trusted` is not used**. |
| Observation close (production API) | Applicant/authenticated close when calendar day ≥ `observation_ends_on` and no open anomaly. **`asOf` is refused** on the production route. |
| Observation close (demo/maint) | **`manufacturer_onboarding_maint_observation_close_as_of`** and batch close are **`bee_local_maint` EXECUTE only** for rehearsal and data repair — not the browser contract. |

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
| POST | `/api/manufacturer-onboarding/{id}/observation/close` |
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
| POST | `/api/runtime/manufacturer-onboarding/{id}/observation/close` |
| GET/POST | `/api/runtime/manufacturer-onboarding/{id}/documents` |

Detail responses include `draft`, `documents`, `fee`, `payment`, `automatedChecks`, `lifecycle`, `directorDecision`, `permitteeActivation`, `observation`, and `anomalies` where applicable.

## Runtime EXECUTE inventory (`bee_runtime`)

1. `manufacturer_onboarding_trusted_create`
2. `manufacturer_onboarding_trusted_patch_draft`
3. `manufacturer_onboarding_trusted_append_document`
4. `manufacturer_onboarding_orchestrate_submit`
5. `manufacturer_onboarding_orchestrate_director_decision`
6. `manufacturer_onboarding_orchestrate_raise_anomaly`
7. `manufacturer_onboarding_orchestrate_resolve_anomaly`
8. `manufacturer_onboarding_orchestrate_observation_close`

Idempotency: each command accepts a client **`Idempotency-Key`**; replays are keyed by derived `command_id` + payload hash. **Separate anomaly episodes** require **separate keys** after the prior episode is resolved — there is no one-key-per-application assumption.

## Proof

`SnlWp03OptimizedManufacturerOnboardingDatabaseTest` — migration rank, trusted-boundary guards, create/patch/document commands, trade-licence gate, cross-org refusal, runtime EXECUTE inventory, repeated anomaly idempotency, happy path, model-submit guard.

## Deferred

- **BL-261** — Production identity/KYC (CIN/GSTIN, director KYC); local simulated checks only.
- **BL-262** — Real payment gateway + Finance exception queue.
- **BL-263** — External permittee registry sync and **production observation scheduler** (auto-close at day 15). Maint/batch close exists for demo only; **the production scheduler is not implemented**.
