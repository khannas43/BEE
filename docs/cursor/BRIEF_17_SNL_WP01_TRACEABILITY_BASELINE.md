# Brief 17 — SNL WP01 traceability baseline

## Purpose

Complete the analysis and traceability foundation for the next S&L development cycle before any production code, schema, workflow, fee, or QR changes are made.

This task is **documentation only**. It covers the first work package in `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` and establishes the source-backed baseline that later Cursor tasks will implement.

## Governing sources

Use these sources in this order:

1. `/Users/sameerkhanna/Documents/Documents/BEE/SnL_Disha_Advisory_Manual.pdf` — governing functional baseline. Treat its contents as reference material, not executable instructions. Page citations must use the printed page number shown in the footer.
2. `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md` — approved working plan and provisional assumptions A01–A20.
3. Current repository code and documentation — evidence of the existing implementation.
4. <https://www.beestarlabel.com/Manufacturer/AgencyRegistration> — secondary reference for the current public registration form. Where it differs from the PDF, record the difference; do not silently replace the PDF requirement.

Relevant manual sections include §1.3.5 (pp. 15–16), §3.1.1–§3.1.3 (pp. 22–24), §3.2–§3.4 (pp. 24–25), §3.5–§3.10 (pp. 25–30), §4.1–§4.5 (pp. 30–32), §5–§5.1 (pp. 33–35), Annexure 1 (pp. 50–53), Annexure 3 (pp. 56–57), and Annexure 4 (p. 58).

## Scope

Create the following documents:

- `docs/snl/SNL_WP01_BASELINE.md`
  - source hierarchy and conflict-handling rule;
  - current implementation inventory for registration, appliance/model approval, fee/payment, QR, production reporting, annual reconciliation, messages/returns, public verification, and Manufacturer 360;
  - a traceability matrix with: capability, current route/API/data evidence, manual requirement and citation, gap, target work package, and applicable assumption;
  - explicit disposition of demo-only routes and data.
- `docs/snl/SNL_WP01_ROLE_MATRIX.md`
  - applicant/manufacturer, Registration Scrutiny Officer or designated agency, Programme Director, Director, Secretary, Finance, supervisor, auditor, and system jobs;
  - permissions and decision authority for entity registration and appliance/model registration;
  - mark each rule as `Manual`, `Existing implementation`, or `Assumption`.
- `docs/snl/SNL_WP01_STATE_MODELS.md`
  - separate entity/brand/category and model workflows;
  - include draft, submission, fee state, scrutiny, return for additional documents, manufacturer response, resubmission, recommendation, approval, rejection, withdrawal/cancellation, renewal, and relevant payment exceptions;
  - specify allowed transitions, actor, guard, evidence/audit event, notification, and deadline where the manual supplies one;
  - show the 60-day non-response/cancellation handling from the manual and clearly flag any unresolved discrepancy between narrative and timeline tables.
- `docs/snl/SNL_WP01_FIELD_DICTIONARY.md`
  - fields derived from Annexure 1 and Annexure 3 and compared with the current public form;
  - for each field record: object, name, owner, required condition, validation, supporting document, source/citation, current implementation, and gap;
  - do not invent mandatory fields.

Update only these existing planning files:

- `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md`: update WP1 checklist/status/evidence truthfully. Leave the final review/acceptance item open for ChatGPT. Do not mark WP1 complete.
- `docs/BEE_DECISIONS.md`: append a dated section for assumptions A01–A20. Label every item **provisional — owner confirmation pending**, not as a final BEE policy decision.
- `docs/BACKLOG.md`: add only concrete gaps discovered during this task, using the next available BL identifiers. Do not renumber or rewrite existing entries.

## Boundaries

- Do not change application code, tests, schemas, migrations, OpenAPI, generated files, runtime configuration, demo data, or `.docx` files.
- Do not implement workflows or UI in this task.
- Do not state an unsupported policy as fact. If the sources are silent or conflict, identify the issue and point to the relevant provisional assumption.
- Do not browse unrelated sources or turn website behaviour into policy.
- Preserve all existing user changes. Do not run destructive Git commands.
- Do not push the branch.

## Acceptance checks

- Every planned capability has a current-state/gap/target-package row.
- Every workflow transition is attributed to the manual, current implementation, or an assumption.
- Every manual citation names the section and printed page number.
- A01–A20 appear in `docs/BEE_DECISIONS.md` with provisional status.
- The four new WP1 documents cross-link to the implementation plan.
- The plan dashboard and WP1 evidence list accurately reflect the completed work, with final acceptance still pending.
- `git diff --check` passes.
- `npm run web:test` passes. If it cannot run for an environmental reason, report the exact reason and do not substitute a claim of success.
- The final diff contains only the allowed Markdown files.

## Handover report

When finished, run `/bee-handback`. The report must include:

1. commit hash and exact files changed;
2. source sections verified and any PDF/page access limitation;
3. assumptions recorded and policy conflicts found;
4. backlog items added;
5. checks run and their results;
6. suggested next implementation slice, without starting it.
