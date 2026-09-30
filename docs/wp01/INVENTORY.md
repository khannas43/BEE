# WP01.1 Inventory and gap register

Baseline: commit `97839e5` (main), inventoried 30 September 2026. Scope: the current portal code, plus a requirement trace limited to the registration-to-model slice. The full RFP-to-feature trace is not part of this increment.

Status: WP01.1, WP01.2 and WP01.3 (architecture decisions and acceptance mapping: [ADR-001](ADR-001-local-runtime.md) and [ACCEPTANCE_MAPPING.md](ACCEPTANCE_MAPPING.md)) passed documentation review on 30 September 2026. WP01 is accepted as documentation and design evidence (1 of 11 work packages, 9.1%). This is documentation only. No app route, menu or screen changed. The per-screen matrix is in [SCREEN_ACTION_MATRIX.md](SCREEN_ACTION_MATRIX.md), generated from `lib/screenMatrix.ts`; the slice definition is in [FIRST_SLICE.md](FIRST_SLICE.md).

## 1. Route inventory

| Group | Count | Where |
| --- | ---: | --- |
| Catalogue screens (14 modules) | 140 | One dynamic route: `app/app/[module]/[screen]/page.tsx`, built from `lib/screens.ts` |
| Bespoke catalogue screens | 38 | `components/app/deepScreens.tsx`: model-label 18, QR 8, workflow 5, MIS/AI 6, audit 1 |
| Generic placeholder screens | 102 | `components/app/ScreenScaffold.tsx`, one of 10 archetypes (table, form, detail and so on) |
| Standalone console routes | 9 | `/app`, `/app/screens` (catalogue), `/app/ai`, `/app/registrations/record`, `/app/qr/batch`, `/app/enforcement/case`, `/app/helpdesk/workspace`, `/app/identity/access-management`, `/app/workflow/my-approvals` |
| Public routes (no login) | 9 | `/`, `/about`, `/programmes`, `/directory`, `/verify`, `/calculator`, `/notifications`, `/contact`, `/login` |

`next build` reports 161 pages; that figure includes framework pages and is not a screen count.

### How screens are reached today

The console menu (`lib/categories.ts`) has 9 categories and 52 items: 44 open catalogue screens, 8 open standalone routes.

| Reach | Catalogue screens |
| --- | ---: |
| Direct menu item | 44 |
| Task link, in-page link or `WORKFLOW_ACCESS` exception only | 13 |
| No inbound path except the development catalogue `/app/screens` | 83 |

Catalogue-only screens by module: documents 8 of 8, agency & brand 8 of 9, enforcement 9 of 14, identity 5 of 6, withdrawal 7 of 8, workflow 7 of 9, helpdesk 7 of 10, administration 6 of 12, model-label 8 of 18, QR 5 of 8, production 5 of 9, finance 5 of 10, MIS/AI 3 of 15, audit 0 of 4.

## 2. Roles and navigation policy

- 13 personas in `lib/roles.ts`: 8 internal (admin, programme, reviewer, director, secretary, finance, helpdesk, auditor) and 5 partner (manufacturer, agency, IAME, SDA, laboratory).
- One policy (`ROLE_CATEGORIES`, item `ext`/`hideFrom`, `WORKFLOW_ACCESS`, `canRoleAccessPath`) drives the sidebar, `RouteGuard` and `scripts/access-audit.cjs`. The audit's 9 invariants pass at the baseline.
- All of it runs in the browser. The login page writes the chosen role to `localStorage` (`bee-role`); any OTP is accepted; the top-bar "Preview role" switcher changes the role at will; `/app/screens` opens for every role.
- Internal capacity per screen comes from DDD Annex A.1 (`lib/screens.ts`, 8 internal roles only). Partner capacity is not recorded anywhere; partners get whatever their menu items open, and `ScreenScaffold` grants them View/Download on those screens.

## 3. State and fixtures

