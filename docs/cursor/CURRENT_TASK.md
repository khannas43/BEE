# Current Cursor task

**Holder:** cursor, from 18 October 2026.

- Brief: `BRIEF_19C_A_SNL_WP02C_REGISTRATION_DB_BOUNDARY.md`
- Branch: `cursor/snl-wp02c-registration-db-boundary`
- Base: `main @ d981bb6`
- Work package: `SNL-WP02C registration return/resubmit trusted database boundary`
- Scope: V73 registration return/resubmit cycle schema, two trusted orchestrators, internal Java repository and full database integrity/concurrency proofs. No live service hook in this slice.
- Boundaries: do not edit V69–V72, `RegistrationReviewService`, public API/UI, model behaviour, 60-day job, demo journeys or the Word document; no push or PR.
- Completion: satisfy Brief 19C-A sections 1–10, run the full gates, stop local services, release the worktree baton to `claude`, and provide `/bee-handback` for ChatGPT review.
