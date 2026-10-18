# Manufacturer onboarding — BFF API contract (Brief B2)

Frontend adapter: `lib/manufacturer-onboarding/client.ts` (`ManufacturerOnboardingClient`).

- **Default:** real HTTP client (`lib/manufacturer-onboarding/httpClient.ts`) → browser routes under `/api/runtime/manufacturer-onboarding/**` (OpenAPI **0.37.1**).
- **Fixture only:** set `NEXT_PUBLIC_MANUFACTURER_ONBOARDING_FIXTURE=1` for `lib/manufacturer-onboarding/fixtureClient.ts` (isolated UI tests).
- Tests may inject `adapter` via `ManufacturerOnboardingClientOptions`.

Backend `state` maps to UI `phase` in `lib/manufacturer-onboarding/mapBackend.ts`. Every PATCH and command sends the current backend `version`. Observation is **read-only** in the browser (no observation-close route; BL-263).

## Browser routes (authoritative)

| Method | Path | Description |
|--------|------|-------------|
| GET, POST | `/api/runtime/manufacturer-onboarding` | List (server-scoped) / create (`legalName`, optional `draft`, `Idempotency-Key`) |
| GET, PATCH | `/api/runtime/manufacturer-onboarding/{id}` | Detail / save draft (`version`, `legalName`, `draft`) |
| GET, POST | `/api/runtime/manufacturer-onboarding/{id}/submit` | Submit preview / submit `{ "version": N }` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/director-decision` | `{ "version", "decision": "approve"\|"reject", "note" }` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/anomalies` | `{ "version", "reason" }` |
| POST | `/api/runtime/manufacturer-onboarding/{id}/anomaly-resolution` | `{ "version", "resolution": "cleared"\|"revoked", "note" }` |
| GET, POST | `/api/runtime/manufacturer-onboarding/{id}/documents` | List / multipart upload (`file`, `documentKind`, `label`, optional dates) |

**Not used:** `/applications/**`, `/director/queue`, `/monitoring/queue`, observation-close.

## Queue filtering (client)

Single authorized list GET, then filter:

- **Director queue:** `director_review`
- **Monitoring:** `active_observation`, `active`, `on_hold`
- **Applicant:** full server-scoped list (no extra client filter)

## Phase contract

| `phase` (`state`) | UI label (summary) |
|-------------------|-------------------|
| `draft` | Draft — not yet submitted |
| `submitted` | Submitted — processing |
| `automatic_checks_failed` | Automated rules check — action required |
| `director_review` | Awaiting Director decision |
| `active_observation` | Active — under 15-day observation |
| `active` | Active — observation completed |
| `on_hold` | On hold — anomaly under review |
| `rejected` | Registration rejected (pre-activation) |
| `revoked` | Revoked by Director (post-activation) |

Legacy aliases in `phaseMapping.ts`: `awaiting_director` → `director_review`, `hold_anomaly` → `on_hold`, `observation_completed` → `active`.

## Document kinds

`trade_licence`, `certificate_of_incorporation`, `gst_certificate`, `pan_card`, `signatory_photo_id`, `facility_address_proof`, `signed_declaration`, `signed_agreement`.

## Idempotency

Generate a **new** `Idempotency-Key` per distinct user action (create, submit, director decision, anomaly, resolution, upload). Reuse a key only when retrying the same in-flight payload.

## Fee

Provisional company-registration fee **₹5,000.00** (`REG:manufacturer_onboarding`); simulated payment verification on submit.

## Acceptance notes (B2)

- A3 backend accepted at commit `b378900`.
- B2 UI integrated — ChatGPT review pending.
- WP3 not complete until coordinated live smoke (not run in B2).
- BL-261, BL-262, BL-263 remain open.
