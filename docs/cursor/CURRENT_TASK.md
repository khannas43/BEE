# Current Cursor task

**Holder:** cursor, from 18 October 2026.

- Brief: `BRIEF_19B_SNL_WP02B_MODEL_RETURN_WIRING.md`
- Branch: `cursor/snl-wp02b-model-return-wiring`
- Base: `main @ 582f0b5`
- Work package: `SNL-WP02B-2 — model return/resubmit loop`
- Scope: V71 durable model-cycle linkage; atomic task, discrepancy and SLA-clock wiring; exactly-once applicant return notification; targeted officer resubmit notification; replay, concurrency and rollback proof.
- Boundaries: no registration wiring, new public API/UI, supervisor queue, scheduler, demo data, Word/PDF change, push or PR.
- Completion: commit implementation, run full default and DB-tagged suites plus build/web/type checks, stop local services, run `/bee-handback`, and return the complete report for ChatGPT review. Leave the owner-controlled untracked Word file untouched.
