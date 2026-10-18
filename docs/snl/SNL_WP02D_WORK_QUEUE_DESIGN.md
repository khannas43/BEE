# SNL WP02D — common work projection, queues and SLA read model (Brief 19D-0)

**Status:** Design and analysis only (19D-0). No migrations, Java, API, OpenAPI, BFF or UI on this slice.
**Branch:** `cursor/snl-wp02d-work-queue-design`
**Base:** `main` @ `d981bb6` (post WP02B acceptance through Brief 19B-2B)
**Governing source:** *SnL Disha Advisory Manual* (`SnL_Disha_Advisory_Manual.pdf`, printed footer page numbers verified with `pdftotext` from `/Users/sameerkhanna/Documents/Documents/BEE/SnL_Disha_Advisory_Manual.pdf`, 18 October 2026)
**Depends on:** Accepted V69–V72; [SNL_WP02A_WORKFLOW_FOUNDATION.md](SNL_WP02A_WORKFLOW_FOUNDATION.md); [SNL_WP02B_RETURN_RESPONSE.md](SNL_WP02B_RETURN_RESPONSE.md); [SNL_WP02B_MODEL_RETURN_WIRING.md](SNL_WP02B_MODEL_RETURN_WIRING.md); [SNL_WP02C_REGISTRATION_RETURN_DESIGN.md](SNL_WP02C_REGISTRATION_RETURN_DESIGN.md) (19C writes must populate the same projection keys once wired)
**Related:** [SNL_WP01_ROLE_MATRIX.md](SNL_WP01_ROLE_MATRIX.md), [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) (B14, B15, D10), [docs/wp07/WP07.1j_INBOX.md](../wp07/WP07.1j_INBOX.md), **BL-257**, **BL-128**, **BL-129**, **BL-135**, **BL-253**, **BL-255**, **BL-256**

---

## 1. Problem statement

WP2B now persists **tasks**, **SLA clocks**, **discrepancies**, **responses**, **dispositions**, **return cycles**, and **in-portal notifications** for model applications (V71/V72). Registration will gain the same overlay after 19C-A–19C-C. Officers and applicants still see work only through **legacy list endpoints** and client-side inference (`workTasks.ts`, WP07.1j): state + assignment, with **no** due date, paused time, task age, discrepancy status, notification delivery state, or return-cycle context.

The manual expects visible processing timelines and applicant response windows (§3.10, pp. 28–29; Table 2 rows 4–6, p. 29; Table 3 rows 4–5, pp. 29–30; §3.2, p. 24). Owner assumptions **A17** (working-day clock with applicant pause) and **B14** (per-stage limits in configurable data) require a **single read projection** that both **My work** and future **supervisor queue** screens consume without duplicating business rules in the browser.

**19D-0 outcome:** specify the projection, visibility, SLA math, privacy boundaries, API field shapes, implementation slices (19D-A/B/C), and acceptance tests — without shipping code.

---

## 2. As-built read paths (pre-19D)

| Consumer | Data source today | WP2 fields visible |
| --- | --- | --- |
| `/app/workflow/personal-inbox` | Scoped model list (`ModelApplication` JSON) | None — `state`, `reference`, `version` only |
| `/app/workflow/my-approvals` | Same list, filtered by `workTasks` | None |
| Stage screens | Detail GET + commands | Partial history; no clock aggregate |
| Registration lists | Registration GET | No task/clock/discrepancy |
| Notification bell (WP10) | `notification` rows | Not joined to open task or discrepancy |

**Segregation today:** Spring scopes lists (org, assignment, stage role). The inbox **does not grant** access; it only maps visible rows to links (WP07.1j). **19D must preserve this:** the projection is computed **after** the same scope predicates, never widening visibility.

---

## 3. Design principles

