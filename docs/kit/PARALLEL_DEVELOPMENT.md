# Two-way development: Claude Code (CLI) and Cursor

**Status:** Working agreement, 3 October 2026. It records how two agents share one repository on one Mac without losing work. The owner can change it.

## Lanes

| | Claude Code (CLI) | Cursor |
| --- | --- | --- |
| Worktree | `~/Code/BEE/worktrees/wp05.1-read-ui` on `wp06.1a-document-intake` (the integration branch) | its own worktree per task, branch `cursor/<task>` |
| Owns | `backend/**`, the OpenAPI artifact and its pin, `lib/server/**`, `app/api/**`, request-log files, Flyway migrations, contract and coverage scripts, live checks, reviews, merging | `components/**`, `lib/client/**`, `app/app/**`, the kit components, and the tooling files a brief names |
| Does | Wave 1 backend commands (Finance confirmation and after), contract changes, independent review, the full gate, integration | the briefs in `docs/cursor/` |

Anything not listed is Claude's until a brief hands it over. `package.json` is shared: add to the `web:test` list append-only and expect a trivial rebase conflict. `docs/BACKLOG.md` is shared: change only the rows you own and add new `BL-nnn` rows at the end.

## One runtime, one at a time

The local runtime (PostgreSQL, Keycloak, Spring, Next.js) uses fixed ports and the Docker containers `bee-local-postgres` and `bee-local-keycloak`. Two worktrees cannot run it at once, and a second `local:up` against the same containers corrupts the first run.

- Unit tests, `tsc`, `eslint` and `next build` need no runtime. Cursor runs these freely.
- Browser and contract checks (`local:*`, `local:check`) need the runtime. Cursor runs them **only** if `.local/run/run.lock` in the main worktree is free and no `bee-local-*` container is up. Otherwise it lists them under "Not run" and Claude runs them at merge.
- `local:check` stays a Claude responsibility at integration: one full run per merged task.

## Starting a Cursor task

```bash
# from any shell; <task> is the name in the brief, <base> the tip the brief names (default: origin/wp06.1a-document-intake)
git -C ~/Code/BEE/Code fetch origin
git -C ~/Code/BEE/Code worktree add ~/Code/BEE/worktrees/cursor-<task> -b cursor/<task> <base>
cd ~/Code/BEE/worktrees/cursor-<task> && npm ci
```

Open that folder in Cursor, then run the task's slash command (`/bee-01-draft-form-on-kit` and so on; see `.cursor/commands/`). Keep Claude's worktree closed in Cursor so the two never edit the same files.

## Handing back

Cursor commits on `cursor/<task>`, then runs `/bee-handback`, which stops and prints the hand-back report: branch and commit, files changed, what it ran with totals, what it did not run, anything deferred (with the `BL-nnn` it added), and any lane boundary it hit. It does not push.

Claude then, in its own worktree: reads the diff, runs `/code-review` on the range (one review per task; fixes for high and medium findings, the rest to the backlog), merges into `wp06.1a-document-intake` (`git merge --no-ff cursor/<task>`), runs the full gate (`api:test` if backend changed, `web:test`, `tsc`, `build`, `local:check`, `matrix`, `audit:access`), and pushes only when the owner asks. After any review run Claude checks `git branch --show-current` (BL-077).

## Conflict rules

- Two tasks never touch the same file. The briefs are chosen so they do not; if one needs a file another owns, it stops and reports.
- If a Cursor branch falls behind, rebase it onto the integration branch (`git rebase origin/wp06.1a-document-intake`) before hand-back, never merge the integration branch into it.
- Contract changes (new field, new error code, new route) come only from Claude. Cursor work that needs one is queued, not guessed.
- A migration is never edited once applied; a fix is a new migration, and migrations are Claude's.

## Briefs

See [../cursor/README.md](../cursor/README.md). Each brief is independent of the others and of Claude's current work.
