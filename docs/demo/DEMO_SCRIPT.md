# Client demonstration: presenter script by use case (40 minutes)

Rehearsed end to end on 16 October 2026. Every account uses the password `demo123`. Sign in at `http://127.0.0.1:3100/login` (type the username). The role dropdown at the top right of every console page switches to that role's demo account in one step, so you can change persona without signing out. Sign out with the arrow icon at the top right.

**How to run this demo:** tell it as stories about people, not screens. Each use case below names the person, the problem they have today, what they do, and the outcome the audience should take away. Say the persona's name out loud and keep to their view of the work.

**Say once at the start:** "This is a local demonstration. The data is synthetic and nothing here is a BEE record. Three things are simulated: the Fabric network, the payment gateway, and the AI models, which are transparent rules and statistics and advisory only. Everything else (roles, approvals, audit trail, database, hash chains) is real code running here."

## The cast

| Persona | Who they are | Username | Their question |
|---|---|---|---|
| **Neha**, compliance manager at Nova Cool (a manufacturer) | Files applications, pays fees, labels products, reports production | `nova.applicant` | "Can I get my model on the market and stay compliant without chasing paper?" |
| **Farid**, finance officer at BEE | Confirms fees, reconciles payments | `bee.finance` | "Is every rupee accounted for, and who confirmed it?" |
| **Sunita**, secretary at BEE | Issues certificates to the ledger | `bee.secretary` | "How do I issue a certificate and prove it was not altered?" |
| **Arjun**, administrator at BEE | Second signature on ledger changes | `bee.admin` | "Who approves what I did not submit myself?" |
| **Priya**, programme officer at BEE | Reviews production, runs AI advisories | `bee.programme` | "Which manufacturers should I look at first?" |
| **Ravi**, helpdesk agent at BEE | Answers manufacturers' questions | `bee.helpdesk` | "Can I reply faster without guessing?" |
| **Meera**, technical reviewer at BEE | Checks test reports against declarations | `bee.reviewer` | "Does the report say what the application claims?" |
| **Dr. Rao**, Director | Needs the whole picture | `bee.director` | "How is the programme doing, right now?" |
| **Imran**, a shopper (no sign-in) | Checks a label in a shop | public `/verify` | "Is this AC's rating real?" |
| **Pixel's compliance manager** | Another manufacturer | `pixel.applicant` | (used once, to show data separation) |

## Running order

| Min | Use case | Personas |
|---|---|---|
| 0-3 | Opening | Dr. Rao |
| 3-10 | UC1. A manufacturer pays the application fee | Neha, Farid |
| 10-17 | UC2. A manufacturer labels its products with QR codes, a shopper checks | Neha, Imran |
| 17-25 | UC3. A certificate is issued and cannot be quietly altered | Sunita, Arjun, Imran |
| 25-31 | UC4. A manufacturer reports quarterly production, BEE checks it against QR | Neha, Priya |
| 31-36 | UC5. The Director sees the programme at a glance | Dr. Rao, Farid |
| 36-40 | UC6. Five AI helpers that advise, never decide | Priya, Ravi, Meera |
| 40-43 | UC7. Everyone is told | Neha, Farid, Sunita, Arjun, Priya |
| 43-45 | Exports | Neha |

Keep three minutes spare. If you run late, drop the "if time" lines. UC1 to UC6 are unchanged; UC7 and the exports sit after them.

---

## Opening (0-3 min). Persona: Dr. Rao, Director
1. Open `/login`; point at the demo panel on the left and "Password for every demo account: demo123".
2. Sign in as `bee.director`. You land on the MIS dashboard.
3. Say: "Dr. Rao will see the whole programme at the end. First, the people whose work feeds it." Point at the role dropdown: "Choosing a role signs in as that person, so we change hats in one click."

---

## UC1. A manufacturer pays the application fee (3-10 min)
**Persona: Neha** (Nova Cool, `nova.applicant`) and **Farid** (BEE Finance, `bee.finance`).
**Problem today:** fees are paid through separate channels, receipts arrive late and finance reconciles by hand.
**What the audience should take away:** the amount is fixed by the system, a double gateway message cannot double-charge, and the payer cannot confirm their own fee.

**Neha's story.** Menu: **Payments**.
1. "Neha has several applications waiting for the fee." Point at DEMO-PAY-0001 to 0003 (the list also shows older ones): fee INR 10,000 plus 18 percent tax is INR 11,800. Say: "The amount comes from the fee snapshot on the application. The gateway cannot change it."
2. On DEMO-PAY-0001 click **Pay at simulated gateway**; a panel shows a gateway reference (`SIMGW-...`). Click **Pay now**. The screen says "callback received: paid, receipt SIMRCPT-...".
3. Click **Replay last callback**. Say: "Gateways sometimes deliver twice. The second one is recognised by its fingerprint and ignored, so there is no double payment."
4. Scroll to "My organisation's payments": the paid row and a **Receipt** button.
5. *If time:* decline another payment from its gateway panel to show a failed payment. Use the search box or date range on the list to show how Neha finds an old payment.

