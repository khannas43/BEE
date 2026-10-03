# BEE hand-back

Your task is finished. Stop coding and produce the hand-back for Claude Code. Do not push, and do not start another task.

1. Make sure everything is committed on your `cursor/<task>` branch (`git status` clean) and that the branch is rebased on the integration branch (`git fetch origin && git rebase origin/wp06.1a-document-intake`); resolve conflicts only inside your own files, otherwise stop and say so.
2. Print this report, filled in from facts you just checked, nothing from memory:

```
BRANCH:      <branch> @ <short hash>   (base: <short hash>)
TASK:        <brief number and title>
FILES:       <git diff --stat against the base>
RAN:         <each command with its exact result and totals>
NOT RUN:     <each command you did not run and why (for example: runtime busy)>
BEHAVIOUR:   <what changed for a user, or "none, refactor only">
DEFERRED:    <each item left undone, with the BL-nnn row you added to docs/BACKLOG.md>
BOUNDARIES:  <any file in Claude's lane you needed and did not touch>
LINT:        <new findings only; the whole-repo baseline is known (BL-035)>
BACKLOG:     <rows you marked done, and the evidence for each>
```

3. Say plainly if anything in the brief's acceptance list was not met. Never write "all checks pass" unless you ran them all.
