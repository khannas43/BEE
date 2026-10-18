# WP3–WP9 guided showcase (15–20 minutes)

Updated 18 October 2026. **This is a rehearsal script, not a work-package acceptance record.** It walks the SnL journey from brand registration through post-approval lifecycle using **existing** portal routes and demo seeds. Password for every account: **`demo123`**. Sign in at `http://127.0.0.1:3100/login`.

**Sign-in vs preview role:** The **preview role switcher** (top bar) changes which menus and labels you see for exploration; it is **not** authentication and does not grant API access. The **signed-in identity badge** (name, role, organisation) is authoritative. If a list is empty or wrong, **sign out** and sign in again as the demo account named in the step—do not rely on the preview switcher alone.

Optional PDF-aligned opener: **`bee.director`** — `/app/demo/manufacturer-360` (synthetic-data disclosure; lifecycle rail links to the working screens below).

**Say once at the start:** “This local showcase uses **synthetic data** only. Registration requests, model records, fees, QR, production and the register run on the **real Spring database and BFF** in this build. Demonstration screens (Payments, QR batches, Certificate ledger, Quarterly production, MIS and Executive dashboards) are **local demonstrations** with simulated gateway and simulated ledger rules. Renewal, voluntary withdrawal and bureau **cancellation** screens marked **demo preview** use the **lifecycle-store fixture** (`lib/mock/lifecycle.ts`) until **WP9** production. Nothing here is an official BEE record.”

Binding references: `docs/snl/BEE_SNL_IMPLEMENTATION_PLAN.md`, `docs/BEE_DECISIONS.md`, `docs/snl/SNL_WP01_STATE_MODELS.md`, SnL Disha Advisory Manual §3.1–§3.9 (roles per **Assumption A15** where the manual is silent).

---

## Anchor records

| Work package | What to open | Reference | Real vs simulated |
|---|---|---|---|
| WP3 | Register → Brands | **Nova Cool** (active brand on register) | **Real** register row from demo seeds (**s7** / base seed); **s9** verifies only |
| WP3 | Registration reviews (Director) | **REG-2026-9001** (approved; synthetic org **SYNTH-MFG-2**, brand **Synthetic Registered Brand 1**) | **Real** `registration_application` with fee → Programme → Director **trail** (**s8**) |
| WP4 | My model applications | **DEMO-MA-0101**, model **NC-RAC-12D**, state **approved** | **Real** model application + certificate |
| WP4 | Public verify | **BEE/RAC/2026/10101** | **Real** verification API |
| WP5 | Payments | **DEMO-PAY-0001** (and 0002–0005) | **Simulated** gateway on demo screen |
| WP6 | QR batches | Batch tied to **BEE/RAC/2026/10101** | **Real** QR tables; demo UI |
| WP7 | Quarterly production | Nova **2026-Q3** (submitted) | **Real** production submission |
| WP8 | Executive / MIS | Nova-filtered figures | **Simulated** MIS assumptions |
| WP9 | Register → Waiting for a decision | Pending revoke on **Polar Wave (synthetic)** | **Real** register revocation workflow |
| WP9 preview | Renewals and changes | `/app/model-label/renewal-or-degradation` | **Demo preview** (lifecycle-store) |
| WP9 preview | Withdrawals | `/app/withdrawal/brand-withdrawal` | **Scaffold / demo preview** |
| WP9 preview | Cancellation (§3.8) | `/app/registrations/record` | **Static fixture** workspace; WP9 not built |

---

## Running order (15–20 min)

