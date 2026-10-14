# Portal status workbook

**File:** [BEE-portal-status.xlsx](./BEE-portal-status.xlsx)

| Sheet | Contents |
| --- | --- |
| **Screens** | Every catalogue screen plus live-only runtime routes and planned Business settings. Legend row explains **Live – BEE service** vs prototype. **Screen handling** (from WP01): keep / merge / retire. |
| **Work register** | Cursor briefs, work-package slices, and selected backlog themes with status and % complete (owner-facing estimates from docs). |

**Regenerate** (after code or docs change):

```bash
docs/tracking/.venv/bin/python scripts/tracking/build-portal-status-xlsx.py
```

To refresh catalogue rows from code (needs network for `npx tsx` the first time):

```bash
BEE_REFRESH_SCREEN_CATALOG=1 docs/tracking/.venv/bin/python scripts/tracking/build-portal-status-xlsx.py
```

First time only: `python3.12 -m venv docs/tracking/.venv && docs/tracking/.venv/bin/pip install openpyxl`

Intermediate JSON (git-ignored): `.screen-catalog.json`
