# Current Cursor task

**Holder:** cursor, 19 October 2026. C3A complete; hand-back below.

- Brief: **C3A — Admin read-only demonstration access** (extends [BRIEF_C3_ROLE_LIFECYCLE_NAVIGATION.md](BRIEF_C3_ROLE_LIFECYCLE_NAVIGATION.md) §9)
- Branch: `cursor/c3-role-navigation`
- Worktree: `/Users/sameerkhanna/Developer/BEE-c3-role-navigation`

## Gates (C3A)

| Gate | Result |
| --- | --- |
| TypeScript | pass |
| ESLint (changed files) | not re-run whole repo (BL-035 baseline) |
| Backend unit (`AdminDemonstrationAccessTest`, `SlicePolicyTest`) | pass |
| Backend DB (registration, onboarding admin tests) | not run (needs local PostgreSQL) |
| `npm run web:test` | pass |
| `npm run web:test:ui` | **268/268** (includes AdminDemonstration + adminMenuCoverage) |
| `npm run build` | pass |
| `npm run local:c3a-five-role` | **Not run** — Keycloak login form did not appear (portal/Spring not up on this machine; postgres/keycloak containers only) |
