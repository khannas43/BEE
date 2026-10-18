# SNL WP02C — registration return / resubmit workflow (Brief 19C-0)

**Status:** Design and analysis only (19C-0). No migrations, Java, API, UI or tests implemented on this slice.
**Branch:** `cursor/snl-wp02c-registration-design`
**Base:** `main` @ `f732482` (post-Brief-19B implementation-plan record)
**Governing source:** *SnL Disha Advisory Manual* (`SnL_Disha_Advisory_Manual.pdf`, printed footer page numbers verified with `pdftotext` on 18 October 2026)
**Depends on:** WP2A (V69), policy/notifications (V70), model return pattern (V71, V72 pending acceptance — design stays compatible with V72 corrections, not assuming `ccd2b6a` unchanged)
**Related:** [SNL_WP02B_RETURN_RESPONSE.md](SNL_WP02B_RETURN_RESPONSE.md), [SNL_WP02B_MODEL_RETURN_WIRING.md](SNL_WP02B_MODEL_RETURN_WIRING.md), [SNL_WP01_STATE_MODELS.md](SNL_WP01_STATE_MODELS.md), [SNL_WP01_ROLE_MATRIX.md](SNL_WP01_ROLE_MATRIX.md), [SNL_WP01_FIELD_DICTIONARY.md](SNL_WP01_FIELD_DICTIONARY.md)

---

## 1. Current registration journey map (as-built)

Portal states and commands are **provisional local rules** (WP04.2b), not asserted BEE policy. Manual mapping uses **Assumption A03** (Programme recommend, Director approve) and **A02** (scrutiny → Programme officer for brand path).

| Step | Portal state / action | Actor | Persistence / API | Manual analogue (printed pp.) |
| --- | --- | --- | --- | --- |
| 1. Draft | `draft` | Applicant org (`manufacturer` / `agency`) | `POST/PATCH /api/registrations`, trade-licence PDF | §3 online application; signed/stamped uploads (§3, p. 22); Annexure 1 fields (pp. 50–53) — **mostly not captured** ([SNL_WP01_FIELD_DICTIONARY.md](SNL_WP01_FIELD_DICTIONARY.md)) |
| 2. Submit | `draft` → `fee_due` | Applicant | `POST …/submit`; `registration_submission_event`, `registration_fee_snapshot` (V43) | §3.1.1 company/brand registration; fee per §4.1 (p. 30) |
| 3. Fee confirmation | `fee_due` → `programme_review` | Finance (`finance` / `all`) | `POST …/fee-confirmation`; `RegistrationFeeService`; `registration_fee_confirmation` + transition event | §4 electronic payment (p. 30); **A16** auto-post target not built — manual confirm only |
| 4. Programme review | `programme_review` | Programme | `POST …/transition` `recommend` → `director_approval` or `return` → `returned` | Table 2 scrutiny/approval steps (pp. 28–29); hold grounds §3.4 brand (pp. 24–25) |
| 5. Director decision | `director_approval` | Director (`registration_approve`) | same route: `approve` → `approved` (+ `registration_approve()` writes brand/agency row), `return`, `reject` | **A03** maps to Director final approve; §3.4 reject/hold (pp. 24–25) |
| 6. Return | `returned` | Programme or Director (note required) | `registration_transition_event` only — **no** `registration_application_return`, **no** WP2 task/clock/discrepancy, **no** V70 notification in production path | §3.4 hold + portal communication (pp. 24–25); Table 2 rows 4–5 (p. 29) |
| 7. Applicant fix | `returned` (editable) | Applicant | `PATCH`, document new version; `refuseAtSubmit` gates | Revised documents (Table 2 row 5, p. 29); document sequence §3 (p. 22) |
| 8. Resubmit | `returned` → `programme_review` | Applicant | `transition` `resubmit` — **always** to `programme_review` (even if Director returned) | Applicant response after hold (§3.4, pp. 24–25); resubmit always re-enters Programme queue (local rule — **owner decision** if Director-return should skip Programme) |
| 9. Approval outcome | `approved` | Director | `registration_approve()` atomic register write | §3.1.1 unique company registration number (p. 22) — **not stored** on approval today (**A20**) |
| 10. Rejection | `rejected` | Director | transition + note | §3.4(a)–(e) (pp. 25–26) |
| 11. Notifications | — | — | Demo seed V68 `demo_message_org` only; **BL-171** — bell not wired for registration | §3.4 inform via portal (pp. 24–25); **A18** |

