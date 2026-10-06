# Decisions needed from BEE — Standards & Labelling Portal (local build)

**Status:** Request for decisions, prepared 3 October 2026; B14 and B15 added 4 October 2026; the owner's assumptions for every decision recorded the same day (not BEE's). **Nothing in this document has been decided by BEE.** It is for the BEE officials who own each rule.

## Why this is needed

The local portal can already take a model application from a manufacturer's draft to "fee due". To keep building the rest of the journey (fee confirmation, scrutiny, rating, Director and Secretary approval, label and certificate) the build has used **provisional defaults** in place of rules BEE has not yet stated. Every default is shown as provisional in the product. None is BEE-verified, and none should be read as BEE's position.

Each decision below gives what the system does today, the realistic options, a recommendation, and what happens if no answer is given. An answer can be as short as the decision number and the chosen option.

## How to read the priority

- **A. Needed before any figure, rating or standard can be called verified.** The demonstration is internally consistent without these but cannot claim they are right.
- **B. Shapes how the screens and the workflow behave.** A wrong default is cheap to change now and costly after more screens are built on it.
- **C. Administration and housekeeping.** Can follow the first complete journey.

## A. Rules the numbers and the rating depend on

### A1 — Fee amount per category and application type (D6 / M4)
- **Question.** What fee applies to a new-model application for each appliance category, how is tax treated, and from what date?
- **Today.** One rule for room air conditioners: **₹24,000**, shown as "provisional, not BEE-approved". An earlier synthetic rule of ₹1,000 also exists for dates before 1 October 2026, only to prove that rules change by date. That split date is invented.
- **Options.** (a) One flat fee per category; (b) a fee that depends on application type (new model, renewal, family); (c) different fees by applicant type.
- **Recommendation.** Give the amount, tax treatment and effective date per category and application type in one table.
- **If unanswered.** The ₹24,000 stays and stays labelled provisional.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** (1) Option (b): the fee depends on category and application type. (2) Fee rules are **configurable in the portal** by an authorised user, each with an effective-from date: a new rule takes over from that date and the previous one ends on it. (3) Who may enter or change a fee rule: **the Administrator now; the permission is to be assignable to another role later** (so it is a permission, not a fixed role). (4) **Tax is a separate line**, not part of the fee amount. Still open: the tax rate or rule itself, the category and application-type combinations, and the amounts. Built in part in WP08.1a (fee rules in the portal, two people, tax as a recorded separate line); the tax line was then applied to the fee an applicant pays and Finance receives in WP08.1b (BL-132): see the tax assumption below.
- **Owner's assumption, 4 October 2026 (not BEE's decision): how the tax line works.** The owner has no tax rule; this is Claude's recommended default, to be replaced from the client's rule. One rate (percent) per fee-rule version, set where the fee is set. **Tax is added on top of the fee** (the fee is the amount before tax): tax = fee x rate / 100, rounded half up to the paisa, and the whole fee due is fee plus tax. The applicant sees all three; the rate is kept with the fee given at submit, so a later rule never changes it; Finance confirms that the **whole fee due** was received (decision B12, exact match, now on the total). A rate of 0 means no tax is set and nothing changes. Not modelled: tax that depends on the applicant (exemptions, place of supply), several taxes, tax-inclusive fees, tax invoices, and refunds of tax.

### A2 — Approved star-rating formula and version (D3 / M5)
- **Question.** Which rating formula, which version and which inputs apply per category, and how a new version takes effect.
- **Today.** No formula is computable. The placeholder version is labelled `0-unverified`; the system refuses to compute a rating from it.
- **Options.** (a) One formula per category with dated versions; (b) formula plus thresholds that change by year.
- **Recommendation.** Provide the formula, the input list and the threshold table for room air conditioners first, with its effective date.
- **If unanswered.** The rating step cannot be built beyond a clearly labelled demonstration.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The owner has no formula. Do not invent a "standard" star scheme: the rating formula and its threshold table become **configurable data** (effective-dated, versioned, entered in the portal like the fee rules). Until BEE supplies a formula, the local demonstration bands stay and every rating stays labelled "local demonstration, not a BEE rating". Built in WP08.1c (BL-134): see below.
- **Built (WP08.1c, 5 October 2026).** A *scheme* is the lowest efficiency figure (ISEER) that earns each of 1 to 5 stars, for a category, from a start date. The Administrator holds the permission now (it is a database row, assignable to another role); a person proposes a scheme from a date that is not in the past, a **different** permission holder approves it, and the rating step uses the scheme with the latest start on or before the day it computes. Two schemes of one category cannot start on the same day. Earlier schemes stay, and every rating keeps the scheme it was computed with. **Still a local demonstration:** a scheme entered here is not a BEE-approved formula and every rating computed from it says so; the formula itself (inputs beyond the ISEER figure, how it is computed) is still BEE's to give (A2 stays open).

