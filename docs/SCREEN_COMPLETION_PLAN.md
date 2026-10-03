# Screen completion plan — from prototype to working portal

**Status:** Proposed plan, 3 October 2026. Not a BEE decision and not an acceptance record. It is a supplement to [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) and changes none of its work-package definitions. Accepted work packages remain **1/11**.

## 1. What "all screens" means

The prototype has 140 catalogue screens, 9 standalone console routes and 9 public routes (158 matrix rows, [SCREEN_ACTION_MATRIX.md](wp01/SCREEN_ACTION_MATRIX.md)). They are **not** 158 independent pieces of work. The WP01 matrix gives each row a disposition:

| Disposition | Catalogue | Standalone | Public | Meaning for the build |
| --- | ---: | ---: | ---: | --- |
| retain | 49 | 8 | 9 | A real entry route with its own screen: **66 routes** (see section 6) |
| contextual | 55 | 0 | 0 | A tab, panel or action inside a retained route |
| merge | 34 | 0 | 0 | Folds into another retained route |
| retire | 2 | 0 | 0 | Removed |
| dev-only | 0 | 1 | 0 | Screen catalogue; stays development-only |

**The unit of completion is the retained entry route, with its contextual tabs and merged views.** Completing the 66 routes completes the portal's screens. The 89 contextual and merged rows are tabs of those routes and are delivered with them, not as separate screens.

### Where we are

- **3 of 66 routes are real or partly real:** `/login` (Keycloak sign-in), `/app/model-label/model-dashboard` (scoped list and detail) and `/app/model-label/new-model-application` (draft create and edit, submit to `fee_due`, and the test-report card, which is still in review). `/app` already uses the real session, but its content is still fixture data.
- **63 routes still run on prototype state:** `localStorage` stores, fixtures in `lib/mock/*` or generic placeholder screens. None of them proves persistence or server-side authorisation yet.
- **Of the seven first-slice steps** ([FIRST_SLICE.md](wp01/FIRST_SLICE.md)), only step 1 exists on the backend (manufacturer submits, `draft → fee_due`). Steps 2–7 (Finance, IAME, Reviewer, rating, Director, Secretary) have no backend.

## 2. Definition of a finished screen

A route counts as complete only when all of these hold. They are the existing WP02–WP05 rules applied to a screen:

1. **Real data.** The records come from Spring through the Next.js BFF. No `localStorage` or fixture is the source of truth for the route. Preferences such as language and accessibility may stay client-side.
2. **Server-side authorisation.** Spring decides role, organisation, assignment and stage. The screen never grants access, and the preview role never selects records.
3. **Persisted commands.** Every action is a Spring command with idempotency, a version check and an audit event written with the state change.
4. **Standard states.** Loading, empty, no-access, not-found, service-unavailable and session-expired all behave and read the same on every screen.
5. **Contract and tests.** The OpenAPI artifact is updated and the contract coverage gate stays at 100% of documented pairs. There are unit, database and live checks for the new behaviour.
6. **Live browser check** with real sign-in and TOTP for each role that can reach the route, including a cross-organisation or wrong-role denial.
7. **Navigation.** `matrix` and `audit:access` pass, and every route has a documented path in.
8. **Honest labelling.** Anything that depends on an undecided BEE rule is shown as provisional. No accreditation, verification or approval claim is made that the system cannot back.
9. **A short evidence note** under `docs/wpNN/`, with accurate totals and stated limits.

## 3. Order of work

The order follows the plan's dependency stages and puts the first end-to-end slice ahead of breadth. Routes are tracked in section 6.

| Wave | Goal | Routes | Plan activities | Plan person-days* |
| --- | --- | ---: | --- | ---: |
| 0 | Done or partly done | 3 | WP02.1, WP05.1a–c, WP06.1a | already spent |
| 1 | **Finish the first slice**, `fee_due → approved` with a computed rating | 9 | Remainder of WP05.1 (including WP05.1d), WP07.1 (manual Finance confirmation only), WP05.2, audit part of WP04.3 | rest of 55 + 45 + 55 + part of 25 |
| 2 | Registrations, masters, documents, access | 11 | WP04.2, WP04.3, WP06.2, WP06.3, WP02.3 remainder | 45 + 25 + 25 + 15 + part of 20 |
| 3 | Labels, QR, certificates, public verification | 6 | WP05.3, WP08.1–3, WP09.1–3 | 40 + 95 + 135 |
| 4 | Production and finance | 8 | WP07.1 rest, WP07.2, WP07.3 | 50 + 35 + rest of WP07.1 |
| 5 | Enforcement and helpdesk | 10 | WP10.1–3 | 115 |
| 6 | Insights, audit, AI, remaining admin, static public pages | 19 | WP11.1–4 and configuration | 210 + configuration |

