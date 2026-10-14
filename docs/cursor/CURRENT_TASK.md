# Current Cursor task

**Holder:** cursor, from 14 October 2026.

- **Brief:** [BRIEF_14_REGISTRATION_REVIEW_SCREENS.md](BRIEF_14_REGISTRATION_REVIEW_SCREENS.md)
- **Branch:** `cursor/registration-review-screens`, created from `main` at `5e17731` (WP04.2b-2 merged, PR #46).
- **Additions or overrides:** none. The server routes and the contract (0.29.0) already exist; you build only the screens. Revocation is a later package (WP04.2b-2b).
- **Acceptance commands:** `npx tsc --noEmit`; `npx eslint . --max-warnings 0`; `npm run web:test`; `npm run web:test:ui` (the total in the report is the current 119 plus yours); `npm run build`.
- **Live checks:** you may run `npm run local:registrations` (178 checks, must stay 178/0), `npm run local:registration-review` (104 checks, must stay 104/0) and `npm run local:model-submit` against the runtime you start (`npm run local:up`, `npm run local:seed`; `BEE_API_PORT=8091` if 8090 is taken) and stop (`npm run local:down`). Do **not** run `npm run local:check`. Anything else goes under "Not run".