### A3 — Standard and edition (M2)
- **Question.** Which standard and edition applies per category and purpose (for example performance testing), and how does the changeover work?
- **Today.** A stand-in code, not a real standard, with a changeover on 1 July 2026 chosen only to test dates.
- **Options.** (a) Standard in force on the **test date**; (b) standard in force on the **submission date**; (c) the applicant chooses within a transition window.
- **Recommendation.** (a): the standard in force when the test was done.
- **If unanswered.** The system uses the standard in force on the test date.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** Option (a): the standard in force on the test date. This is what the build does.

### A4 — Official category list (M1)
- **Question.** The official list of appliance categories, their codes and names, and when each scheme starts.
- **Today.** Room air conditioner only.
- **Recommendation.** The list in a table: code, name, start date.
- **If unanswered.** Only room air conditioners can be filed.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: the official list as a table (code, name, start date). **No list has been supplied**, so only room air conditioners can be filed until it is.

### A5 — Which date selects a rule (M7)
- **Question.** For fee, standard and similar rules, which business date decides which version applies: submission date, fee-confirmation date, or the test date?
- **Today.** The fee and standard use the submission date. Accreditation and the standard for the test use the **test date**.
- **Recommendation.** Fee by submission date; standard and laboratory accreditation by test date (as today).
- **If unanswered.** As today.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: fee by submission date; standard and laboratory accreditation by test date. This is what the build does.

## B. Rules that shape the workflow

### B1 — Is a test report required before an application can be submitted?
- **Question.** Must at least one test report be uploaded before the application can go to fee payment? One per model, or per family?
- **Today.** Required, one report per model application (a local default).
- **Options.** (a) Required before submit; (b) required before scrutiny but not before the fee; (c) optional until review.
- **Recommendation.** (a).
- **If unanswered.** (a) stays, as a provisional rule.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** Option (a): a test report is required before submit. As built.

### B2 — Laboratory accreditation
- **Question.** Must the laboratory be chosen from an accredited-laboratory list, and must it be accredited for the category **on the test date**? Who maintains the list and from what source (M3)? Does a later suspension block an application already submitted?
- **Today.** The laboratory is chosen from a local list and must hold an active accreditation for the category on the test date. The list is synthetic.
- **Options.** (a) As today; (b) laboratory typed freely and checked later by a reviewer; (c) accreditation checked at the **review** stage as well as at submit.
- **Recommendation.** (a), with the authoritative source and the rule for later suspensions stated by BEE.
- **If unanswered.** (a) stays, on the synthetic list.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** Option (a): as built (laboratory chosen from the accredited list, accredited on the test date). The authoritative source of the list and the rule for a later suspension are **not yet stated**.

### B3 — Test date rules
- **Question.** Is the test date required, may it be in the future, and is there a maximum age (for example the test must be within N months of filing)?
- **Today.** Required; not in the future; **no maximum age**.
- **Recommendation.** Give the maximum age, if any, as a number of months.
- **If unanswered.** No maximum age.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation is to state a maximum age in months. **No number has been given**, so there is still no maximum age; give N months, or "none", to close this.

### B4 — What counts as the same model, and families
- **Question.** When are two applications the same model, so a second must be refused? Is a **family** (several models sharing one rating) filed as one application or several?
- **Today.** The same brand and the same model number, ignoring capital letters and surrounding spaces, among applications that are not drafts and not rejected. Families are not modelled. `NC-1` and `NC1` count as different.
- **Options.** (a) As today; (b) also ignore punctuation; (c) a family record that groups models.
- **Recommendation.** State the rule, and say whether family applications are in the first release.
- **If unanswered.** As today; no families.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: as built (same brand and model number, ignoring capitals and surrounding spaces). Whether families are in the first release is **not stated**; they are not built.

### B5 — Efficiency figure: declared or calculated
- **Question.** Does the applicant declare the efficiency figure (ISEER), or is it only calculated from the test report? What range and how many decimals are valid?
- **Today.** The applicant declares it: a positive number up to 99.99 with at most two decimals (placeholders). The rating step, when built, would calculate its own figure and keep both.
- **Recommendation.** Declared by the applicant and verified by scrutiny; give the valid range and precision.
- **If unanswered.** The placeholder limits stay.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: the applicant declares the figure and scrutiny verifies it. As built. The valid range and precision are **not stated**; the placeholder limits stay (positive, up to 99.99, two decimals).

