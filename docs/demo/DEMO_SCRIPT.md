# Client demonstration: presenter script (40 minutes)

Written from a full rehearsal on 15 October 2026. Every account uses the password `demo123`. Sign in at `http://127.0.0.1:3100/login` (type the username; do not use the "Demo accounts" chips if the page is slow). Sign out with the arrow icon at the top right of any console page. **Shortcut:** the role dropdown in the header switches to that role's demo account in one step (it signs in as that account and opens its landing screen), so you do not need to sign out and in between parts. The dropdown names map to the accounts in the cheat sheet; the left menu and screens change with it.

**Say once at the start:** "This is a local demonstration. The data is synthetic, nothing here is a BEE record, and three things are simulated: the Fabric network, the payment gateway, and the AI models are rules and statistics, advisory only. Everything else (roles, approvals, audit trail, database, hash chains) is real code running here."

## Before you start (15 minutes before)
Follow `docs/demo/DEMO_DAY_CHECKLIST.md`. Quick check: `/login` shows the username and password form; `bee.director` lands on the MIS dashboard.

## Running order

| Min | Part | Who | Screen |
|---|---|---|---|
| 0-3 | Opening and sign-in | any | /login |
| 3-9 | Payment simulation | nova.applicant, bee.finance | Payments (simulated) |
| 9-16 | QR batch and serial, public check | nova.applicant, public | QR batches and serials, /verify |
| 16-24 | Fabric certificate (simulated ledger) | bee.secretary, bee.admin | Certificate ledger (simulated Fabric) |
| 24-30 | Quarterly production submission | nova.applicant, bee.programme | Quarterly production |
| 30-35 | MIS dashboard | bee.director, bee.finance | MIS dashboard |
| 35-40 | Five AI use cases | bee.programme, bee.helpdesk, bee.reviewer | AI use cases |

Keep three minutes spare. If you are running late, drop the second half of any part (marked "if time").

---

## 0-3 min: Opening
1. Open `/login`. Point out the left panel: what the demonstration covers, and "Password for every demo account: demo123".
2. Sign in as `bee.director`. You land on the **MIS dashboard**. Say: "We will come back here; first the journey a manufacturer follows." (Skip ahead if you prefer MIS first.)
3. Point at the role dropdown at the top right: "Choosing a role signs in as that demo user, so we can switch hats during the demo."

## 3-9 min: Payment simulation
**Sign out, sign in as `nova.applicant` (manufacturer).** Menu: **Payments (simulated)**.
1. Show "Applications waiting for the fee": DEMO-PAY-0001..3, fee INR 10,000 plus 18% tax = INR 11,800. Say: "The amount comes from the fee snapshot; the gateway cannot change it."
2. Click **Pay at simulated gateway** on DEMO-PAY-0001. A panel appears with a gateway reference (`SIMGW-...`).
3. Click **Pay now**. The screen says "callback received: paid, receipt SIMRCPT-...".
4. Click **Replay last callback**. Say: "Gateways deliver twice. The second one is recognised and ignored; no double payment." (The screen says so.)
5. Scroll to "My organisation's payments": the paid row and a **Receipt** button. Open it.
6. *If time:* **Decline** on another payment to show a failed payment.

**Sign in as `bee.finance`.** Menu: **Payments (simulated)** (also Finance queue under Finance).
7. Show all payments with gateway references and the reconciliation panel: paid versus confirmed. Say: "Finance confirms the fee with the gateway reference. The payer cannot confirm their own fee." Optional: confirm one in the Finance queue.

## 9-16 min: QR batch and serial
**Sign in as `nova.applicant`.** Menu: **QR batches and serials**.
1. Show the two existing batches with allocated, bound and void counts.
2. Create a batch: pick "Nova Cool NC-RAC-12D (BEE/RAC/2026/10101)", quantity 100, **Create batch**. Say: "Only an approved model with a certificate can have QR codes."
3. Open the new batch, **Allocate** 5 serials (format `BEEQ-` plus ten characters), **Bind** one to a unit. Try to bind the same serial twice: "Duplicate code blocked" is shown. Say: "Duplicate control is enforced in the database, not only on screen."
4. Use **Verify this serial** on a bound serial: the public page confirms the certificate.
5. Public check without signing in: open `/verify` in a private window with a bound serial, for example the seeded `BEEQ-S2D0000001` (type it into the search box). An unbound or void serial (`BEEQ-S2D0000040`) gives "not found", the same answer as an unknown code.
6. *If time:* sign in as `bee.programme`: the same screen shows all batches read-only. `pixel.applicant` sees none of Nova's batches.

## 16-24 min: Fabric certificate (simulated ledger)
Say first: "A simulated Fabric test network, not Hyperledger Fabric. Real database tables, a hash chain, and the same rules a network would apply."

**Sign in as `bee.secretary`.** Menu: **Certificate ledger (simulated Fabric)**. (Not `bee.director`: the director cannot open this screen, by design.)
1. The certificate list is long. Click **Open** on `BEE/RAC/2026/10101`, then scroll to the bottom: the ledger panel is below the list.
2. Status "Not submitted". Click **Submit to ledger**. Status becomes **Pending, waiting for a peer**; the panel says "You submitted this transaction; a second person must commit or fail it". Commit is disabled. Say: "Segregation of duties: nobody commits their own submission."
3. Click **Verify again**: chain verification **MATCH**.
4. **Sign out, sign in as `bee.admin`.** Open the same certificate (`10101`), click **Commit (peer)**. Status becomes **Active**; the block explorer at the bottom shows the block with its hash and the previous hash.
5. Public check: open `/verify` with registration `BEE/RAC/2026/10101` (private window): valid.
6. Still as admin: **Revoke** with a reason, then sign in as `bee.secretary` and commit the revoke. Reload `/verify` for 10101: **Revoked**. Say: "The public verifier now reflects the ledger."
7. Seeded examples to open (as `bee.secretary`), all under 2025: `BEE/RAC/2025/90040` active; `90039` pending; `90038` failed (two attempts kept, use **Retry**); `90037` **MISMATCH at transaction 1**: say "this record's hash was tampered with in the seed; verification recomputes every hash and catches it."
8. *If time:* **Amend** valid-to on an active certificate and commit as the other person.

