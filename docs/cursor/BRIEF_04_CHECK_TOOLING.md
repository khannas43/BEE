# Brief 04 — `local:check` preflight, stale lock, steadier memory gate (BL-030, BL-031, BL-032)

Branch `cursor/check-tooling`. Tooling only. Do not push. For this task you own `scripts/local/check.sh`, `scripts/local/lib.sh` and `scripts/local/health.sh`; Claude will not edit them meanwhile.

## Objective

Three things have cost real time in this project:

1. **BL-030.** `npm run local:check` does not start the servers. With them down it prints about 30 failures that look like code defects. The interrupted WP06.1a handover mistook exactly this for broken code.
2. **BL-031.** A crashed run leaves `.local/run/run.lock` behind and the next run refuses to start until the lock is removed by hand (the lock directory holds an `owner` file with a pid and a time).
3. **BL-032.** `memory.web` has measured anywhere from about 400 to 1541 MB against a 1500 MB budget on the same code, so a good run failed once on that alone.

## What to do

1. **Preflight.** At the very start of `check.sh`, before any check, verify the runtime is reachable: PostgreSQL, Keycloak, the Spring API and the Next.js server (the ports and health URLs `health.sh` already uses). If anything is down, print one clear message that names what is down and the command to fix it (`npm run local:up`), count it as a single failed check, and exit non-zero without running the rest. A passing run must be unchanged.
2. **Stale lock.** Where the run lock is taken (look in `lib.sh` and `up.sh`), if the lock exists and its owner pid is not alive, remove it, print one line saying so, and continue. If the owner is alive, keep refusing, and name the pid and the command. Never remove a live owner's lock.
3. **Memory gate.** Make `memory.web` measure fairly: take several samples a few seconds apart after the checks finish and use the median (or the lowest sustained reading); print the samples. Make each budget overridable by an environment variable with the current value as the default. Do not raise a budget; if you think one is wrong, say so in the hand-back.
4. Document the three behaviours in a short `docs/` note and update the three rows in `docs/BACKLOG.md`.

## Constraints

- Do not change what any other check does or how it counts. Do not touch `backend/**`, the contract or `lib/**`.
- Shell must stay portable to macOS bash and zsh invocations as the script is today; run `bash -n` on every file you change.

## Evidence (this one needs the runtime)

Check the main worktree's `.local/run/run.lock` and `docker ps` first; run these only if nothing else is using the runtime, and say so if you could not.
- With the runtime **stopped**, `bash scripts/local/check.sh` produces one clear failure and exits early, in seconds.
- Create a lock whose owner pid is dead and show the next run removes it with the message; show a lock with a live pid is still refused.
- With the runtime up, a full `local:check` gives the same pass and fail counts as before your change (it was 422 passed, 0 failed at the time of writing) and prints the memory samples.
Report the exact outputs. Mark BL-030, BL-031, BL-032 `done` only with that evidence.
