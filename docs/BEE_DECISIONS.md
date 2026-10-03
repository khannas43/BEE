# Decisions needed from BEE — Standards & Labelling Portal (local build)

**Status:** Request for decisions, prepared 3 October 2026. **Nothing in this document has been decided by BEE.** It is for the BEE officials who own each rule.

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

### A2 — Approved star-rating formula and version (D3 / M5)
- **Question.** Which rating formula, which version and which inputs apply per category, and how a new version takes effect.
- **Today.** No formula is computable. The placeholder version is labelled `0-unverified`; the system refuses to compute a rating from it.
- **Options.** (a) One formula per category with dated versions; (b) formula plus thresholds that change by year.
- **Recommendation.** Provide the formula, the input list and the threshold table for room air conditioners first, with its effective date.
- **If unanswered.** The rating step cannot be built beyond a clearly labelled demonstration.

### A3 — Standard and edition (M2)
- **Question.** Which standard and edition applies per category and purpose (for example performance testing), and how does the changeover work?
- **Today.** A stand-in code, not a real standard, with a changeover on 1 July 2026 chosen only to test dates.
- **Options.** (a) Standard in force on the **test date**; (b) standard in force on the **submission date**; (c) the applicant chooses within a transition window.
- **Recommendation.** (a): the standard in force when the test was done.
- **If unanswered.** The system uses the standard in force on the test date.

### A4 — Official category list (M1)
- **Question.** The official list of appliance categories, their codes and names, and when each scheme starts.
- **Today.** Room air conditioner only.
- **Recommendation.** The list in a table: code, name, start date.
- **If unanswered.** Only room air conditioners can be filed.

### A5 — Which date selects a rule (M7)
- **Question.** For fee, standard and similar rules, which business date decides which version applies: submission date, fee-confirmation date, or the test date?
- **Today.** The fee and standard use the submission date. Accreditation and the standard for the test use the **test date**.
- **Recommendation.** Fee by submission date; standard and laboratory accreditation by test date (as today).
- **If unanswered.** As today.

## B. Rules that shape the workflow

### B1 — Is a test report required before an application can be submitted?
- **Question.** Must at least one test report be uploaded before the application can go to fee payment? One per model, or per family?
- **Today.** Required, one report per model application (a local default).
- **Options.** (a) Required before submit; (b) required before scrutiny but not before the fee; (c) optional until review.
- **Recommendation.** (a).
- **If unanswered.** (a) stays, as a provisional rule.

### B2 — Laboratory accreditation
- **Question.** Must the laboratory be chosen from an accredited-laboratory list, and must it be accredited for the category **on the test date**? Who maintains the list and from what source (M3)? Does a later suspension block an application already submitted?
- **Today.** The laboratory is chosen from a local list and must hold an active accreditation for the category on the test date. The list is synthetic.
- **Options.** (a) As today; (b) laboratory typed freely and checked later by a reviewer; (c) accreditation checked at the **review** stage as well as at submit.
- **Recommendation.** (a), with the authoritative source and the rule for later suspensions stated by BEE.
- **If unanswered.** (a) stays, on the synthetic list.

### B3 — Test date rules
- **Question.** Is the test date required, may it be in the future, and is there a maximum age (for example the test must be within N months of filing)?
- **Today.** Required; not in the future; **no maximum age**.
- **Recommendation.** Give the maximum age, if any, as a number of months.
- **If unanswered.** No maximum age.

### B4 — What counts as the same model, and families
- **Question.** When are two applications the same model, so a second must be refused? Is a **family** (several models sharing one rating) filed as one application or several?
- **Today.** The same brand and the same model number, ignoring capital letters and surrounding spaces, among applications that are not drafts and not rejected. Families are not modelled. `NC-1` and `NC1` count as different.
- **Options.** (a) As today; (b) also ignore punctuation; (c) a family record that groups models.
- **Recommendation.** State the rule, and say whether family applications are in the first release.
- **If unanswered.** As today; no families.

### B5 — Efficiency figure: declared or calculated
- **Question.** Does the applicant declare the efficiency figure (ISEER), or is it only calculated from the test report? What range and how many decimals are valid?
- **Today.** The applicant declares it: a positive number up to 99.99 with at most two decimals (placeholders). The rating step, when built, would calculate its own figure and keep both.
- **Recommendation.** Declared by the applicant and verified by scrutiny; give the valid range and precision.
- **If unanswered.** The placeholder limits stay.

### B6 — Other required documents and file rules
- **Question.** Besides the test report, which documents are required at submit (for example brand authorisation, licence copies)? Which file types, and what size limit?
- **Today.** The test report only, **PDF only, 5 MiB**.
- **Recommendation.** List the required documents per application type.
- **If unanswered.** As today.

### B7 — Changes after an application is returned
- **Question.** If scrutiny returns an application to the applicant, may the applicant add or replace documents and edit the form, and until when?
- **Today.** Documents and edits are allowed on a draft only; the return step is not built yet.
- **Recommendation.** Allowed while the application is in the returned state, never after resubmission.
- **If unanswered.** That recommendation will be built.

