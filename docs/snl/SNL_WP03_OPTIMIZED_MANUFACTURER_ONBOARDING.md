# SNL WP03 — optimized manufacturer onboarding (backend slice)

**Status:** Implemented on branch `cursor/wp3-fast-manufacturer-onboarding-backend` (Flyway **V75** only). Provisional local rules, not BEE rules.

## Scope

Auditable manufacturer entity onboarding: draft application, trade-licence document versions, fee snapshot, simulated auto-payment on submit, automated checks, director approve/reject, 15 calendar-day observation, permittee activation, finance/programme anomalies, director resolve/revoke, immutable events and command evidence.

## Backend authority (not UI copy)

| Rule | Source |
| --- | --- |
| Company registration fee | **₹5,000.00** from master fee rule `REG:manufacturer_onboarding` (version 1); submit orchestrator snapshots the rule — clients do not supply the amount. |
| Officer roles | Finance/Programme/Director actions use **role grants on the authenticated account** (`p_actor_role` / capability checks in SQL). Request bodies carry decisions and notes only, not role. |
| `rejected` vs `revoked` | **Reject** at `director_review` → terminal `rejected` (no permittee). **Revoke** via anomaly resolution `revoked` while on hold after activation path → terminal `revoked` + `organisation.permittee_lifecycle = revoked`. |
| Automated checks | Failed checks land in **`automatic_checks_failed`** (distinct from director reject). |
| Observation window | On **approve**, `started_on` and `observation_ends_on` are **15 calendar days from Director approval** (`decided_at` in IST), not from an arbitrary client clock. |
| Anomaly cleared after deadline | If `observation_ends_on` has passed, **cleared** resolves to **`active`** (closes observation, activates permittee), not back to `active_observation`. Within the window, cleared returns to `active_observation`. |

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
| POST | `/api/manufacturer-onboarding/{id}/documents` |

BFF: `/api/runtime/manufacturer-onboarding/**` (list, create, read, patch, submit).

## Example JSON (create → submit)

```json
POST /api/manufacturer-onboarding
Idempotency-Key: 7b2c…
{ "legalName": "Onboard Manufacturing Pvt Ltd" }

→ 201
{
  "id": "…",
  "reference": "MOB/2026/00001",
  "organisationId": "00000000-0000-4000-b000-000000000007",
  "legalName": "Onboard Manufacturing Pvt Ltd",
  "state": "draft",
  "version": 0,
  "tradeLicenceUploaded": false,
  "createdAt": "…"
}
```

```json
POST /api/manufacturer-onboarding/{id}/submit
Idempotency-Key: c4e1…
{ "version": 0 }

→ 200 (checks pass, simulated payment)
{
  "state": "director_review",
  "version": 2,
  "outcome": "director_review",
  "paymentId": "…"
}
```

## Migration objects (V75 summary)

- `organisation.permittee_lifecycle`
- `manufacturer_onboarding_application` (+ allocator, events, fee snapshot, payment link, automated checks, documents/versions, director decision, permittee activation, observation, anomaly, command evidence)
- Orchestrators: `manufacturer_onboarding_orchestrate_submit`, `_director_decision`, `_raise_anomaly`, `_resolve_anomaly`, `_observation_close`
- Extended `model_application_guard` for permittee on_hold/revoked
- Capabilities: `manufacturer_onboarding_director`, `manufacturer_onboarding_anomaly`

## Proof

`SnlWp03OptimizedManufacturerOnboardingDatabaseTest` — migration rank, check failure, happy path, idempotency, runtime evidence denial, model-submit guard, anomaly cycle, director segregation.

## Deferred

Production identity verification, real payment gateway, external registry sync, observation scheduler job — see `docs/BACKLOG.md`.