**Segregation (existing):** submitter, applicant org members, and recommender cannot approve; submitter and org cannot review (`RegistrationReviewService`, V44/V45 triggers, `registration_approve`).

**Repeat cycles:** Supported only as repeated `return` / `resubmit` transition pairs with a single free-text note per event — no discrepancy line codes, disposition, or SLA evidence.

---

## 2. Gap matrix (manual vs as-built vs target)

| Topic | Manual requirement | As-built (f732482) | Target (19C+) | Basis |
| --- | --- | --- | --- | --- |
| Hold communication deadline | §3.10: communicate discrepancies within **7 working days** (p. 28); Table 2 row 4: **12 days** (p. 29); Table 3 row 4: **15 days** (p. 30) | No SLA on registration return | Applicant due date from **`workflow_sla_policy_version` `snl_return_response`** (V70, provisional **A08** / **BL-255**) — not Java constants | §3.10; Tables 2–3; **A08**, **BL-255** |
| Applicant response window | Table 2 row 5: **60 days** from hold notice; auto-cancel + fee return (p. 29); §3.4(a): **reject** after 60 days no response (p. 25) | No job; no cancel vs reject split | **Defer** 60-day enforcement to BL-253 / **BL-256**; 19C only **surfaces** applicant deadline in notifications/read model where policy exists | Table 2 row 5; §3.4(a); **BL-256** |
| Structured discrepancies | §3.2 / §3.4: communicate discrepancies; checklist scrutiny (p. 24) | Single `note` on transition | `workflow_discrepancy` line `return_response` + optional future line codes (**A05**) | §3.2 (p. 24); §3.4 (pp. 24–25) |
| Portal notification on return/resubmit | §3.4 portal (and other modes) (pp. 24–25) | No production V70 path | `notification_foundation_deliver` in same transaction as return/resubmit orchestrate | §3.4; **A18** |
| Officer notification on resubmit | Implicit resume of scrutiny | None | Officer notify (Programme assignee or return actor — see §4) | **A02**, **A03** |
| Review task / clock pause | **A17**: working days; clock stops while awaiting applicant (§3.10, pp. 28–29) | None | Open task at `programme_review`/`director_approval` + `review`; clock **pause** on return, **resume** on resubmit | §3.10; **A17** |
| Multi-cycle return | Re-scrutiny after revised docs (Table 2 row 6, p. 29) | Allowed informally via states | Same task + discrepancy; disposition `needs_more` on re-return; **V72-style** cycle/`cycle_return` binding when model V72 accepted | Table 2 row 6; V72 pattern |
| Company registration fee | ₹5,000 §4.1 (p. 30) | REG fee rules + Finance confirm | Unchanged in 19C | §4.1 |
| Document checklist | Annexure 1-A enclosures (pp. 52–53); §3.1.1 list (p. 22) | Single trade-licence PDF | Unchanged in 19C; future WP3 expands evidence | Annexure 1; **A05** |
| Permittee number on approve | §3.1.1 (p. 22) | Brand/authorisation row only | Unchanged in 19C (**A20** / WP3) | §3.1.1 |
| Agency registration path | Manual silent | `kind=agency` | Same return/resubmit mechanics; notifications to filing agency org | **Conflict** — implementation-only |
| Category / model journeys | §3.1.2–§3.3, Annexure 3 (pp. 23–24, 56–57) | Model wired in 19B; category absent | Registration scope = brand/agency only in 19C | §3.1.2–§3.3 |

