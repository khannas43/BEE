# Brief C3 — Role-based lifecycle navigation

**Status:** implemented on `cursor/c3-role-navigation`; **ChatGPT review pending**, not accepted.
**Base:** `6c40482`, the integration tip of `cursor/wp3-auto-activation`.
**Worktree:** `/Users/sameerkhanna/Developer/BEE-c3-role-navigation`
**Decision:** owner-approved role/menu structure, recorded in [BEE_DECISIONS.md](../BEE_DECISIONS.md) under "Role-based lifecycle navigation".

## 1. What changed

The console menu was a flat set of preview-role categories, with the signed-in person's working screens merged into "Home" and a development "All screens · dev" link. It is now one typed definition, [`lib/navigation.ts`](../../lib/navigation.ts), with a lifecycle hierarchy for each operational role. That definition is read by:

- the desktop sidebar and the mobile drawer (both render `components/app/AppSidebar.tsx`);
- the top-bar search (`components/app/TopbarSearch.tsx`);
- the console landing page's work-area cards (`app/app/page.tsx`);
- the client route guard (`components/app/RouteGuard.tsx`);
- the tests (`components/app/__tests__/RoleNavigation.test.tsx`).

The "All screens · dev" link is removed. The `/app/screens` page remains, reachable only by an Admin sign-in and not linked from any menu.

## 2. Rules the definition enforces

- **Hierarchy from the Spring identity.** The menu follows `/api/runtime/me` (effective roles and capabilities), never the browser preview role.
  - Admin is checked first, then Director, Secretary, Finance, and Manufacturer (which includes Agency).
  - Officer roles with no hierarchy of their own (Programme, Reviewer, IAME, SDA, Laboratory, Helpdesk, Auditor) see the Admin hierarchy, narrowed to the working screens the runtime registry already gives their role.
- **At most four primary groups for every role.** Admin has exactly four.
- **Each entry carries:** a stable ID, a title, an icon, a canonical route, its allowed roles, a state (`available`, `preview` or `planned`), optional children, and an optional badge.
- **Routes come only from existing registries:**
  - `live(href)` must be a `RUNTIME_ROUTES` entry (state `available`);
  - `proto(module, screen)` must be a `lib/screens` prototype (state `preview`);
  - `page(href)` must be listed in `STANDALONE_PAGES` (`/verify`, `/app/identity/access-management`);
  - planned entries have no route.
  - Loading the module throws if a route does not exist, so the menu cannot link to a missing page.
- **Planned entries** are shown with a "Planned" label as non-links (`aria-disabled`). Preview entries are labelled "Preview".
- **Permission-gated screens follow the permission.**
  - Fee rules, Rating schemes, Business settings and Receipts take `navCapabilities` from the registry.
  - Each operational hierarchy carries a "Rules and settings" parent that appears only when the person's role has been granted one of those permissions.
- **Runtime routes not in any menu** are listed with reasons in `NOT_IN_MENU`:
  - `/app/registrations/new` is opened from Registration requests;
  - `/app/registrations/request` is a detail page;
  - `/app/manufacturer/director` is the "activation is automatic" notice, replaced in the menu by observation monitoring.

## 3. Hierarchies

- **Admin (demonstration umbrella).** The Admin sidebar shows the narration: "Consolidated view of every screen for the demonstration. In normal operation each user sees only the menus and records permitted for their role."
  - **Executive Dashboard:**
    - Executive overview, Manufacturer 360, Programme MIS.
    - Officer work queue: My work, My approvals, Applications in progress, SLA and escalations.
    - Notifications and messages, Director overview.
  - **Registration & Applications:**
    - Company registration.
    - Brand registration: requests, reviews.
    - Product category registration (planned).
    - Model applications: list, new, approval and recommendation, notifications.
    - Document verification: IAME evidence scrutiny; registration documents (preview).
    - Test-report scrutiny: BEE scrutiny, rating calculation.
    - Returns and responses (preview).
  - **Labels & Consumer Services:**
    - Certificates, QR batches and serials, Consumer verification.
    - Suspect-label reports (planned).
    - Generated forms and letters (preview).
    - Official templates (planned).
  - **Operations & Intelligence:**
    - Payments and receipts: payments, fee receipts and corrections, model and registration fee confirmation.
    - Production reporting; Annual QR reconciliation (preview); Observation and anomalies.
    - Renewal, withdrawal and revocation: renewals and withdrawals (preview); register and revocation.
    - AI advisory use cases (Advisory); Secure evidence ledger (Simulated).
    - Users and access: delegations; access management (preview).
    - Rules and master data: fee rules, rating schemes, business settings; master data (preview).
    - Audit history: workflow history, audit overview.
