# Cursor, ChatGPT review, and git worktrees

**Status:** Working agreement updated **18 October 2026** (owner-approved). Supersedes the Claude-default baton flow for day-to-day implementation while Claude Code is paused.

## Worktrees

Use **one git worktree per active task branch** (for example `/Users/sameerkhanna/Developer/BEE-19c-b`). Do not edit another agent's checkout. The primary clone at `/Users/sameerkhanna/Developer/BEE` may stay on `main` for merge/integration.

## Roles

| Role | Responsibility |
| --- | --- |
| **Cursor** | Full-stack implementation **when the active brief authorizes it**; gates; commit on `cursor/<task>`; `/bee-handback`. |
| **ChatGPT** | Acceptance review from diff + handback; **does not hold the editing baton** or relay step-by-step coding commands. |
| **Owner** | Sets task scope; authorizes merge/push after ChatGPT acceptance. |
| **Claude Code** | Paused (weekly limit). May resume merge/review later if the owner re-enables it. |

## The baton

`.baton` (git-ignored) in **each worktree**:

- **Implementing:** `cursor cursor/<task> <date>`
- **Review pending:** `claude` (after `/bee-handback`)

Check `.baton` in the worktree you are editing before making changes.

## Hand-off

1. **Task setup:** Branch `cursor/<task>` in a dedicated worktree; `docs/cursor/CURRENT_TASK.md` + brief; `.baton` → cursor.
2. **Cursor implements:** Run applicable gates; commit; update implementation plan/backlog as the brief requires.
3. **Handback:** `/bee-handback`; `.baton` → `claude`; stop until review.
4. **ChatGPT review:** Owner pastes handback + diff; accept or list findings; Cursor fixes on same branch if needed.
5. **Merge/push:** Only after ChatGPT acceptance **and explicit owner authorization**.

Cursor does **not** merge to `main` or push by default.

## Migrations

- On a **task branch**, an unaccepted migration may be corrected **in place**.
- After acceptance into **`main`** or deployment, the migration is **immutable** — add **V74+** for schema fixes.

## Lanes

- **Frontend-only briefs:** `components/**`, `lib/client/**`, `app/app/**`, kit, tooling the brief names.
- **Full-stack briefs (must say so):** `backend/**`, new Flyway on the task branch, OpenAPI/BFF when required, tests and docs.

## Runtime

PostgreSQL, Keycloak, Spring and Next.js use project `bee-local` and fixed ports. Start/stop (`npm run local:up` / `local:down`) in the worktree running live checks.

## Briefs

See [../cursor/README.md](../cursor/README.md).