1. **One projection, many surfaces** — `WorkQueueItem` (internal name) is shared for applicant tasks, officer My work, finance fee queue, and supervisor team queue (supervisor adds team metadata only).
2. **Subject-polymorphic** — `subject_kind` ∈ `model_application`, `registration_application` (future category/entity use same shape).
3. **Read-only** — no mutation in 19D; reassignment remains a separate command slice (WP2 checklist; **BL-135**).
4. **Policy from data** — due dates use persisted `workflow_sla_policy_version` (V70 `snl_return_response`, **A08** / **BL-255**); Java reuses `WorkingDaySla` + `SnlReturnResponsePolicyRepository` semantics, not hard-coded 7/12/15/30/60.
5. **Clock truth** — elapsed bureau time, pause intervals, and overdue derive from **`workflow_sla_clock_event`** on the task’s 1:1 clock (V69 identity), not from `updated_at` on the application row.
6. **Return episode context** — when an open `model_return_response_cycle` (or registration analogue) exists, the queue row exposes cycle seq, latest bound return, discrepancy status, and whether the applicant or bureau is responsible (clock paused vs running).
7. **Privacy (Brief 19 / D10 / A18)** — applicant-facing rows exclude officer identity; officer-facing rows exclude applicant org internal notes except neutral resubmit fact; supervisor sees assignment and SLA, not unrelated org PII beyond existing list scope.

---

## 4. Proposed read projection (logical model)

### 4.1 Identity and navigation

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `subjectKind` | string | `workflow_task.subject_kind` or legacy row | Required |
| `subjectId` | uuid | `workflow_task.subject_id` | Required |
| `reference` | string | model/registration reference column | Display |
| `journeyKind` | enum | derived | `model`, `registration_brand`, `registration_agency`, … |
| `legacyState` | string | `model_application.state` / `registration_application.state` | Authoritative for command guards |
| `legacyVersion` | integer | application row | Optimistic concurrency on commands |
| `organisationId` | uuid | filing org | Applicant scope |
| `actionHint` | string | derived | Mirrors WP07.1j copy where possible; localized in UI layer |
| `deepLink` | string | derived | Stage screen URL + id query (UI concern; API may omit) |

### 4.2 Task and assignment (officer work)

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `taskId` | uuid? | `workflow_task.id` | Null if no WP2 task yet (pre–lazy-link application) |
| `taskStage` | string? | `workflow_task.stage` | Scrutiny stage key |
| `taskAction` | string? | `workflow_task.action` | Expected `review` for return loops |
| `taskStatus` | enum? | `workflow_task.status` | `open`, `completed`, `cancelled` |
| `taskOwnerRole` | string? | `workflow_task.owner_role` | programme, iame, … |
| `taskOwnerAccountId` | uuid? | `workflow_task.owner_account_id` | **Officer/supervisor only** |
| `assigneeAccountId` | uuid? | `assignment` active row for stage | My work match key for IAME/reviewer |
| `assigneeDisplay` | string? | identity join | **Supervisor only**; optional redacted hash for officers |
| `taskCreatedAt` | instant? | first `workflow_task_event` `created` | **Task age** anchor |
| `taskVersion` | integer? | `workflow_task.version` | For future reassign/terminal commands |

### 4.3 SLA, due date, age, pause (manual §3.10; **A17**)

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `clockId` | uuid? | `workflow_sla_clock.task_id` → clock | 1:1 per SLA task |
| `clockState` | enum? | derived from events | `not_started`, `running`, `paused`, `stopped` |
| `policyKey` | string? | `workflow_sla_policy_version.policy_key` | e.g. `snl_return_response` |
| `policyVersion` | integer? | pinned on clock | Immutable after task create |
| `policyAnchorAt` | instant? | clock row | Return/resubmit anchor (Asia/Kolkata date for version pick at write time) |
| `dueAt` | instant? | `workflow_task.due_at` | Immutable after insert (V69); officer/applicant display |
| `applicantRespondBy` | instant? | same as `dueAt` when clock paused for applicant | Table 2 row 5 / Table 3 row 5 context (**BL-256** job separate) |
| `bureauWorkingMillis` | long | `WorkingDaySla.elapsedWorkingMillis(start, asOf, calendar, pauses)` | Excludes applicant pauses |
| `pausedMillis` | long | sum of applicant pause intervals | Open pause uses `asOf = now()` |
| `taskAgeMillis` | long | `now - taskCreatedAt` | Wall-clock age for sorting |
| `overdue` | boolean | `clockState == running && now > dueAt` | **B14:** false when no policy/due |
| `escalationStatus` | enum | derived | `none`, `approaching_due`, `overdue` — **no** auto-escalation recipient in 19D (**BL-148**) |

