# WP01.2 First vertical slice: registration to approved model with computed rating

Status: WP01.2 and WP01.3 passed documentation review on 30 September 2026. WP01 is accepted as documentation and design evidence (1 of 11 work packages, 9.1%). WP02.2 local list/read policy activity accepted on 30 September 2026; WP02 remains open: Spring enforces the list and read scope in §7 from its own account, role, membership and assignment records, and defines reusable checks for the seven steps in §3. Every transition and the history read stay denied by default. Rules, evidence and deferred actions: [WP02.2_POLICY.md](../wp02/WP02.2_POLICY.md). No slice transition is implemented yet.

This is the first increment of real behaviour after WP01. It is chosen because it exercises the three controls every later work package depends on: organisation-scoped partner access, manual Finance fee confirmation with no payer self-confirmation, and a two-stage BEE approval taken on a computed, versioned star rating. Requirement references (R1 to R15) and gap references (G01 to G25) are in [INVENTORY.md](INVENTORY.md). The role and route capacity for every slice step is in [SCREEN_ACTION_MATRIX.md](SCREEN_ACTION_MATRIX.md) (rows whose note starts with **slice**), and `scripts/screen-matrix.cjs` checks it.

## 1. Scope

**In scope.** Precondition data for one organisation and brand; one model application from intake to `approved`; manual Finance fee confirmation; IAME and BEE scrutiny with return and resubmit; rating computed from a versioned formula and stored with its inputs; Director recommendation and Secretary final approval, both taken with the rating in view; an append-only history of every transition.

**Final state.** `approved`. The rating is already computed and recorded when the Secretary approves. Nothing after approval is in this slice.

**Out of scope for this slice.** Label generation, QR batches, certificates and ledger (WP08, WP09); online payment or any payment adapter; eSign, OTP delivery, DigiLocker or any other external integration (WP12); data migration (WP13); performance, security certification and release work (WP14); brand and agency registration workflows beyond seeded, already-active records (WP04).

## 2. Actors and seed data

Two partner organisations, so that cross-organisation denial can be tested:

