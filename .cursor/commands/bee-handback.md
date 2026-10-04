# BEE hand-back

Your task is finished. Stop coding, release the folder to Claude, and print the hand-back report. Do not push, do not switch branches, and do not start another task.

1. Make sure everything is committed on your task branch (`git status --short` is empty) and that the branch is still the one named in `docs/cursor/CURRENT_TASK.md`.
2. If the local runtime is up (`docker ps` shows `bee-local-*`), stop it with `npm run local:down`.
3. Release the folder: write the single word `claude` into `.baton` in the repository root. (The file is git-ignored; it is not a commit.)
4. Print this report, filled in from facts you just checked, nothing from memory:

```
BRANCH:      <branch> @ <short hash>   (base: <short hash of the integration tip it started from>)
TASK:        <brief number and title>
FILES:       <git diff --stat against the base>
RAN:         <each command with its exact result and totals>
NOT RUN:     <each command you did not run and why>
BEHAVIOUR:   <what changed for a user, or "none, refactor only">
DEFERRED:    <each item left undone, with the BL-nnn row you added to docs/BACKLOG.md>
BOUNDARIES:  <any file in Claude's lane you needed and did not touch>
LINT:        <new findings only; the whole-repo baseline is known (BL-035)>
BACKLOG:     <rows you marked done, and the evidence for each>
BATON:       released to claude
```

5. Say plainly if anything in the brief's acceptance list was not met. Never write "all checks pass" unless you ran them all.
