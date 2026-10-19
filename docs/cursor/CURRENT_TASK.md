# Current Cursor task

**Holder:** released to Claude, 19 October 2026.

- Brief: **C3A — Admin read-only demonstration access** (register/revocation correction)
- Branch: `cursor/c3-role-navigation`
- Worktree: `/Users/sameerkhanna/Developer/BEE-c3-role-navigation`

## Gates (this pass)

| Gate | Result |
| --- | --- |
| TypeScript | pass |
| ESLint (changed files) | pass (no new findings) |
| Backend unit (`AdminDemonstrationAccessTest`, `SlicePolicyTest`) | pass |
| `RevocationDatabaseTest` | pass (5/5, incl. `adminDemonstrationReadsRegisterButCannotMutate`) |
| Full `@Tag("db")` suite | pass |
| `npm run web:test` | **263/264** — `contract-artifact.test.mjs` pin SHA256 ≠ current OpenAPI (pre-existing C3A pin drift) |
| `npm run web:test:ui` | **270/270** |
| `npm run build` | pass |
| `git diff --check` | pass |
| `npm run local:c3a-five-role` | **Not run green** — Keycloak login form did not appear (~62s timeout on first persona) |

**BL-266:** remains **open** until contract pin + live five-role check pass.
