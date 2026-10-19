# Current Cursor task

## WP3-D1 — guest manufacturer signup and Director activation (this worktree)

**Holder:** Cursor on `cursor/wp3-guest-director-approval` (worktree `/Users/sameerkhanna/Developer/BEE-wp3-guest-director-approval`), parallel with C3B. Do not edit Agent A C3B files (RoleContext, AppSidebar, Admin banner, login visual design). Do not restart the shared ngrok/demo stack.

- Brief: **WP3-D1 guest manufacturer signup and Director-gated activation**
- Branch: `cursor/wp3-guest-director-approval` from `cursor/c3-role-navigation` @ `cb85f18`
- Policy: new applications stop at `director_review`; Director approval activates; V77 automatic-activation history is retained
- Contract: **0.38.0**
- Live demo apply: **BL-268** (coordinated window)

---

**Previous (C3A, other worktree):** released to Claude, 19 October 2026.

- Brief: **C3A final verification correction** (contract pin + live five-role proof)
- Branch: `cursor/c3-role-navigation` @ `522a6bb` + verification commit
- Worktree: `/Users/sameerkhanna/Developer/BEE-c3-role-navigation`

## WP3-D1 gates (19 October 2026)

| Gate | Result |
| --- | --- |
| OpenAPI version | **0.38.0** |
| `scripts/local/contract-pin.json` | SHA256 `00a11d61d07fbed0155c5d8c138417c1ede048e6be88f0371c30c9233f125fa6` |
| `node scripts/local/contract-artifact.test.mjs` | **7/7** |
| Default `mvn test` | **165/165** |
| Full `@Tag("db")` suite | **597/597** (`mvn test -Dgroups=db -Dbee.test.excludedGroups=none`); WP3 class **32/32** |
| Spring contract test | **40/40** (included in default suite) |
| `npx tsc --noEmit` | pass |
| `npx eslint` (changed TS files) | pass (DirectorQueue setState-in-effect fixed) |
| `npm run web:test` | **272/272** |
| `npm run web:test:ui` | **270/270** |
| `npm run build` | pass |
| `git diff --check` | pass |

## Previous C3A gates (19 October 2026)

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
