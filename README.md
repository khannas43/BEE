# BEE Standards and Labelling portal (local demonstration build)

A working local demonstration of a Bureau of Energy Efficiency portal: manufacturers and agencies register brands and file model applications; BEE officers scrutinise, rate, approve and issue certificates; a simulated ledger, payments, QR serials, quarterly production, advisory AI, dashboards and exports sit around that. **All data is synthetic and nothing here is a BEE record.** Three things are simulated and said so on screen: the Fabric ledger, the payment gateway and the AI models.

**Start with `docs/HANDOVER_2026-10-17.md`** (what exists, how to run it, what is open). The presenter script is `docs/demo/DEMO_SCRIPT.md`.

## Stack
- **Portal:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 3. A server layer (`app/api/runtime/**`) holds the session, validates every answer against a contract and logs requests. This Next.js differs from older versions: read `node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).
- **Back end:** Spring Boot 3.5 on Java 17 (`backend/`), plain JDBC, Spring Security as an OAuth2 resource server.
- **Data:** PostgreSQL with Flyway migrations (`backend/src/main/resources/db/migration`, V1 to V68). Many rules are enforced in the database itself (triggers, append-only audit tables, separation of duties, hash chains).
- **Identity:** Keycloak. Normal sign-in is PKCE with a one-time code; the demonstration uses a password-only sign-in (`BEE_DEMO_LOGIN=1`).
- **Local runtime:** PostgreSQL and Keycloak in Docker (`local/compose.yaml`); API on 8090, portal on 3100, Keycloak on 8180, PostgreSQL on 5434.

## Run it
Needs Node 20+, Java 17, Maven, Docker and `jq`.
```bash
npm install
npm run local:up        # database, Keycloak, API, portal
npm run local:reset     # clean data and the 16 sample users
```
Demonstration mode (password sign-in, sample data), in one shell:
```bash
export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false
npm run local:down && npm run local:up
bash scripts/local/ensure-runtime-role.sh
node scripts/demo/login-setup.cjs apply
npm run demo:seed       # safe to run again
```
Open http://127.0.0.1:3100/login. Every demo account uses the password `demo123` (usernames in `docs/demo/DEMO_SCRIPT.md`). For a completely fresh start: `npm run local:down && npm run local:up && npm run local:reset`, then the block above.

## Test it
| What | Command |
|---|---|
| Types and lint | `npx tsc --noEmit` and `npx eslint . --max-warnings 0` |
| Portal checks | `npm run web:test` |
| UI tests | `npm run web:test:ui` |
| Back end, default suite | `cd backend && mvn test` |
| Database tests (throwaway schemas on the local PostgreSQL) | `cd backend && mvn test -Dgroups=db -Dbee.test.excludedGroups=none` with the variables from `scripts/local/lib.sh` exported |
| Full gate (about 25 minutes; needs the runtime up and **demo mode off**) | `npm run local:check` |

The full gate counts records, so run it on a reset database **without** `demo:seed`, with `BEE_DEMO_LOGIN` unset, and with Keycloak sessions of the sample users cleared. Details: `docs/demo/DEMO_DAY_CHECKLIST.md` ("After the demo") and `docs/kit/`.

## Where things are
- `app/`, `components/`, `lib/`: portal pages, screens, client libraries (CSV, Excel, PDF and QR are hand-written, no libraries), server layer.
- `backend/`: Spring service, migrations, tests (`*DatabaseTest` use the real migrations).
- `local/`: Docker compose, Keycloak realm, seed data (`local/seed/seed.sql` and `local/seed/demo/s1` to `s8`).
- `scripts/local`, `scripts/demo`: runtime, gate, checks, demo set-up.
- `docs/`: plans, decisions (`BEE_DECISIONS.md`), backlog (`BACKLOG.md`), API contract (`wp03/bee-local-api.openapi.json`), demo notes (`docs/demo/`), screen kit (`docs/kit/`).

## Rules worth knowing before changing anything
- Never edit an applied Flyway migration; add a new one. The tests assert the migration count.
- The OpenAPI file and the code must agree: a test fails on drift. The demonstration family `/api/demo/**` is documented in `docs/demo/API.md`, with a test that checks the document against the code.
- Do not edit repository files while the full gate runs.
- `AGENTS.md` is written by `next dev`; keep it.