## 24-30 min: Quarterly production submission
**Sign in as `nova.applicant`.** Menu: **Quarterly production**.
1. Show the quarters: 2026-Q3 submitted, earlier accepted.
2. New submission, quarter `2026-Q4`, **Create submission**, open it.
3. Paste CSV rows (the screen shows the format; include one deliberately bad line), press **Validate (dry run)**: per-row errors, "nothing was written". Fix the line, store the rows.
4. Attach evidence (a small text file) as CA evidence. Say: "Stored and fingerprinted (SHA-256), recorded, not verified." **Submit**: editing is now closed.

**Sign in as `bee.programme`.** Same menu.
5. Open the new submission or 2026-Q3. Show the **reconciliation**: declared units against bound QR serials, flagged when over the 10 percent margin (2026-Q3 has a seeded spike). Accept it, or raise a query with a note.
6. *If time:* back as `nova.applicant`, see the query, edit and resubmit. `nova.applicant` cannot review; a reviewer from the submitting organisation is refused.

## 30-35 min: MIS dashboard
**Sign in as `bee.director`** (lands here). Menu: **MIS dashboard**.
1. Read the cards (applications, approvals, average days, certificates, fees collected) and the "as of ... data version" line. Say: "Every number is calculated live from the database at this moment."
2. Tabs: Summary, Applications, Finance, Production, Certificates. Open a table under a chart. Narrow the date range with "Last 12 months" and **Refresh**.
3. **Download CSV**.
4. Say: "Some history is synthetic, which is why 12 months of data exist."
5. *If time:* sign in as `bee.finance` and open MIS: only the Finance tab (role scoping).

## 35-40 min: Five AI use cases
Say: "Transparent rules and statistics, not machine learning. Every run records the model version, the data it saw and its evidence; a person decides; nothing is written to any application, certificate or fee."

**Sign in as `bee.programme`.** Menu: **AI use cases**.
1. **Compliance risk**: **Run**, open the top row to show contributions and evidence, then **Override** with a reason.
2. **Production anomaly**: flags the spike series.
3. **Rating trends**: slope and 95 percent band.

**Sign in as `bee.helpdesk`.** AI use cases.
4. **Helpdesk assist**: ask "How do I pay the fee?", read the draft answer with its sources, edit it (override). Then ask a nonsense question: it escalates instead of guessing.

**Sign in as `bee.reviewer`.**
5. **Document extraction**: run for LOCAL-MA-0004, confirm each extracted field.
6. Reload the page: the history and dispositions persist. `bee.auditor` can read but not record.

## Closing (1 minute)
"Registration, payment, QR, ledger, production and MIS all sit on one audited database with role scoping and segregation of duties. What is simulated here (Fabric, gateway, AI models) is replaced by the real integrations in the next phase."

---

## What is simulated, and how to say it
- **Fabric:** "A simulated Fabric test network. Same rules (pending, committed, failed, a second person commits, hash chain), no blockchain nodes."
- **Payment gateway:** "A simulated gateway. No money moves; the Pay now and Decline buttons play the part of the gateway callback."
- **AI:** "Rules, statistics and retrieval over synthetic data. Advisory only; a person decides and every decision is recorded."
- **CA evidence:** "Stored and fingerprinted, not verified."
- **Data:** synthetic. Not a BEE record.

## If something goes wrong
| Symptom | Do |
|---|---|
| A screen is blank or shows an error | Reload once. |
| Sign-in is refused | Check the username (no spaces, lower case) and that the password is `demo123`. |
| Ledger screen fails or says permission denied for everyone | In a terminal: `bash scripts/local/ensure-runtime-role.sh`, reload. |
| Data looks wrong or a step was already used | `npm run demo:seed` (safe to re-run; it does not undo the ledger or payments you already made). For a full fresh start: `npm run local:reset`, `bash scripts/local/ensure-runtime-role.sh`, `npm run demo:seed`. |
| Everything is down | `export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false; npm run local:down && npm run local:up`, then `node scripts/demo/login-setup.cjs apply` and `npm run demo:seed`. |
| An icon shows as raw text | Fonts did not load; reload. They are bundled, so this should not happen offline. |
| A step you cannot finish | Say "that one we will show offline", move to the next part. Each part stands alone. |

## Cheat sheet (password for all: `demo123`)
| Username | Role | Use for |
|---|---|---|
| `bee.director` | Director | MIS dashboard (lands here) |
| `nova.applicant` | Manufacturer, Nova Cool | Payments, QR, Production |
| `bee.finance` | Finance | Payment reconciliation, Finance queue, MIS Finance tab |
| `bee.secretary` | Secretary | Ledger: submit, retry, amend |
| `bee.admin` | Admin | Ledger: commit, fail, revoke |
| `bee.programme` | Programme officer | Production review, QR (read), AI runs |
| `bee.helpdesk` | Helpdesk | Helpdesk assist |
| `bee.reviewer` | Reviewer | Document extraction |
| `bee.auditor` | Auditor | Read only |
| `pixel.applicant` | Manufacturer, other org | Shows organisation scoping |

Order of screens: Payments, QR, Ledger, Production, MIS, AI. Public pages (no sign-in): `/verify`.