\* Figures are carried over from [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) section 15.2, **not re-estimated**. Where a package overlaps a wave they are shown as that package's full figure. The plan itself says these estimates need a local-scope re-estimate after the first vertical slice; this plan keeps that checkpoint at the **end of Wave 1**.

**Wave 1 detail (the first slice).** Steps 2–7 end at `approved`:
- Finance confirms the fee **manually**, and the payer cannot confirm their own fee.
- IAME scrutinises and recommends.
- The Reviewer verifies and forwards.
- Programme computes and records a versioned rating.
- The Director recommends.
- The Secretary gives final approval.
- Return, resubmit, rejection and history are included.
- The inbox routes (`personal-inbox`, `my-approvals`) are the task source for every step, so they are built with Wave 1, not later.

WP05.1d (submit-time evidence, laboratory accreditation, test date, model and family uniqueness) is ahead of this and needs the BEE decisions in section 7.

### Tiers, for when time is short

| Tier | Contents | What it lets you show |
| --- | --- | --- |
| A | Waves 0–1 (12 routes) | One model from draft to approved, with real roles, evidence and rating |
| B | Add Waves 2–3 (17 more; 29 routes in total) | Registration, documents, label, QR, certificate and public verification: the narrow registration to model to certificate path |
| C | Add Waves 4–6 (37 more; all 66) | The remaining workspaces, MIS and the clearly labelled AI demonstrations |

On one workstation the plan's own capacity figures (section 15.3) already show that the full base is years of sequential work, not months. Tier A and Tier B are the realistic way to have something complete and demonstrable early.

## 4. Why progress feels slow, and what to change

Observed in this work, from the WP05.1c and WP06.1a history:

- **Every new backend feature is wide.** WP06.1a changed 42 files and about 4,300 lines for one upload feature: Flyway, Spring controller, service and repository, BFF route and validator, client helper, a 2,000-line OpenAPI diff, contract pin, unit, database and live tests, and a note.
- **Review loops dominate.** WP05.1c needed five independent review passes and WP06.1a needed three, after the implementation. The later rounds found mostly edge cases, and each one re-ran the full gate.
- **The full gate is slow.** `local:check` takes about 3–5 minutes plus a runtime restart, and it was re-run after every round, including documentation or tooling-only edits.
- **Environmental noise looked like code failures.** The handover's failing checks were servers not started, and a stale lock and a duplicate folder cost a large part of one session.
- **Hot files.** `bee-local-api.openapi.json`, `apiContract.ts`, `bff.ts` and `contract-pin.json` change on every feature, so work cannot safely run in parallel.

Proposed changes, in order of payoff. These are recommendations for you to accept or reject:

1. **Build a runtime screen kit once (during Wave 1).** Shared server-scoped table (paging, filters), record detail with tabs, an idempotent command panel with version check, a document card (generalise `DraftTestReports`), and a single state panel for the standard states. The 102 placeholder screens already fall into 10 archetypes in `ScreenScaffold`, so screens convert by archetype, not one by one.
2. **Cut the per-route boilerplate.** Add a feature template or generator covering Spring read/command, BFF route with validator, client helper, contract entry and test skeletons. Split the OpenAPI artifact and the coverage inputs per module (merged by a script), so features stop colliding in the same files.
3. **Tier the gates.** Per change, run the focused tests (one to two minutes). Run the full `local:check` once per activity and once after the last review fix. Skip it for documentation-only edits.
4. **One independent review per activity.** Fix high and medium findings. Write low-severity items to a backlog file (for example `docs/REVIEW_BACKLOG.md`) instead of starting another fix-and-re-review round. Take a second review only if the fixes change authorisation, data integrity or the contract.
5. **One authoritative folder.** Use `~/Code/BEE/worktrees/…` only; leave the Documents copy untouched as agreed. Keep the runtime stopped between sessions and keep the harness's own servers only.
6. **Parallel work, carefully.** Once the kit and the split contract exist, independent workspaces (for example Wave 5 and Wave 6) can be built on separate branches by separate agents against unit, database and contract tests. Live browser checks need the single runtime (the local budget is about 3.6 GB), so they run one at a time. Merge only reviewed branches in wave order.
7. **Ship with labelled provisional defaults** where BEE has not decided (as with the ₹24,000 fee and the five-star formula), and track each in the decision register. Do not block a screen on a policy answer.

