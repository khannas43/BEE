# Brief 19D-0 — SNL WP02D work queue design (documentation only)

## Status

Design and analysis only. No migrations, Java, API, OpenAPI, BFF or UI.

## Branch

`cursor/snl-wp02d-work-queue-design` from `main` @ `d981bb6`.

## Deliverable

- [SNL_WP02D_WORK_QUEUE_DESIGN.md](../snl/SNL_WP02D_WORK_QUEUE_DESIGN.md) — authoritative 19D-0 design.

## Governing source

*SnL Disha Advisory Manual* (`SnL_Disha_Advisory_Manual.pdf`, printed footer pages; verified with `pdftotext` 18 October 2026).

## Depends on

Accepted V69–V72 (WP2A foundation, V70 policy/notifications, V71/V72 model return/resubmit/forward closure), [SNL_WP02C_REGISTRATION_RETURN_DESIGN.md](../snl/SNL_WP02C_REGISTRATION_RETURN_DESIGN.md) (19C-0).

## Boundaries

- Do not edit V69–V72 migrations, registration wiring, `.docx`, demo data, or Agent B worktree.
- Do not implement read API, BFF, UI, supervisor reassignment commands, 60-day job (BL-253), or cancel/reject normalization (BL-256).

## Follow-on slices (design only here)

| Slice | Scope |
| --- | --- |
| 19D-A | Read repository + SQL projection; database tests; no public route |
| 19D-B | OpenAPI + Spring list/detail enrichment; BFF pass-through; contract tests |
| 19D-C | My work / supervisor queue UI; live inbox checks; WP2 acceptance evidence |

## Handback

Run `/bee-handback`. Report PDF traceability, projection field list, visibility matrix, SLA formulas, slice boundaries, and any backlog/plan updates. Release baton to `claude`. Do not push.
