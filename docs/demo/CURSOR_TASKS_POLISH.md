# Tasks for Cursor (demo polish, 16 October 2026; the client demo is moved two days)

Claude has built, on branch `demo-polish`: CSV downloads on every list (`lib/client/csv.ts`, `ListToolbar` prop `exportCsv`, QR "Download all serials (CSV)"), a simulated email and SMS outbox (migration V66, Spring module `messages`, screen `/app/demo/notifications`, component `components/app/demo/MessagesDemo.tsx`), a Validity period label on the public check, and a reconciliation seed fix. Read `docs/demo/DEMO_SCRIPT.md` and `components/app/demo/MessagesDemo.tsx` first.

## Set-up (your OWN clone, not the shared checkout)
```
cd ~/Developer/BEE-demo
git fetch /Users/sameerkhanna/Developer/BEE demo-polish
git checkout -B cursor/demo-polish FETCH_HEAD
npm install
```
Do NOT take the baton, do NOT push, do NOT run the app or database (ports 8090, 3100, 8180, 5432 belong to the other checkout), do NOT run `npm run local:check`. Do NOT edit AGENTS.md, CLAUDE.md, anything under `backend/`, `app/api/`, `lib/server/`, `local/seed/`, `scripts/`, or `lib/runtimeRoutes.ts`. Next.js here has breaking changes: read `node_modules/next/dist/docs/` before writing Next code. Checks you may run: `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test:ui`, `npm run web:test`. Small commits, one per task, on `cursor/demo-polish`.

## Task 1: unread badge for the new messages in the top bar (new files plus a small edit to `components/app/AppTopbar.tsx`)
The top bar already has the in-portal bell (`components/app/notifications/NotificationBell.tsx`, application notifications). Add a second, separate control right beside it: a small mail icon with the number of unread simulated messages, linking to `/app/demo/notifications`.
- New component `components/app/notifications/DemoMessageBadge.tsx`. It calls `GET /api/runtime/demo/messages` through `demoGet(demoPath("messages"))` from `lib/client/runtimeDemo.ts` and reads `{ unread: number }`. Re-read every 10 seconds while `document.visibilityState === "visible"` (copy the effect pattern from `MessagesDemo.tsx`; the lint rule `react-hooks/set-state-in-effect` forbids calling a state-setting function directly in an effect body, so set state inside `.then`).
- Shows nothing at all (not even the icon) when the call fails, returns 403, or the person is signed out. Shows the number in a small pill only when it is above zero (cap the text at "9+"). `aria-label` is "Simulated email and SMS messages, N unread" (or "…, none unread").
- Wire it into `AppTopbar.tsx` next to the existing bell without changing the bell's behaviour or its tests.
- Tests in `components/app/__tests__/DemoMessageBadge.test.tsx` (the vitest config only collects that folder): hidden on failure, shows "3", shows "9+" for 12, link goes to `/app/demo/notifications`. Mock `fetch` the way `MessagesDemo.test.tsx` does.

## Task 2: tests for the CSV download (tests only; do not change the components)
In `components/app/__tests__/CsvExport.test.tsx`: render `PaymentsDemo`, `LedgerDemo` and `QrDemo` with a stubbed `fetch` (copy the stubs from the existing `PaymentsDemo.test.tsx`, `LedgerDemo.test.tsx`, `QrDemo.test.tsx`) and check that `data-testid="list-export"` ("Download CSV") exists, is enabled when rows exist, and that clicking it calls `URL.createObjectURL` once with a Blob whose text starts with the BOM, then the header line (stub `URL.createObjectURL`/`revokeObjectURL` and `HTMLAnchorElement.prototype.click`). Check the file name set on the anchor starts with `payments-`, `ledger-certificates-`, `qr-batches-` and ends `.csv`. Also test that after typing in `list-search` the CSV has only the matching rows (all matching rows, not just the first page).

## Task 3: presenter script additions (documents only: `docs/demo/DEMO_SCRIPT.md`)
Add to the use-case script, in the same persona style as the other use cases:
1. **UC7, "Everyone is told" (about 3 minutes)**: persona Neha pays DEMO-PAY-0001 (UC1); then Farid (`bee.finance`) opens Notifications (email and SMS) in the side menu and shows the "Payment to confirm" email; Neha's own inbox shows an email and an SMS "payment received". Later in UC3 Arjun (`bee.admin`) and Sunita (`bee.secretary`) each get "Second signature needed" for the one who did not send it (the sender is not told); when the second person commits, Neha gets an email and an SMS "Certificate on the ledger"; a revoke commit says "Certificate revoked". In UC4 Priya (`bee.programme`) gets "Production figures to review" when Nova submits, Nova gets "Query on your production figures" (email and SMS) and later "accepted". Say clearly: simulated, nothing is sent; addresses end @bee-demo.invalid and the mobile numbers are made up.
2. **Exports (about 2 minutes)**: on each list (Payments, QR batches, Ledger certificates and transactions, Production submissions) the "Download CSV" button saves what the filters currently show, not just the page; on a QR batch "Download all serials (CSV)" is the print shop's file with the public check link per serial; the MIS "Download CSV" is per panel. It opens in Excel. Tell the presenter to say the file is saved to Downloads and to not open it on the projector unless asked. The printable certificate with its QR code is at Model label, Label preview (`/app/model-label/label-preview`): pick an approved application, use the browser Print and choose "Save as PDF".
3. Update the cheat sheet (usernames and order of screens) and "what is simulated and how to say it" with the new screens. Do not change any other step: Claude will rehearse the whole script after your commit and correct anything that does not match the live screens.

## Deliver
Commits on `cursor/demo-polish`. Tell the owner the branch is ready with test counts. Claude fetches it, runs the checks, and rehearses it live.
