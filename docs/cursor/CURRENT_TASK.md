# Current Cursor task

**Holder:** cursor, from 18 October 2026.

- Brief: `BRIEF_19_SNL_WP02B_RETURN_RESPONSE_WIRING.md`
- Branch: `cursor/snl-wp02b-return-response-wiring`
- Work package: `SNL-WP02B — return, applicant response and review-task wiring`
- Scope: atomically wire registration and model return/resubmit loops to common tasks, discrepancies, paused SLA clocks and production in-portal notifications; add an internal read projection.
- Boundaries: no new API/OpenAPI/BFF/UI, supervisor screen, scheduler, 60-day job, demo data, Word or PDF changes.
- Completion: commit implementation, run full default and DB-tagged suites plus web/type checks, stop local services, run `/bee-handback`, and return the complete report for ChatGPT review. Leave the owner-controlled untracked Word file untouched.
