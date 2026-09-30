# ADR-001: Local runtime for the first slice

Status: accepted as WP01.3 documentation and design on 30 September 2026. WP01 is accepted as documentation and design evidence (1 of 11 work packages, 9.1%). Runtime implementation and start proof remain for WP03.

Date: 30 September 2026. Scope: local development on one MacBook, first registration-to-model slice ([FIRST_SLICE.md](FIRST_SLICE.md)). Excluded: WP12 external adapters, WP13 migration, WP14 quality and release.

This ADR documents architecture, a provisional resource budget and a command contract. It adds no containers, scripts or code. The executable start, seed, reset and health proof belongs to WP03 and does not block WP01 acceptance.

## 1. Context

- The portal is Next.js 16 / React 19 with all state in the browser (`localStorage`) and a client-side route guard. [INVENTORY.md](INVENTORY.md) G17 and G18 record that identity and authorisation are not enforced anywhere on a server.
- The pre-ADR `docs/DEVELOPMENT_PLAN.md` §3.1 left the primary backend and local identity choice open. This ADR resolved them to Spring Boot and Keycloak; the plan now reflects those decisions. §3.2 records the minimum runtime, resource budget and service boundaries.
- The MacBook, observed on 30 September 2026: Apple M5, 10 cores, 32 GB RAM, about 51 GB free disk; Node 22.23, npm 10.9, Java 17.0.18, Maven 3.9.12, psql 18.3 client; Docker 29.5 through Rancher Desktop with a VM of about 19.5 GB and 8 CPUs.
- The machine is shared with other work. Already listening: Homebrew PostgreSQL 16 on 5432; an unrelated Docker stack on 3000, 5433, 8080, 8081, 9010, 9011 and 9083; Ollama on 11434.
- `next dev` rewrites a block in `AGENTS.md`.

## 2. Decisions

### D-RT1 Backend: one Spring Boot application

Spring Boot 3 on Java 17, built with Maven, as one deployable. Domain modules are packages in that application: `identity` (session principal, membership lookup), `policy` (slice authorisation rules), `registration` (organisation, brand, authorisation), `lifecycle` (model application state machine, rating, decisions), `fees` (fee rule, manual confirmation) and `history` (append-only transitions). No second backend language, no separate microservices.

### D-RT2 Web-to-API path: Next.js server routes as a same-origin BFF

The browser talks only to Next.js. Next.js server route handlers hold the session in an httpOnly, SameSite=Lax cookie, perform the Keycloak authorization-code flow with PKCE, and forward calls to Spring with the access token. The browser never receives a token and never calls Spring directly. Spring decides every authorisation and data-scope question; the Next.js menu and route guard stay a convenience, not a control.

This touches `app/` only in WP02/WP03. WP01 changes nothing there.

### D-RT3 Identity: Keycloak identifies the user; Spring's database decides access

- Keycloak 26 runs as a local container in development mode with one realm, imported from a versioned JSON file (WP02.1). It authenticates the user and issues tokens. Spring validates them as an OAuth2 resource server.
- **Keycloak identifies the user only.** Spring maps the token subject (`sub`) to a `user_account` row. Organisation membership, role assignment, stage assignment (IAME, Reviewer) and record scope are read from Spring's own PostgreSQL tables and are authoritative there.
- A persona role in the token is necessary but not sufficient: Spring also requires an active `role_assignment` row for that user and role.
- Keycloak user attributes (for example an organisation name) may be used to seed Spring's tables or to display a label. Spring must never grant data access from a token attribute alone.
- Rejected: a development-only identity provider (chosen against in the WP01.3 decision), and deriving organisation scope from token claims.

### D-RT4 Authorisation scope: only the reviewed first-slice rules

When WP02/WP03 begin, Spring implements only the explicitly reviewed first-slice roles, actions and denial rules: the 7 steps and their actors in [FIRST_SLICE.md](FIRST_SLICE.md) §3, the read rules each slice role needs, and the 10 denial cases in §8. Every other API action is denied by default.

Spring does **not** import capacities from [SCREEN_ACTION_MATRIX.md](SCREEN_ACTION_MATRIX.md) or `lib/screenMatrix.ts`. The 540 reachability mismatches listed there remain proposals for policy review and are granted nowhere. The prototype's client-side menu policy (`lib/categories.ts`) is unchanged by this ADR.

### D-RT5 Data: dedicated PostgreSQL container, targeted app-data reset