- **Manufacturer (own organisation only; no risk scores, no internal BEE queues):**
  - **Dashboard:** Manufacturer 360.
  - **Registration & Applications:**
    - Company registration; Registration status and observation.
    - Brand and category registration.
    - Model applications: mine, new.
    - Document uploads (preview); Returned applications; Certificates.
  - **Labels & Operations:**
    - QR batches and serials, Payments and receipts, Production reporting.
    - Annual QR reconciliation (preview); Generated forms and letters (preview).
  - **Compliance & Support:**
    - Renewals and Withdrawals (preview).
    - Anomalies and holds (planned).
    - Messages and queries; Application notifications.
    - Official templates (planned); Helpdesk (preview).
- **Director (no onboarding pre-approval queue; AI is advisory and human-controlled):**
  - **Dashboard:** Director overview, Executive overview, Manufacturer 360, Notifications.
  - **Work Queue & Decisions:**
    - Officer work queue, Registration observations, Anomalies and holds.
    - Model recommendations, Brand registration reviews.
    - Withdrawal requests (preview); Rejection and revocation.
  - **Oversight & Intelligence:**
    - AI advisory use cases (Advisory); Risk-prioritised cases (preview, Advisory).
    - Document verification (preview); Test-report scrutiny (preview).
    - Programme MIS; Secure evidence ledger (Simulated).
  - **Registers & Compliance:**
    - Manufacturer register (planned); Brand and category register.
    - Model and certificate register (preview); QR and production reconciliation (preview).
    - Audit history, Delegations.
- **Secretary (model and appliance approval only):**
  - **Dashboard:** Secretary overview, Notifications.
  - **Final Approvals:** Model applications; Returned applications (planned); Rejection recommendations (planned); Pending final decisions.
  - **Certificates & Formats:** Approved certificates; Generated approval letters (preview); Model register (preview); Certificate history (planned); Revoked certificates (planned).
  - **Oversight & Reports:** Manufacturer 360, Approval summary, Pending applications, AI advisory summary (Advisory), Secure evidence status (Simulated).
- **Finance (automatically verified payments, for information; no manual confirmation of ordinary successful payments):**
  - **Dashboard:** Finance overview, Notifications.
  - **Payments & Receipts:** Registration, model-application and QR-label payments (preview); Receipts (when granted `fee_confirmation_correct`); Payment exceptions (preview).
  - **Reconciliation:** QR issued versus paid (preview); Production versus QR usage (preview); Annual reconciliation (planned); Outstanding balances (preview).
  - **Monitoring & Reports:** Manufacturer observation information, Raise anomaly, Payment reports, Manufacturer 360, Audit history, Delegations.
  - The Finance queue and Registration fee confirmation screens are not in the Finance menu.

## 4. Blueprint feature coverage

The table maps each feature to its menu entry and state. Nothing below is presented as complete unless it is backed by a working runtime screen.

| Feature | Menu entry | State |
| --- | --- | --- |
| Company registration with automatic activation and 15-day observation | Company registration; Registration status and observation; Observation and anomalies | Available |
| Brand and category registration | Brand registration; Product category registration | Available; category Planned |
| Model application and approval | Model applications; Model recommendations; Final approvals | Available |
| Document verification (OCR) | Document verification | IAME scrutiny Available; OCR not built; registration documents Preview |
| Test-report scrutiny and rating | Test-report scrutiny | Available (no AI extraction) |
| Payments and receipts | Payments and receipts | Available demonstration; gateway simulated |
| QR batches and serials | QR batches and serials | Available demonstration; signed QR payloads not built |
| Consumer verification and suspect-label reports | Consumer verification; Suspect-label reports | Available; reports Planned |
| Production reporting and annual reconciliation | Production reporting; Annual QR reconciliation | Available demonstration; reconciliation Preview |
| Manufacturer 360 | Manufacturer 360 | Available |
| AI advisory use cases | AI advisory use cases; Risk-prioritised cases | Advisory demonstration; no production AI |
| Secure evidence ledger | Secure evidence ledger | Simulated; not Hyperledger, no Merkle anchoring |
| Generated forms, letters and official templates | Generated forms and letters; Official templates | Preview; templates Planned; no e-signing |

MCA and GSTN checks are not represented as working anywhere (BL-261 remains open).

## 5. Route guard

`RouteGuard` decides prototype and standalone console pages from the Spring identity only (`canOpenConsolePath`). A page opens if:

- it is in the person's own menu; or
- the existing per-role screen policy (`lib/categories.ts` `canRoleAccessPath`) allows one of their **Spring** roles; or
- the sign-in is Admin (every prototype).