| Min | WP | Persona (username) | Route | Record / action | One sentence (real vs simulated) |
|---|---|---|---|---|---|
| 0–1 | — | *(none)* | `/login` | Demo panel | “Every account uses **demo123**; sign in as the persona named on each step.” |
| 0–2 | WP8 preview | `bee.director` | `/app/demo/manufacturer-360` | Guided lifecycle rail | “**Demonstration preview**—synthetic M360 accelerator; links jump to **real** working screens.” |
| 1–3 | WP3 | `bee.director` | `/app/registrations/register` | **Brands** tab → search **Nova Cool** | “**Real** active register row from existing demo seeds; **s9** only **verifies** anchors—it does **not** add or change register rows.” |
| 3–5 | WP3 | `bee.director` | `/app/registrations/reviews` | **Decided** or **All** → open **REG-2026-9001** | “**Real** approval trail on a **synthetic** registration: Finance fee confirmation, Programme recommendation, Director approval—not Nova Cool’s brand row.” |
| 5–7 | WP4 | `nova.applicant` | `/app/model-label/model-dashboard` | **DEMO-MA-0101** / **NC-RAC-12D** | “**Real** approved Nova model in Spring; full six-step SnL wizard and category deposit are **WP3/WP4** future work.” |
| 7–8 | WP4 / WP6 | *(public)* | `/verify` | **BEE/RAC/2026/10101** | “**Real** public read: valid permission for Nova Cool **NC-RAC-12D**.” |
| 8–10 | WP5 | `nova.applicant` → `bee.finance` | `/app/demo/payments` | **DEMO-PAY-0001** | “**Simulated** gateway; fee amount is fixed on the application—Finance still **confirms** separately (**real** separation on registration fees; demo payments are local demonstration).” |
| 10–12 | WP6 | `nova.applicant` | `/app/demo/qr` | Certificate **BEE/RAC/2026/10101** | “**Real** QR batch for 10101 in the database; this screen is the **local demonstration** UI.” |
| 12–14 | WP7 | `nova.applicant` → `bee.programme` | `/app/demo/production` | Quarter **2026-Q3** (submitted) | “**Real** Nova submission; **hard-refresh** if the list first shows ‘No submissions yet’; programme view compares declared units to bound serials.” |
| 14–16 | WP8 | `bee.director` | `/app/demo/executive` then `/app/demo/mis` | Filter **Nova Cool** / manufacturer | “**Simulated** executive/MIS assumptions; numbers recompute on refresh.” |
| 16–18 | WP9 | `bee.director` | `/app/registrations/register` | Tab **Waiting for a decision** → **Polar Wave (synthetic)** revoke (read-only) | “**Real** two-person register revocation—do **not** approve or reject live; same pattern WP9 will extend per **A15**.” |
| 17–19 | WP9 preview | `nova.applicant` | `/app/model-label/renewal-or-degradation` | Fixture app (e.g. **APP-2026-05016** in store) | “**Demo preview only**: buttons do not write to Spring; planned path is scrutiny → Programme → Secretary (**§3.5**, **A15**).” |
| 17–19 | WP9 preview | `nova.applicant` | `/app/withdrawal/brand-withdrawal` | Scaffold screen | “**Demo preview**: §3.7 withdrawal with financial clearance + Director (**A15**) is **not** production yet.” |
| 18–19 | WP9 preview | `bee.programme` | `/app/registrations/record` | Static **Model** record tabs | “**Fixture preview** for a unified record workspace; bureau **cancellation** (**§3.8**, Programme → Director → Secretary per **A15**) is **WP9**—not live.” |
| 19–20 | Close | `bee.director` | `/verify` | **BEE/RAC/2026/10101** again | “One database, role scoping, public verify; WP3–WP9 **production acceptance** remains on the implementation plan.” |

**Fallback if a step fails**

| Step | Fallback |
|---|---|
| Registration / model list errors | **Register** → **Nova Cool**; **Registration reviews** → **REG-2026-9001** trail; or `/verify?reg=BEE/RAC/2026/10101` |
| Demo payment gateway | Show **DEMO-PAY-0002** as already paid in list; switch to **Finance** reconciliation panel only |
| QR bind / generate | Open existing batch for **10101** read-only; use **Verify this serial** link |
| Production list empty | Stay signed in as **nova.applicant**, **hard-refresh** `/app/demo/production`; show existing **2026-Q3** submitted row only (do not submit Q4 live) |
| Executive/MIS blank | `/app/demo/director` card dashboard |
| Register revocation click fails | Describe pending **Polar Wave** row from **Waiting for a decision** count card |
| Renewal / withdrawal / record workspace | Say “WP9 preview offline” and show **SNL_WP01_STATE_MODELS.md** transition row on slide |
| Wrong or empty screen after “switching role” | Sign out; sign in as the step’s demo account; ignore preview-only menu entries |

---

## Five-minute cut

1. **`bee.director`** — `/app/registrations/register` → **Nova Cool** (WP3 register); then `/app/registrations/reviews` → **REG-2026-9001** approval trail (WP3 workflow).
2. **`nova.applicant`** — `/app/model-label/model-dashboard` → **DEMO-MA-0101** (WP4).
3. **Public** — `/verify` → **BEE/RAC/2026/10101** (WP4/6).
4. **`nova.applicant`** — `/app/demo/payments` → **DEMO-PAY-0001** (WP5 simulated).
5. **`bee.director`** — `/app/demo/executive` (WP8 simulated) + `/app/registrations/register` → pending **Polar Wave** revocation, read-only (WP9).
6. One line each: renewal and withdrawal routes are **demo preview** only.

