# Manufacturer onboarding — expected API contract (Agent A)

Frontend adapter: `lib/manufacturer-onboarding/client.ts` (`ManufacturerOnboardingClient`). Set `NEXT_PUBLIC_MANUFACTURER_ONBOARDING_API=1` when the BFF routes below exist. Until then the fixture client in `lib/manufacturer-onboarding/fixtureClient.ts` is used.

All times ISO-8601 UTC; UI displays Asia/Kolkata. Demo applicant account: `onboarding.applicant`.

## Resources

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/manufacturer-onboarding/applications` | Applicant | List summaries scoped to caller org |
| GET | `/api/manufacturer-onboarding/applications/{id}` | Applicant, Director, Finance, Programme | Full application (Spring scopes fields by role) |
| PUT | `/api/manufacturer-onboarding/applications/{id}/draft` | Applicant | Save wizard draft (`ManufacturerDraft` body) |
| POST | `/api/manufacturer-onboarding/applications/{id}/submit` | Applicant | Submit → simulated payment + automated checks + `awaiting_director` |
| GET | `/api/manufacturer-onboarding/director/queue` | Director | Applications in `awaiting_director` |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/approve` | Director | Approve → activate + 15-day observation window |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/reject` | Director | Reject → `revoked` (body: `{ "reason": string }`, required) |
| GET | `/api/manufacturer-onboarding/monitoring/queue` | Director, Finance, Programme | Observation / hold / completed observation |
| POST | `/api/manufacturer-onboarding/applications/{id}/anomalies` | Finance, Programme, Director | Raise anomaly → immediate `hold_anomaly` (body: `{ "summary": string }`) |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/resolve` | Director | Clear hold → `active_observation` (body: `{ "note": string }`) |
| POST | `/api/manufacturer-onboarding/applications/{id}/director/revoke` | Director | Revoke → terminal `revoked` (body: `{ "reason": string }`) |

## JSON shape (core)

Matches `ManufacturerApplication` in `lib/manufacturer-onboarding/types.ts`:

- `phase`: `draft` \| `awaiting_director` \| `active_observation` \| `hold_anomaly` \| `observation_completed` \| `revoked`
- `payment.gatewayMode`: `simulated_demo` until live gateway wired
- `payment.verifiedAt` set on submit (automatic verification)
- `automatedChecks[]` populated on submit (automatic rules check — not external DB/AI)
- `observationStartedAt` / `observationEndsAt` set on Director approve (15 calendar days)
- `syntheticDemo`: boolean — true for seeded Aarav fixture rows

## Status labels (UI mapping)

Server `phase` drives UI copy:

- Payment verified → **Automatically verified payment**
- Checks complete → **Automated rules check**
- `awaiting_director` → **Awaiting Director decision**
- `active_observation` → **Active — under 15-day observation**
- `hold_anomaly` → **On hold — anomaly under review**
- `observation_completed` → **Active — observation completed**
- `revoked` → **Revoked by Director**