**Farid's story.** Switch role to Finance (dropdown). Menu: **Payments**.
6. "Farid sees every manufacturer's payments." Show the reconciliation panel: paid versus confirmed, and the "paid but not yet confirmed by Finance" differences.
7. Say: "Finance confirms the fee against the gateway reference. Neha cannot confirm her own fee: separation of duties." Optional: confirm one in the **Finance queue**.

---

## UC2. A manufacturer labels its products with QR codes; a shopper checks one (10-17 min)
**Persona: Neha** (`nova.applicant`) and **Imran**, a shopper (no sign-in).
**Problem today:** counterfeit or mis-stated labels are hard to spot at the shop.
**Take-away:** only an approved model with a certificate can get QR codes, duplicates are blocked in the database, and anyone can check a code without an account.

**Neha's story.** Menu: **QR batches and serials**.
1. "Neha already has batches for her models, some partly used." Show allocated, bound and void counts (the newest are at the top).
2. Create a batch: choose "Nova Cool NC-RAC-12D (BEE/RAC/2026/10101)", quantity 100, **Create batch**. Say: "Only an approved model with a certificate can have QR codes."
3. Open the new batch. **Allocate** 5 serials (format `BEEQ-` plus ten characters). In "Serials to bind" paste one serial and click **Bind to certificate** (do not press Enter, it only adds a line; the box clears after each bind; a blank box binds every allocated serial, so paste a serial each time). Paste the same serial again and bind: the screen says "0 newly bound, 1 already bound". Say: "Duplicate control is enforced in the database, not only on screen."
4. Click **Verify this serial** on a bound serial: the public page confirms the certificate.

**Imran's story.** Open `/verify` in a private window (no sign-in).
5. Type `BEEQ-S2D0000001`: valid, with manufacturer, model, star rating and validity dates. Type `BEEQ-S2D0000040` (void) or any made-up code: "No such registration", the same answer for both, so nothing leaks.
6. *If time:* switch to `bee.programme`: the same menu shows all batches read-only. `pixel.applicant` sees none of Nova's batches.

---

## UC3. A certificate is issued and cannot be quietly altered (17-25 min)
**Persona: Sunita** (Secretary, `bee.secretary`), **Arjun** (Administrator, `bee.admin`), **Imran** (public).
**Problem today:** certificate changes are hard to audit and one person can do everything.
**Take-away:** two people are needed for every ledger change, every record is hash-chained, and the public check follows the ledger.
Say first: "A simulated Fabric test network, not Hyperledger Fabric. Real database tables, a hash chain and the rules a network would apply."

**Sunita submits.** Menu: **Certificate ledger**. (Not the Director: that screen is not for the Director, by design.)
1. Search `10101` and click **Open**; the ledger panel is below the list. Status "Not submitted". Click **Submit to ledger**. Status becomes "Pending, waiting for a peer" and Commit is disabled with "a second person must commit or fail it". Say: "Nobody commits their own submission."
2. Click **Verify again**: chain verification **MATCH**.

**Arjun commits.** Switch role to Administrator. Open the same certificate.
3. Click **Commit (peer)**. Status **Active**; the block explorer at the bottom shows the block with its hash and previous hash.

**Imran checks.** `/verify` with `BEE/RAC/2026/10101`: valid.

**Revocation.** As Arjun, **Revoke** with a reason (the pending revoke needs Sunita): switch to Secretary and commit it. Reload `/verify` for 10101: **Revoked**. Say: "The public verifier follows the ledger."

**Tamper detection.** As Sunita open the seeded 2025 certificates: `BEE/RAC/2025/90040` active; `90039` pending; `90038` failed (two attempts kept, **Retry**); `90037` **MISMATCH at transaction 1**. Say: "This record's hash was altered in the seed. Verification recomputes every hash and catches it."
*If time:* **Amend** valid-to on an active certificate and commit as the other person.

---

## UC4. A manufacturer reports quarterly production and BEE checks it against QR (25-31 min)
**Persona: Neha** (`nova.applicant`) and **Priya** (Programme officer, `bee.programme`).
**Problem today:** production returns arrive as spreadsheets and nobody can cross-check them against labels actually issued.
**Take-away:** errors are caught before anything is stored, evidence is fingerprinted, and declared units are compared with bound QR serials.

**Neha files.** Menu: **Quarterly production**.
1. "Neha's earlier quarters are accepted; 2026-Q3 is with BEE." New submission: quarter `2026-Q4`, **Create submission**, open it.
2. Paste CSV rows (the screen shows the format) with one deliberately bad line, **Validate (dry run)**: per-row errors and "nothing was written". Fix the line, **Store rows**.
3. Attach evidence: CA name, membership number, statement and a small file. Say: "Stored and fingerprinted (SHA-256): recorded, not verified." **Submit for review**: editing is now closed.

