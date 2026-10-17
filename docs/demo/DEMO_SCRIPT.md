# Client demonstration: presenter script by use case (59 minutes)

Updated 17 October 2026. **Use case 9 (registration) is a draft: it is written from the code and the screens and has not been rehearsed on screen yet; lines marked (check) need confirming at the first rehearsal, once the registration sample data is loaded.** Use cases 1 to 6 were rehearsed end to end on screen; use case 7, the exports and use case 8 were checked screen by screen and through the live API. Every account uses the password `demo123`. Sign in at `http://127.0.0.1:3100/login` (type the username). The role dropdown at the top right of every console page switches to that role's demo account in one step, so you can change persona without signing out. Sign out with the arrow icon at the top right. More than ten sign-in attempts in a minute for one person pauses the sign-in for a minute, so type the password once, carefully. The left menu is one list under **Home**: dashboards first, then My work and approvals, registrations, applications, money, and the demonstration screens (Payments, QR batches, Certificate ledger and the others).

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
| **Anil**, auditor at BEE | Checks that the records can be trusted | `bee.auditor` | "Can I prove who did what, and that nothing was altered?" |
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
| 43-45 | Exports (CSV, Excel, PDF certificate) | Neha |
| 45-47 | UC8. The auditor checks the trail | Anil |
| 47-59 | UC9. Becoming a registered brand: four people, nobody marks their own work | Neha, Farid, Priya, Dr. Rao, Pixel's manager |

For an audience of BEE officers, **move UC9 to minute 3**, straight after the Opening (it is where the programme starts, and each use case stands alone). The times of the other use cases then shift by twelve minutes.

Keep three minutes spare. If you run late, drop the "if time" lines, then shorten UC7 and the exports, which can be shown in a few clicks each. Before you start: `docs/demo/DEMO_DAY_CHECKLIST.md`, a fresh reset and seed (see "If something goes wrong"), and an empty Downloads folder so the exports are easy to find.

---

## Opening (0-3 min). Persona: Dr. Rao, Director
1. Open `/login`; point at the demo panel on the left and "Password for every demo account: demo123".
2. Sign in as `bee.director`. You land on the **Executive dashboard**: eight figures across the top (applications received, in progress now, certificates issued, approval rate, days to approval, fees confirmed, ledger needs a look, high compliance risk) and ten charts below. Use the date range or the Manufacturer filter in the green banner (or click a manufacturer in "Certificates by manufacturer": every figure narrows to that one; **Reset filters** widens it). The **Director's dashboard** in the menu is the older, card-by-card view: six figures (awaiting approval, certificates issued, ledger needs a look, production with BEE, paid but fee not confirmed, highest compliance risk). Each card has its own chart (a ring for the mix, a small trend for the months). Use the date range in the green banner (**Last 30 days**, **Last 90 days**, **This year**, or From and To): every card, chart and list changes with it. Click **Highest compliance risk**: the list shows each organisation's score and **Why it is high**; click the arrow on a row to see every factor with its points (for example "33% of its applications were rejected, +24.5 of 25"). Search, sort, **Download CSV** and **Download Excel** work on any list. Say: "Every number is calculated at this moment, and each one opens the records behind it and says why." The MIS dashboard (UC5) is one click away in the menu.
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
1. "Neha already has batches for her models, some partly used." Show generated, bound and void counts (the newest are at the top).
2. Create a batch: choose "Nova Cool NC-RAC-12D (BEE/RAC/2026/10101)", quantity 100, **Create batch**. Say: "Only an approved model with a certificate can have QR codes."
3. Open the new batch. **Generate** 5 serials (format `BEEQ-` plus ten characters). In "Serials to bind" paste one serial and click **Bind to certificate** (do not press Enter, it only adds a line; the box clears after each bind; a blank box binds every allocated serial, so paste a serial each time). Paste the same serial again and bind: the screen says "0 newly bound, 1 already bound". Say: "Duplicate control is enforced in the database, not only on screen."
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