| Key or source | Holds | Kind | Replaced by |
| --- | --- | --- | --- |
| `localStorage bee-role` | Current role | Authoritative-looking | WP02 |
| `localStorage bee-lifecycle-v1` | Model applications, stages, timeline (`LifecycleStore`) | Authoritative-looking | WP05 |
| `localStorage bee-qr-v1` | QR batches (`QRStore`) | Authoritative-looking | WP08 |
| `localStorage bee-cert-state-v2` | Certificate versions and ledger state (`CertificateStore`) | Authoritative-looking | WP09 |
| `localStorage bee-lang`, `bee-a11y` | Language and accessibility preferences | Harmless UI preference | Stays client-side |
| `lib/mock/lifecycle.ts` | 8 seed applications, stage owners, star thresholds, fee | Fixture | WP04, WP05 |
| `lib/mock/payments.ts` | Partner fee rows keyed by role | Fixture | WP07 |
| `lib/mock/certificate.ts`, `lib/mock/qr.ts` | Journey certificate, ledger, QR seeds | Fixture | WP08, WP09 |
| In-component fixtures | `RecordWorkspace` RECORDS, `QRBatchWorkspace` batches, `MyApprovals` ITEMS, enforcement, helpdesk, access, AI | Fixture | WP04–WP11 |

The public `/verify` page reads `bee-lifecycle-v1` directly from the browser.

## 4. Requirement trace for the registration-to-model slice

Sources were extracted to text outside the repository for reading only: RFP Vol 2 and its Scope of Work, the corrigendum (ATC file including Annexure X), and Detailed Design v0.2. Page numbers are from the PDF footers.

| ID | Requirement | Source | Current code | Gap |
| --- | --- | --- | --- | --- |
| R1 | Manufacturers, traders or importers apply for agency/brand registration online, with documents and fee; approval runs as a workflow | RFP Vol 2 §1.4(i), p. 8; Annexure X §5 | Brand and agency registration are placeholder screens; `RecordWorkspace` shows three fixed records | G05, G06 |
| R2 | Model applications from manufacturers/agencies are evaluated, approved and listed, with energy data and star rating recorded | RFP Vol 2 §1.4(ii), p. 8 | `NewModelApplication` creates a record in `LifecycleStore` | G01, G03 |
| R3 | Multi-page model application with test-report upload, auto star label generation, note-sheet and approval workflow | Annexure X §5 | Single-page form; upload area is decorative; note-sheet is a placeholder detail view | G04, G11 |
| R4 | Intake validates brand, appliance configuration, model/family uniqueness, standard, lab accreditation, test dates and documents | DDD §5.3 | No validation; brand is free text; test date is free text | G03, G04 |
| R5 | Fee: compute the application fee and record confirmed settlement, with ledger and receipt | DDD §5.3; RFP Vol 2 SoW (d), p. 13 | Flat ₹24,000 for every category; Finance confirms manually; payer view is read-only | G08 |
| R6 | Finance verifies documents and payments; no technical approval | RFP Vol 2 §1.3, p. 8; DDD §4.3 | Fee confirmation gated to Finance on route, view and button (REVIEW-FIXES-3). Annex A.1 still grants Finance approve on director and secretary approval | G10 |
| R7 | IAME scrutiny: checklist, test evidence, technical note; return or recommend. IAME has scrutiny and verifier (note-sheet) users and no final approval | DDD §5.3, §4.3; RFP Vol 2 §1.3, p. 8 | One `iame` role; stage advance or return; no note-sheet | G11 |
| R8 | Project Engineer or assigned official verifies applications | RFP Vol 2 §1.3, p. 8 | Mapped to the `reviewer` stage `bee_scrutiny` | G12 |
| R9 | Program Director recommends and approves; Secretary gives final approval; stages follow configured delegation | RFP Vol 2 §1.3, p. 8; DDD §5.3 | One `approval` stage that either Director or Secretary completes | G09 |
| R10 | Star rating computed from the approved, effective formula, keeping inputs and intermediate results | RFP Vol 2 SoW (b), p. 13; DDD §5.3 | `computeStars` uses fixed ISEER thresholds for every category and keeps no formula version. The corrigendum (p. 29, row 70) points bidders to beestarlabel.com rather than supplying formulas | G13 |
| R11 | Each user reaches only explicitly authorised functions and data; partners never see another organisation | RFP Vol 2 SoW (b), p. 13; DDD §4.3 | Client-side menu and route guard only; no organisation on the model record | G02, G03 |
| R12 | Workflow supports task allocation, routing, shortfall handling, reassignment and escalation; every action time-stamped and auditable | RFP Vol 2 SoW (f), p. 13 | Stage timeline with browser-local times; return flag without a resubmission step | G14 |
| R13 | Temporary save of incomplete agency/brand and model applications, purged if payment is not completed within the prescribed window (180 days, as applicable) | Annexure X §7 | No draft state; submit creates the record at `fee_due` | G15 |
| R14 | Last 3 years of production and sales data uploaded as part of model registration | Annexure X §7 | Not captured | G16 |
| R15 | Demo: submit model, IAME/BEE scrutiny, return, resubmit, approve | DDD §13.2 scenario 3 | Submit, scrutiny, return and approve exist in the store; resubmit does not | G14 |