## 5. How each wave is run

For every retained route, in this order:

1. Read the matrix row for its roles, scope and contextual tabs.
2. Spring: table and command, policy through the existing slice rules, audit event.
3. BFF route and validator, client helper and OpenAPI entry, using the template.
4. The screen on the kit, with the standard states.
5. Focused unit, database and contract tests, including a denial case, and a mutation check of any new lock or guard.
6. Live check with real roles, then `matrix` and `audit:access`.
7. One full `local:check` and one independent review per activity, then an evidence note and a local commit.

Stop at the end of each activity, as in the handover. Do not start the next while the current one is failing.

## 6. Route tracker (66 retained routes)

Generated from the screen matrix. Status is as of 3 October 2026. "Not started" shows the matrix's current implementation and state: scaffold, deep or standalone, and which store holds it. The development-only catalogue (`/app/screens`) is excluded.

| Wave | Route | Screen | Workspace | Status |
| ---: | --- | --- | --- | --- |
| 0 | `/app/model-label/model-dashboard` | Model dashboard | Registrations | Partial: scoped list and detail on real API (WP05.1a) |
| 0 | `/app/model-label/new-model-application` | New model application | Registrations | Partial: draft create/edit/submit to `fee_due` (WP05.1b/c); Test reports card (WP06.1a, in review) |
| 0 | `/login` | Sign in | Public (no login) | Real Keycloak sign-in (WP02.1); accepted as a local activity |
| 1 | `/app` | Console home | Home | Shell uses the real session; content still local fixtures |
| 1 | `/app/model-label/iame-scrutiny` | IAME scrutiny | My work and approvals | Not started: deep / lifecycle-store → WP05 |
| 1 | `/app/model-label/bee-scrutiny` | BEE scrutiny | My work and approvals | Not started: deep / lifecycle-store → WP05 |
| 1 | `/app/model-label/director-approval` | Director approval | My work and approvals | Not started: deep / lifecycle-store → WP05 |
| 1 | `/app/model-label/rating-calculation` | Rating calculation | My work and approvals | Not started: deep / lifecycle-store → WP05 |
| 1 | `/app/workflow/personal-inbox` | Personal inbox | My work and approvals | Not started: deep / lifecycle-store → WP05 |
| 1 | `/app/workflow/my-approvals` | My approvals | My work and approvals | Not started: standalone / static-fixture → WP05 |
| 1 | `/app/model-label/model-payment` | Model payment | Production and finance | Not started: deep / lifecycle-store → WP07 |
| 1 | `/app/finance/finance-queue` | Finance queue | Production and finance | Not started: scaffold / scaffold |
| 2 | `/app/identity/organisation-users` | Organisation users | Registrations | Not started: scaffold / scaffold |
| 2 | `/app/agency-brand/brand-registration` | Brand registration | Registrations | Not started: scaffold / scaffold |
| 2 | `/app/withdrawal/brand-withdrawal` | Brand withdrawal | Registrations | Not started: scaffold / scaffold |
| 2 | `/app/registrations/record` | Registration record workspace | Registrations | Not started: standalone / static-fixture → WP04 |
| 2 | `/app/administration/appliance-master` | Appliance master | Insights and administration | Not started: scaffold / scaffold |
| 2 | `/app/administration/rating-formula` | Rating formula | Insights and administration | Not started: scaffold / scaffold |
| 2 | `/app/administration/fee-rules` | Fee rules | Insights and administration | Not started: scaffold / scaffold |
| 2 | `/app/administration/workflow-configuration` | Workflow configuration | Insights and administration | Not started: scaffold / scaffold |
| 2 | `/app/documents/repository` | Repository | Insights and administration | Not started: scaffold / scaffold |
| 2 | `/app/documents/malware-quarantine` | Malware quarantine | Insights and administration | Not started: scaffold / scaffold |
| 2 | `/app/identity/access-management` | Users, roles and delegation | Insights and administration | Not started: standalone / static-fixture → WP02 |
| 3 | `/app/model-label/renewal-or-degradation` | Renewal or degradation | Registrations | Not started: deep / lifecycle-store → WP05 |
| 3 | `/app/model-label/label-preview` | Label preview | Labels, QR and certificates | Not started: deep / cert-store → WP09 |
| 3 | `/app/qr/batch` | QR batch workspace | Labels, QR and certificates | Not started: standalone / static-fixture → WP08 |
| 3 | `/app/audit/integration-correlation` | Integration correlation | Insights and administration | Not started: deep / cert-store → WP09 |
| 3 | `/directory` | Appliance directory | Public (no login) | Not started: public / none |
| 3 | `/verify` | Public verification | Public (no login) | Not started: public / lifecycle-store → WP08 |
| 4 | `/app/production/quarterly-submission` | Quarterly submission | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/production/bulk-upload` | Bulk upload | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/production/reconciliation` | Reconciliation | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/production/compliance-exceptions` | Compliance exceptions | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/finance/transaction-search` | Transaction search | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/finance/payment-reconciliation` | Payment reconciliation | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/finance/refund` | Refund | Production and finance | Not started: scaffold / scaffold |
| 4 | `/app/finance/security-deposit-ledger` | Security deposit ledger | Production and finance | Not started: scaffold / scaffold |
| 5 | `/app/enforcement/sample-plan` | Sample plan | Enforcement | Not started: scaffold / scaffold |
| 5 | `/app/enforcement/laboratory-assignment` | Laboratory assignment | Enforcement | Not started: scaffold / scaffold |
| 5 | `/app/enforcement/challenge-test` | Challenge test | Enforcement | Not started: scaffold / scaffold |
| 5 | `/app/enforcement/enforcement-decision` | Enforcement decision | Enforcement | Not started: scaffold / scaffold |
| 5 | `/app/mis-ai/enforcement-dashboard` | Enforcement dashboard | Enforcement | Not started: scaffold / scaffold |
| 5 | `/app/enforcement/case` | Enforcement case workspace | Enforcement | Not started: standalone / static-fixture → WP10 |
| 5 | `/app/helpdesk/raise-ticket` | Raise ticket | Support | Not started: scaffold / scaffold |
| 5 | `/app/helpdesk/sla-dashboard` | SLA dashboard | Support | Not started: scaffold / scaffold |
| 5 | `/app/helpdesk/knowledge-base` | Knowledge base | Support | Not started: scaffold / scaffold |
| 5 | `/app/helpdesk/workspace` | Helpdesk agent workspace | Support | Not started: standalone / static-fixture → WP10 |
| 6 | `/app/workflow/escalation-dashboard` | Escalation dashboard | My work and approvals | Not started: deep / lifecycle-store → WP05 |
| 6 | `/app/administration/admin-dashboard` | Admin dashboard | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/administration/notification-templates` | Notification templates | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/administration/reference-publication` | Reference publication | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/mis-ai/executive-mis` | Executive MIS | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/mis-ai/registration-dashboard` | Registration dashboard | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/mis-ai/report-builder` | Report builder | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/mis-ai/data-quality` | Data quality | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/mis-ai/model-monitoring` | Model monitoring | Insights and administration | Not started: deep / static-fixture → WP11 |
| 6 | `/app/audit/business-audit-search` | Business audit search | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/audit/configuration-history` | Configuration history | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/audit/security-event-review` | Security event review | Insights and administration | Not started: scaffold / scaffold |
| 6 | `/app/ai` | AI insights | Insights and administration | Not started: standalone / static-fixture → WP11 |
| 6 | `/` | Public home | Public (no login) | Not started: public / none |
| 6 | `/about` | About | Public (no login) | Not started: public / none |
| 6 | `/programmes` | Programmes | Public (no login) | Not started: public / none |
| 6 | `/calculator` | Energy calculator | Public (no login) | Not started: public / none |
| 6 | `/notifications` | Notifications | Public (no login) | Not started: public / none |
| 6 | `/contact` | Contact | Public (no login) | Not started: public / none |

## 7. Decisions needed from you or BEE

| # | Decision | Needed by | Default if undecided |
| --- | --- | --- | --- |
| 1 | Accept the tiers: finish Tier A first, then Tier B, before breadth? | Before Wave 1 | Yes |
| 2 | Accept the review policy in section 4 (one review per activity, backlog for low findings)? | Now | Yes |
| 3 | Allow parallel agents on separate branches after the kit exists? | End of Wave 1 | Not until the kit and split contract are in |
| 4 | The WP05.1d questions (test report required, laboratory accreditation, test date, uniqueness, standard, post-return uploads): see [WP05.1d_DECISIONS.md](wp05/WP05.1d_DECISIONS.md) | Before WP05.1d | Not required; display only (current behaviour); my recommendation is to require them |
| 5 | Who may close or supersede a master version (M6), and the approved fee and rating formula? | Before Wave 2 admin screens | Provisional values shown as such |
| 6 | Re-estimate point: confirm the end of Wave 1 as the checkpoint to replace the carried-over person-day figures | End of Wave 1 | Yes |