### B6 — Other required documents and file rules
- **Question.** Besides the test report, which documents are required at submit (for example brand authorisation, licence copies)? Which file types, and what size limit?
- **Today.** The test report only, **PDF only, 5 MiB**.
- **Recommendation.** List the required documents per application type.
- **If unanswered.** As today.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: list the required documents per application type. **No list has been given**; the test report only (PDF, 5 MiB) stays.

### B7 — Changes after an application is returned
- **Question.** If scrutiny returns an application to the applicant, may the applicant add or replace documents and edit the form, and until when?
- **Today.** The recommended default is built (WP07.1g): the applicant may correct the evidence and add reports while the application is returned, never after resubmission, and cannot change the brand or the model number. There is no time limit.
- **Recommendation.** Allowed while the application is in the returned state, never after resubmission.
- **If unanswered.** That recommendation will be built.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: editing is allowed while the application is returned, never after resubmission. As built (WP07.1g).

### B8 — Who verifies a test report, and with what outcomes
- **Question.** Who checks that a report is genuine and complete, what outcomes exist (for example verified, not verified, query raised), and what happens next?
- **Today.** Every uploaded report is labelled "pending local verification". The system makes no claim about accreditation, authenticity or malware.
- **Recommendation.** The IAME scrutiny step records verified or not verified with a note.
- **If unanswered.** Reports stay "pending verification" through the whole journey.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: the IAME scrutiny step records verified or not verified with a note. As built.

### B11 — How the fee is confirmed, and who can correct a mistake
- **Question.** Is the fee confirmed **by hand by Finance** after seeing the payment, or by the applicant uploading proof, or by a payment gateway? Who exactly may confirm? If a confirmation is wrong (wrong reference, wrong date), how is it corrected or reversed, and by whom?
- **Today.** Finance confirms by hand, recording a receipt reference and the date received. The applicant's organisation and anyone who took part at another stage cannot confirm. A confirmation **cannot be undone** in the product.
- **Options.** (a) As today, plus a correction step that needs a second Finance approver; (b) applicant uploads proof, Finance verifies it; (c) gateway callback with Finance reconciliation.
- **Recommendation.** (a) for the first release: manual confirmation, with a defined correction route.
- **If unanswered.** As today, with no correction route.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** Option (a): manual confirmation by Finance, **plus a correction route that needs a second Finance approver**. The correction route is built in WP08.1e (BL-133): see below.
- **Built (WP08.1e, 5 October 2026).** A *correction* fixes the **receipt reference** or the **date received** of a fee confirmation; the amount must still equal the fee due, so it is not corrected. A person whose role holds the `fee_confirmation_correct` permission (Finance now; assignable to another role) proposes the right values with a reason; a **different** holder approves or rejects; the proposer may withdraw. Neither may belong to the paying organisation or have acted at another stage of the application (the same separation as the confirmation itself). One correction waits at a time per confirmation. The original confirmation is **never edited**: the values in effect are the latest approved correction, and the history shows both. **Not modelled:** reversing a confirmation (moving the application back to "fee due"), which would need a decision about work already started at scrutiny.

### B12 — Amount received
- **Question.** Must the amount received equal the fee exactly? What about part payments, overpayment, tax, or amounts deducted at source?
- **Today.** The amount must equal the fee on the application exactly; anything else is refused and nothing changes.
- **Recommendation.** State the tolerance, if any, and how a difference is recorded.
- **If unanswered.** Exact match only.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: state a tolerance, if any. **None has been given**, so the exact match stays.