Annexure X also resolves a volume question: about 60 crore registered appliance units for FY 2024–25, with about 30,000 models and 5,000 agencies. That is production sizing and outside this local phase.

## 5. Gap register

Priority: **S** blocks the first slice; **H** high; **M** medium. "Closes in" is the work package that owns the fix. WP01 changes none of these.

| ID | Pri | Gap | Evidence | Closes in |
| --- | --- | --- | --- | --- |
| G01 | S | The registration record workspace and the model lifecycle are disconnected. `RecordWorkspace` reads its own RECORDS fixture, and its Approve/Reject/Return buttons do nothing. A model created in "New model application" never appears there | `components/app/registrations/RecordWorkspace.tsx` | WP04, WP05 |
| G02 | S | The Manufacturer cannot open `/app/registrations/record`: its menu item is scoped to the agency role only | `lib/categories.ts` "Agency registrations" `ext: ["agency"]`; matrix proposals on slice rows | WP02, WP04 |
| G03 | S | A model application has no organisation or brand ID; the brand is free text. Partner scoping comes from a per-role fixture (`PARTNER_PAYMENTS[role]`), not from the record | `lib/mock/lifecycle.ts` `ModelApplication`; `lib/mock/payments.ts` | WP04, WP05 |
| G04 | S | Intake does no validation (uniqueness, accreditation, test dates, documents) and the upload area is decorative | `NewModelApplication.tsx` | WP05, WP06 |
| G05 | S | No brand or agency registration flow exists to create the slice's precondition (an active brand owned by the applicant) | Placeholder `agency-brand/*` screens | WP04 |
| G06 | H | Registration ID collision: `BEE/RAC/2026/10016` is Godrej Turbo in the lifecycle seed, but Nova Cool FrostMax in the certificate, QR and QR-workspace fixtures | `lib/mock/lifecycle.ts:297`, `lib/mock/certificate.ts:77`, `lib/mock/qr.ts:51` | WP05 (recommend Nova Cool keeps the ID) |
| G07 | H | Application IDs are derived from array length, and the form predicts the ID separately from the reducer | `LifecycleStore.tsx` `CREATE`; `NewModelApplication.tsx` `submit` | WP05 |
| G08 | H | The fee is a flat ₹24,000 for every category, not an effective-dated rule | `feeForCategory` | WP04 (fee rule), WP07 |
| G09 | H | Director and Secretary are alternatives for one approval stage; the RFP describes Director recommendation followed by Secretary final approval | `STAGE_OWNERS.approval`; `WORKFLOW_ACCESS` | WP05 |
| G10 | H | Annex A.1 (`APPROVE_ALL`) grants approve to Admin, Finance and Helpdesk on brand, director and secretary approval, contradicting DDD §4.3. The matrix overrides it on the two slice approval rows only | `lib/screens.ts` pattern `APPROVE_ALL` | WP02 |
| G11 | M | No IAME note-sheet, and no split between the scrutiny and verifier IAME users | RFP Vol 2 §1.3; one `iame` role | WP05 |
| G12 | M | RFP roles Data Analyst (application allocation) and IT are not in the 13 personas; allocation is implicit | `lib/roles.ts` | WP02 |
| G13 | H | The rating uses fixed thresholds for every category and records no formula version or inputs | `computeStars` | WP05 (formula source is a BEE dependency) |
| G14 | M | A return sets a flag but there is no applicant resubmission step; timeline times are browser-local | `LifecycleStore` `RETURN` | WP05 |
| G15 | M | No draft or temporary-save state, and no purge rule | Annexure X §7 | WP05 |
| G16 | M | Three years of production and sales data are not captured at model registration | Annexure X §7 | WP07 |
| G17 | H | Role identity is whatever `localStorage` says; any OTP is accepted; `/app/screens` is open to all roles | `RoleContext.tsx`, `app/login/page.tsx`, `canRoleAccessPath` | WP02 |
| G18 | H | Only fee confirmation checks the role inside the stage screen; other stage actions rely on the route guard | `StageScreen.tsx` `canConfirmFee` | WP02, WP03 |
| G19 | M | "My approvals" is a static list, so slice approvals never appear there, and one item is dated "18 Oct" while the others are dated 23–24 Sep 2026 | `components/app/workflow/MyApprovals.tsx` | WP05 |
| G20 | M | Two QR models: `/app/qr/batch` uses its own batch fixture while the QR catalogue screens use `QRStore` | `QRBatchWorkspace.tsx`; `QRStore.tsx` | WP08 |
| G21 | M | Duplicates: "Approval note" and "Model dashboard" each exist in two modules; `secretary-approval` renders the same view as `director-approval` with no inbound link; `qr-verification/public-verification` duplicates `/verify`; `identity/login-and-mfa` duplicates `/login` | Matrix dispositions | WP05, WP08 |
| G22 | M | The menu item "Integrations" opens `administration/reference-publication` | `lib/categories.ts` | WP04 |
| G23 | M | Manufacturer and agency have no route to their own show-cause notice or response | Matrix proposals on `/app/enforcement/case` | WP10 |
| G24 | H | DDD Annex A.2 gives all five partner roles identical capacity on every screen (for example IAME and laboratory can create a model application, and the manufacturer can review IAME scrutiny), so it cannot be used as the partner matrix | DDD v0.2 Annex A.2 | WP01 review with BEE |
| G25 | M | The matrix and the current client policy disagree on 540 role/route pairs: 475 are Annex A.1 cells carried unchanged (Director 106, Secretary 106) and 65 are WP01 proposals; 52 are on slice rows. Each is a proposal requiring policy review, not a grant: none may be closed by widening a menu, the route guard or a server permission automatically | Matrix section "Reachability mismatches: proposals requiring policy review" | WP02 policy review |