**Revocation.** As Arjun, **Revoke** with a reason (the pending revoke needs Sunita): switch to Secretary and commit it. Reload `/verify` for 10101: **Revoked**. Say: "The public verifier follows the ledger." *If time:* switch to Neha: her own certificate card for 10101 now says **Revoked (simulated ledger)** too, and on **QR batches and serials** a new batch for 10101 is refused ("revoked on the simulated ledger: no new batches, serials or bindings"). Say: "A revoked certificate cannot be labelled any more."

**Tamper detection.** As Sunita open the seeded 2025 certificates: `BEE/RAC/2025/90040` active; `90039` pending; `90038` failed (two attempts kept, **Retry**); `90037` **MISMATCH at transaction 1**. Say: "This record's hash was altered in the seed. Verification recomputes every hash and catches it."
*If time:* **Amend** valid-to on an active certificate (a date up to ten years from today) and commit as the other person.

---

## UC4. A manufacturer reports quarterly production and BEE checks it against QR (25-31 min)
**Persona: Neha** (`nova.applicant`) and **Priya** (Programme officer, `bee.programme`).
**Problem today:** production returns arrive as spreadsheets and nobody can cross-check them against labels actually issued.
**Take-away:** errors are caught before anything is stored, evidence is fingerprinted, and declared units are compared with bound QR serials.

**Neha files.** Menu: **Quarterly production**.
1. "Neha's earlier quarters are accepted; 2026-Q3 is with BEE." New submission: quarter `2026-Q4`, **Create submission**, open it.
2. The box is pre-filled with a full quarter (six rows, three months for each of two models). Change one number to text such as `abc` for one deliberately bad line, **Validate (dry run)**: per-row errors and "nothing was written". Fix the line, **Store rows**. Say: "Two rows for the same model whose periods overlap are refused too, so the same units cannot be counted twice."
3. Attach evidence: CA name, membership number, statement and a small file. Say: "Stored and fingerprinted (SHA-256): recorded, not verified." **Submit for review**: editing is now closed.

**Priya reviews.** Switch role to Programme officer. Same menu.
4. Open the new submission or 2026-Q3. Show **Reconciliation against QR serials**: declared units against bound serials, flagged "Review" when over the 10 percent margin. Say: "A flag is a prompt for a person, not a decision." **Accept**, or **Raise a query** with a note (up to 800 characters).
5. *If time:* back as Neha, see the query and correct the figures: change the rows in the box and click **Replace all rows with these** (it swaps every stored row, all or nothing, and only while there is a query), then **Submit for review**. Neha cannot review, and a reviewer from the submitting organisation is refused.

---

## UC5. The Director sees the programme at a glance (31-36 min)
**Persona: Dr. Rao** (`bee.director`) and **Farid** (`bee.finance`).
**Problem today:** programme numbers come from different offices and are weeks old.
**Take-away:** every number is calculated live from the database, and each role sees only its own tab.

**Start on the Executive dashboard** (menu **Executive dashboard**; it is where the Director and the Secretary land after sign-in). Read the eight figures across the top, then the charts: received against issued by month, where the applications are now, decisions, star ratings, fees by month, certificates by manufacturer, the ledger, waiting time, production, payments, and the two lists (waiting longest, highest compliance risk). Click a manufacturer in "Certificates by manufacturer": every figure narrows to that one; **Reset filters** widens it again. Try **Last 30 days**. Say: "One page, every number live."