| Organisation | Kind | Seed users | Brand |
| --- | --- | --- | --- |
| Nova Cool Appliances | Manufacturer | Manufacturer applicant | Nova Cool (active) |
| PixelCert Agency | Authorised agency | Agency applicant | none (applies for its principal's brand only when authorised) |

Nova Cool keeps registration ID `BEE/RAC/2026/10016` from the certificate and QR fixtures; the lifecycle seed record for Godrej Turbo receives a new ID (G06).

Internal users: one each of Finance, IAME scrutiny officer, Reviewer (Project Engineer), Programme (rating), Programme Director and Secretary. No user holds two slice roles.

## 3. Steps

Capacity codes are the Annex A codes: **S** submit, **X** execute, **R** review, **A** approve, **V** view.

| # | Actor | Action | Code | Transition | Matrix row | Prototype route today |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Manufacturer (or authorised agency) | Submit model application | S | draft → fee_due | `new-model-application` | `/app/model-label/new-model-application` (in the manufacturer menu) |
| 2 | Finance | Confirm fee received, manually | X | fee_due → iame_scrutiny | `model-payment` | `/app/model-label/model-payment` (task link) |
| 3 | IAME | Scrutinise and recommend | R | iame_scrutiny → bee_scrutiny | `iame-scrutiny` | `/app/model-label/iame-scrutiny` (task link) |
| 4 | Reviewer | Verify and forward | R | bee_scrutiny → rating | `bee-scrutiny` | `/app/model-label/bee-scrutiny` (task link) |
| 5 | Programme | Compute and record the rating from the effective formula version | X | rating → director_review | `rating-calculation` | `/app/model-label/rating-calculation` (task link) |
| 6 | Programme Director | Review the rating and recommend approval | A | director_review → secretary_approval | `director-approval` | `/app/model-label/director-approval` (task link) |
| 7 | Secretary | Review the rating and give final approval | A | secretary_approval → approved | `director-approval` (the merged Secretary view) | same route, today reached through `WORKFLOW_ACCESS` |

Fee confirmation is **X**, not **A**: Finance executes a recorded manual confirmation of money received. It is not an approval decision on the application, and no role holds **A** on the fee row.

The Director and Secretary hold **V** on `rating-calculation` and see the rating, formula version and inputs on the approval view. Under today's client policy they cannot open `rating-calculation` directly; that route is one of the policy-review proposals listed in the matrix.

Each step's planned entry path is recorded in the matrix section "Planned entry paths": Finance opens the fee step from the finance queue; IAME, Reviewer and Programme from the personal inbox; Director and Secretary from My approvals, and the rating screen from the rating panel on the approval view.

`scripts/screen-matrix.cjs` checks that the steps chain without gaps, that the slice ends at `approved`, that the rating step records the formula version and comes before both approvals, and that the current client policy lets each actor open its step's route.

## 4. State machine

```text
draft ──submit──▶ fee_due ──Finance confirms (X)──▶ iame_scrutiny ──recommend──▶ bee_scrutiny ──forward──▶ rating
                                                        │                            │
                                                      return                       return
                                                        ▼                            ▼
                                                  returned (to applicant) ◀──────────┘
                                                        │ resubmit
                                                        ▼
rating ──compute (X)──▶ director_review ──recommend (A)──▶ secretary_approval ──approve (A)──▶ approved   (final)
                              │                                 │
                            return                            return
                              ▼                                 ▼
                        returned (to applicant)           returned (to applicant)

Any scrutiny, rating or approval stage ──reject (reason required)──▶ rejected   (terminal)
```

Rules:

- A return needs a reason. The applicant edits and resubmits, and the application goes back to the stage that returned it, not to the start.
- If a resubmission changes any rating input, the rating result is superseded (kept in history, not deleted) and the application passes through `rating` again before it reaches the Director or Secretary.
- Reject needs a reason and is terminal. A new application is needed to try again.
- Approval is recorded against a specific rating result. The Secretary cannot approve if the rating result the Director recommended on has been superseded.
- Each transition writes one history entry: application, from-state, to-state, actor user, actor role, organisation, reason or note, server time. Entries are never updated or deleted.
- `draft` is saved but not submitted. The Annexure X 180-day purge (R13) is recorded as a rule to implement in WP05 and is not tested in this slice.

Compared with the prototype: its `approval` stage, which either Director or Secretary completes, splits into `director_review` then `secretary_approval` (G09). Its `rating` stage moves from after approval to before it.

## 5. Manual Finance fee confirmation

- The fee is computed when the application is submitted and stored on it as an amount, fee rule ID and effective date. The slice seeds one fee rule (provisional decision D6).
- The applicant sees the amount, status and receipt reference. It has View, Submit (upload the payment proof or reference) and Download. It never holds Approve or Execute on the fee row or on any row merged into it.
- Finance records a reference number, amount received and date, then confirms (X). The system rejects confirmation if the amount does not match the stored fee.
- There is no payment gateway, bank file or reconciliation adapter in this slice.

This preserves the REVIEW-FIXES-3 behaviour ("Payment confirmed" belongs to Finance only) and moves the check from the browser to the server. Changing the code from A to X does not widen the payer's access: the matrix check fails if any payer holds A or X on the fee row, if any role other than Finance holds X there, or if any role holds A there.

## 6. Data model outline

Only what the slice needs. Names are indicative; WP04 and WP05 own the final schema.

| Entity | Key fields |
| --- | --- |
| `organisation` | id, kind (manufacturer, agency, iame, lab, sda, bee), legal name, status |
| `user_account` | id, organisation id, display name, status |
| `role_assignment` | user id, role, scope (own organisation, assigned, all), valid from/to |
| `brand` | id, owner organisation id, name, status |
| `agency_authorisation` | agency organisation id, principal organisation id, brand id, valid from/to |
| `model_application` | id (server sequence), organisation id, brand id, category, model number, declared metric (ISEER), test lab, test report reference, state, returned-from state, current rating result id, version |
| `fee_rule` | id, category, amount, effective from/to |
| `fee_confirmation` | application id, fee rule id, amount due, amount received, reference, confirmed by, confirmed at |
| `assignment` | application id, stage, assignee user id (IAME and Reviewer) |
| `rating_formula` | id, category, version, thresholds, effective from/to, source reference, verification status |
| `rating_result` | id, application id, formula id and version, inputs, star result, computed by, computed at, superseded by |
| `approval_decision` | application id, stage (director, secretary), decision, rating result id, decided by, decided at, note |
| `transition` | append-only history, as in §4 |

IDs are issued by the server. The client does not predict them (G07).

WP02.2 persists only the part of `model_application` that the scope checks need: id, reference, organisation id, brand name as text, category, model number, state and version (`V3__model_application.sql`). Brand, fee, rating and history columns and tables stay with WP04, WP05 and WP07.

## 7. API outline

| Method and path | Who | Effect |
| --- | --- | --- |
| `POST /api/model-applications` | Applicant (own organisation, own or authorised brand) | Create a draft |
| `PATCH /api/model-applications/{id}` | Applicant, while draft or returned | Edit |
| `POST /api/model-applications/{id}/submit` | Applicant | Draft or returned → next state; computes the fee on first submit |
| `POST /api/model-applications/{id}/fee/confirm` | Finance | fee_due → iame_scrutiny |
| `POST /api/model-applications/{id}/recommend` | Stage owner (IAME, Reviewer) | Move to the next stage |
| `POST /api/model-applications/{id}/rating` | Programme | rating → director_review; stores the rating result with formula version |
| `POST /api/model-applications/{id}/decision` | Director, then Secretary | Recommend (Director) or final approve (Secretary), bound to the current rating result |
| `POST /api/model-applications/{id}/return` | Stage owner | → returned, with reason |
| `POST /api/model-applications/{id}/reject` | Stage owner | → rejected, with reason |
| `GET /api/model-applications`, `GET /api/model-applications/{id}` | Any slice role, filtered by scope | List and read, including the current rating result |
| `GET /api/model-applications/{id}/history` | Any slice role that can read the application | Transition history |

Every write checks, on the server: the user's role owns the current state, the application is inside the user's scope, and the expected version matches (optimistic concurrency).

Implemented in WP02.2: the two `GET` list and read routes, filtered on the server by rules P1–P6 in [WP02.2_POLICY.md](../wp02/WP02.2_POLICY.md). A read outside scope returns the same 404 as an unknown ID. Every other route in this table returns 403 `denied_by_default` until its owning activity implements it.

## 8. Denial cases

Each of these must fail with a server error and must leave no transition entry:

1. A Nova Cool manufacturer user lists, reads or edits a PixelCert application, or the reverse.
2. PixelCert submits for the Nova Cool brand without an active authorisation.
3. The applicant, or anyone other than Finance, confirms the fee.
4. Finance recommends, computes the rating or approves.
5. IAME approves, or acts on an application not assigned to it.
6. The Director or Secretary decides before a rating result exists, or on a superseded rating result.
7. The Director gives final approval, or the Secretary acts before the Director has recommended.
8. The same user acts at two stages of one application.
9. Any role acts on an application that is not in that role's stage.
10. Helpdesk, Admin or Auditor performs any slice transition. (Annex A.1 would grant Admin, Finance and Helpdesk approve on director and secretary approval; the slice overrides it, G10.)

WP02.2 enforces case 1 for list and read and denies case 10's roles any read. Cases 1, 2, 3, 4, 5, 7, 8, 9 and 10 have unit-tested step checks (P7 in [WP02.2_POLICY.md](../wp02/WP02.2_POLICY.md)). None of them can yet be exercised through the API, because every transition is still denied. Case 6 is deferred to WP05.2.

## 9. Proposed local acceptance checks

These are proposed for your review. They are not met yet and are not claimed as met by WP01. They are to be demonstrated by the implementation work packages (WP02 access, WP04 master data, WP05 lifecycle), running on one MacBook with local services only, and accepted only by you.

1. A seeded Nova Cool applicant submits a room air conditioner model. It appears with a server-issued ID, state `fee_due`, and a fee with its rule ID.
2. Finance confirms the fee with a reference number. The applicant sees "Payment confirmed" and has no confirm action.
3. IAME returns the application with a reason. The applicant edits and resubmits, and it returns to `iame_scrutiny`. IAME then recommends, and the Reviewer forwards it to `rating`.
4. Programme computes the rating. The rating result stores the formula ID and version, the inputs and the star result, and the state is `director_review`.
5. The Director and the Secretary each see that rating result, with its formula version, on the approval view. The Director recommends and the Secretary approves. Each decision records the rating result ID, and the final state is `approved`.
6. The history shows every transition from submission to approval, in order, each with actor, role, organisation and server time.
7. Every denial case in §8 fails, and the history is unchanged afterwards.
8. `bash scripts/access-audit.sh`, `bash scripts/screen-matrix.sh`, `npx tsc --noEmit` and `npm run build` pass. `npm run lint` reports no problem in files the work package adds or changes. (At the WP01 baseline `npm run lint` exits with code 1: 21 errors and 18 warnings, all in existing files under `app/`, `components/` and `lib/` that WP01 does not change. Clearing that baseline is not part of this slice.)
9. The same end-to-end run can be repeated after a targeted app-data reset and re-seed ([ADR-001](ADR-001-local-runtime.md) D-RT5), without deleting the database volume.

Each check above, each step in §3 and each denial case in §8 is mapped to its owning activity, planned check, API and records in [ACCEPTANCE_MAPPING.md](ACCEPTANCE_MAPPING.md).

## 10. Provisional BEE decisions

The local demo uses these defaults. Each is **provisional and pending a BEE decision**; none is a BEE decision until BEE confirms it. The same list is in `lib/screenMatrix.ts` (`PROVISIONAL_DECISIONS`), is rendered into the matrix document, and is checked for its provisional status.

| # | Question | Provisional default for the local demo | Basis |
| --- | --- | --- | --- |
| D1 | Is Secretary approval always required, or can it be delegated to the Director for some categories? | Always required: Director recommends, Secretary gives final approval | RFP Vol 2 §1.3 lists both; DDD §5.3 says "per delegation" |
| D2 | Who allocates applications to IAME and Reviewer users? | Seeded round-robin assignment; no allocator role in the slice | RFP Vol 2 §1.3 names a Data Analyst role, which the prototype lacks (G12) |
| D3 | Which approved star-rating formula and version applies to each category? | Current `computeStars` thresholds, recorded as formula version "0-unverified" | RFP Vol 2 SoW (b); the corrigendum (row 70) refers to beestarlabel.com (G13) |
| D4 | Does `/app/registrations/record` become the applicant's model record? | Yes, scoped to the applicant's organisation | Today the manufacturer cannot open it (G02) |
| D5 | Is the IAME verifier (note-sheet) a separate step from IAME scrutiny? | Single IAME step in the slice | RFP Vol 2 §1.3; DDD §4.3 (G11) |
| D6 | Which fee rule applies per category and application type? | One seeded rule: ₹24,000 for room air conditioners | DDD §5.3 (G08) |

Because D3 is unverified, any rating computed in the local demo carries formula version "0-unverified" and must not be presented as an official star rating.
