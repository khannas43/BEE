# Current Cursor task

**Holder:** cursor, from 14 October 2026.

- **Brief:** [BRIEF_15_REGISTER_REVOCATION_SCREEN.md](BRIEF_15_REGISTER_REVOCATION_SCREEN.md)
- **Branch:** `cursor/register-revocation-screen`, created from `main` at `f9b8223` (WP04.2b-2b merged, PR #50).
- **Additions or overrides:** none. The server routes and the contract (0.30.0) already exist; you build only the screen.
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint . --max-warnings 0`; `npm run web:test`; `npm run web:test:ui` (the total in the report is the current 128 plus yours); `npm run build`.
- **Live checks:** you may run `npm run local:register-revocation` (100 checks, must stay 100/0), `npm run local:registration-review` (122/0) and `npm run local:registrations` (178/0) against the runtime you start (`npm run local:up`, `npm run local:seed`; `BEE_API_PORT=8091` if 8090 is taken) and stop (`npm run local:down`). Do **not** run `npm run local:check`. Anything else goes under "Not run".