**Priya reviews.** Switch role to Programme officer. Same menu.
4. Open the new submission or 2026-Q3. Show **Reconciliation against QR serials**: declared units against bound serials, flagged "Review" when over the 10 percent margin. Say: "A flag is a prompt for a person, not a decision." **Accept**, or **Raise a query** with a note.
5. *If time:* back as Neha, see the query, edit and resubmit. Neha cannot review, and a reviewer from the submitting organisation is refused.

---

## UC5. The Director sees the programme at a glance (31-36 min)
**Persona: Dr. Rao** (`bee.director`) and **Farid** (`bee.finance`).
**Problem today:** programme numbers come from different offices and are weeks old.
**Take-away:** every number is calculated live from the database, and each role sees only its own tab.

Menu: **MIS dashboard**.
1. Read the cards: applications, approvals, average days to approval, certificates, fees collected, open delegations, and the "as of ... data version" line. Say: "Every number is calculated at this moment."
2. Tabs: Summary, Applications, Finance, Production, Certificates. Open a table under a chart. Click **Last 12 months**, **Refresh**. **Download CSV**.
3. Say: "Some history is synthetic, which is why twelve months of data exist."
4. *If time:* switch to Finance: only the Finance tab (role scoping).

---

## UC6. Five AI helpers that advise, never decide (36-40 min)
Say: "Transparent rules and statistics, not machine learning. Every run records the model version, the data it saw and its evidence; a person decides; nothing is written to any application, certificate or fee."

**Priya decides where to look first** (`bee.programme`, menu **AI use cases**).
1. **Compliance risk**: **Run**; open the top row to show the weighted contributions and evidence; then choose **Override**, enter your own value (for example `medium`) and a reason, **Record disposition**.
2. **Production anomaly**: flags four of the eleven series; open the Nova NC-RAC-12D one for the spike. 3. **Rating trends**: slope and 95 percent band.

**Ravi answers a manufacturer faster** (`bee.helpdesk`).
4. **Helpdesk assist**: ask "How do I pay the fee?": a draft reply with ranked source articles and a confidence. Then ask a nonsense question: it escalates to a person instead of guessing.

**Meera checks a test report** (`bee.reviewer`).
5. **Document extraction**: run for `LOCAL-MA-0004` (already filled in); read the extracted fields against the declared ones. One field differs (efficiency): that is the point. Then **Record disposition** (accept, override or reject) as Meera.
6. Reload: the history and dispositions persist. The auditor (`bee.auditor`) can read but not run or record; the Director and Secretary can also run the models; the AI never writes to any record.

---

## UC7. Everyone is told (40-43 min)
**Persona: Neha** (`nova.applicant`), **Farid** (`bee.finance`), **Sunita** (`bee.secretary`), **Arjun** (`bee.admin`) and **Priya** (`bee.programme`).
**Problem today:** people learn that a fee, a certificate or a return has moved only when someone telephones them.
**Take-away:** each step writes an email, and where it matters an SMS, to the person who must act next. Nothing leaves this machine.

Say clearly, once: "Simulated. No email and no text message is sent. Every address ends @bee-demo.invalid, and the mobile numbers are made up." The mail icon beside the bell is the unread count for this inbox. It is not the application bell next to it. Menu: **Notifications (email and SMS)**.

1. After Neha pays DEMO-PAY-0001 in UC1, switch to Farid. Open the menu. Show the email **Payment to confirm: DEMO-PAY-0001**. Say: "Finance is told that money arrived, and Farid still confirms it himself."
2. Switch back to Neha. Her inbox has an email **Payment received: DEMO-PAY-0001** and an SMS "payment received" to a made-up mobile. Say: "Neha is told the gateway took it. She is not told to confirm her own fee."
3. In UC3, when Sunita submits 10101, Arjun's inbox has **Second signature needed**. Sunita does not get that mail: the sender is not told. When Arjun later sends the revoke, Sunita is the one who gets **Second signature needed**, and Arjun does not.
4. When the second person commits the issue, switch to Neha: an email **Certificate on the ledger** and an SMS of the same news. When the revoke is committed, the subject is **Certificate revoked**.
5. In UC4, when Neha submits the quarter, Priya gets **Production figures to review** (email only). If Priya raises a query, Neha gets **Query on your production figures** as an email and an SMS. When Priya accepts, Neha gets **Production figures accepted**, again as an email and an SMS.

---

## Exports (43-45 min)
**Persona: Neha** (`nova.applicant`), with one look at Priya's production list and Dr. Rao's MIS.
**Problem today:** a list on screen is not a file the office can keep.
**Take-away:** each list saves the rows the filters currently show, as a spreadsheet, and a label can be saved as a PDF.

