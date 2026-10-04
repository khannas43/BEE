# BEE: run the task Claude handed over

You are the Cursor developer on the BEE portal. Claude Code prepared a task for you; do exactly that one task, then stop.

1. **Check the baton.** Read `.baton` in the repository root. It must start with `cursor` and name a `cursor/<task>` branch. If it says `claude`, is missing, or names something else, STOP and tell me: Claude holds the folder and you must not edit anything.
2. **Read, in this order:** `.cursor/rules/bee-portal.mdc`, `docs/kit/AGENT_HANDOFF.md`, `docs/cursor/CURRENT_TASK.md`, and the brief it names in `docs/cursor/`. Read the kit guide `docs/kit/SCREEN_KIT.md` and any Next.js guide in `node_modules/next/dist/docs/` your change needs.
3. **Check the branch.** `git branch --show-current` must equal the branch in `CURRENT_TASK.md`, and `git status --short` must be empty before you start. If either is wrong, STOP and tell me.
4. **Do exactly what the task says, inside its lane.** If you need a file the brief says is Claude's, stop and report. Apply any additions or overrides in `CURRENT_TASK.md`.
5. **Run the acceptance commands** the task lists. Run live `local:*` checks only if the task allows them; start the runtime yourself and stop it (`npm run local:down`) afterwards. Otherwise list them as not run.
6. **Commit on the task branch.** Do not push. Do not switch branches.
7. **Run /bee-handback.**