Then the full set: menu **MIS dashboard** (the Director's dashboard from the opening is the one-page version; this is the full set of panels, in the same look: cards with icons, rings and trends, and **Show the figures** under each chart for the table behind it).
1. Read the cards: applications, approvals, average days to approval, certificates, fees collected, open delegations, and the "as of ... data version" line. Say: "Every number is calculated at this moment."
2. Tabs: Summary, Applications, Finance, Production, Certificates. Open a table under a chart. Click **Last 12 months**, **Refresh**. **Download CSV** or **Download Excel**.
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
5. **Document extraction**: run for `LOCAL-MA-0004` (already filled in; Meera may check only applications assigned to her, and this one is); read the extracted fields against the declared ones. One field differs (efficiency): that is the point. Then **Record disposition** (accept, override or reject) as Meera.
6. Reload: the history and dispositions persist. The auditor (`bee.auditor`) can read but not run or record; the Director and Secretary can also run the models (Meera, whose scope is "assigned", cannot run the models that look across all manufacturers); the AI never writes to any record.

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
**Take-away:** each list saves the rows the filters currently show, as CSV or as a real Excel workbook, and the certificate with its label is a real PDF with a QR code a phone can scan.

1. On **Payments**, **QR batches and serials**, **Certificate ledger** (both the certificate list and the block explorer) and **Quarterly production**, point at **Download CSV** and **Download Excel**. Type in the search box first. Say: "This file is what the filter shows, not only this page. The Excel file is a real workbook, with a bold header row and numbers as numbers. It is saved to Downloads." Do not open the file on the projector unless someone asks.
2. Open one QR batch and click **Download all serials (CSV)** (or **(Excel)**). Say: "This is the print shop's file. Every serial is in it, with the public check link for that serial."
3. On the **MIS dashboard**, **Download CSV** and **Download Excel** are one file for the panel that is open, not for every chart at once.
4. Menu: **Model label**, then **Label preview** (`/app/model-label/label-preview`). Pick an approved application and click **Download PDF (certificate and label)**: page one is the certificate, page two the star label, each with a QR code that opens the public verification page when scanned. Say: "That PDF is for a file or a printer. It is not sent anywhere." **Print or save as PDF** still prints the on-screen layout.

---

## UC8. The auditor checks the trail (45-47 min)
**Persona: Anil** (`bee.auditor`).
**Problem today:** an auditor has to ask each office for its own records and trust the answers.
**Take-away:** one screen shows whether every ledger chain still matches, who sent and who committed each change, where a person set aside an AI advice, and every recorded step in order.

Sign in as `bee.auditor`. You land on the **Auditor's dashboard**.
1. Click **Ledger chains**: the list puts the broken chain first, `BEE/RAC/2025/90037`, **MISMATCH** at transaction 1, and then every other certificate as **MATCH**. Say: "Every hash is recomputed now. This is the record that was altered in the seed."
2. Click **Two-person commits**: "Committed by the same person who sent it: 0". Each row names the sender and the committer.
3. Click **AI overrides and rejections**: each row has the person, their own value and the reason they gave.
4. Click **All recorded activity**: payments, ledger, production and AI steps together, newest first. Set **Last 30 days** in the banner, type a name or a certificate in the search box, then **Download Excel**.
5. Say: "The auditor can read everything and change nothing."

---

## UC9. Becoming a registered brand: four people, nobody marks their own work (47-59 min, or minute 3)
**Personas: Neha** (`nova.applicant`), **Farid** (`bee.finance`), **Priya** (`bee.programme`), **Dr. Rao** (`bee.director`); optionally **Pixel's compliance manager** (`pixel.applicant`).
**Problem today:** a brand is registered on paper. Nobody outside can see where the request is, and one official could do every step.
**Take-away:** four people, four steps, and the database itself refuses a shortcut. The register changes the moment the Director approves, and taking an entry out needs a second person too. Say: "The rules are not a screen setting. They are in the database."

**Part A. Neha files the request (3 min)** (menu: Registration requests)
1. Sign in as `nova.applicant`. Open **Registration requests** and start a new brand request (check: the button name on the list).
2. First type a brand name that is already on the register (for example `Nova Cool`) and read the answer (check: wording). Say: "A live brand name cannot be taken twice by the same owner." Then use a fresh name, for example `Nova Aurora`.
3. Upload the trade licence: any small PDF (the certificate PDF from the Exports step will do). Point at the **readiness checks** (trade licence uploaded, brand name free and the others the page lists): they must be met before **Submit**.
4. Click **Submit**. The page shows **Fee due: INR ...** with tax on its own line and the label "Local demo fee (not BEE-approved)". Say: "Neha cannot confirm her own fee."
5. Open **Notifications (email and SMS)**: "Registration filed" with an email and an SMS. Say: "She is told at every step."

**Part B. Farid confirms the fee (1.5 min)**
1. Switch to `bee.finance`. Open **Notifications**: "Registration fee to confirm". Open the request and confirm the fee (check: which screen Finance uses for a registration fee, the Finance queue or the request page).
2. Say: "First separation: the person who pays is not the person who confirms." The request now waits with the Programme officer; Neha and Priya are both told.

**Part C. Priya recommends, Dr. Rao approves (3 min)** (menu: Registration reviews)
1. Switch to `bee.programme`. **Registration reviews**, tab **Waiting for me**. Open Neha's request: the trail shows who did what and when (filed, fee confirmed). Click **Recommend**.
2. Switch to `bee.director`. **Registration reviews** shows it waiting. Open it, read the line "This registers the brand for NOVA", click **Approve**.
3. Say: "Second separation: the person who recommends cannot approve. And the person who filed, or anyone from the applicant's organisation, can never review their own request. The database refuses it even if a screen were changed." (If asked to prove it, the rules are covered by automated tests; do not try to break it live.)
4. Switch to `nova.applicant`, **Notifications**: "Registration approved. You are on the register." Open the request: Neha sees the decisions; officers see every step, with the person and the time. Say: "The applicant sees the decisions, the officers see the full trail."

**Part D. The register updates at once (1.5 min)** (menu: Register)
1. Switch to `bee.director`. **Register**: the cards (brands, agency authorisations, waiting for a decision, decided). Search `Aurora`: the new brand is **Active** and its source is the registration. Show a filter (Status, Owner), a sort and the page controls.
2. Switch to `nova.applicant`, start a **New model application** and open the brand list: the new brand is offered (check). Say: "Only active brands can be used. The register is the single source of truth."

**Part E. Taking an entry out also needs two people (2.5 min)**
1. Switch to `bee.programme`. **Register**, tab **Brands**, find `Nova Aurora`, click **Propose...**, give a reason ("The owner has stopped trading"), **Submit**.
2. Open the tab **Waiting for a decision**: Priya sees "You proposed this; another person decides" and no Approve button. Say: "Third separation."
3. Switch to `bee.director`. The card **Waiting for a decision** shows 1 (and the Director has a message "Register revocation to decide"). Open it: "This revokes the brand and its authorisations". Click **Approve**.
4. The brand now reads **Revoked** on the Brands tab; **History** lists the decision with the person and the time (Decided column, in IST). Switch to `nova.applicant`: **Notifications** has "Register entry revoked", and the brand is no longer offered when starting a model application (check). Say: "One decision, and the brand's authorisations went with it."
5. *If time:* propose another revocation and **Reject** it with a reason; it appears under History as Rejected with the note.

**Part F. Agency variant (1.5 min, optional)**
1. Switch to `pixel.applicant` (an agency). **Registration requests** lists its agency requests (sample data): one approved with its authorisation, one with Programme, one with the Director, one waiting for its fee (check once the sample data is loaded).
2. As `bee.director`, **Register**, tab **Agency authorisations**: filter Agency = Pixel. Say: "An agency may act for a brand only inside its authorisation period, and two overlapping authorisations for the same agency and brand are refused by the database."

**Repeating the demo:** a revoked name can be filed again, so UC9 can be rerun without a reset; the register then shows the earlier entries as history. For a clean start use the fresh reset and seed (see "If something goes wrong").

---

## Closing (1 min)
"Neha pays and labels, Farid reconciles, Sunita and Arjun issue with two signatures, Priya checks production against QR, Dr. Rao sees it live, Anil can prove who did what, and Imran can verify at the shop. One audited database, role scoping and separation of duties. What is simulated here (Fabric, gateway, AI models) is replaced by the real integrations in the next phase."

## What is simulated, and how to say it
- **Fabric:** "A simulated Fabric test network. Same rules (pending, committed, failed, a second person commits, hash chain), no blockchain nodes."
- **Payment gateway:** "A simulated gateway. No money moves; Pay now and Decline play the gateway callback."
- **AI:** "Rules, statistics and retrieval over synthetic data. Advisory only; a person decides and every decision is recorded."
- **CA evidence:** "Stored and fingerprinted, not verified."
- **Data:** synthetic. Not a BEE record.
- **Email and SMS:** "Simulated. Nothing is sent. Addresses end @bee-demo.invalid and the mobile numbers are made up. The inbox is Notifications (email and SMS); the mail icon beside the bell counts what is unread there."
- **Exports:** "Download CSV and Download Excel save the filtered rows to Downloads; the Excel file is a real workbook. Download PDF on the label preview is a real PDF of the certificate and the star label, each with a QR code that opens the public verification page. Do not open the files on the projector unless asked."

## If something goes wrong
| Symptom | Do |
|---|---|
| A screen is blank or shows an error | Reload once. |
| Sign-in is refused | Check the username (lower case, no spaces) and the password `demo123`. If it says too many attempts, wait a minute. |
| Every demo screen says "not found" or the dashboards stay empty | The API was started without `BEE_DEMO_LOGIN=1`. Use the "Everything is down" row: the variables must be exported before `npm run local:up`. |
| A figure looks out of date | Click **Refresh** on the dashboard; every figure is recalculated on each read. |
| A download does nothing | The browser may be asking to allow several downloads: allow it for 127.0.0.1 and click again. |
| Ledger screen fails or says permission denied for everyone | `bash scripts/local/ensure-runtime-role.sh`, reload. |
| A step was already used | `npm run demo:seed` is safe to re-run but does not undo ledger or payments already made. For a fresh start: `npm run local:reset`, `bash scripts/local/ensure-runtime-role.sh`, `npm run demo:seed`. |
| Everything is down | `export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false; npm run local:down && npm run local:up`, then `node scripts/demo/login-setup.cjs apply` and `npm run demo:seed`. |
| An icon shows as raw text | Fonts did not load; reload (they are bundled). |
| A step you cannot finish | Say "that one we will show offline" and move to the next use case. Each stands alone. |

## Cheat sheet (password for all: `demo123`)
| Username | Persona | Use case |
|---|---|---|
| `bee.director` | Dr. Rao, Director | Opening (lands on the Executive dashboard), UC5 (MIS), UC9 (approves, decides the revocation), exports (MIS CSV and Excel) |
| `bee.auditor` | Anil, Auditor | UC8 (lands on the Auditor's dashboard) |
| `nova.applicant` | Neha, manufacturer (Nova Cool) | UC1, UC2, UC4, UC7 (payment received, certificate on the ledger), UC9 (files the registration), exports |
| `bee.finance` | Farid, Finance | UC1 (reconcile), UC5 (Finance tab), UC7 (Payment to confirm), UC9 (confirms the registration fee) |
| `bee.secretary` | Sunita, Secretary | UC3 (submit, retry, amend, commit revoke), UC7 (second signature when she did not send it) |
| `bee.admin` | Arjun, Administrator | UC3 (commit, revoke), UC7 (second signature when he did not send it) |
| `bee.programme` | Priya, Programme officer | UC4 (review), UC6 (AI), UC7 (production figures to review), UC9 (recommends, proposes the revocation) |
| `bee.helpdesk` | Ravi, Helpdesk | UC6 (helpdesk assist) |
| `bee.reviewer` | Meera, Reviewer | UC6 (document extraction for an application assigned to her) |
| `pixel.applicant` | Manufacturer, other organisation | shows data separation (UC2); UC9 agency variant |
| public | Imran, shopper | `/verify` in UC2, UC3 |

The persona names are only for storytelling; the demo accounts carry no personal names.

Order of screens: sign in as Dr. Rao (Executive dashboard, then MIS) → Neha, Payments → QR batches and serials → Sunita then Arjun, Certificate ledger → Neha then Priya, Quarterly production → Dr. Rao, MIS dashboard → Priya, Ravi and Meera, AI use cases → Notifications (email and SMS) for the people named in UC7 → Download CSV and Excel on the lists, then Model label, Label preview, Download PDF → Anil, Auditor's dashboard.
