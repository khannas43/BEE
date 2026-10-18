# SNL WP02B — return, applicant response and review-task wiring

**Status:** Umbrella design recorded; Briefs 19A and 19B accepted; **Brief 19B-2 implemented (ChatGPT review pending)**; Briefs 19C–19D remain.
**Depends on:** WP2A merge `80b1da7`, `WorkflowFoundationRepository`, V69 command functions.
**Migration sequence:** V70 starts the policy and generic notification foundation; later migrations wire model and registration journeys. V69 remains unchanged.

## Delivery slices

| Slice | Scope | Status |
| --- | --- | --- |
| 19A | V70 provisional A08 policy + generic replay-safe in-portal notification foundation | Accepted (`64accd5` plus acceptance corrections) |
| 19B | Model return/resubmit/response wiring | Accepted (V71 trusted orchestrate commands + `WorkflowReturnResponseWiring`; see `SNL_WP02B_MODEL_RETURN_WIRING.md`) |
| 19B-2 | Model stage-forward closure + repeat-cycle safety | **Review pending** (V72: cycle/return binding with revoked `bind_cycle_return`, enforced forward map + stored event time, structural constraints, post-legacy service 409 proofs; see `SNL_WP02B_MODEL_RETURN_WIRING.md`) |
| 19C | Registration return/resubmit/response wiring | Planned |
| 19D | Common read projection, consolidated concurrency/rollback proof and plan evidence | Planned |

## Integration map (return / resubmit loop)

| Journey | Legacy command | Transaction owner | State before → after | Common task (stage/action) | Clock | Discrepancy | Notification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Registration | `POST …/registrations/{id}/transition` `return` | `RegistrationReviewService` | `programme_review` / `director_approval` → `returned` | `programme_review` or `director_approval` / `review` (open) | start + pause (applicant) | open `return_response` line | applicant org (V70) |
| Registration | same route `resubmit` | `RegistrationReviewService` | `returned` → `programme_review` | same task (replay owner) | resume | response N | assigned officer (V70) |
| Registration | `recommend` / `approve` after resubmit | `RegistrationReviewService` | forward states | task stays open | running | disposition `accepted` | — |
| Model | `POST …/model-applications/{id}/return` | `StageReturnService` → `StageReturnRepository` + `WorkflowReturnResponseWiring` | `{stage}` → `returned` | `{fromState}` / `review` | start + pause | open `return_response` | applicant once inside the V71 trusted orchestrate command |
| Model | `POST …/model-applications/{id}/resubmit` | `ResubmitApplicationService` + wiring | `returned` → `{resumed}` | same stage task | resume | response N | database-resolved officer inside the V71 trusted orchestrate command |
| Model | next forward at stage | `IameRecommendationService`, `ReviewerForwardService`, `RatingService`, `DirectorRecommendationService`, `SecretaryApprovalService` + `WorkflowReturnResponseWiring.afterAcceptedForward` | varies | task **completed** when open return cycle present | **stop** | `accepted` on forward; `needs_more` on re-return before forward | — |

Officer **re-return** after resubmit: disposition `needs_more` on the undisposed response, then pause clock again (same discrepancy, next cycle).

## Transaction boundary

`WorkflowReturnResponseWiring` (Spring `@Component`, called only from existing `@Transactional` services/repositories above) performs all WP2 writes via `WorkflowFoundationRepository` in the **caller's transaction**. No controller multi-step writes. Failure in wiring rolls back legacy rows and notifications.

## Command IDs and replay

Deterministic UUID v5-style: `UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + subjectId).getBytes(UTF_8))` for purposes `task`, `return`, `resubmit`, `accept`. Same key + same payload replays; hash mismatch → `WorkflowIdempotencyConflictException` surfaced as HTTP 409 on the owning route.

## Policy selection (provisional A08)

V70 seeds `workflow_sla_policy_version` key `snl_return_response` version 1, effective from portal epoch, **7 working days**, note `provisional A08 / BL-255`. Selected by `Asia/Kolkata` date at return anchor; due via `WorkingDaySla.dueAtEndOfWorkingDay`. Not hard-coded in Java.

## V70 foundation objects (19A)

| Object | Role |
| --- | --- |
| `workflow_sla_policy_version` row `snl_return_response` v1 | Idempotent seed; sole source of the 7-day limit; migration refuses a conflicting pre-existing v1 row |
| `SnlReturnResponsePolicyRepository` | Exactly-one applicable version + due calculation |
| `notification.subject_kind` / `subject_id` | Polymorphic subject; model rows keep `application_id = subject_id`; registration rows have `application_id` null |
| `notification_command` + `notification_foundation_deliver` | Replay-safe fan-out; payload hash covers subject, kind and message suffix; advisory lock on `command_id`; `delivered_at` makes a zero-recipient result final |
| `app_disposable_registration_cleanup` | Maint-only cleanup for throwaway registration tests |
| `NotificationCommandRepository` | Java entry to `notification_foundation_deliver` only |

`NotificationRepository.newest()` joins model or registration for `reference` and returns `COALESCE(application_id, subject_id)` as `applicationId` so the existing JSON shape is unchanged. Model V39 triggers populate subject columns; journey wiring in 19B–19C will call the command boundary instead of ad hoc inserts.

Acceptance re-ran the complete foundation gates: 160 default back-end tests, 299 database tests, 251 web tests and TypeScript checking all passed. The additional database proof fixes the zero-recipient edge case: later membership changes cannot turn a completed no-delivery command into a new delivery.

## Pre-migration applications

First wired command in a transaction **idempotently** creates the open review task (+ SLA bundle on return only). No bulk backfill.

## Privacy

Applicant notifications: reference, return reason, due date, required action only. Officer notifications on resubmit: reference and resubmit fact only — no internal notes.

## Deferrals (still WP2B / BL-257)

Registration wiring (19C), common public read API and consolidated proof (19D), BFF, UI, supervisor queue, 60-day job (BL-253), cancel/reject normalization (BL-256), and other non-return transitions. Model stage-forward closure (19B-2) is implemented and awaiting ChatGPT review before acceptance.