- One `postgres:16` container dedicated to this project, with its own named volume, holding two databases: `bee_app` (Spring, schema managed by Flyway migrations) and `keycloak` (Keycloak's own store).
- Routine reset is **targeted to application data**: it drops and recreates only the application schema inside `bee_app`, reapplies migrations and loads the seed. It refuses to run unless the connection is to `localhost` on the project port and the database is `bee_app`. It never touches the `keycloak` database, the Homebrew instance or the other Docker stack.
- Identity reset is a separate command that re-imports the realm.
- Deleting the project's database volume is a separate destroy command that asks for explicit confirmation. It is not part of any routine reset, check or demo.
- Rejected: reusing the Homebrew PostgreSQL 16 on 5432 (shared with other work, no isolated reset).

### D-RT6 Documents, workflow and deferred components

- Documents: a git-ignored local folder with files named by SHA-256 hash and metadata in PostgreSQL (WP06). No MinIO or object store.
- Workflow: the in-process application state machine in [FIRST_SLICE.md](FIRST_SLICE.md) §4. No Temporal.
- Deferred and not started by this runtime: Hyperledger Fabric (WP09), AI inference and Ollama (WP11), API gateway, message bus, search, analytics stack and every item in DEVELOPMENT_PLAN §3.2's exclusion list.

### D-RT7 Ports: provisional

| Component | Proposed port | Reason |
| --- | ---: | --- |
| Next.js web and BFF | 3100 | 3000 is in use |
| Spring API | 8090 | 8080 and 8081 are in use |
| Keycloak | 8180 | 8080 is in use |
| PostgreSQL (project container) | 5434 | 5432 and 5433 are in use |

These are provisional. WP03 must check that each port is free before starting and fail with a clear message if not. All services bind to `127.0.0.1`.

### D-RT8 Resource budget: provisional

| Component | Estimated resident memory |
| --- | ---: |
| Keycloak (development mode) | about 1.0 GB |
| Spring Boot application | about 0.8 GB |
| PostgreSQL container | about 0.3 GB |
| `next dev` | about 1.5 GB |
| **Total** | **about 3.6 GB** |

This is an estimate, not a measurement. WP03 must measure resident memory with the slice running and record the result against this budget. If Docker memory is short while the unrelated stack is running, the documented action is to stop that stack, not to shrink this one below what the slice needs. Disk budget: under 5 GB for images and volumes, also to be measured.

## 3. Command contract

WP03 implements these commands; this ADR fixes only their names and behaviour. Nothing here is executable yet.

| Command | Behaviour |
| --- | --- |
| `npm run local:up` | Check that ports are free and Docker is running; start PostgreSQL, Keycloak and Spring; start Next.js on the web port. Idempotent. |
| `npm run local:seed` | Load the synthetic seed (Nova Cool, PixelCert, the internal personas, one fee rule, formula version "0-unverified") into `bee_app`. Idempotent; no duplicate rows. |
| `npm run local:reset` | Targeted app-data reset of `bee_app` as in D-RT5, then seed. Never touches the `keycloak` database or any volume. |
| `npm run local:reset:identity` | Re-import the Keycloak realm. |
| `npm run local:check` | Report pass/fail for: each port reachable; Spring health endpoint; Keycloak realm discovery; database migration version; seed counts; measured memory per component against D-RT8. |
| `npm run local:down` | Stop the project's containers and processes; keep data. |
| `npm run local:destroy` | Remove the project's containers and volume after explicit confirmation. Not routine. |

Any command that runs `next dev` must restore `AGENTS.md` afterwards, or WP03 must configure Next.js so the file is not rewritten.

## 4. Consequences

- WP02 and WP03 can start on one backend with a single authority for access, and without importing unreviewed matrix grants.
- Keycloak adds about 1 GB and an import step, in exchange for a realistic token flow.
- The WP01 exit criterion in `docs/DEVELOPMENT_PLAN.md` §5.1 is "local runtime architecture, resource budget and start/seed/reset/check command contract documented". The executable start, health, seed and reset proof is RT1 under WP03.2 in [ACCEPTANCE_MAPPING.md](ACCEPTANCE_MAPPING.md).

## 5. Open points for WP03

- Measured memory, disk and start time against D-RT8.
- Port conflicts at start time against D-RT7.
- Keycloak realm file format and version pinning.
- Whether `next dev` can run without rewriting `AGENTS.md`.