---

## 3. Target state and transition table (return / resubmit)

Legacy **`registration_application.state`** remains authoritative for API compatibility. WP2 rows are parallel (`subject_kind = registration_application`).

### 3.1 Legacy state transitions (unchanged)

| From | Action | Actor | To | Guard |
| --- | --- | --- | --- | --- |
| `programme_review` | `return` | Programme | `returned` | Note 1–500 chars; version match; segregation |
| `director_approval` | `return` | Director | `returned` | Same |
| `returned` | `resubmit` | Applicant | `programme_review` | No note; submit gates; segregation |
| `programme_review` | `recommend` | Programme | `director_approval` | After resubmit, may disposition discrepancy `accepted` (19C-C) |
| `director_approval` | `approve` / `reject` | Director | `approved` / `rejected` | Existing `registration_approve` for approve |

No new public states in 19C (no `cancelled_auto` until BL-253/BL-256 policy).

### 3.2 WP2 overlay per transition

| Legacy transition | WP2 effects (target) |
| --- | --- |
| First entry `programme_review` (fee confirm) | **Lazy** (19C-B): idempotent open `workflow_task` (`stage=programme_review`, `action=review`, `owner_role=programme`) — no SLA until return unless policy extended |
| `return` from `programme_review` | Orchestrated bundle: durable **return row** linked to transition event; applicant **notification** (reason + policy due date); open/update discrepancy; **start+pause** SLA clock on existing or new task; **cycle** insert (first) or re-return disposition `needs_more` + pause (repeat) |
| `return` from `director_approval` | Same with `stage=director_approval`, `owner_role=director`; store **returned_from_stage** for officer resolution on resubmit |
| `resubmit` | Orchestrated bundle: **resubmission row**; append discrepancy **response**; **resume** clock; officer **notification**; wiring evidence; validate open cycle + matching return |
| `recommend` / `approve` after clean review | Disposition `accepted` on latest undisposed response; complete task or leave open until approve — **19C-C** aligns with model forward closure pattern |

### 3.3 Repeated discrepancy cycles

Mirror accepted **V72** model semantics (pending ChatGPT review):

- One **open** cycle per application (`status=open`); `cycle_seq` monotonic; `model_return_response_cycle_return` analogue binds **each** return id to the cycle.
- Re-return after resubmit: disposition **`needs_more`** on current response seq, clock **pause**, new return row appended to cycle — **not** a new discrepancy line.
- Officer resubmit notify uses **return id + resumed stage** (`programme_review` after resubmit) and persisted resubmission row.

**Registration-specific rule:** `resumed_stage` after resubmit is always **`programme_review`** (legacy target in `RegistrationReviewService.target()`). Officer notification recipient:

- If the **latest return** in the cycle was from **`director_approval`**, notify the **Director account who returned** (same as model director/secretary rule in V71).
- Else resolve **single active Programme assignee** for subject `registration_application` — if none or ambiguous → orchestrate **rolls back** (409 `assignee_unavailable`).

---

## 4. Actor and recipient rules

| Event | Acting role | Who may act | Notification recipient | Message content (max) |
| --- | --- | --- | --- | --- |
| Return | `programme` or `director` | Role at current state; not submitter; not applicant org member | **All active users in filing organisation** via V70 org fan-out (`subject_kind=registration_application`) | Reference, reason, respond-by date (policy due), edit/resubmit instruction — **no** officer identity (**A18**, Brief 19 privacy) |
| Resubmit | Applicant (`manufacturer` / `agency` per kind) | Filing org only | **Officer** resolved per §3.3 | Reference + resubmitted fact — **no** applicant note in officer message unless policy adds neutral body |
| Recommend / approve | Programme / Director | Existing segregation | — (19C) | — |
| Reject | Director | Existing | Optional future applicant notify — **defer** (not 19C scope) | §3.4 (pp. 25–26) |