### B8 — Who verifies a test report, and with what outcomes
- **Question.** Who checks that a report is genuine and complete, what outcomes exist (for example verified, not verified, query raised), and what happens next?
- **Today.** Every uploaded report is labelled "pending local verification". The system makes no claim about accreditation, authenticity or malware.
- **Recommendation.** The IAME scrutiny step records verified or not verified with a note.
- **If unanswered.** Reports stay "pending verification" through the whole journey.

### B11 — How the fee is confirmed, and who can correct a mistake
- **Question.** Is the fee confirmed **by hand by Finance** after seeing the payment, or by the applicant uploading proof, or by a payment gateway? Who exactly may confirm? If a confirmation is wrong (wrong reference, wrong date), how is it corrected or reversed, and by whom?
- **Today.** Finance confirms by hand, recording a receipt reference and the date received. The applicant's organisation and anyone who took part at another stage cannot confirm. A confirmation **cannot be undone** in the product.
- **Options.** (a) As today, plus a correction step that needs a second Finance approver; (b) applicant uploads proof, Finance verifies it; (c) gateway callback with Finance reconciliation.
- **Recommendation.** (a) for the first release: manual confirmation, with a defined correction route.
- **If unanswered.** As today, with no correction route.

### B12 — Amount received
- **Question.** Must the amount received equal the fee exactly? What about part payments, overpayment, tax, or amounts deducted at source?
- **Today.** The amount must equal the fee on the application exactly; anything else is refused and nothing changes.
- **Recommendation.** State the tolerance, if any, and how a difference is recorded.
- **If unanswered.** Exact match only.

### B9 — Approval chain (D1) and allocation (D2, D5)
- **D1.** Is Secretary approval always required, or can the Director's recommendation be final for some categories? **Today:** always required. **Recommendation:** state the delegation rule, if any.
- **D2.** Who assigns applications to IAME and Reviewer officers? **Today:** automatic round-robin; no allocator role. **Recommendation:** name the allocating role, or confirm round-robin.
- **D5.** Is the IAME verifier (note-sheet) a separate step from IAME scrutiny? **Today:** one IAME step. **Recommendation:** say whether a second step exists.
- **If unanswered.** The defaults stay.

### B10 — The applicant's model record (D4)
- **Question.** Should the registration record screen become the applicant's own record of their models?
- **Today.** Yes, limited to the applicant's organisation.
- **If unanswered.** As today.

## C. Administration

### C1 — Changing a rule that is already in force (M6)
- **Question.** Who may close a rule version or replace it with a new one, on whose authority, may the closing date be in the past (which changes what applied to dates already gone), and how is a mistaken entry corrected or withdrawn?
- **Today.** Closing a version is possible only inside the system, once per version, recording who, why and the source. No screen or permission exists. Past dates are allowed. A wrong entry cannot be corrected, only superseded.
- **Options.** (a) Administrators only, with a second approver; (b) Programme only; (c) closing dates may not be in the past.
- **Recommendation.** (a) with (c).
- **If unanswered.** No screen is built for editing rules; the administration screens for fees, standards and formulas stay read-only.

## Summary of what each unanswered decision costs

| Decision | If unanswered |
| --- | --- |
| A1 fee | ₹24,000 stays labelled provisional; no verified fee |
| A2 formula | No real rating, only a labelled demonstration |
| A3 standard, A4 categories | Synthetic standard; one category |
| A5 date rule | As today |
| B1 to B8 | The local defaults stay and are labelled provisional |
| B9, B10 | Defaults stay |
| B11, B12 | Manual confirmation with an exact amount and no correction route |
| C1 | Rule-editing screens stay read-only |

## Answer sheet

| ID | Your decision (option letter or your own wording) | Source or document | Decided by and date |
| --- | --- | --- | --- |
| A1 | | | |
| A2 | | | |
| A3 | | | |
| A4 | | | |
| A5 | | | |
| B1 | | | |
| B2 | | | |
| B3 | | | |
| B4 | | | |
| B5 | | | |
| B6 | | | |
| B7 | | | |
| B8 | | | |
| B9 (D1, D2, D5) | | | |
| B11 | | | |
| B12 | | | |
| B10 | | | |
| C1 | | | |

## References for the engineering team

Source decision records and the build's provisional values: [wp01/SCREEN_ACTION_MATRIX.md](wp01/SCREEN_ACTION_MATRIX.md) (D1 to D6), [wp04/WP04.1_MASTERS.md](wp04/WP04.1_MASTERS.md) section 10 (M1 to M7), [wp05/WP05.1d_DECISIONS.md](wp05/WP05.1d_DECISIONS.md) and [wp05/WP05.1d_EVIDENCE_GATES.md](wp05/WP05.1d_EVIDENCE_GATES.md) (B1 to B8). Tracked in [BACKLOG.md](BACKLOG.md): BL-040 to BL-043, BL-064, BL-065, BL-068, BL-073, BL-084, BL-085, BL-086.
