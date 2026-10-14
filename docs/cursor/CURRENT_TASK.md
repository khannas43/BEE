# Current Cursor task

**Holder:** cursor, from 14 October 2026.

- **Brief:** [BRIEF_16_DELEGATION_SCREEN.md](BRIEF_16_DELEGATION_SCREEN.md)
- **Branch:** `cursor/delegation-screen`, created from `main` at `26aae74` (WP02.4c merged, PR #54).
- **Additions or overrides:** none. The server routes and the contract (0.32.0) already exist; you build only the screen.
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint . --max-warnings 0`; `npm run web:test`; `npm run web:test:ui` (the total in the report is the current 135 plus yours); `npm run build`.
- **Live checks:** you may run `npm run local:delegation` (106 checks, must stay 106/0) and `npm run local:register-revocation` (100/0) against the runtime you start (`npm run local:up`, `npm run local:seed`; `BEE_API_PORT=8091` if 8090 is taken) and stop (`npm run local:down`). Do **not** run `npm run local:check`. Anything else goes under "Not run".
