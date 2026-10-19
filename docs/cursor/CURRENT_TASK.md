# Current Cursor task

**Holder:** released to Claude, 19 October 2026.

- Brief: **C3A final verification correction** (contract pin + live five-role proof)
- Branch: `cursor/c3-role-navigation` @ `522a6bb` + verification commit
- Worktree: `/Users/sameerkhanna/Developer/BEE-c3-role-navigation`

## Gates (19 October 2026)

| Gate | Result |
| --- | --- |
| OpenAPI version | **0.37.2** (unchanged) |
| `scripts/local/contract-pin.json` | SHA256 `fc06669ad1b40bf79d4018b5dd7a459a2967bf92641602e4dc4dc6affba01e85` |
| `node scripts/local/contract-artifact.test.mjs` | **7/7** |
| Full `@Tag("db")` suite | pass (`mvn test -Dgroups=db -Dbee.test.excludedGroups=none`) |
| `npx tsc --noEmit` | pass |
| `npm run web:test` | **264/264** |
| `npm run web:test:ui` | **270/270** |
| `npm run build` | pass |
| `git diff --check` | pass |
| `npm run local:c3a-five-role` | **17/17** |

## Live five-role (local stack)

- **Keycloak:** Cleared brute-force lockouts on C3A personas; reset seeded passwords to `BEE_DEV_USER_PASSWORD` and enrolled local TOTP secrets for browser sign-in (demo `demo123` was invalid after lockout). **Demo ngrok web** restored: `BEE_WEB_ORIGIN=https://nicola-habited-barb.ngrok-free.dev`, redirect_uri back on ngrok.
- **API:** Rebuilt and restarted from this worktree (C3A Spring changes on `:8090`).
- **Web (C3A run only):** Temporarily `BEE_WEB_ORIGIN=http://127.0.0.1:3100` for Keycloak callback; restored after check.

## BL-266

**Closed** — all gates above green.

## Not run

- `npm run local:check` (full 2000+ item gate; not requested for this correction pass)
- `npm run local:down` (shared runtime left up for demo; API/web from verification)
