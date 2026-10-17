# Brief 17A — SNL WP01 review corrections

## Purpose

Resolve the ChatGPT review findings on Brief 17 so the WP1 baseline is internally consistent, source-accurate and ready for final acceptance. Continue on `cursor/snl-wp01-traceability`; this is a documentation-only correction pass.

## Governing source

`/Users/sameerkhanna/Documents/Documents/BEE/SnL_Disha_Advisory_Manual.pdf` remains authoritative. Use printed footer page numbers. The live form URL remains secondary and may remain unavailable; do not infer its fields from search snippets or third-party pages.

## Required corrections

### 1. Make the branch-wide whitespace check truthful

- Remove trailing Markdown whitespace in the four new WP1 documents.
- Run `git diff --check 8528c48..HEAD` after committing, not only `git diff --check` on an already-clean worktree.

### 2. Correct the 60-day citations and distinguish outcomes

- Table 2 brand-registration auto-cancellation is **row 5**, printed p. 29, not row 6.
- §3.2, printed p. 24 says a model application with no applicant action within 60 days “shall stand cancelled”.
- §3.4, printed p. 25 says a brand/model application may be **rejected** when the applicant fails to respond within 60 days or fails to pay dues within 60 days.
- Table 3 row 5, printed p. 30 gives 60 days for revised model documents but does not itself say “auto-cancel”.
- Preserve these distinct manual statements. Add the cancel-versus-reject normalization as an explicit WP2 policy conflict/decision point; do not silently collapse them.
- Fix withdrawal/cancellation citations throughout: §3.7 starts on printed p. 26 and continues on p. 27; §3.8 starts on p. 27 and continues on p. 28.

### 3. Complete the role/authority matrix

Update `docs/snl/SNL_WP01_ROLE_MATRIX.md` so it explicitly covers:

- applicant/manufacturer;
- Registration Scrutiny Officer or designated agency;
- portal Programme role versus the manual’s Programme Director role;
- Director;
- Secretary;
- Finance;
- supervisor;
- auditor;
- system jobs.

For entity/company/brand, category, and model journeys, record the target action and its basis as exactly one of `Manual`, `Existing implementation`, or `Assumption`. Do not use a combined `R/A` that obscures segregation of duties. Populate provisional category-registration, renewal, withdrawal and cancellation responsibilities from A02, A03 and A15, clearly labelled as assumptions.

### 4. Complete the required state models

Update `docs/snl/SNL_WP01_STATE_MODELS.md` with distinct target transition tables for:

1. legal entity/company and brand registration;
2. appliance-category registration, including the security-deposit gate;
3. model registration.

Each allowed transition must identify from/to state, actor, guard, evidence/audit event, notification, deadline where the manual supplies one, and basis (`Manual`, `Existing implementation`, or `Assumption`). Cover draft, submission, payment pending/settled/exception, scrutiny, structured return, applicant response, resubmission, recommendation, approval, rejection, the 60-day outcomes, renewal, withdrawal and cancellation. Later-lifecycle transitions may point to WP9, but they must not be omitted.

### 5. Make the public-form limitation explicit and consistent

- `docs/snl/SNL_WP01_FIELD_DICTIONARY.md` must contain a `Public form` comparison column or a separate comparison table. Mark items `Unavailable — BL-252` where the page could not be verified.
- In the implementation plan, do **not** check “Inspect the current BEE Company Registration Form” while the page remains unavailable. Record the attempted fetch and BL-252.
- Do not mark WP1 complete. Set it to `Gate pending`, 90%, with live-form comparison and final ChatGPT acceptance still open.

### 6. Update traceability records

- Correct BL-253 and every related citation.
- Add a backlog item for the 60-day cancel-versus-reject normalization if it is not already captured by BL-255; use the next available ID without renumbering existing entries.
- Update the WP1 evidence note and work-package log with this review correction pass.
- Keep A01–A20 provisional. Do not invent or approve policy.

## Allowed files

- `docs/BACKLOG.md`
- `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md`
- `docs/snl/SNL_WP01_BASELINE.md`
- `docs/snl/SNL_WP01_FIELD_DICTIONARY.md`
- `docs/snl/SNL_WP01_ROLE_MATRIX.md`
- `docs/snl/SNL_WP01_STATE_MODELS.md`

Do not edit `docs/BEE_DECISIONS.md` unless only a broken citation must be corrected. Do not edit code, tests, schemas, migrations, OpenAPI, generated files, runtime configuration, demo data or `.docx` files. Do not push.

## Acceptance checks

- All findings above are resolved without weakening the manual/assumption distinction.
- `git diff --check 8528c48..HEAD` passes.
- `npm run web:test` passes.
- `git status --short` is clean after the correction commit.
- Final report lists each review finding and exactly how it was resolved.

When complete, run `/bee-handback` and return the full report.