**Supervisor / designated agency:** Manual **§3.2** (p. 24) names designated agency for **model** scrutiny only. Brand registration scrutiny is **Assumption A02** mapped to **Programme** — no separate supervisor queue in 19C (**BL-257** deferral).

---

## 5. Proposed trusted database-command boundary

Follow **V71/V72** split: only **`registration_return_response_orchestrate_wired_return`** and **`registration_return_response_orchestrate_resubmit`** granted to **`bee_runtime` EXECUTE**; internal helpers **REVOKE EXECUTE** from runtime.

**Transaction owner:** `@Transactional` on **`RegistrationReviewService.transition`** (unchanged). After legacy `registrations.transition()` / before idempotency complete, call **`RegistrationReturnResponseWiring`** (new component, parallel to `WorkflowReturnResponseWiring`) → repository → orchestrate functions in the **same** transaction. On wiring failure: `setRollbackOnly()` before mapped HTTP errors (same pattern as `StageReturnService`).

**Idempotency (HTTP layer):** unchanged `idempotency_record` on `POST /api/registrations/{id}/transition`.

**Idempotency (WP2 layer):**

- `command_id = UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + registrationId).getBytes(UTF_8))` with purposes e.g. `registration_return_notify`, `registration_return_wiring`, `registration_resubmit_wiring`, `registration_resubmit_notify`.
- Wiring evidence table **`registration_return_response_wiring_evidence`** (`command_id` PK, `purpose`, `payload_hash`) — immutable except maint delete.
- Orchestrate functions: **ON CONFLICT** / evidence guard → replay without duplicate notifications or task rows.

**New durable rows (proposed — migration number assigned only after V72 accepted):**

| Object | Purpose |
| --- | --- |
| `registration_application_return` | Return id, `application_id`, `from_state`, `reason`, `returned_by`, `transition_event_id`, optional `foundation_notify_command_id` |
| `registration_application_resubmission` | Resubmission id, `return_id`, `resumed_state`, `transition_event_id`, optional note (registration API keeps resubmit **without** note — body may be neutral constant) |
| `registration_return_response_cycle` | Align with **V72** columns when merged: `cycle_seq`, `status`, `review_stage`, `task_id`, `discrepancy_id`, `last_resumed_stage`, closure fields |
| `registration_return_response_cycle_return` | Many returns per cycle |
| `registration_return_response_wiring_evidence` | Proof / replay |

**Internal functions (names indicative):** `registration_return_response_insert_return`, `link_cycle`, `append_response`, `officer_resubmit_notify`, `resolve_officer`, `record_wiring_evidence` — same security model as [SNL_WP02B_MODEL_RETURN_WIRING.md](SNL_WP02B_MODEL_RETURN_WIRING.md).

**Runtime table access:** REVOKE direct INSERT on return table; SELECT-only on cycle/evidence where applicable.

---

## 6. Task, clock, discrepancy, response, disposition and notification lifecycle

| Phase | Task (`workflow_task`) | Clock (`workflow_sla_clock`) | Discrepancy | Notification |
| --- | --- | --- | --- | --- |
| Fee confirmed → `programme_review` | Open `programme_review`/`review` (lazy create) | None until first return | — | — |
| Return | Stays **open** | **Start** at return anchor; **pause** (applicant responsibility) using policy `snl_return_response` v1 | Open `return_response` summary = reason (truncated) | Applicant **`returned`** via `notification_foundation_deliver` |
| Applicant editing | — | Stays paused | Open | — |
| Resubmit | Same task id | **Resume** | Append **response** seq N (body neutral or document-change summary later) | Officer **`applicant_resubmitted`** |
| Programme recommends | Open → complete or stay open per 19C-C | **Stop** or complete on forward — align model 19B-2 | Disposition **`accepted`** on seq N | — |
| Re-return | Same task | Pause again | Disposition **`needs_more`** on seq N; new return row | Applicant notify again with new due date |
| Reject / approve terminal | **Complete** / cancel task | **Stop** | Close discrepancy | Defer reject notify |

