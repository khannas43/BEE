# Manufacturer onboarding — expected API contract (Agent A)

Frontend adapter: `lib/manufacturer-onboarding/client.ts` (`ManufacturerOnboardingClient`).

- Default: fixture client (`lib/manufacturer-onboarding/fixtureClient.ts`).
- Live: set `NEXT_PUBLIC_MANUFACTURER_ONBOARDING_API=1` to use `lib/manufacturer-onboarding/httpClient.ts` (BFF routes below; no throw at module load).
- Integration may inject `adapter` via `ManufacturerOnboardingClientOptions` without changing UI components.

All times ISO-8601 UTC; UI displays Asia/Kolkata. Demo applicant: `onboarding.applicant` (seeded by Agent A).

## Phase contract

| `phase` | UI label (summary) |
|---------|-------------------|
| `draft` | Draft — not yet submitted |
| `submitted` | Submitted — processing |
| `automatic_checks_failed` | Automated rules check — action required |
| `director_review` | Awaiting Director decision |
| `active_observation` | Active — under 15-day observation |
| `active` | Active — observation completed |
| `on_hold` | On hold — anomaly under review |
| `rejected` | Registration rejected (pre-activation Director rejection) |
| `revoked` | Revoked by Director (post-activation, after anomaly) |

Legacy/cosmetic aliases normalized in the HTTP adapter (`lib/manufacturer-onboarding/phaseMapping.ts`): `awaiting_director` → `director_review`, `hold_anomaly` → `on_hold`, `observation_completed` → `active`.

On Director approve: `observationStartedAt` = approval instant; `observationEndsAt` = approval + 15 calendar days.

On Director resolve from hold: if now &lt; `observationEndsAt` → `active_observation`; else → `active`.

## Resources

| Method | Path | Role (Spring) | Description |
|--------|------|-----------------|-------------|
| GET | `/api/manufacturer-onboarding/applications` | Applicant | List summaries scoped to caller org |
| GET | `/api/manufacturer-onboarding/applications/{id}` | Applicant, Director, Finance, Programme | Full application (Spring row scope) |
| PUT | `/api/manufacturer-onboarding/applications/{id}/draft` | Applicant | Save wizard draft |
| POST | `/api/manufacturer-onboarding/applications/{id}/submit` | Applicant | Submit → payment + automated checks → `director_review` or `automatic_checks_failed` |
| GET | `/api/manufacturer-onboarding/director/queue` | Director | `director_review` only (not failed checks) |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/approve` | Director | Activate + observation window |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/reject` | Director | Pre-activation → `rejected` (body: `{ "reason": string }`) |
| GET | `/api/manufacturer-onboarding/monitoring/queue` | Director, Finance, Programme | Observation / hold / active |
| POST | `/api/manufacturer-onboarding/applications/{id}/anomalies` | Finance, Programme, Director | Body: `{ "summary": string }` only — **role derived from session** |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/resolve` | Director | Clear hold (body: `{ "note": string }`) |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/revoke` | Director | Post-activation terminal (body: `{ "reason": string }`) |

## JSON shape (core)

Matches `ManufacturerApplication` in `lib/manufacturer-onboarding/types.ts`.

- `payment.amountInr`: `"5000.00"` (provisional company registration fee, assumption A07 / S&L Manual §4.1)
- `payment.gatewayMode`: `simulated_demo` until live gateway wired
- `syntheticDemo`: boolean

## HTTP errors (adapter)

| Status | Adapter error kind | UI treatment |
|--------|-------------------|--------------|
| 401 | `session` | Sign-in required / retry |
| 403 | `forbidden` | Access denied message |
| 404 | `not_found` | Not found / empty |
| 422 | `validation` | Inline validation / form |
| 409 | `conflict` | Refresh and retry |
| 5xx / network | `unavailable` | Error state + retry |
