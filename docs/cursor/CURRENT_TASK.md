# Current Cursor task

**Holder:** cursor (handed over 4 October 2026)

- **Brief:** `docs/cursor/BRIEF_01_DRAFT_FORM_ON_KIT.md`
- **Branch:** `cursor/draft-form-on-kit` (already created and checked out by Claude, from the integration tip)
- **Additions or overrides:** Work only in this folder. The React test runner now exists (`npm run web:test:ui`, Vitest, 19 tests; see `docs/kit/UI_TESTS.md`), so the brief's "no React test runner yet" no longer applies: add hook or component tests there if you extract anything worth testing. `web:test` is now 110. iCloud may create stray "name 2.ext" copies; do not commit them.
- **Acceptance commands:**
  1. `npx tsc --noEmit`
  2. `npx eslint components/app/lifecycle/NewModelApplication.tsx` (say whether the two BL-035 `set-state-in-effect` errors went away)
  3. `npm run web:test` (110) and `npm run web:test:ui` (19, plus any you add)
  4. `npm run build`
- **Live checks:** Not run by you. Do not start the runtime; list `local:model-drafts` and `local:model-submit` under "Not run". Claude runs them at merge, and BL-082 stays `open` with a note until then.
- **Finish with:** `/bee-handback`. Never push.