### B9 — Approval chain (D1) and allocation (D2, D5)
- **D1.** Is Secretary approval always required, or can the Director's recommendation be final for some categories? **Today:** the build assumes, on the owner's say-so of 4 October 2026 (not BEE's), that the Director's recommendation **can** be final for some categories; which categories is data (`director_final_rule`), and the only rule today (RAC) keeps the Secretary in the chain. **Recommendation:** state the delegation rule, if any.
- **D2.** Who assigns applications to IAME and Reviewer officers? **Today:** automatic round-robin; no allocator role. **Recommendation:** name the allocating role, or confirm round-robin.
- **D5.** Is the IAME verifier (note-sheet) a separate step from IAME scrutiny? **Today:** one IAME step. **Recommendation:** say whether a second step exists.
- **If unanswered.** The defaults stay.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** D1: no delegation rule was given, so the 4 October assumption above stands (the Director's recommendation can be final for categories listed in `director_final_rule`; none today). D2: automatic round-robin, no allocator role. D5: the recommendation, which is as built (one IAME step).

### B13 — What the applicant may see of the officers' notes (the history)
- **Question.** The history of an application lists every step with who took it and the note that went with it. May the applicant see the officers' internal notes and findings (for example the IAME finding on the test report, the Reviewer's and the Director's notes, the rating figures), or only the steps and the notes addressed to them (a return or rejection reason, their own resubmission)? May the applicant see an officer's name, or only the role and organisation?
- **Today.** The build shows the applicant the whole timeline but withholds the officers' internal notes, findings and rating figures (the step says "Internal note, not shown to you") and shows no personal names; an officer who can read the application sees everything. This is a provisional choice, not a BEE rule.
- **Recommendation.** Keep it: the applicant sees what was addressed to them; the officers' working notes stay internal.
- **If unanswered.** The provisional rule stays and is labelled.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: keep the built rule (the applicant sees what was addressed to them; the officers' working notes stay internal, no personal names).

### B14 — Time limits for each stage (SLA)
- **Question.** How long may an application wait at each stage (fee confirmation, IAME scrutiny, BEE scrutiny, rating, Director, Secretary) before it counts as late, who is told, and who is it escalated to? Do the limits count calendar days or working days, and does the clock stop while an application is returned to the applicant?
- **Today.** No limits exist. The "SLA and escalations" screen only counts applications per stage and says that no limits are set; the inbox shows no due date, overdue flag or age.
- **Options.** (a) One limit for every stage; (b) a limit per stage; (c) a limit per stage and category.
- **Recommendation.** (b), in working days, with the clock stopped while the application is with the applicant.
- **If unanswered.** The screens stay as they are: counts, with nothing called late.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: a limit per stage, in working days, with the clock stopped while the application is with the applicant. **No number of days, recipients or escalation target has been given**; the limits become configurable data (BL-128) and until they are set nothing is called late.

### B15 — Who may see the whole queue of a stage (team queue)
- **Question.** May a person see every application waiting at their stage, including those assigned to a colleague (for example all applications waiting for IAME scrutiny, not just the ones assigned to this officer)? Which roles, and may they reassign?
- **Today.** IAME and Reviewer officers see only the applications assigned to them. Programme, Director and Secretary see every application at their stage. The "Team queue" screen shows prototype data and is not connected.
- **Options.** (a) As today, no team view; (b) a read-only team view for every stage owner; (c) a team view for a supervisor role only, who may also reassign.
- **Recommendation.** (c): name the supervisor role and let it reassign; ordinary officers keep seeing only their own work.
- **If unanswered.** No team queue is built.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** The recommendation: a team view for a supervisor role only, who may also reassign. **The supervisor role is not named yet**; no team queue is built until it is (BL-129, BL-135).

### D7 — Registration ID, validity and when the certificate is issued
- **Owner's assumption, 5 October 2026 (not BEE's decision).** (1) Registration ID: `BEE/<category>/<year>/<number>`, numbered per category and year from 10001 (the fixtures use `BEE/RAC/2026/10016`). (2) Validity: 3 years from the approval date (the fixture shows Jan 2026 to Dec 2028); renewal is not built. (3) The certificate is issued **automatically in the same step as the Secretary's final approval**; if issuing fails, the approval does not happen.

### D8 — What the public may see when verifying a certificate
- **Owner's assumption, 5 October 2026 (not BEE's decision).** The public verification page shows the registration ID, brand, model, category, star rating, efficiency figure (ISEER), validity dates, status and the manufacturer's legal name. It shows no personal names, addresses or internal notes, and it gives the same answer for every registration that does not exist. Status is valid or expired, worked out from the dates; revoked is designed in but not built.

### D9 — The label and the certificate document
- **Owner's assumption, 5 October 2026 (not BEE's decision).** The certificate and the label are a printable web page with a QR image (the browser's Print gives a PDF); a server-made PDF can follow. The label is a simple design clearly marked "local demonstration", showing stars, efficiency figure, brand and model, registration ID, QR and validity. It shows no annual-energy figure (there is no rule for it). BEE's official artwork is not available.

### B10 — The applicant's model record (D4)
- **Question.** Should the registration record screen become the applicant's own record of their models?
- **Today.** Yes, limited to the applicant's organisation.
- **If unanswered.** As today.
- **Owner's assumption, 4 October 2026 (not BEE's decision).** Yes: the registration record screen becomes the applicant's own record of their models, limited to the applicant's organisation. As built.