Clock events append only through **`workflow_foundation_append_clock_event`** (V69). Policy anchor = **`returnedAt`** instant; version chosen by **`SnlReturnResponsePolicyRepository`** at **Asia/Kolkata** date (**A08** note in DB, not code).

---

## 7. Working-day SLA behaviour (provisional A08)

- **Source of truth:** row `policy_key = snl_return_response` in `workflow_sla_policy_version` (V70), note **`provisional A08 / BL-255; not confirmed by BEE`**.
- **Applicant respond-by:** `WorkingDaySla.dueAtEndOfWorkingDay(returnAnchor, working_day_limit)` — limit read from applicable version row, **not** hard-coded 7, 12, or 15 in Java.
- **Officer-side Table 2 rows 3, 6 (30 / 12 days):** **not** seeded in 19C unless owner adds separate policy keys — tasks without policy remain non-SLA.
- **Pause while awaiting applicant:** **A17** — enforced by pause/resume clock events on return/resubmit, not by counting wall-clock while in `returned`.
- **Conflicting manual tables:** Document in UI copy as provisional; **BL-255** remains open.

---

## 8. Proposed migration changes (no number until V72 accepted)

1. Add registration return/resubmission/cycle/evidence tables and immutability triggers (mirror V71+V72 corrections).
2. Add orchestrate and internal DEFINER functions; grant EXECUTE on orchestrates only to `bee_runtime`.
3. Optional: column on `registration_transition_event` FK to return/resubmission ids for audit (read-only join) — only if transition insert stays in Java repository.
4. **Do not** alter V43–V48, V69–V72 in place.
5. **Do not** assign Flyway version until V72 acceptance is recorded (next number after accepted chain).
6. **Compatibility:** pre-19C applications — first wired return/resubmit **lazy-creates** task + cycle like model `lazyLinksPreV71OpenReturnOnFirstWiredResubmit` test.

---

## 9. Integration points in `RegistrationReviewService`

File: `backend/src/main/java/gov/bee/api/registration/RegistrationReviewService.java`

| Hook | When | Behaviour |
| --- | --- | --- |
| After successful `registrations.transition` for `return` | `toState=returned` | Resolve `transition_event_id`, call wiring `completeWiredReturn(registrationId, returnId, …)` with idempotency key from HTTP header |
| After successful `transition` for `resubmit` | `toState=programme_review` | Insert/get resubmission id; `afterResubmit(…)` |
| Before return/resubmit | Validation only | No WP2 writes |
| `approve` path | Unchanged in 19C-A/B | Disposition closure in 19C-C |
| Failure handling | `DataAccessException` / conflict | Map wiring idempotency conflict → 409; rollback legacy transition |
| Dependencies | Inject `RegistrationReturnResponseWiring` + policy repo | Keep controller thin |

**Not in 19C:** fee confirmation (`RegistrationFeeService`), document upload, list/get trail shaping (trail stays; optional future append WP2 summary).

---

## 10. Common read projection (for 19D)

Internal repository (no new OpenAPI in 19C), subject key `(registration_application, id)`:

| Field group | Contents |
| --- | --- |
| Task | Open task id, `stage`, `action`, `owner_role`, `owner_account_id`, `version`, `due_at` |
| Clock | `state` (`running`/`paused`/`stopped`), `policy_version_id`, anchor, overdue flag, ordered `workflow_sla_clock_event` |
| Discrepancy | Open line codes, `summary`, status, latest `response_seq`, latest disposition |
| Cycle | `cycle_seq`, `status`, `review_stage`, `last_resumed_stage`, linked return ids |
| Notifications | Latest delivered commands for applicant/officer kinds (optional join) |
| Evidence | Wiring evidence rows for concurrency audits |

Registration GET may later embed a subset; 19C only ensures writes populate data **19D** tests can read.

---

