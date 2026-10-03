# Claude Code and Cursor in one repository: the hand-off

**Status:** Working agreement, 3 October 2026. It replaces the earlier two-clone and worktree designs. The owner can change it.

## One project, one folder

```
/Users/sameerkhanna/Documents/Projects/BEE      the only copy of the project (the git repo itself)
```

Claude Code and Cursor both work in this one folder, on the same checkout, with the same `node_modules` and the same local runtime. There is no second clone, no worktree and no other path to confuse. Open this folder in Cursor, and start Claude Code from it (`cd /Users/sameerkhanna/Documents/Projects/BEE && claude`).

The cost of one folder is that **only one agent works in it at a time**. The rest of this document is how that stays safe.

## The baton

A small file, `.baton` (git-ignored, in the repo root), says who holds the folder:

```
claude
```
or
```
cursor cursor/<task> <date>
```

- **Claude holds it by default.** While Claude holds it, Cursor does not edit anything.
- Claude hands it over by committing everything, creating the task branch, writing `.baton` and `docs/cursor/CURRENT_TASK.md`, and telling the owner "run `/bee-run-task` in Cursor".
- **While Cursor holds it, Claude edits nothing in the folder.** Claude may read, plan and talk, but any file Claude wrote would land in Cursor's branch.
- Cursor hands it back with `/bee-handback`: everything committed on its branch, `.baton` set to `claude`, a report printed. Claude then reviews the diff and merges.
- Every agent checks `.baton` first. If it names the other agent, stop and tell the owner. The file is a rule, not a lock: the owner is the final check and can always look.

## The hand-off, step by step

1. **Claude prepares.** Picks a brief from `docs/cursor/` (or writes a new one), then writes `docs/cursor/CURRENT_TASK.md`: the brief to follow, the branch name `cursor/<task>`, anything to add or override, and the exact acceptance commands. Commits that, runs `git switch -c cursor/<task>`, writes `.baton` as `cursor cursor/<task> <date>`.
2. **Cursor executes.** The owner runs `/bee-run-task` in Cursor's Agent chat. It reads `.cursor/rules/bee-portal.mdc`, `CURRENT_TASK.md` and the brief, checks `.baton` and the branch, does the work inside its lane, runs the gates, commits on the task branch, and runs `/bee-handback`.
3. **Claude reviews and merges.** Runs `/code-review` on the range (one review per task; fixes for high and medium findings, the rest to the backlog), merges into the integration branch (`git switch wp06.1a-document-intake && git merge --no-ff cursor/<task>`), deletes the task branch, runs the full gate, sets `.baton` back to `claude`, and pushes only when the owner asks. After any review run, check `git branch --show-current` (BL-077).

Cursor never pushes. Only Claude pushes, and only when the owner asks.

## Lanes (what Cursor may touch)

| Cursor | Claude |
| --- | --- |
| `components/**`, `lib/client/**`, `app/app/**`, the kit components, and the tooling files a brief names | `backend/**`, the OpenAPI artifact and its pin, `lib/server/**`, `app/api/**`, request-log files, Flyway migrations, contract and coverage scripts, live checks, reviews, merging |

Anything not listed is Claude's until a brief hands it over. If Cursor needs a file in Claude's lane it stops and reports. Contract changes (a new field, error code or route) come only from Claude. A migration is never edited once applied.

## The runtime

PostgreSQL, Keycloak, Spring and Next.js use fixed ports and the Docker project `bee-local`. With one folder there is one runtime. Whoever holds the baton may start it (`npm run local:up`), and must stop it (`npm run local:down`) before handing back. Cursor runs `local:*` live checks only for a task whose brief asks for them; otherwise it lists them under "Not run" and Claude runs them at merge.

## iCloud

`~/Documents` is synced to iCloud, which can evict or stall files (BL-034, BL-094). The heavy generated folders (`node_modules`, `.next`, `.local`, `backend/target`) live in `*.nosync` siblings with a symlink back, which iCloud ignores. After every `npm ci` (it recreates `node_modules` as a real folder) run `npm run setup:nosync`. It is safe to repeat.

## If you want parallel work later

Two agents editing at once needs two checkouts. When that is worth the extra care, add a second clone and a branch per task; the earlier design is in git history (`docs/kit/PARALLEL_DEVELOPMENT.md` at commit 45e648d). Until then, one folder.

## Briefs

See [../cursor/README.md](../cursor/README.md). Each is independent of the others and of Claude's current work, which makes them safe to hand over one at a time.
