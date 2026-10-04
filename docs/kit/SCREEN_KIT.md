# Screen kit — building a runtime screen

**Status:** Frontend kit extracted from the two working screens, 3 October 2026. It is a development aid, not a BEE deliverable and not an acceptance record. Accepted work packages remain 1/11.

## What is in it

| Piece | File | Does |
| --- | --- | --- |
| Transport and failure model | `lib/client/runtimeHttp.ts` | Cookie-only fetch (no bearer), one failure type for reads, one for commands, fixed copy, `not_found` identical for unknown, other-organisation and malformed ids |
| `runtimeRead(path, parse)` | same | GET with a shape check; a request that never reaches the BFF reads as unreachable |
| `runtimeCommand(path, method, payload, key, parse)` | same | POST or PATCH with the required `Idempotency-Key`; JSON or `FormData`; reports replays; typed `conflict` and `validation` codes |
| `PayloadKeyGate` | same | One idempotency key per exact payload, so a lost-response retry replays instead of duplicating |
| `gateRead(identityStatus, read)` | same | Nothing while the identity loads; never records for a signed-out identity |
| `useRevalidation()` | `components/app/kit/useRuntimeRead.ts` | One clock per screen: focus, tab visible, back-forward-cache restore, every 30 s; re-reads the Spring identity each tick |
| `useRuntimeRead(target, load, revalidation)` | same | Reads one target and re-reads it on each tick; `null` while loading, including right after the target changes or the page is restored |
| `ReadPanel` | `components/app/kit/StatePanels.tsx` | One card for the standard states: loading, failure (session, forbidden, not found, unavailable), empty, result |
| `FailureBanner`, `LoadingNote`, `DescriptionList` | same | The parts `ReadPanel` is made of, usable alone |

The model dashboard (`components/app/lifecycle/ModelDashboard.tsx`) is the worked example: list, selectable detail, identity strip, all standard states.

## Recipe for a read screen

1. **Client module** `lib/client/runtime<Thing>.ts`: type the payload, write `parse` (return `null` if the documented shape is missing), and export `read<Thing>List` and `read<Thing>` using `runtimeRead`. Re-use `READ_UI_MESSAGES`-style copy only for the screen's own wording (empty, loading).
2. **Stable loaders** at module level: `const loadList = () => readThings();` and `const loadDetail = (id: string) => readThing(id);`. They are effect dependencies; an inline arrow re-reads on every render.
3. **Screen component** (`"use client"`):
   ```tsx
   const identity = useSpringIdentity();
   const revalidation = useRevalidation();
   const list = gateRead(identity.status, useRuntimeRead("list", loadList, revalidation));
   const detail = gateRead(identity.status, useRuntimeRead(selectedId, loadDetail, revalidation));
   ```
   Read `selectedId` from the URL in the component (`useSearchParams`), not in the kit, and keep the screen where a `Suspense` boundary already wraps it.
4. **Render** with `ReadPanel` (title, `read`, loading and error test ids, `signInReturnTo`, `isEmpty`, `resultAction`, children) and `DescriptionList` for fields.
5. **Never filter by role or organisation in the browser.** Spring decides scope; the screen shows what it returns.

## Recipe for a command (write)

For a new command start from the scaffolder ([FEATURE_TEMPLATE.md](FEATURE_TEMPLATE.md)), which generates this client and the backend. The screen side is:

1. In the client module: `runtimeCommand(path, "POST" | "PATCH", payload, key, parse)`. Include the record `version` in the payload for edits and transitions.
2. In the component: `const gate = useRef(new PayloadKeyGate())`; send with `gate.current.keyFor(payloadSignature)`; call `gate.current.clear()` only after a known outcome (success or a definite refusal).
3. Show `failure.message` for `denied`, `validation` and `conflict`; for `conflict` with `version_conflict` re-read the record; for `session` show the sign-in link.
4. The Spring side needs the usual command shape: idempotency record, version check, audit event written with the state change (see `ModelApplicationSubmitService`).

## Rules the kit relies on

- Test ids stay stable: live browser checks find elements by them.
- A screen is complete only when it meets the definition in `docs/SCREEN_COMPLETION_PLAN.md` section 2.
- Preview roles never select records; they only choose what the menu displays.

## Table and tabs

See [TABLE_AND_TABS.md](TABLE_AND_TABS.md) for `DataTable` (client-side filter, sort, paging) and `RecordTabs` (URL tab id owned by the screen). Server-scoped paging remains BL-020 / BL-096.

## Not in the kit yet (build when the first screen needs it; tracked as BL-020 to BL-027 in [../BACKLOG.md](../BACKLOG.md))

- Wider use of the command panel: it exists (`useCommand` and `CommandPanel`) and the test-report upload uses it; the draft save and submit confirm do not yet (BL-082).
- A generic document card: `DraftTestReports` is the model; generalise it when a second document kind exists.
- The rest of the backend half: the feature template exists for POST commands (see [FEATURE_TEMPLATE.md](FEATURE_TEMPLATE.md)); reads, other resources, test skeletons and splitting the OpenAPI artifact per module are open (BL-024, BL-078 to BL-082).

## Migration status

Every client module is now on the kit transport: `runtimeModelApplications.ts`, `runtimeModelDrafts.ts`, `runtimeModelSubmit.ts` and `runtimeModelDocuments.ts` use `runtimeRead` and `runtimeCommand`, and the test-report upload uses `useCommand` and `CommandPanel`. The draft save and submit confirm in `NewModelApplication.tsx` still keep their own state and buttons (BL-082).

## Evidence

`runtime-kit.test.mjs` (10 tests) covers failure mapping, `runtimeRead`, the signed-out gate, `PayloadKeyGate` and `runtimeCommand` (JSON, multipart, key validation, every failure kind). The hooks and panels are covered by `npm run web:test:ui` (see [UI_TESTS.md](UI_TESTS.md)). The live `local:read-ui` check still exercises the migrated dashboard against the real stack (sign-in with TOTP, cross-organisation and unknown ids, expiry, revocation, outage).
