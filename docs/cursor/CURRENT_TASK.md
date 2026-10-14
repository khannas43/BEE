# Current Cursor task

**Holder:** cursor, from 14 October 2026.

- **Brief:** [BRIEF_13_REGISTRATION_APPLICANT_SCREENS.md](BRIEF_13_REGISTRATION_APPLICANT_SCREENS.md)
- **Branch:** `cursor/registration-applicant-screens`, created from `main` at `0d05ea2` (WP04.2b-1 merged, PR #44).
- **Additions or overrides:** none. The server routes, the contract (0.28.0) and the REG fees already exist; you build only the screens. Do not start review or approval screens (Brief 14, after WP04.2b-2).
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint . --max-warnings 0`; `npm run web:test`; `npm run web:test:ui` (the total in the report is the current 109 plus yours); `npm run build`.
- **Live checks:** you may run `npm run local:registrations` (178 checks, must stay 178/0) and `npm run local:model-submit` against the runtime you start (`npm run local:up`, `npm run local:seed`; `BEE_API_PORT=8091` if 8090 is taken) and stop (`npm run local:down`). Do **not** run `npm run local:check`. Anything else goes under "Not run".
