# Current Cursor task

**Holder:** claude (no task handed over). Claude fills this file in when it hands the folder to Cursor, and resets it to this text when the task is merged.

When a task is handed over, this file contains:

- **Brief:** the file in `docs/cursor/` to follow (for example `BRIEF_01_DRAFT_FORM_ON_KIT.md`).
- **Branch:** `cursor/<task>`, already created and checked out by Claude.
- **Additions or overrides:** anything that differs from the brief.
- **Acceptance commands:** the exact commands to run and the results expected.
- **Live checks:** which, if any, Cursor may run (it starts and stops the runtime itself); everything else goes under "Not run".
