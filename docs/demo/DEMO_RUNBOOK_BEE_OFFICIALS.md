# BEE officials demonstration: runbook (about 30 minutes, this laptop only)

Rehearsed on 19 October 2026 on branch `integration/wp3-c3`. The registration journey in section 2 was run end to end by script and through the browser: `node scripts/demo/c1-manufacturer-onboarding-journey.cjs` (all steps passed).

## 0. Before the room (one command, about two minutes)
```
cd ~/Developer/BEE-integration
npm run demo:reset
```
It restarts the stack with demo sign-in on, re-imports the sign-in realm (removing rehearsal guest accounts), resets the data, applies the demo seeds and **re-creates `ravik24`** (password `demo123`, company Ravik Appliances Pvt Ltd, empty draft). `ravik24` therefore always exists after a reset. To make sure it exists without resetting: `npm run demo:ensure-ravik24`. Open http://127.0.0.1:3100/login. Every password is `demo123`. ngrok stays closed. Do not run `npm run local:check` on the day (it wipes the demo state; run `npm run demo:reset` again afterwards).

| Person in the story | Sign in as |
|---|---|
| Applicant | `ravik24` (already created by the reset; to show the sign-up page live, register a different username, for example `ravik25`) |
| Established manufacturer | `nova.applicant` |
| BEE Officer (operational approver, "bee.official") | `bee.officer` |
| Director (final authority) | `bee.director` |
| Finance | `bee.finance` |
| Admin (sees every screen, read only; optional) | `bee.admin` |

## 1. The registration journey (the core, about 12 minutes)
Use a private window per person or sign out between people (icon at the top right).

1. **Create applicant login** (not signed in): http://127.0.0.1:3100/register/manufacturer . Show the page with a new name, for example company `Ravik Appliances Pvt Ltd`, name `Ravi Kumar`, email `ravik25@example.invalid`, mobile `9876543211`, username `ravik25`, password `demo123` twice, Submit; then carry on the journey as `ravik25`, or sign in as `ravik24` (already created) and continue from step 2. Thank-you page (simulated e-mail), then "Continue to manufacturer application".
2. **Submit company registration** (as `ravik24`), seven steps:
   1. Company: legal name (already `Ravik Appliances Pvt Ltd`, carried over from sign-up), CIN `U27100DL2015PTC123456`, GSTIN `07AABCR1234A1Z5`, registered address (line 1 `12 Okhla Industrial Area`, state Delhi, city New Delhi, pincode `110020`; state and city are drop-downs, pick the state first).
   2. Facilities: one plant (`Okhla Plant 1`, same address).
   3. Contacts and signatory (KYC): `Ravi Kumar`, designation `Director`, DIN `01234567`, email `ravik24@example.invalid`, phone `9876543210`, PAN `ABCDE1234F`, Aadhaar `123412341234`, father's name `R. Kumar`, residential address `5 Residency Road`, state Delhi, city New Delhi, pincode `110001`. All of these are required before Submit is enabled.
   4. Annexure 1: upload `docs/demo/assets/demo-document.pdf` against all eight document kinds.
   5. Declaration and agreement: tick both.
   6. Fee summary: INR 5,000 shown.
   7. Review and submit.
3. **Online payment automatically verified**: the application page shows the fee paid with a simulated receipt number.
4. **Automated document and eligibility checks**: the checks list on the application page (all pass). To show a failure, a second registration reusing the same CIN or GSTIN fails the duplicate checks (do not do this live unless asked).
5. **Approval** (sign in as `bee.officer`): Work Queue & Decisions, Registration observations, tab "Registrations awaiting decision", open the `MOB/...` request, add a note, **Approve**. (The Director, `bee.director`, can see the same request and its history.)
6. **Manufacturer activated immediately**: the request shows state "active observation" and a permittee number (`PT-2026-...`).
7. **15-day anomaly-monitoring window**: the same screen shows the observation window, start date to start date plus 15 days. Finance (`bee.finance`): Monitoring, open the manufacturer, **Raise anomaly** (the application goes on hold). `bee.officer`: **Resolve** returns it to observation (or **Revoke** ends it).
8. **Remains active if no anomaly is raised**: say that the window closes by itself when the 15 days pass with no open anomaly (the portal has no close button by design; there is no clock to wait for in the room).

## 2. The thirteen items, where to click
Sign in as `bee.admin` (it shows the whole menu), or as the person named.

| # | Item | Where | Status on screen |
|---|---|---|---|
| 1 | Seven-screen journey | Admin menu: Registration & Applications, Labels & Consumer Services, Operations & Intelligence, Executive Dashboard | live |
| 2 | Applicant dashboard | `nova.applicant` lands here: Manufacturer 360 (company profile, brands, models, QR, fees, documents on file) | live (some figures aggregated for the demonstration, disclosed on screen) |
| 3 | Company / brand registration | `ravik24` lands on Company registration (the wizard); registered manufacturers see Brand registration | company and brand live; MCA/GSTN check and scoring are future work |
| 4 | Document verification | Registration & Applications: Document verification | upload and return live; OCR and AI evidence are future work |
| 5 | Model / test report | Registration & Applications: Model applications, Test-report scrutiny | core live; extraction and rating computation are future work |
| 6 | Officer scrutiny | `bee.officer`: Work Queue & Decisions | approvals live; full risk queue is future work |
| 7 | Secure QR batch | Labels & Operations: QR batches and serials, Quarterly submission (products, QR status, test results) | live demonstration |
| 8 | Consumer verification | public site, Verify | basic verification live |
| 9 | AI use cases | Oversight & Intelligence: Compliance risk, Production anomaly, Rating trends, Document extraction | simulated, advisory, a person decides |
| 10 | Blockchain / secure QR | Secure evidence ledger | local simulation only (labelled "Simulated") |
| 11 | Data model | Admin: Audit history, master data, secure evidence | live |
| 12 | Generated formats | hidden in the menu for the demonstration | partial (prototype letters) |
| 13 | Official templates | hidden in the menu for the demonstration | planned |

Also built, as `bee.officer`: Registers & Compliance holds the manufacturer, brand and category, model and certificate, and QR reconciliation registers (one tab each, a page per record), Audit History and Delegations.

## 3. Known limits to say aloud or avoid
- The company name typed at sign-up now becomes the application's legal name. The organisation record behind the account still carries the applicant's name (BL-276), which only shows in a few organisation-level lists.
- Product category registration, suspect-label reports and official templates are "Planned" entries without a screen.
- Nothing is sent anywhere: e-mail, SMS, OTP, payment and KYC are simulated and labelled so.
- If something goes wrong in the room: `npm run demo:reset` brings the clean state back in about two minutes.