**Calculation rules (normative for 19D-A):**

- **Calendar:** load `workflow_working_day_calendar` + closures for the policy’s `calendar_key` (same as `SnlReturnResponsePolicyRepository`).
- **Pause intervals:** `WorkingDaySla.applicantPausesFromClockEvents(events, asOf)` on the task’s clock events ordered by `occurred_at`.
- **Bureau elapsed:** from clock `start` event to `asOf`, minus pauses; if `stopped`, cap at `stop` event.
- **Due date:** persisted `due_at` at task creation (return orchestrate); **do not recompute** on read (replay/idempotency safety).
- **Applicant hold notice:** manual Table 2 row 4 (**12 working days** from receipt for brand discrepancy communication, p. 29) vs §3.10 narrative (**7 days**, p. 28) vs Table 3 row 4 (**15 days**, p. 30 for model) — projection **displays the policy row used at write time** only (**BL-255**); 19D does not reconcile tables.

### 4.4 Discrepancy and return cycle

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `discrepancyId` | uuid? | open or cycle-linked | |
| `discrepancyLineCode` | string? | `workflow_discrepancy.line_code` | `return_response` in WP2B |
| `discrepancyStatus` | enum? | `workflow_discrepancy.status` | open, awaiting_review, needs_more, closed, … |
| `latestResponseSeq` | integer? | max response | Applicant-facing: “response submitted” |
| `latestDisposition` | string? | latest disposition outcome | accepted, needs_more, … |
| `openCycleSeq` | integer? | open cycle | model: `model_return_response_cycle.cycle_seq` |
| `openCycleStage` | string? | `review_stage` / `last_resumed_stage` | Officer context |
| `returnCountInCycle` | integer? | count `cycle_return` links | |
| `awaitingApplicant` | boolean | `clockState == paused` && open cycle | Drives applicant “Edit and resubmit” |

### 4.5 Notifications (in-portal; V70)

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `lastApplicantNotificationAt` | instant? | latest delivered `notification` / `notification_command` for org fan-out kinds | returned, applicant_resubmitted (officer), fee_due, approved — **registration/model kinds from wiring** |
| `lastApplicantNotificationKind` | string? | kind column | No message body in list projection |
| `unreadNotificationCount` | integer? | bell query scope | Optional embed; may stay on separate notifications API (**BL-171**) |

### 4.6 Applicant-specific task rows (no WP2 task)

When `legacyState` is `draft`, `fee_due`, or `returned` and the caller is applicant-scoped:

| Field | Behaviour |
| --- | --- |
| `taskId`, `clockId` | null unless lazy task exists |
| `actionHint` | “Finish and submit”, “Confirm fee” (finance), “Edit and resubmit” |
| `awaitingApplicant` | true for `returned` |
| `applicantRespondBy` | from open cycle clock when present; else null until 19C/19B wiring |

---

## 5. Proposed API shapes (19D-B — not implemented in 19D-0)

### 5.1 List endpoint (new)

`GET /api/work-queue` (name TBD in OpenAPI — Claude lane)

Query parameters (all optional, enforced server-side):

| Param | Purpose |
| --- | --- |
| `view` | `my_work` (default), `supervisor` (role gate), `applicant` |
| `subjectKind` | filter |
| `stage` | officer stage filter |
| `overdueOnly` | boolean |
| `limit`, `cursor` | pagination |

Response envelope:

```json
{
  "items": [ { /* WorkQueueItem */ } ],
  "nextCursor": "..."
}
```

### 5.2 WorkQueueItem JSON (stable fields for BFF/UI)

Required: `subjectKind`, `subjectId`, `reference`, `legacyState`, `legacyVersion`, `actionHint`, `awaitingApplicant`, `overdue`, `clockState`, `dueAt` (nullable), `bureauWorkingMillis`, `pausedMillis`, `taskAgeMillis`, `discrepancyStatus` (nullable), `openCycleSeq` (nullable).

