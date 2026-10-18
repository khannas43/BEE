# Current Cursor task

**Holder:** cursor, from 18 October 2026.

- Brief: `BRIEF_19C_A2_SNL_WP02C_PAYLOAD_AND_PROOF_CLOSURE.md`
- Branch: `cursor/snl-wp02c-registration-db-boundary`
- Base: `main @ d981bb6`
- Work package: `SNL-WP02C registration payload integrity and proof closure`
- Scope: correct V73 in place: calculate canonical command payloads inside the database, reject old-hash/changed-input replay, use deterministic role-validity anchors, and complete rollback, concurrency, recipient and tamper proofs. No live service hook in this slice.
- Boundaries: do not add V74; do not edit V69–V72, `RegistrationReviewService`, public API/UI, model behaviour, supervisor queue, 60-day job, demo journeys or the Word document; no push or PR.
- Completion: satisfy Brief 19C-A2 sections 1–8, run the full gates, stop local services, release the worktree baton to `claude`, and provide `/bee-handback` for ChatGPT review. Do not mark 19C-A accepted.