## 6. Review-fix regressions retained

These behaviours from `docs/REVIEW-FIXES*.md` are encoded as matrix checks or as capacity in the matrix and must survive later work:

- A payer (manufacturer or agency) never holds approve or execute on fee confirmation. Only Finance confirms, as an execute (X) action, and no role holds approve (A) on the fee row (REVIEW-FIXES-3).
- Partners never see internal-only items and never get "all organisations" scope (REVIEW-FIXES P0-B).
- Workflow action screens remain reachable by their stage owners (REVIEW-FIXES-2); every slice step's route is allowed for its actor today.
- Public verification stays outside the staff console; the console duplicate is marked retire (REVIEW-FIXES P0-A, audit invariant).
- Label, certificate, ledger and QR stay one record; the registration ID collision (G06) is recorded against that rule.

## 7. Checks

| Command | What it proves |
| --- | --- |
| `bash scripts/access-audit.sh` | Existing 9 navigation and permission invariants (unchanged) |
| `bash scripts/screen-matrix.sh` | 24 structure checks: 16 matrix invariants (including slice order, fee confirmation as Finance X only, the provisional decisions, and a planned entry path for every permitted role on every retained console route), 6 acceptance-map checks, and 2 checks that `SCREEN_ACTION_MATRIX.md` and `ACCEPTANCE_MAPPING.md` match `lib/screenMatrix.ts` and `lib/acceptanceMap.ts`. These validate structure, not business acceptance |
| `bash scripts/screen-matrix.sh --write` | Regenerates `SCREEN_ACTION_MATRIX.md` and `ACCEPTANCE_MAPPING.md` |

`npm run audit:access` and `npm run matrix` run the first two. Neither changes the app's policy: reachability mismatches are reported as proposals for policy review and never fail or grant anything.

Baseline results for the other project checks, at the WP01 revision:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Passes |
| `npm run build` | Passes, 161 pages |
| `npm run lint` | **Fails**, exit code 1: 21 errors and 18 warnings, all in existing files under `app/`, `components/` and `lib/` that WP01 does not change. The WP01 files (`lib/screenMatrix.ts`, `scripts/screen-matrix.cjs`) lint clean. |

## 8. Provisional BEE decisions

The six local-demo defaults (D1 to D6: Secretary always required, seeded round-robin allocation, unverified formula version "0-unverified", record workspace as the applicant's model record, single IAME step, one seeded fee rule) are provisional and pending BEE decisions. They are listed with their basis in [FIRST_SLICE.md](FIRST_SLICE.md) §10 and in `PROVISIONAL_DECISIONS` in `lib/screenMatrix.ts`.
