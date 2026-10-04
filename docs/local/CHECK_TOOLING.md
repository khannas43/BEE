# Local check tooling

**Status:** How `npm run local:check` behaves when the runtime is down, when a run lock is stale, and how memory is measured. Not an acceptance record.

## Runtime preflight (BL-030)

`scripts/local/check.sh` calls the same component probes as `npm run local:health` (PostgreSQL, Keycloak, Spring `/actuator/health`, Next.js `/api/runtime/health`) before any other check runs. If anything is down, the script records a single failed check (`runtime.preflight`), writes `.local/run/check.json`, prints which components are down and `npm run local:up`, and exits in seconds. It does not run port probes, contract checks or browser journeys against a dead stack.

## Run lock (BL-031)

Only one mutating local run may hold `.local/run/run.lock` at a time (`scripts/local/lib.sh`). The lock directory stores an `owner` file: the shell pid and its start time. If the lock exists and that pid is still running with the same start time, the next run refuses and names the pid and command. If the owner pid is not running, the lock is removed, one log line says so, and the run continues. Read-only commands set `BEE_RUN_LOCK=skip` before sourcing `lib.sh` (as `health.sh` does).

## Memory gate (BL-032)

After all other checks finish, memory is sampled several times (default five reads, three seconds apart). Each component uses the **median** of its samples for the pass/fail line; the samples are printed in the check detail and stored in `.local/run/memory.json`. Budgets are unchanged unless you override them:

| Variable | Default (MB) |
| --- | --- |
| `BEE_CHECK_MEMORY_BUDGET_POSTGRES` | 300 |
| `BEE_CHECK_MEMORY_BUDGET_KEYCLOAK` | 1000 |
| `BEE_CHECK_MEMORY_BUDGET_API` | 800 |
| `BEE_CHECK_MEMORY_BUDGET_WEB` | 1500 |
| `BEE_CHECK_MEMORY_BUDGET_TOTAL` | 3600 |

Sample count and interval: `BEE_CHECK_MEMORY_SAMPLES` (default 5), `BEE_CHECK_MEMORY_INTERVAL_SEC` (default 3).