Otherwise:

- a signed-out visitor sees "Sign in to continue";
- a signed-in person without access sees "Not in your menu".

Prototype pages show a "Preview screen: sample data, not yet connected to the BEE service" note. Runtime routes stay exempt: Spring scopes and refuses them. Choosing a preview role changes only the sample data a prototype shows; it never opens a screen.

## 6. Boundaries kept

- No database migration, no workflow-state change, and no backend, BFF, `lib/server` or `app/api` change.
- No new permission, and no route invented or removed.
- The only registry change is the label and description of `/app/manufacturer/director`. The old wording ("Manufacturer registration decisions"; "Approve or reject") is now "Company registration activation", matching the automatic-activation notice the page shows.

## 7. Tests (brief §10, 1–15)

`components/app/__tests__/RoleNavigation.test.tsx` has 24 tests. Brief tests 1–15 map to them as follows:

- **Tests 1–5 (group counts and coverage):** exact group counts and titles per role. Admin covers every runtime route except `NOT_IN_MENU`, and every working route used by another role.
- **Test 6:** no "All screens" or "dev" text and no `/app/screens` link for any role.
- **Tests 7–8:** AI advisory and the secure ledger reach Admin and Director, carrying the Advisory and Simulated badges.
- **Test 9:** Manufacturer has no risk scoring and no internal queue.
- **Test 10:** Finance has no fee-confirmation or approval screen, and no title containing "approv" or "confirm".
- **Test 11:** Secretary has no manufacturer pre-approval.
- **Test 12:** planned entries are `aria-disabled` non-links labelled "Planned".
- **Test 13:** `aria-current`, the active group kept open, one other group at a time, nested parents opening for detail pages, and arrow, Home and End keys between group headers.
- **Test 14:** the layout renders `AppSidebar` twice (desktop and drawer); both render the same entries, and `onNavigate` closes the drawer.
- **Test 15:** `canOpenConsolePath` ignores the preview role. A Manufacturer previewing as Admin keeps the Manufacturer menu and is refused an Admin screen. An Admin sign-in opens it whatever the preview role.
- **Further tests:** every route exists and every ID is unique; capability gating; officer fallback; signed-out state.

The live check `read-ui-browser-check.cjs` step `read-ui.preview-elsewhere-unchanged` expected a Manufacturer previewing as Admin to open an Admin prototype. That contradicts this brief, so the step is replaced by `read-ui.preview-grants-nothing`.

## 8. Deferred

- BL-265: Hindi labels for the new menu.
- BL-267: planned entries that need a screen.

## 9. Brief C3A — Admin read-only demonstration access (19 October 2026)

**Goal:** Every non-planned Admin menu link opens in backend-enforced read-only mode; operational roles keep their mutations.

**Access model:** `AdminDemonstrationAccess` (Spring): umbrella `admin`/`all` with no operational own role → `mayReadAllOperationalRecords` on model applications, registrations and manufacturer onboarding; `deniesOperationalMutation` on workflow, filing, fee confirm, onboarding writes and registration review transitions. `/api/me` exposes `adminDemonstrationReadOnly`. Admin capabilities (fee rules, rating schemes, business settings, fee corrections, delegations approval, demo ledger writes) are unchanged.

**Portal:** `AdminDemonstrationBanner`; `ScreenChrome` hides header actions; manufacturer routes use `ManufacturerRouteShell`; registration list and finance queue hide mutation controls when Spring reports read-only Admin.

**Proof:** `AdminDemonstrationAccessTest`, `SlicePolicyTest`, `RegistrationDatabaseTest`, `RevocationDatabaseTest.adminDemonstrationReadsRegisterButCannotMutate`, `SnlWp03OptimizedManufacturerOnboardingDatabaseTest`; `AdminDemonstration.test.tsx`, `RegisterRevocations.test.tsx` (read-only Admin hides mutation controls), `adminMenuCoverage.test.tsx` (every menu route names real backend/UI tests); live `npm run local:c3a-five-role` (Admin opens all four menu groups plus register). OpenAPI **0.37.2** adds optional `adminDemonstrationReadOnly` on Me.

**BL-266:** **done** (19 October 2026). Contract pin SHA256 `fc06669a…` matches OpenAPI **0.37.2**; `npm run local:c3a-five-role` **17/17** (five roles, Admin register read-only + POST `role_not_permitted`); full `@Tag("db")` suite, `web:test` **264/264**, `web:test:ui` **270/270**, `build`, `contract-artifact.test.mjs` **7/7**, `git diff --check` green.