## 11. Test matrix (registration-specific)

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | First Programme return | One task, clock paused, discrepancy open, one applicant notification, cycle seq 1 |
| 2 | Policy due date | Due date matches persisted calendar + version limit (not Java constant) |
| 3 | Resubmit | Response seq 1, clock resumed, officer notify to Programme assignee |
| 4 | Director return → resubmit | Officer notify to returning Director; resumed state `programme_review` |
| 5 | Double cycle | One task; disposition `needs_more`; two returns bound to cycle; contiguous response seq |
| 6 | Replay same idempotency | Single evidence row; `Idempotency-Replayed` on HTTP; no duplicate notifications |
| 7 | Changed payload same key | 409 `idempotency_key_conflict` (HTTP) / wiring hash conflict |
| 8 | Concurrent return | One complete outcome; one conflict |
| 9 | Concurrent resubmit | One complete outcome |
| 10 | Wiring failure mid-orchestrate | Legacy transition rolled back; no orphan notification |
| 11 | Assignee unavailable | 409; full rollback |
| 12 | Segregation | Applicant cannot return; submitter cannot review; recommender cannot approve (existing + unchanged) |
| 13 | Role separation resubmit | Only filing org resubmit |
| 14 | Recipient resolution | Inactive/officer ambiguous → rollback |
| 15 | Stale version / wrong state | No WP2 writes |
| 16 | Runtime tampering | Runtime cannot INSERT return/evidence/cycle directly; cannot forge orchestrate parameters |
| 17 | Pre-wiring application | Lazy task + cycle on first wired resubmit |
| 18 | Repeat return after recommend blocked | State machine rejects illegal legacy move before wiring |

Implement as `SnlWp02cRegistrationReturn*DatabaseTest` + service tests mirroring `SnlWp02bModelReturnServiceDatabaseTest` groups.

---

## 12. PDF traceability table

Verified with `pdftotext` from `/Users/sameerkhanna/Documents/Documents/BEE/SnL_Disha_Advisory_Manual.pdf` (18 Oct 2026).

| Manual reference | Printed p. | Topic used in this design |
| --- | --- | --- |
| §1.3.5 (a)–(g) | 15–16 | Permittee obligations context (production/quarterly fees — out of 19C scope) |
| §3 General introduction (a)–(d) | 22 | Online portal, signed/stamped documents, sequence |
| §3.1.1 Company registration | 22–23 | Brand-per-company, document list, fee reference |
| §3.1.2 Category registration | 23 | Out of scope for current API |
| §3.1.3 Model registration | 23–24 | Parallel model journey (19B) |
| §3.2 Model scrutiny / hold / 60-day cancel | 24 | Analogue for hold communication; **BL-256** vs brand Table 2 |
| §3.3 Model approval path | 24 | Contrast with registration **A03** |
| §3.4 Rejection/holding | 24–26 | Hold grounds, 60-day reject, portal inform, DG binding |
| §3.5–§3.6 Renewal | 25–26 | WP9 deferral |
| §3.7 Withdrawal | 26–27 | WP9 deferral |
| §3.8 Cancellation | 27–28 | WP9 deferral |
| §3.9 Fresh application | 28 | WP9 deferral |
| §3.10 Timelines narrative | 28 | 30-day complete app; **7-day** discrepancy communication |
| Table 2 (brand registration) | 28–29 | Rows 3–6: approval, discrepancy comms, 60-day resubmit, revised doc scrutiny |
| Table 3 (model registration) | 29–30 | Reference for model 19B; 15-day comms row 4 |
| §4 intro + §4.1 Company fee | 30–31 | ₹5,000; electronic payment |
| §4.2–§4.3 | 30–31 | Category deposit; model fee — registration uses §4.1 only today |
| §4.5 | 32 | Label fee / quarterly — out of 19C |
| Annexure 1 / 1-A | 50–53 | Field/document target dictionary |
| Annexure 3 | 56–57 | Model form — not registration 19C |
| Annexure 4 | 58 | Self-declaration continuation — renewal path, not return/resubmit |

---

## 13. Assumptions, conflicts and owner decisions

