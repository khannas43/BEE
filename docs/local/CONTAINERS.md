# Running the application as containers

By default `npm run local:up` runs PostgreSQL and Keycloak in Docker and the Spring API and the portal as host processes. `npm run local:app:up` runs **all four** in Docker (compose project `bee-local`, profile `app`). Development only: no production hardening, no TLS, ports bound to `127.0.0.1`.

| | Host mode (default) | Container mode |
| --- | --- | --- |
| Start | `npm run local:up` | `npm run local:app:up` (first run builds two images: about 5 minutes) |
| Stop | `npm run local:down` | `npm run local:down` (stops all four, keeps data) |
| Seed | `npm run local:seed` | `npm run local:seed` |
| Full gate `local:check` | **use this mode** | not supported (the gate restarts the API as a host process) |

Use one mode at a time: both bind the same ports (`8090`, `3100`). `local:app:up` stops host-mode processes first; `local:up` refuses to start while the containers hold the ports.

## How it fits together

- `backend/Dockerfile` builds the API jar (Maven, Java 17) and runs it as a non-root user. `Dockerfile` (repo root) builds the portal with `next build` and runs `next start`.
- The sign-in name (issuer) stays `http://127.0.0.1:8180/realms/bee-local`, because the browser and the tokens use it. Inside a container `127.0.0.1` is the container itself, so the servers call Keycloak at `http://keycloak:8080` instead: the portal through `BEE_KC_INTERNAL_URL` (`AUTH.reachable` in `lib/server/authConfig.ts` rewrites only the address it calls, never the issuer it checks), the API through `BEE_SECURITY_JWK_SET_URI` (only where the signing keys are fetched; the issuer and audience checks are unchanged). Both settings are empty in host mode.
- The API reaches PostgreSQL at `postgres:5432`; the portal reaches the API at `http://api:8090`.
- `.local/logs` and `.local/documents` are mounted into the containers, so the request logs and the document store are the same files in both modes and the live checks work unchanged.

## Verified

The live checks `local:inbox` (36), `local:history` (57) and `model-documents` (50) pass against the containers. The full gate in host mode, with these changes in place, passes: 1081 passed, 0 failed. Memory at rest: API about 385 MB, portal about 110 MB.

## Not done (BL-130)

Production images, TLS, image scanning, secrets handling, and running the full `local:check` gate in container mode.
