# Cursor briefs

Four independent tasks for Cursor, handed over by Claude one at a time (see [../kit/AGENT_HANDOFF.md](../kit/AGENT_HANDOFF.md)). Each is frontend or tooling only, touches files the others and Claude's backend work do not, and ends with a hand-back.

**How a task runs.** Claude writes [CURRENT_TASK.md](CURRENT_TASK.md) (which brief, the `cursor/<task>` branch, any overrides, the acceptance commands), checks out the branch and sets `.baton`. You then run **`/bee-run-task`** in Cursor's Agent chat; Cursor does the task and ends with **`/bee-handback`**. Claude reviews and merges.

| # | Task | Branch Claude creates | Backlog | Touches | Live checks? |
| --- | --- | --- | --- | --- | --- |
| 01 | Move the draft form's save and submit onto the command kit | `cursor/draft-form-on-kit` | BL-082 | `components/app/lifecycle/NewModelApplication.tsx` | at merge (Claude) |
| 02 | Table and tabs for the kit | `cursor/table-and-tabs-kit` | BL-020, BL-021 | `components/app/kit/*` (new), `components/app/lifecycle/ModelDashboard.tsx` | `local:read-ui` at merge |
| 03 | A React test runner for the kit hooks | `cursor/react-test-runner` | BL-027, BL-076 | `package.json`, lockfile, new test config and tests | no |
| 04 | `local:check` preflight, stale lock and a steadier memory gate | `cursor/check-tooling` | BL-030, BL-031, BL-032, BL-095 | `scripts/local/check.sh`, `lib.sh`, `health.sh` | yes (the task runs the runtime itself) |

Not briefed on purpose, because they change the contract or the backend and so belong to Claude: the Wave 1 commands (IAME recommendation onward), the OpenAPI split, the scaffolder's extensions, the WP06.2 blob work, and the lint-baseline clean-up (BL-035, which touches too many files to run beside other work).