| ID | Item | Status |
| --- | --- | --- |
| **A02** | Programme performs brand registration scrutiny | Provisional — affects officer recipient |
| **A03** | Programme recommend / Director approve registration | Provisional — maps to portal states |
| **A08** | Seven working days as discrepancy ceiling until tables reconciled | Provisional — V70 seed; **BL-255** open |
| **A17** | Working-day calendar; pause while awaiting applicant | Provisional — clock pause/resume |
| **A18** | Portal notifications authoritative | Provisional — 19C wires V70 |
| **BL-255** | 7 vs 12 vs 15 day conflict | Open — do not hard-code alternate values |
| **BL-256** | Cancel vs reject vs Table 2 auto-cancel | Open — 60-day job out of 19C |
| **BL-257** | Tracks 19C after 19B-2 acceptance | Open |
| **BL-171** | Registration not in bell | Open — 19C uses V70 deliver, UI bell may lag |
| **Resubmit routing** | Always `programme_review` after return | **Local rule** — confirm if Director-return should land on Director |
| **Agency registration** | No manual chapter | Implementation-only — same workflow |
| **V72 acceptance** | Cycle/return binding shape | Design mirrors V72; if review changes constraints, adjust registration migration before numbering |
| **Permittee number** | §3.1.1 p. 22 | **A20** — not part of 19C |

---

## 14. Proposed implementation split (19C-A / 19C-B / 19C-C)

Sized for independent Cursor hand-backs (Claude merges each slice).

### 19C-A — Database trusted boundary (implementation lane)

- Flyway migration **after V72 acceptance** (no number in 19C-0).
- Tables + orchestrate functions + grants + immutability triggers.
- **`RegistrationReturnResponseWiringRepository`** Java stub calling SQL only.
- Database tests: orchestrate atomicity, replay, runtime tampering, cycle/return binding (mirror V71/V72 proof groups 1–11, 13).
- **No** `RegistrationReviewService` behaviour change.
- Gates: `mvn test -Dgroups=db` for new test class(es).

### 19C-B — Service integration (implementation lane)

- `RegistrationReturnResponseWiring` + hook **`RegistrationReviewService`** return/resubmit paths.
- Rollback proofs (mid-orchestrate failure trigger in test schema only).
- Service-level concurrent return/resubmit tests.
- Preserve OpenAPI response bodies on transition/fee routes.
- Gates: backend unit + db tests for registration review + new snl wp02c tests.

### 19C-C — Forward disposition + lazy link + read prep (implementation lane)

- On `recommend` (and optionally `approve`): disposition **`accepted`**, clock/task completion rules aligned with model 19B-2 outcome.
- Lazy first-task creation on fee confirm or first return (document chosen rule).
- **`RegistrationReturnResponseReadRepository`** (internal) populating §10 projection; tests only — **19D** exposes API/UI.
- Repeat-cycle stale transition guards integrated with legacy state trigger.

---

## Appendix A — Inspected codebase references (read-only)

| Area | Location |
| --- | --- |
| Review service | `RegistrationReviewService.java`, `RegistrationController.java` |
| Persistence | `RegistrationRepository.java`; migrations V43–V48 (`registration_application`, review, audit, revocation) |
| Fee | `RegistrationFeeService.java`, `registration_fee_confirmation` |
| Tests / contract | `RegistrationReviewDatabaseTest.java`, `SpringContractTest` registration pairs |
| WP2 foundation | V69, V70, V71, V72 (model); `WorkflowReturnResponseWiring.java`, `SNL_WP02B_MODEL_RETURN_WIRING.md` |
| WP1 | `SNL_WP01_*`, `docs/BEE_DECISIONS.md` A01–A20 |

---

## Appendix B — Brief 19C-0 hand-back checklist

- [x] Design doc only — no code/migrations
- [x] PDF pages verified via `pdftotext`
- [x] Compatible with V72 correction posture
- [x] Implementation slices 19C-A/B/C for follow-on briefs
