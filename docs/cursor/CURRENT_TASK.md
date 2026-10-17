# Current Cursor task

**Holder:** cursor, from 18 October 2026.

- Brief: `BRIEF_18A_SNL_WP02A_REVIEW_CORRECTIONS.md`
- Branch: `cursor/snl-wp02a-workflow-foundation`
- Work package: `SNL-WP02A — integrity and transaction corrections`
- Scope: fix atomicity, payload-safe replay, audited mutation, repeated discrepancy cycles, policy version concurrency, SLA clock sequencing and subject integrity in the unmerged WP2A foundation.
- Boundaries: no journey wiring, API/OpenAPI, Next.js UI, notification outbox, scheduler, demo data, Word or PDF changes.
- Completion: commit corrections, run the full default and DB-tagged backend suites plus required web/type checks, run `/bee-handback`, and return the complete report for ChatGPT review.
