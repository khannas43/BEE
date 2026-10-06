# Current Cursor task

**Holder:** cursor.

- **Brief:** [BRIEF_10_NOTIFICATIONS_UI.md](BRIEF_10_NOTIFICATIONS_UI.md).
- **Branch:** `cursor/notifications-ui`, already created and checked out by Claude from `main` (e00a0b3, with WP10.1a merged).
- **Additions or overrides:** none. Note the housekeeping step 0 (four stray duplicate files) goes in its own commit. If port 8090 is held by something else on this machine, set `BEE_API_PORT=8091` for every command (the runtime and the live checks honour it).
- **Acceptance commands:** `npx eslint . --max-warnings 0` (zero); `npx tsc --noEmit` (clean); `npm run web:test` (198); `npm run web:test:ui` (77 plus yours); `npm run build`.
- **Live checks:** you may run, after `npm run local:up` and `npm run local:seed`, then `npm run local:down`: `npm run local:read-ui` (report the new total), `npm run local:inbox`, `npm run local:secretary-approval` (127). Everything else goes under "Not run".