Role-gated optional blocks:

- **`officer`:** `taskId`, `taskStage`, `assigneeAccountId`, `taskOwnerAccountId`, `escalationStatus`, `latestDisposition`, `openCycleStage`
- **`supervisor`:** officer block + `assigneeDisplay`, team counts not in row (separate aggregate endpoint deferred)
- **`applicant`:** `applicantRespondBy`, `lastApplicantNotificationAt`, `lastApplicantNotificationKind` — **no** officer ids

Existing list routes (`/api/model-applications`, `/api/registrations`) may embed a **`workQueueSummary`** object later; 19D-B should prefer **one** queue endpoint to avoid N+1 joins on dashboard loads.

---

## 6. Visibility and role rules

### 6.1 Applicant (manufacturer / agency)

| Manual basis | Visible work |
| --- | --- |
| §3 (p. 22) online participation | Own org applications only |
| Table 2 row 5 (p. 29); §3.2 (p. 24) | Returned / on-hold: respond-by date, return reason on **detail** only |
| D10 | Notifications: reference, reason, due, action — **no officer names** |

**Queue rows:** `draft`, `fee_due` (if applicant pays — usually finance), `returned`. **Exclude** bureau scrutiny states unless read-only tracking is explicitly requested (default **exclude** — not applicant work).

### 6.2 Officer (assigned / stage role)

| Role pattern | My work filter (existing + 19D) |
| --- | --- |
| IAME, Reviewer | `assignment.active` && `taskStage` matches role stage |
| Programme, Director, Secretary | All applications at stage (existing list scope) |
| Finance | `fee_due` registration/model fee confirmation |

**May see:** SLA fields, discrepancy status, cycle seq, disposition, task owner ids for **own** assignments. **May not see:** other officers’ personal notes in list row (detail command history unchanged).

### 6.3 Supervisor (**B15** / **BL-135**)

| Manual basis | 19D posture |
| --- | --- |
| §3.2 (p. 24) “Bureau or its designated agency” for **model** scrutiny | Designated agency ≈ supervisor team view for **model** stages only until role is named |
| Brand registration (**A02**) | Programme stage team view — **defer** separate queue until supervisor role named |

**Supervisor view (19D-C UI + 19D-B API gate):**

- Read-only list of **all open tasks** at nominated stages within caller’s bureau scope (exact role name TBD — placeholder `supervisor` scope in OpenAPI).
- Shows assignee, SLA, overdue, task age, paused time.
- **Reassignment** UI/command **out of scope** for 19D; only display `taskOwnerAccountId` / assignee for hand-off to WP2 reassignment slice.

### 6.4 Auditor / cross-org

No change: auditors use existing read exports; work queue endpoint **denied** unless explicitly granted later (**A14**).

---

## 7. “My work” vs supervisor queue

| Aspect | My work (`view=my_work`) | Supervisor queue (`view=supervisor`) |
| --- | --- | --- |
| Manual driver | Officer performs scrutiny within timelines (Table 2 row 3, p. 29; Table 3 rows 2–3, pp. 29–30) | Team oversight (**B15**); manual agency wording §3.2 (p. 24) |
| Row set | Intersection of Spring scope + **actionable** tasks for caller | Open tasks at stage(s) supervisor manages |
| Sort default | `overdue` desc, `dueAt` asc, `taskAgeMillis` desc | Same + group by `assigneeAccountId` |
| WP07.1j | Replaces client `workTasks()` mapping when BFF consumes queue API | New screen; replaces fixture Team queue |
| Data | Full `WorkQueueItem` officer block | Officer block + assignee display |

**Applicant “My applications”** remains org-scoped list; queue API `view=applicant` supplies actionable subset only.

---

## 8. Journey-specific notes

### 8.1 Model (V71/V72 accepted)

- Open return cycle: clock **paused**, discrepancy awaiting applicant response after return; **resubmit** → **resume**, append response, officer notify.
- Forward closure: task **completed**, clock **stopped**, cycle **closed** — row drops from My work unless a new cycle opens at a later stage.
- Pre-wiring applications: first return creates task+cycle; projection **lazy** nulls until first orchestrate (matches WP02B “no backfill”).