Register rows and **REG-2026-9001** come from existing demo seeds (**s5**, **s7**, **s8**, **s4**, and related slices). **`s9_wp3_wp9_showcase.sql`** runs **readiness assertions only** after those seeds; it confirms required WP3–WP9 anchor records exist and **does not mutate** them (see `local/seed/demo/s9_wp3_wp9_showcase.sql`).

**Quarterly production (presenter):** Sign in as **`nova.applicant`**. Open `/app/demo/production`. If you see **“No submissions yet”**, **hard-refresh** once—the seeded Nova **2026-Q3** **submitted** quarter should appear. Do not create a new quarter during the demo.

---

## Reset and reseed

```bash
export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false
npm run local:down && npm run local:up
node scripts/demo/login-setup.cjs apply
npm run demo:seed    # safe to run twice; s9 asserts anchors without duplicating rows
npm run demo:wp3-wp9-check
```

For a **clean** database (undoes ledger commits and live demo clicks): `npm run local:reset`, then `bash scripts/local/ensure-runtime-role.sh`, then the block above.

*(Before a live presentation with the stack already up: do **not** reset or reseed unless the database was mutated during rehearsal.)*

---

## Demo-only fixtures and hardcoded assumptions (replace in production)

| Item | Location | Planned replacement |
|---|---|---|
| s9 readiness assertions only (no row drift) | `local/seed/demo/s9_wp3_wp9_showcase.sql` | WP3–WP9 showcase markers via API when built |
| Payments demo UI + SIMGW callbacks | `components/app/demo/PaymentsDemo.tsx`, `s1_payments.sql` | WP5 payment gateway integration |
| Ledger “simulated Fabric” | `components/app/demo/LedgerDemo.tsx`, `s3_ledger.sql` | WP6/WP10 anchoring policy |
| QR demo UI | `components/app/demo/QrDemo.tsx`, `s2_qr.sql` | WP6 production portal |
| Production demo UI | `components/app/demo/ProductionDemo.tsx`, `s4_production.sql` | WP7 production API |
| MIS / Executive dashboards | `components/app/demo/*Dashboard*.tsx`, `s5_mis.sql` | WP8 Manufacturer 360 + MIS |
| Manufacturer 360 fixture | `lib/demo/manufacturer360Fixture.ts`, `/app/demo/manufacturer-360` | WP8 Manufacturer 360 |
| Renewal screen | `lib/mock/lifecycle.ts`, `ModelDetailScreens.tsx` | WP9 renewal workflow |
| Withdrawal scaffold | `ScreenScaffold` `/app/withdrawal/brand-withdrawal` | WP9 withdrawal + **A15** clearance |
| Record workspace cancellation tab | `RecordWorkspace.tsx` static `Rec[]` | WP9 cancellation + verification effects |
| Register revocation demo brands | `s7_register.sql` (pending revoke **Polar Wave**) | WP9 aligned register/lifecycle |
| Fee rule label “Local demo fee (not BEE-approved)” | Registration fee snapshot | WP3/WP5 approved fee tables |

---

## Presenter checklist (final)

- [ ] `export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false` before `local:up` (if starting cold)
- [ ] `npm run demo:seed` run successfully when preparing a fresh database (run twice if you want idempotency proof)
- [ ] `npm run demo:wp3-wp9-check` passes
- [ ] `/verify` shows **BEE/RAC/2026/10101** valid
- [ ] WP3: **Nova Cool** on register (**director**) and **REG-2026-9001** trail on **Registration reviews**—understand they are **separate** records
- [ ] WP9: pending revoke is **Polar Wave (synthetic)**—read-only; no approve/reject
- [ ] Production: **nova.applicant**, hard-refresh if needed, **2026-Q3** submitted visible
- [ ] Identity: trust the **signed-in badge**; sign out and sign in as the step account if data looks wrong
- [ ] Downloads folder empty if you will export CSV
- [ ] Said clearly: simulated gateway, simulated ledger, lifecycle-store **WP9 previews**, M360 **demonstration preview**
- [ ] Did **not** claim WP3–WP9 packages are complete on the implementation plan

Automated check: `npm run demo:wp3-wp9-check`. Full day checklist: `docs/demo/DEMO_DAY_CHECKLIST.md`. Longer 59-minute script: `docs/demo/DEMO_SCRIPT.md`.