1. On **Payments**, **QR batches and serials**, **Certificate ledger** (both the certificate list and the block explorer) and **Quarterly production**, point at **Download CSV**. Type in the search box first. Say: "This file is what the filter shows, not only this page. It opens in Excel. It is saved to Downloads." Do not open the file on the projector unless someone asks.
2. Open one QR batch and click **Download all serials (CSV)**. Say: "This is the print shop's file. Every serial is in it, with the public check link for that serial."
3. On the **MIS dashboard**, **Download CSV** is one file for the panel that is open, not for every chart at once.
4. Menu: **Model label**, then **Label preview** (`/app/model-label/label-preview`). Pick an approved application. Use the browser's Print and choose **Save as PDF**. Say: "That PDF is the certificate with its QR code, for a file or a printer. It is not sent anywhere."

---

## Closing (1 min)
"Neha pays and labels, Farid reconciles, Sunita and Arjun issue with two signatures, Priya checks production against QR, Dr. Rao sees it live, and Imran can verify at the shop. One audited database, role scoping and separation of duties. What is simulated here (Fabric, gateway, AI models) is replaced by the real integrations in the next phase."

## What is simulated, and how to say it
- **Fabric:** "A simulated Fabric test network. Same rules (pending, committed, failed, a second person commits, hash chain), no blockchain nodes."
- **Payment gateway:** "A simulated gateway. No money moves; Pay now and Decline play the gateway callback."
- **AI:** "Rules, statistics and retrieval over synthetic data. Advisory only; a person decides and every decision is recorded."
- **CA evidence:** "Stored and fingerprinted, not verified."
- **Data:** synthetic. Not a BEE record.
- **Email and SMS:** "Simulated. Nothing is sent. Addresses end @bee-demo.invalid and the mobile numbers are made up. The inbox is Notifications (email and SMS); the mail icon beside the bell counts what is unread there."
- **Exports:** "Download CSV saves the filtered rows to Downloads and opens in Excel. Do not open it on the projector unless asked. Label preview, then the browser's Print, Save as PDF, is the certificate with its QR code."

## If something goes wrong
| Symptom | Do |
|---|---|
| A screen is blank or shows an error | Reload once. |
| Sign-in is refused | Check the username (lower case, no spaces) and the password `demo123`. |
| Ledger screen fails or says permission denied for everyone | `bash scripts/local/ensure-runtime-role.sh`, reload. |
| A step was already used | `npm run demo:seed` is safe to re-run but does not undo ledger or payments already made. For a fresh start: `npm run local:reset`, `bash scripts/local/ensure-runtime-role.sh`, `npm run demo:seed`. |
| Everything is down | `export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false; npm run local:down && npm run local:up`, then `node scripts/demo/login-setup.cjs apply` and `npm run demo:seed`. |
| An icon shows as raw text | Fonts did not load; reload (they are bundled). |
| A step you cannot finish | Say "that one we will show offline" and move to the next use case. Each stands alone. |

## Cheat sheet (password for all: `demo123`)
| Username | Persona | Use case |
|---|---|---|
| `bee.director` | Dr. Rao, Director | Opening, UC5 (lands on MIS), exports (MIS CSV) |
| `nova.applicant` | Neha, manufacturer (Nova Cool) | UC1, UC2, UC4, UC7 (payment received, certificate on the ledger), exports |
| `bee.finance` | Farid, Finance | UC1 (reconcile), UC5 (Finance tab), UC7 (Payment to confirm) |
| `bee.secretary` | Sunita, Secretary | UC3 (submit, retry, amend, commit revoke), UC7 (second signature when she did not send it) |
| `bee.admin` | Arjun, Administrator | UC3 (commit, revoke), UC7 (second signature when he did not send it) |
| `bee.programme` | Priya, Programme officer | UC4 (review), UC6 (AI), UC7 (production figures to review) |
| `bee.helpdesk` | Ravi, Helpdesk | UC6 (helpdesk assist) |
| `bee.reviewer` | Meera, Reviewer | UC6 (document extraction) |
| `bee.auditor` | Auditor | read only |
| `pixel.applicant` | Manufacturer, other organisation | shows data separation (UC2) |
| public | Imran, shopper | `/verify` in UC2, UC3 |

The persona names are only for storytelling; the demo accounts carry no personal names.

Order of screens: sign in as Dr. Rao (MIS) → Neha, Payments → QR batches and serials → Sunita then Arjun, Certificate ledger → Neha then Priya, Quarterly production → Dr. Rao, MIS dashboard → Priya, Ravi and Meera, AI use cases → Notifications (email and SMS) for the people named in UC7 → Download CSV on the lists, then Model label, Label preview, Save as PDF.