### 8.2 Registration (19C target — read must align)

Per [SNL_WP02C_REGISTRATION_RETURN_DESIGN.md](SNL_WP02C_REGISTRATION_RETURN_DESIGN.md) §10:

- Same projection keys; `journeyKind` = `registration_brand` | `registration_agency`.
- Resubmit always resumes to `programme_review`; officer recipient rules differ from model — **notification fields** reflect Programme vs Director return actor.
- 19C-C **`RegistrationReturnResponseReadRepository`** should implement the **same SQL view** as 19D-A to avoid drift.

### 8.3 Fee and non-return states

- `fee_due`: finance task row without return cycle; optional non-SLA task (no clock) until policy extended.
- Approved/rejected/terminal: **exclude** from queue (WP07.1j rule preserved).

---

## 9. Privacy and field suppression matrix

| Field | Applicant | Officer | Supervisor |
| --- | --- | --- | --- |
| `returnReason` / discrepancy summary | detail only | list + detail | list + detail |
| Applicant resubmit note | detail only | **hidden** in list | hidden |
| Officer account ids | hidden | own row / assigned | visible |
| `bureauWorkingMillis` | hidden | visible | visible |
| Internal wiring evidence ids | hidden | hidden | hidden |
| Notification message body | bell/detail | — | — |

---

## 10. Proposed implementation slices

### 10.1 19D-A — Database read projection (Claude / backend lane)

- Create **`workflow_work_queue_v1`** SQL view or **`WorkQueueReadRepository`** composable queries (no Flyway change to V69–V72 tables).
- Unit: pure SQL tests on throwaway schema with V69–V72 seed fixtures (model return cycle, paused clock, completed task).
- Prove: pause math matches `WorkingDaySlaTest`; overdue flags; role-agnostic row set before Spring scope.
- **No** HTTP.

### 10.2 19D-B — API + contract (Claude lane)

- OpenAPI schema for `WorkQueueItem`; `GET /api/work-queue`.
- Spring: scope predicates **identical** to existing list repositories; field filtering by role.
- Embed optional summary on model/registration GET (if backlog allows — otherwise queue-only).
- Contract tests: officer vs applicant field presence; supervisor gate returns 403 until role defined.

### 10.3 19D-C — UI + live checks (Cursor lane after 19D-B)

- Replace `workTasks.ts` inference with BFF fetch of `/api/work-queue?view=my_work`.
- Supervisor queue screen (real data, **BL-129** closes for model stages only if role named).
- Extend `local:inbox` or new `local:work-queue` checks: due date visible, overdue badge, paused indicator for returned model.
- WP2 checklist items: “Build My work and supervisor queue screens”, “Show due dates, age, paused time”.

**Dependency order:** 19C-A–C registration wiring (BL-257) can proceed in parallel with 19D-A; **19D-B** should follow 19C-C read prep or share repository to prevent duplicate SQL.

---

## 11. Test and acceptance matrix

| # | Scenario | Layer | Expected |
| --- | --- | --- | --- |
| 1 | Model returned, clock paused | DB read | `clockState=paused`, `awaitingApplicant=true`, `dueAt` = wired policy due |
| 2 | After resubmit, before forward | DB read | `clockState=running`, latest response seq incremented |
| 3 | After forward closure | DB read | No open task row for cycle; `taskStatus=completed` |
| 4 | Bureau elapsed through pause | Unit | Matches `WorkingDaySla` fixture |
| 5 | Overdue running clock | DB read | `overdue=true`, `escalationStatus=overdue` |
| 6 | Pre-wiring application | DB read | Null task; applicant row from legacy state only |
| 7 | IAME assignee scope | API | Sees only assigned rows; Programme sees stage-wide |
| 8 | Applicant scope | API | No officer ids; no bureau millis |
| 9 | Supervisor without role | API | 403 on `view=supervisor` |
| 10 | Registration (post-19C) | DB read | Same keys as model; `programme_review` stage |
| 11 | Notification kind join | DB read | `lastApplicantNotificationKind=returned` after V70 deliver |
| 12 | Repeat cycle seq 2 | DB read | `openCycleSeq=2`, prior cycle closed |
| 13 | Concurrent list + command | Live | Queue version / state consistent with detail GET |
| 14 | Privacy | API | Applicant list never includes `taskOwnerAccountId` |
| 15 | Policy conflict display | DB read | Row shows persisted policy version note, not alternate 12/15-day recompute (**BL-255**) |

