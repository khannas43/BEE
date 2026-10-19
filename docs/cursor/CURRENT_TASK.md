# Current Cursor task

**Holder:** cursor, 19 October 2026. ChatGPT review pending.

- Brief: **C3 — Role-based lifecycle navigation** ([BRIEF_C3_ROLE_LIFECYCLE_NAVIGATION.md](BRIEF_C3_ROLE_LIFECYCLE_NAVIGATION.md))
- Branch: `cursor/c3-role-navigation`
- Worktree: `/Users/sameerkhanna/Developer/BEE-c3-role-navigation`
- Base: `cursor/wp3-auto-activation` @ `6c40482`

## Owner-approved behaviour

1. Each operational role (Manufacturer, Director, Secretary, Finance) has its own lifecycle menu of at most four groups.
2. Admin is the demonstration umbrella profile: exactly four groups showing every available screen. It is not a workflow actor.
3. The menu follows the Spring sign-in. The preview role never shows, hides or opens a screen.
4. AI is advisory and human-controlled. The ledger is simulated. Functions that are not yet built are marked Preview or Planned and are not presented as complete.
5. The development "All screens" menu link is removed.

## Implementation

- `lib/navigation.ts` is the central typed definition. Its routes are resolved from `RUNTIME_ROUTES`, `lib/screens` and a short standalone-page list.
- The sidebar (desktop and mobile), the top-bar search, the landing work areas and the client route guard all read that definition.
- `/app/manufacturer/director` gets a corrected label: "Company registration activation".

## Gates

| Gate | Result |
| --- | --- |
| TypeScript | pass |
| ESLint (changed files) | pass |
| Navigation access audit (`audit:access`) | pass |
| Focused navigation tests | **24/24** |
| Web tests | **264/264** |
| UI tests | **263/263** |
| Production build | pass |
| Live browser check (five roles) | see hand-back |