## C. Administration

### C1 — Changing a rule that is already in force (M6)
- **Question.** Who may close a rule version or replace it with a new one, on whose authority, may the closing date be in the past (which changes what applied to dates already gone), and how is a mistaken entry corrected or withdrawn?
- **Today.** Closing a version is possible only inside the system, once per version, recording who, why and the source. No screen or permission exists. Past dates are allowed. A wrong entry cannot be corrected, only superseded.
- **Options.** (a) Administrators only, with a second approver; (b) Programme only; (c) closing dates may not be in the past.
- **Recommendation.** (a) with (c).
- **If unanswered.** No screen is built for editing rules; the administration screens for fees, standards and formulas stay read-only.
- **Owner's assumption, 4 October 2026 (not BEE's decision), for fee rules only.** The Administrator may enter a fee rule now; the permission is to be assignable to another role later. Whether a second approver is needed, whether a closing date may be in the past, and how a mistaken entry is withdrawn are still open (the recommendation above stands for them).
- **Owner's assumption, 4 October 2026 (not BEE's decision).** Later the same day, the recommendation (a) with (c): administrators only, **with a second approver**, and a closing date may not be in the past. Together with the earlier note, a fee rule (and later a formula or standard) is entered by the Administrator, **confirmed by a second approver**, with a date that is not in the past; the permission can be assigned to another role later. Recorded in BL-131.

## Summary of what each unanswered decision costs

| Decision | If unanswered |
| --- | --- |
| A1 fee | ₹24,000 stays labelled provisional; no verified fee |
| A2 formula | No real rating, only a labelled demonstration |
| A3 standard, A4 categories | Synthetic standard; one category |
| A5 date rule | As today |
| B1 to B8 | The local defaults stay and are labelled provisional |
| B9, B10 | Defaults stay |
| B14 | No overdue, no ages, no due dates; counts only |
| B15 | No team queue; each officer sees only their own work |
| D7, D8, D9 | Registration ID, validity, the public page's fields and the label are the owner's defaults, labelled as not BEE's |
| B13 | The applicant sees the timeline and the notes addressed to them, not the officers' internal notes |
| B11, B12 | Manual confirmation with an exact amount and no correction route |
| C1 | Rule-editing screens stay read-only |

## Answer sheet

| ID | Your decision (option letter or your own wording) | Source or document | Decided by and date |
| --- | --- | --- | --- |
| A1 | (b) per category and application type; configurable; Administrator now; tax a separate line | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| A2 | Configurable formula and thresholds; demonstration bands until BEE supplies one | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| A3 | (a) standard in force on the test date | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| A4 | Official list as a table; none supplied yet | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| A5 | Fee by submission date; standard and accreditation by test date | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B1 | (a) required before submit | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B2 | (a) as built; source and suspension rule not stated | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B3 | Maximum age recommended; number not given | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B4 | As built; families not in scope until stated | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B5 | Declared, then verified by scrutiny; range not stated | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B6 | List per application type recommended; none given | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B7 | Allowed while returned, never after resubmission | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B8 | IAME records verified or not verified with a note | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B9 (D1, D2, D5) | D1 as the 4 Oct assumption; D2 round-robin; D5 one IAME step | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B11 | (a) manual, plus a correction route with a second Finance approver | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B12 | Tolerance not given; exact match stays | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B10 | Yes, the applicant's own record of their models | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B13 | Keep the built rule | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B14 | Per stage, working days, clock stopped while returned; days not given | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| B15 | (c) supervisor role only, may reassign; role not named | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |
| C1 | (a) with (c): administrators with a second approver, no past dates | Owner's assumption | Owner, 4 Oct 2026 (not BEE) |

## References for the engineering team

Source decision records and the build's provisional values: [wp01/SCREEN_ACTION_MATRIX.md](wp01/SCREEN_ACTION_MATRIX.md) (D1 to D6), [wp04/WP04.1_MASTERS.md](wp04/WP04.1_MASTERS.md) section 10 (M1 to M7), [wp05/WP05.1d_DECISIONS.md](wp05/WP05.1d_DECISIONS.md) and [wp05/WP05.1d_EVIDENCE_GATES.md](wp05/WP05.1d_EVIDENCE_GATES.md) (B1 to B8). Tracked in [BACKLOG.md](BACKLOG.md): BL-040 to BL-043, BL-064, BL-065, BL-068, BL-073, BL-084, BL-085, BL-086.
