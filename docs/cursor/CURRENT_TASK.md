# Current Cursor task

**Holder:** cursor, from 18 October 2026.

- Brief: `BRIEF_19C_A1_SNL_WP02C_REGISTRATION_DB_BOUNDARY_CORRECTIONS.md`
- Branch: `cursor/snl-wp02c-registration-db-boundary`
- Base: `main @ d981bb6`
- Work package: `SNL-WP02C registration trusted-boundary corrections`
- Scope: correct V73 in place: remove the production maint closure bypass, derive/verify trusted actor/owner/role/due metadata, make replay stable after later lifecycle transitions, and strengthen atomicity, concurrency, tamper and recipient proofs. No live service hook in this slice.
- Boundaries: do not add V74; do not edit V69–V72, `RegistrationReviewService`, public API/UI, model behaviour, supervisor queue, 60-day job, demo journeys or the Word document; no push or PR.
- Completion: satisfy Brief 19C-A1 sections 1–8, run the full gates, stop local services, release the worktree baton to `claude`, and provide `/bee-handback` for ChatGPT review. Do not mark 19C-A accepted.
