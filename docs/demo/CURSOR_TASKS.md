# Tasks for Cursor (demo build, 15 October 2026)

Work in your OWN clone (`~/Developer/BEE-demo`), not in the shared checkout, and do not take the baton. Start with:

```
cd ~/Developer/BEE-demo
git fetch /Users/sameerkhanna/Developer/BEE demo-pack
git checkout -B cursor/demo-login-ui FETCH_HEAD
```

Do NOT run the app (ports 8090, 3100, 8180 belong to the other checkout), do NOT run `npm run local:check`, do NOT push, do NOT edit AGENTS.md, CLAUDE.md, migrations, Spring code, or anything under `app/api/` and `lib/server/`. Next.js here has breaking changes: read `node_modules/next/dist/docs/` before writing Next code (run `npm install` in your clone first). Checks you may run: `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npm run web:test:ui`, `npm run web:test`.

## Task 1: the demo login page (owns `app/login/page.tsx` and new files under `components/login/`)

Goal: the moment someone lands on `/login`, they see a professional, polished sign-in with just a username field and a password field. Government-portal look consistent with the existing design tokens (forest green, the Emblem component, the left brand panel); keep it responsive, accessible (labels, `role="alert"` for errors, visible focus, show/hide password button with aria-pressed, Enter submits), and fast.

Behaviour (the server side is already built; do not change it):

- On load the page calls `GET /api/runtime/demo/login` and reads `{ "enabled": boolean }`.
  - `enabled: true` -> show the simple form (below) and hide the Keycloak button and the "authenticator" bullets in the brand panel; the brand panel instead says "Demonstration environment: local data, nothing here is a BEE record" and lists what the demo shows (registrations, model applications, payment simulation, QR serials, simulated Fabric ledger, quarterly production, MIS, AI use cases).
  - `enabled: false` or the call fails -> keep today's page exactly as it is (the "Sign in with BEE identity" button and the development-preview block). Do not remove any existing behaviour or test.
- Form: `username`, `password`, a "Sign in" button with a loading state. Submit does `POST /api/runtime/demo/login` with JSON `{ "username": "...", "password": "..." }` and `credentials: "include"`.
  - `200 { ok: true, returnTo }` -> `window.location.assign(returnTo)` (it is `/app`).
  - `401 { error: "invalid_credentials" }` -> "The username or password is not correct."
  - `403 { error: <code> }` (for example `no_active_account`, `no_effective_role`) -> reuse the existing `SIGN_IN_ERRORS` messages.
  - `503`/network failure -> "The sign-in service is not reachable. Try again."
  - Never show the password; clear it after a failed attempt; focus the error.
- Under the form add a compact "Demo accounts" panel (collapsed by default, a disclosure button) listing the people as chips: nova.applicant (Manufacturer, Nova), pixel.applicant (Manufacturer, Pixel), bee.finance (Finance), iame.officer (IAME officer), bee.reviewer (Reviewer), bee.programme (Programme), bee.director (Director), bee.secretary (Secretary), bee.admin (Administrator), bee.auditor (Auditor), bee.helpdesk (Helpdesk). Clicking a chip fills the username field only. Add the line "Password for every demo account: demo123".
- Tests: add a vitest/RTL test in `components/app/__tests__/DemoLogin.test.tsx` (the vitest config only collects that folder) for: shows the simple form when enabled, shows the existing button when not enabled, success redirects, 401 shows the message, chip fills username.

Deliver as commits on `cursor/demo-login-ui` plus a short hand-back (what you built, the test counts, screenshots if you can take them without running the app: you cannot, so skip them).

## Task 2: the presenter script (a document only)

Write `docs/demo/DEMO_SCRIPT.md`: a minute-by-minute 40-minute script for the client demonstration, built from `docs/demo/DEMO_WORK_PLAN.md` and the slice notes `docs/demo/S1.md` to `S6.md` (read each for the exact demo steps, people, seeded records and what is simulated). For every step: who is signed in (username, password demo123), the exact screen and menu entry, what to click, what to say, and what the audience should see. Add a section "If something goes wrong" (a re-seed command is `npm run demo:seed`, restart is `npm run local:down && npm run local:up`), a "what is simulated and how to say it" section (simulated Fabric network, simulated payment gateway, AI is rules/statistics/retrieval, advisory only), and a one-page cheat sheet of usernames and the order of screens. Commit it on the same branch.
