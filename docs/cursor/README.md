# Cursor briefs

Four independent tasks for the Cursor lane of [two-way development](../kit/PARALLEL_DEVELOPMENT.md). Each is frontend or tooling only, touches files the others and Claude's backend work do not, and ends with a hand-back, not a push. Pick any one; they can run in parallel in separate worktrees.

| # | Task | Branch | Slash command | Backlog | Touches | Needs runtime? |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Move the draft form's save and submit onto the command kit | `cursor/draft-form-on-kit` | `/bee-01-draft-form-on-kit` | BL-082 | `components/app/lifecycle/NewModelApplication.tsx` | live checks only at merge |
| 02 | Table and tabs for the kit | `cursor/table-and-tabs-kit` | `/bee-02-table-and-tabs-kit` | BL-020, BL-021 | `components/app/kit/*` (new), `components/app/lifecycle/ModelDashboard.tsx` | `local:read-ui` at merge |
| 03 | A React test runner for the kit hooks | `cursor/react-test-runner` | `/bee-03-react-test-runner` | BL-027, BL-076 | `package.json`, lockfile, new test config and tests | no |
| 04 | `local:check` preflight, stale lock and a steadier memory gate | `cursor/check-tooling` | `/bee-04-check-tooling` | BL-030, BL-031, BL-032 | `scripts/local/check.sh`, `lib.sh`, `health.sh` | yes (it exercises the runtime) |

Conflicts: 01 and 02 edit different files. 03 changes only `package.json` (append-only) and adds files. 04 owns `check.sh`, `lib.sh` and `health.sh` for its duration; Claude will not edit them meanwhile.

Not briefed on purpose, because they change the contract or the backend and so belong to Claude: the Wave 1 commands (Finance confirmation onward), the OpenAPI split, the scaffolder's extensions, the WP06.2 blob work, and the lint-baseline clean-up (BL-035, which touches too many files to run beside other work).