**WP2 acceptance mapping:** items “Every pending task has an owner, due date and visible SLA state” and “SLA clock pauses while applicant is responsible” gain evidence from rows 1–2, 4–5, and live 13.

---

## 12. PDF traceability (printed pages)

Verified with `pdftotext` 18 October 2026.

| Manual reference | Printed p. | Use in WP02D |
| --- | --- | --- |
| §3 General introduction (a)–(d) | 22 | Applicant online participation; document sequence |
| §3.1.1 Company registration | 22–23 | Brand registration journey in queue |
| §3.1.3 Model registration | 23–24 | Model journey stages in queue |
| §3.2 Scrutiny / hold / 60-day cancel | 24 | Model hold communication; applicant 60-day window (**BL-256** display only) |
| §3.3 Model approval path | 24 | Programme → Secretary stages in officer work |
| §3.4 Rejection/holding | 24–26 | Hold grounds; portal communication; reject vs cancel narrative |
| §3.10 Timelines | 28 | 30-day complete processing; **7-day** discrepancy communication |
| Table 2 brand registration | 28–29 | Rows 3–6: approval, **12-day** discrepancy notice, **60-day** resubmit, revised scrutiny |
| Table 3 model registration | 29–30 | Rows 2–5: agency scrutiny **15-day**, approval **15-day** |
| §4.1 Company fee | 30–31 | Fee_due queue for finance |

---

## 13. Assumptions, conflicts, deferrals

| ID | Item | 19D-0 handling |
| --- | --- | --- |
| **A08** / **BL-255** | 7 vs 12 vs 15 working-day tables | Display pinned policy at write; no read-time reconciliation |
| **A17** | Working-day pause | `WorkingDaySla` pause intervals on read |
| **B14** | Per-stage limits | `overdue` only when `due_at` present |
| **B15** / **BL-135** | Supervisor role unnamed | Design supervisor view; gate until role exists |
| **BL-253** | 60-day job | Not in 19D; optional `applicantRespondBy` from manual Table 2/3 for display when policy extended |
| **BL-256** | Cancel vs reject | No auto-status in queue |
| **BL-257** | WP2 sequence | 19D-0 design unblocks 19D-A after 19C read prep |
| **BL-128** | Inbox not a task store | Queue API becomes derived read; inbox UI consumes it |
| **BL-171** | Registration bell | Notification fields optional until UI wired |

---

## 14. Documentation and backlog updates

- **Implementation plan:** WP2 adds 19D-0 design reference; next actions split 19C-A–C vs 19D-A–C (see plan commit).
- **BL-257:** Still open; wording updated to include 19D-0 design acceptance path.
- **No change** to V69–V72 migrations or registration wiring code.

---

## Appendix A — As-built persistence map (read-only reference)

| WP2 entity | Migration | Queue use |
| --- | --- | --- |
| `workflow_task` | V69 | Owner, stage, due, status |
| `workflow_sla_clock` / `_event` | V69 | Pause, elapsed, overdue |
| `workflow_sla_policy_version` | V70 | Policy metadata |
| `workflow_discrepancy` + response/disposition | V69 | Status, latest disposition |
| `model_return_response_cycle` (+ `_cycle_return`) | V71/V72 | Open cycle, seq, stage |
| `notification` / `notification_command` | V70 | Last kind/at |
| `assignment` | pre-V69 | IAME/reviewer My work filter |

---

## Appendix B — Brief 19D-0 checklist

- [x] Design doc only — no code/migrations/API/UI
- [x] PDF pages cited with printed footer numbers
- [x] Aligns with accepted V69–V72 and 19C-0 registration design
- [x] Slices 19D-A/B/C defined with test matrix
- [x] My work and supervisor queue specified
