# Package review of WP06 to WP11 (14 October 2026)

**Result: none of the six packages is accepted. The count stays at 5 of 11 (WP01 to WP05).** Three independent read-only reviewers (WP06 with WP10, WP07 with WP08, WP09 with WP11) compared each package's exit criterion in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) with what is built. They ran nothing; the lead (this branch's author) checked the headline findings against the plan, the backlog and the screen plan. Provisional local rules, not BEE rules.

The built work is real and mostly sound, but each package's exit criterion is either unmet or met for a narrower scope than the plan names. Counting a package as accepted on a narrowed scope is the owner's decision (see "Decision for the owner").

## Findings per package

| Package | Exit criterion | Built | Verdict |
| --- | --- | --- | --- |
| WP06 Document service | versions/hashes linked to case; unauthorised retrieval denied | WP06.1a: test-report PDF intake for model-application drafts; append-only versions with SHA-256; hash re-checked on read; scope-checked retrieval (cross-organisation, unknown and malformed ids all 404). Not built: WP06.2 quarantine, rights, retention; WP06.3 document audit. "Linked to case" is only "linked to a model application" | Sound for its slice; **not accepted** as a package. A limited-scope acceptance is possible |
| WP07 Fees and production | payer cannot confirm own fee; simulated callbacks idempotent; local totals reconcile | The stage workflow (WP07.1a to k) with manual Finance fee confirmation, correction and reversal (second approver), payer separation and an idempotency key. Not built: payment simulation and callbacks, reconciliation and totals, quarterly submission, bulk validation, CA evidence, refunds, label fees | "Payer cannot confirm own fee" met; the other two criteria unmet; **not accepted**. Limited-scope acceptance possible ("stage workflow plus manual confirmation") |
| WP08 QR and public verification | duplicate code blocked; pending, active and revoked agree across views | Public verifier built under WP09.1c and d; the real QR image is on the printable label (WP09.1b). Not built: batch, serial binding, duplicate control, pending and revoked states. The WP08.1a to h notes (fee rules, rating schemes, settings) are not QR work | **Not accepted** |
| WP09 Certificate and Fabric | no Active before confirmed test-network commit; retry and mismatch visible | Local certificate record issued in the same transaction as approval (append-only, race-safe allocation), the printable certificate and label, the public verifier with its rate limit. Not built: Fabric, chaincode, adapter, hash proof, pending state, amend, revoke | **Not accepted** as "Certificate and Fabric" |
| WP10 Enforcement and helpdesk | partner and case assignment scope and ticket resolution work with seeded records | In-portal applicant notifications (WP10.1a and b), which are outside the register scope. The helpdesk workspace is a hard-coded screen. Not built: cases, sampling, testing, partner assignment, tickets, SLA | **Not accepted** |
| WP11 MIS and AI | output cites data and model version; disposition and override persist; no automatic adverse decision | Nothing. The AI and MIS screens are in-browser fixtures (state is lost on reload) | **Not accepted**; not started |

## Reconciliation notes

- The WP07.1a to k series is the stage workflow (the plan's WP05.2 and fee confirmation); the WP08.1a to h series is fee rules, rating schemes, permission menu, corrections, reversal and settings. Neither matches the plan's sub-package titles. The plan's WP07.1 to .3 and WP08.1 to .3 stay mostly open.
- The notification notes labelled WP10.1a and b collide with the plan's "WP10.1 Enforcement"; they count toward neither WP10.1 nor WP10.2.
- The public verifier and the real QR are the only delivered parts of the plan's WP08.2.

## Corrections made in this review (documents only)

The WP06.1a status line (it said 1/11 and "WP05 open"), BL-084 (a correction and a reversal now exist), the screen plan row for `/verify` (it is built under WP09.1c and d), and the plan, backlog and workbook as below.

## Not fixed here, recorded as backlog

BL-210 to BL-218 in docs/BACKLOG.md: the unbuilt scope of each package; the static fixture screens (QR batch, ticket workspace, AI and MIS screens, the mock ledger and Fabric panels) that look real without a "sample data" label, and that can show a state different from the real certificate; the missing `nosniff` header on document downloads; document read scope for officers; certificate revocation and a pending state; accessibility of the document, verify and certificate screens.

## Decision for the owner

Whether to count WP06 and WP07 as accepted for their narrowed scopes, as was done for WP05. This review has not, because for WP06 and WP07 the unbuilt part is most of the plan's named scope (WP05's narrowing matched where the plan's own rows were built). Say "count WP06 and WP07 limited" and the count becomes 7 of 11, with the narrowing written into the plan.
