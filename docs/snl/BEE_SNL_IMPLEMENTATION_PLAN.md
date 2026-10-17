# BEE Standards and Labelling Portal Implementation Plan

**Status:** Living work-package tracker
**Date:** 18 October 2026
**Last updated:** 18 October 2026
**Active work package:** WP2 Common workflow tasks and SLA
**Primary source:** *SnL Disha Advisory Manual*
**Secondary reference:** https://www.beestarlabel.com/Manufacturer/AgencyRegistration
**Important:** The assumptions in this plan are implementation defaults selected because formal BEE decisions were not available. They are not BEE policy and must remain configurable.

## 1. Purpose

This plan converts the agreed priorities into buildable work packages for the existing BEE portal. It covers entity and brand registration, appliance-category enrolment, model approval, document queries, fees, QR codes, production reporting, label-fee reconciliation, processing time, Manufacturer 360, renewal, withdrawal and cancellation.

The manual is the requirements baseline. Page references mean the printed page number in the PDF footer. The current BEE registration page is used only to confirm the fields presently collected and to identify usability improvements.

### 1.1 Work package dashboard

Update this table when work starts, reaches a gate, becomes blocked or is accepted. A package is **Complete** only after its acceptance journey, evidence note and required gate are complete.

| WP | Work package | Status | Progress | Depends on | Target release | Completion evidence |
|---|---|---|---:|---|---|---|
| WP1 | Policy baseline and traceability | Complete | 100% | None | R0 | [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md); accepted 18 Oct 2026; BL-252 deferred to WP3 |
| WP2 | Common workflow tasks and SLA | In progress | 5% | WP1 | R1 | Brief 18 / WP2A foundation in progress |
| WP3 | Entity brand and category registration | Not started | 0% | WP2, WP5 foundation | R2 | Pending |
| WP4 | Simplified model registration | Not started | 0% | WP2, WP3, WP5 foundation | R3 | Pending |
| WP5 | Payment and financial controls | Not started | 0% | WP1 | R2–R5 | Pending |
| WP6 | QR requisition and serial register | Not started | 0% | WP4, WP5 | R4 | Pending |
| WP7 | Production label fees and annual reconciliation | Not started | 0% | WP5, WP6 | R5 | Pending |
| WP8 | Manufacturer 360 | Not started | 0% | WP3, WP4, WP6, WP7 | R6 | Pending |
| WP9 | Renewal withdrawal and cancellation | Not started | 0% | WP3, WP4, WP5, WP7 | R6 | Pending |
| WP10 | Production readiness | Not started | 0% | WP2–WP9 | R7 | Pending |

### 1.2 Status rules

| Status | Meaning |
|---|---|
| Not started | No target-package implementation has begun. Existing reusable code may still be listed as foundation. |
| In progress | At least one package task is being implemented or verified. |
| Blocked | Work cannot continue without a policy decision, access, external service or prerequisite package. |
| Gate pending | Implementation is complete but required tests, live proof, review or full gate remain. |
| Complete | Acceptance journey, evidence note, review and required gate are complete. |

Progress is the approximate percentage of target-package checklist items completed. Existing demonstration features do not count as completion until they are promoted, integrated and accepted under the package.

## 2. Delivery principles

1. Collect verified entity information once and reuse it.
2. Preserve the manual's decision authorities while removing duplicate screens and manual hand-offs.
3. Confirm successful online payments automatically; Finance handles exceptions.
4. Treat every return as a structured set of discrepancies with responses and document versions.
5. Keep every fee, rule, document and decision versioned and auditable.
6. Keep legal and operational rules configurable by effective date.
7. Build every release as an end-to-end usable journey with automated and live tests.

## 3. Provisional assumptions

| ID | Provisional assumption | Basis and rationale |
|---|---|---|
| A01 | One legal entity master is verified once. Brands and appliance categories are separate child registrations. | Avoids repeated company data while preserving Sections 3.1.1 and 3.1.2, pages 22–23. |
| A02 | A Registration Scrutiny Officer or assigned designated agency performs entity and brand scrutiny. | Section 3.2 permits BEE or its designated agency to scrutinize model applications; the same operational pattern is adopted for registration. |
| A03 | Programme reviews and recommends entity, brand and category registrations; the Director gives final approval. | The manual does not prescribe the entity approval roles. This reuses the existing registration workflow and segregation of duties. |
| A04 | Model applications follow technical scrutiny, Programme Director recommendation and Secretary approval. | Explicitly prescribed by Section 3.3, page 24. |
| A05 | Required documents are configured by applicant type, registration type, appliance category and effective date. | Sections 3.1.1 and 3.1.3 and Annexures 1 and 3 prescribe a baseline and permit additional schedule-specific documents. |
| A06 | The portal records issue and expiry dates and requires verification for trademark, SSI, BIS, ISO, laboratory accreditation and other expiring documents. | Sections 3.1 and 3.4 require valid documents and permit holding an application for expired documents. |
| A07 | Initial defaults are INR 5,000 company registration, INR 300,000 category security deposit, INR 50,000 for SSI, and INR 5,000 model permission. Label fees remain configurable from official schedules. | Sections 4.1–4.3, pages 30–31. |
| A08 | The narrative requirement to communicate discrepancies within seven working days is treated as the statutory ceiling until BEE resolves the conflicting 12- and 15-day table values. | Section 3.10 and Tables 2 and 3, pages 28–30. |
| A09 | Internal targets are one day for first scrutiny, two to three days for a clean entity registration, and three to five days for a clean model application. | These targets improve on the 30-working-day ceiling without changing authority. |
| A10 | Prepaid QR label fees apply to QR requisitions from 1 April 2027. Before that date, quarterly accrued-fee settlement remains available. | Section 4.5, page 32. |
| A11 | Each QR serial identifies one physical unit. A serial is unique, opaque, server-resolved and cannot be reused after binding or voiding. | The manual requires QR beside the label but does not define the technical serial model. This design gives traceability and duplicate control. |
| A12 | Manufacturers submit quarterly production and fee statements and an annual CA-certified reconciliation. There is no separate annual charge unless BEE later creates one. | Section 1.3.5, page 15, and Section 4.5, page 32. |
| A13 | Every non-zero production-to-QR variance requires an explanation. A configurable materiality rule, initially 1 percent or 100 units whichever is lower, sends the case for BEE review. The system applies no automatic penalty. | Supports reconciliation without inventing enforcement not stated in the manual. |
| A14 | BEE officers see all Manufacturer 360 records allowed by role; designated agencies see assigned records; manufacturers see only their organisation. | Applies least privilege to the consolidated view. |
| A15 | Renewal follows scrutiny, Programme recommendation and Secretary approval. Withdrawal requires financial clearance and Director approval. Cancellation requires Programme proposal, Director recommendation and Secretary decision. | Sections 3.5–3.9 define outcomes but not every role. These defaults preserve segregation and reuse existing roles. |
| A16 | Successful gateway payments are confirmed automatically. Finance reviews failed, unmatched, reversed and disputed transactions. | Removes a routine manual step while preserving financial control. |
| A17 | Working days use a configurable India business calendar. The clock stops while the application is awaiting the applicant. | Section 3.10 defines days as working days; the stop-clock rule prevents BEE time from including applicant delay. |
| A18 | Portal notifications are authoritative. Email is enabled when a provider is approved; SMS is limited to high-value events. | The manual requires portal communication. External channels need provider, template, consent and retry decisions. |
| A19 | Uploaded signed and stamped documents satisfy the current requirement. Digital signature or eSign verification will be added when BEE confirms the accepted mechanism. | Sections 3 and 3.1 require signed and stamped documents. |
| A20 | Registration identifiers use configurable sequences. Existing model identifiers remain `BEE/<category>/<year>/<number>` until BEE supplies the official format. | Preserves the existing portal without claiming an official numbering policy. |

## 4. Target process

### 4.1 Entity brand and category registration

```text
Draft
  -> readiness checks
  -> submit and pay
  -> automated payment confirmation
  -> scrutiny
       -> return with discrepancies -> applicant response -> scrutiny
       -> Programme recommendation -> Director approval
       -> rejection
  -> permittee number and active registrations
```

**Manual trace:** Section 3.1.1, pages 22–23; Section 3.1.2, page 23; Section 3.4, pages 24–25; Table 2, pages 28–29; Sections 4.1 and 4.2, pages 30–31; Annexure 1, pages 50–53.

### 4.2 Model registration

```text
Draft
  -> select approved brand and category
  -> technical details and documents
  -> submit and pay
  -> technical scrutiny
       -> return with discrepancies -> applicant response -> rescrutiny
       -> Programme Director recommendation
       -> Secretary approval or rejection
  -> approval letter certificate and label permission
```

**Manual trace:** Sections 3.1.3–3.4, pages 23–25; Table 3, pages 29–30; Section 4.3, page 31; Annexure 3, pages 56–57.

### 4.3 QR production and fee lifecycle

```text
Approved model
  -> QR quantity request
  -> prepaid fee calculation and payment
  -> batch and serial generation
  -> secure download or API delivery
  -> bind serials to manufactured units
  -> quarterly production return
  -> quarterly fee reconciliation
  -> annual CA-certified reconciliation
```

**Manual trace:** Permittee obligations, Section 1.3.5, pages 15–16; Section 4.5, page 32; label and QR requirements, Sections 5 and 5.1, pages 33–35.

## 5. Technical foundation

### 5.1 Shared workflow engine

Build a common state-transition service used by entity, brand, category and model applications.

Required capabilities:

- transition definitions by application type;
- role and permission checks;
- segregation of duties;
- optimistic version checks;
- idempotency keys for commands;
- assignments, due dates and working-day clocks;
- return, response, recommendation, approval, rejection and cancellation;
- immutable transition events;
- notification events in the same transaction;
- configurable response and escalation rules.

### 5.2 Rules and master data

Create effective-dated masters for:

- applicant types;
- appliance categories and subcategories;
- mandatory and voluntary regimes;
- document requirements;
- fees and tax;
- security deposits;
- label fees;
- technical schedules and parameter schemas;
- test standards and laboratory accreditation;
- processing SLAs;
- working-day calendars;
- approval authorities;
- QR and reconciliation rules.

Applied versions must be immutable. New versions supersede older versions from an effective date.

### 5.3 Document model

Each document record must contain:

- type and requirement version;
- file hash, size and MIME type;
- issue and expiry dates;
- issuer and reference number;
- applicant declaration;
- verification status, officer and time;
- replacement relationship;
- application version in which it was submitted;
- retention and access classification.

## 6. Work package tracking

Every package follows the same lifecycle:

```text
Not started -> In progress -> Gate pending -> Complete
                         \-> Blocked -> In progress
```

At the end of each development session, update the package status, progress, completed checkboxes, evidence links, latest test result and next action. Do not mark a package Complete from code completion alone.

### WP1 Policy baseline and traceability

| Tracking field | Current value |
|---|---|
| Status | Complete |
| Progress | 100% |
| Target release | R0 |
| Depends on | None |
| Manual references | Sections 1.3.5, 3.1–3.10, 4.1–4.5, 5 and 5.1; Annexures 1–4 |
| Current evidence | [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md), [SNL_WP01_ROLE_MATRIX.md](SNL_WP01_ROLE_MATRIX.md), [SNL_WP01_STATE_MODELS.md](SNL_WP01_STATE_MODELS.md), [SNL_WP01_FIELD_DICTIONARY.md](SNL_WP01_FIELD_DICTIONARY.md); A01–A20 in [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) |
| Next action | Start WP2 workflow/SLA design; retry live company registration form during WP3 (BL-252) |

**Outcome:** an accepted provisional requirements baseline in which every planned function has a manual source or a clearly identified implementation assumption.

**Existing foundation:** the manual is reviewed; assumptions A01–A20 and WP01 artifacts are in the repository. Live BEE company registration URL returned **504 Gateway Timeout** on 18 October 2026 — not inspected (**BL-252**).

#### WP1 checklist

- [x] Review the SnL Disha Advisory Manual.
- [x] Attempt inspection of the current BEE Company Registration Form (504 on 18 Oct 2026); defer the secondary comparison to WP3 as **BL-252**.
- [x] Draft assumptions A01–A20.
- [x] Draft the manual traceability index.
- [x] Add assumptions to `docs/BEE_DECISIONS.md` as provisional owner assumptions.
- [x] Create the role and permission matrix.
- [x] Create state diagrams and allowed-transition tables.
- [x] Create entity, model, document and fee field dictionaries.
- [x] Decide the disposition of every `/api/demo/**` route.
- [x] Review the baseline against the existing schema, routes and backlog.
- [x] Create the WP1 evidence note ([SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md) §5 and companion artifacts).
- [x] Run documentation and traceability checks (see WP1 completion evidence).
- [x] Commit, review and accept WP1 (accepted by ChatGPT on 18 Oct 2026; assumptions remain provisional).

#### WP1 completion evidence

| Evidence | Result or link |
|---|---|
| Decision record | [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) §18 Oct 2026 (A01–A20 provisional) |
| Traceability matrix | [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md) §3 |
| Role matrix | [SNL_WP01_ROLE_MATRIX.md](SNL_WP01_ROLE_MATRIX.md) |
| State diagrams | [SNL_WP01_STATE_MODELS.md](SNL_WP01_STATE_MODELS.md) |
| Field dictionaries | [SNL_WP01_FIELD_DICTIONARY.md](SNL_WP01_FIELD_DICTIONARY.md) |
| Test or validation result | `npm run web:test` on task commit (Cursor WP01 handback) |
| Review result | Accepted by ChatGPT on 18 Oct 2026 after Brief 17A corrections; BL-252 is a non-blocking WP3 follow-up |
| Completion commit or PR | Brief 17, Brief 17A and acceptance commits merged to `main` |

#### WP1 acceptance

- [x] Every planned requirement has a manual section/page or an assumption ID.
- [x] Manual requirements and implementation designs are visibly distinguished.
- [x] Roles, transitions, fields and required documents are defined.
- [x] Policy values are configurable and effective-dated where appropriate.
- [x] No unresolved item is omitted; each is recorded as an assumption, dependency or backlog item.

---

### WP2 Common workflow tasks and SLA

| Tracking field | Current value |
|---|---|
| Status | In progress |
| Progress | 5% |
| Target release | R1 |
| Depends on | WP1 |
| Manual references | Sections 3.2–3.4 and 3.10, printed pages 24–25 and 28–30 |
| Existing foundation | Current registration and model flows already have assignments, returns, resubmission, decisions, history and notifications in separate implementations |
| Next action | Implement Brief 18: shared workflow persistence and working-day SLA foundation without changing existing journeys |

**Outcome:** one reusable workflow and task service for entity, brand, category and model applications.

#### WP2 checklist

- [ ] Define the workflow configuration and transition policy.
- [ ] Add task, assignment, SLA-clock and escalation migrations.
- [ ] Add structured discrepancy, response and disposition records.
- [ ] Add working-day calendar and paused-clock calculation.
- [ ] Add supervisor queue and recorded reassignment.
- [ ] Add immutable transition and assignment events.
- [ ] Add notification events in the same transaction as each transition.
- [ ] Build common return, respond, recommend, approve and reject APIs.
- [ ] Build common applicant and officer workflow components.
- [ ] Build My work and supervisor queue screens.
- [ ] Show due dates, age, paused time and escalation status.
- [ ] Add the 60-day no-response cancellation job and proof.
- [ ] Prove role, assignment, segregation, idempotency and concurrency rules.
- [ ] Run unit, contract, database, UI and live workflow checks.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP2.

#### WP2 completion evidence

| Evidence | Result or link |
|---|---|
| Plan and schema | Pending |
| Migration range | Pending |
| Contract version | Pending |
| Unit and contract tests | Pending |
| Database tests | Pending |
| UI tests | Pending |
| Live check | Pending |
| Full gate | Pending |
| Review | Pending |
| Completion commit or PR | Pending |

#### WP2 acceptance

- [ ] The same workflow service supports at least one registration and one model journey.
- [ ] Every pending task has an owner, due date and visible SLA state.
- [ ] The SLA clock pauses while the applicant is responsible.
- [ ] Every discrepancy has an applicant response and reviewer disposition.
- [ ] Concurrent or replayed commands create one valid result.

---

### WP3 Entity brand and category registration

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R2 |
| Depends on | WP2 and WP5 payment foundation |
| Manual references | Sections 3.1.1, 3.1.2, 3.4, 3.10, 4.1 and 4.2; Annexures 1 and 2 |
| Existing foundation | Brand and agency requests, manual fee confirmation, Programme/Director review, return, reject, register and revocation are already demonstrated |
| Next action | Design the legal-entity and appliance-category data model |

**Outcome:** a manufacturer, importer or trader becomes an approved permittee with active brand and appliance-category registrations.

#### WP3 checklist

- [ ] Add legal entity, facility, contact, signatory and retailer records.
- [ ] Add entity, brand and appliance-category application records.
- [ ] Add registration-number and status histories.
- [ ] Add security-deposit account and events.
- [ ] Configure the Annexure 1 document checklist and expiry rules.
- [ ] Build draft create, read, update and save-resume APIs.
- [ ] Build facility and contact management.
- [ ] Build document upload, replacement, verification and history.
- [ ] Build fee preview, payment initiation and readiness checks.
- [ ] Connect submit, return, respond, recommend, approve and reject to WP2.
- [ ] Build the step-based applicant onboarding wizard.
- [ ] Build the BEE scrutiny and decision workspace.
- [ ] Generate the permittee record and registration document on approval.
- [ ] Add active entity, brand and category records to the register.
- [ ] Prove organisation isolation and segregation of duties.
- [ ] Run the end-to-end return-and-response acceptance journey.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP3.

#### WP3 completion evidence

| Evidence | Result or link |
|---|---|
| Data and policy design | Pending |
| Migration range | Pending |
| Contract version | Pending |
| Backend tests | Pending |
| Portal tests | Pending |
| Live check | Pending |
| Full gate | Pending |
| Review | Pending |
| Completion commit or PR | Pending |

#### WP3 acceptance journey

- [ ] A manufacturer files an entity, brand and appliance-category application.
- [ ] Online payment succeeds and confirms automatically.
- [ ] BEE returns an expired document as a structured discrepancy.
- [ ] The manufacturer replaces the document and responds.
- [ ] Programme recommends and the Director approves.
- [ ] Permittee, brand and category records become active atomically.
- [ ] The complete journey appears in the register, audit history and Manufacturer 360 source data.

---

### WP4 Simplified model registration

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R3 |
| Depends on | WP2, WP3 and WP5 payment foundation |
| Manual references | Sections 3.1.3–3.4, Table 3, Section 4.3 and Annexure 3 |
| Existing foundation | The current model flow supports draft, documents, fee, multiple scrutiny stages, return/resubmit, rejection, approval, certificate and label preview |
| Next action | Map Annexure 3 fields and category-specific technical schemas to the existing model domain |

**Outcome:** a clean model application reaches approval through technical scrutiny, Programme Director recommendation and Secretary decision.

#### WP4 checklist

- [ ] Add category-specific technical parameter schemas.
- [ ] Add model-family and child-model records.
- [ ] Add laboratory and accreditation masters.
- [ ] Add test-report age, standard and accreditation-scope validation.
- [ ] Add Annexure 3 fields and category-specific document requirements.
- [ ] Prefill approved entity, brand, category and contact information.
- [ ] Consolidate current officer stages into the target decision chain.
- [ ] Connect payment to WP5 automatic confirmation.
- [ ] Connect structured return and response to WP2.
- [ ] Build Programme Director recommendation.
- [ ] Build Secretary approval and rejection.
- [ ] Generate approval letter, certificate and label permission atomically.
- [ ] Build the simplified applicant wizard and technical scrutiny screen.
- [ ] Prove three-to-five-day SLA measurement on a clean synthetic case.
- [ ] Run the model acceptance journey and all regression checks.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP4.

#### WP4 completion evidence

| Evidence | Result or link |
|---|---|
| Annexure 3 mapping | Pending |
| Technical-schema design | Pending |
| Migration range | Pending |
| Contract version | Pending |
| Backend tests | Pending |
| Portal tests | Pending |
| Live check | Pending |
| Full gate | Pending |
| Review | Pending |
| Completion commit or PR | Pending |

#### WP4 acceptance journey

- [ ] Applicant selects an approved brand and category and receives prefilled company data.
- [ ] Expired or out-of-scope accreditation blocks submission.
- [ ] Successful payment confirms automatically.
- [ ] A returned discrepancy replaces only the affected evidence.
- [ ] Programme Director recommends the model.
- [ ] Secretary approval creates the registration and certificate in one transaction.
- [ ] The applicant and BEE see the decision, validity and complete history.

---

### WP5 Payment and financial controls

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R2–R5 cross-cutting |
| Depends on | WP1 fee and authority assumptions |
| Manual references | Sections 4.1–4.5, printed pages 30–32 |
| Existing foundation | Fee rules, manual confirmation, correction, reversal, simulated payment callbacks, receipts and reconciliation demonstrations exist |
| Next action | Define the provider-neutral payment and financial-ledger model |

**Outcome:** successful payments post automatically while financial exceptions and corrections remain controlled and auditable.

#### WP5 checklist

- [ ] Define payment intent, provider transaction and callback records.
- [ ] Define the fee ledger across registration, model, QR and production obligations.
- [ ] Add signed callback verification and replay protection.
- [ ] Add automatic successful-payment confirmation.
- [ ] Add receipt generation and download.
- [ ] Add provider settlement/reconciliation import or API.
- [ ] Add unmatched, failed, disputed and duplicate exception queues.
- [ ] Reuse and extend correction and reversal workflows.
- [ ] Add refund and security-deposit adjustment workflows.
- [ ] Prove payer and organisation separation.
- [ ] Prove duplicate callbacks never double-charge or double-confirm.
- [ ] Add financial audit and reporting APIs.
- [ ] Run payment failure and recovery live checks.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required gate for each consuming release.

#### WP5 completion evidence

| Evidence | Result or link |
|---|---|
| Payment and ledger design | Pending |
| Provider adapter | Pending |
| Contract version | Pending |
| Callback and replay tests | Pending |
| Exception tests | Pending |
| Reconciliation proof | Pending |
| Live check | Pending |
| Gate result | Pending |
| Review | Pending |

#### WP5 acceptance

- [ ] Callback replay produces one payment and one confirmation.
- [ ] A payer cannot confirm, correct or reverse its own payment.
- [ ] Unmatched money remains visible in an exception queue.
- [ ] Corrections and reversals preserve the original record and require a second person.
- [ ] Registration, model, QR and production charges share one auditable ledger.

---

### WP6 QR requisition and serial register

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R4 |
| Depends on | WP4 and WP5 |
| Manual references | Section 1.3.5, Section 4.5 and Sections 5–5.1, pages 15, 32 and 33–35 |
| Existing foundation | Demo QR batches, unique serials, binding, voiding, downloads and public verification exist |
| Next action | Promote the QR domain into the formal contract and connect it to prepaid fees |

**Outcome:** paid QR batches for active approved models with per-unit traceability.

#### WP6 checklist

- [ ] Confirm and document the QR payload and serial format.
- [ ] Add formal QR requisition and fee-assessment records.
- [ ] Promote batch, serial and serial-event tables and policies.
- [ ] Define generated, issued, bound, voided and replaced states.
- [ ] Add active-model and label-series eligibility checks.
- [ ] Connect QR quantity to WP5 prepaid payment.
- [ ] Guarantee generated quantity never exceeds paid quantity.
- [ ] Promote QR request, batch, serial, bind, void and replace APIs.
- [ ] Promote secure CSV and Excel downloads with audit events.
- [ ] Add an optional authenticated bulk manufacturer API.
- [ ] Extend public verification to serial status.
- [ ] Prove duplicate, reuse, expiry, revocation and isolation controls.
- [ ] Run the paid-batch-to-public-verification acceptance journey.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP6.

#### WP6 completion evidence

| Evidence | Result or link |
|---|---|
| QR format decision | Pending |
| Migration range | Pending |
| Contract version | Pending |
| Serial integrity tests | Pending |
| Portal and export tests | Pending |
| Public verification tests | Pending |
| Live check | Pending |
| Full gate | Pending |
| Review | Pending |

#### WP6 acceptance journey

- [ ] An active model requests a QR quantity and receives a fee assessment.
- [ ] Payment creates exactly the paid number of unique serials.
- [ ] The manufacturer securely downloads and binds selected serials.
- [ ] Duplicate binding and reuse after voiding are refused.
- [ ] Public verification resolves the current registration and certificate status.
- [ ] Every download, bind, void and replacement appears in the audit history.

---

### WP7 Production label fees and annual reconciliation

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R5 |
| Depends on | WP5 and WP6 |
| Manual references | Section 1.3.5, Sections 3.5–3.6 and Section 4.5, pages 15–16, 25–26 and 32 |
| Existing foundation | Demo quarterly returns, bulk validation, evidence, review and QR comparison exist; label-fee and annual reconciliation do not |
| Next action | Design the production, assessment, adjustment and annual reconciliation ledgers |

**Outcome:** quarterly production, QR use and label fees reconcile, followed by annual CA-certified reconciliation.

#### WP7 checklist

- [ ] Promote production-return and model/month row records.
- [ ] Add dry-run bulk validation and atomic storage.
- [ ] Add quarterly submission, query, correction and acceptance.
- [ ] Add CA evidence and fingerprinting.
- [ ] Add label-fee assessment and adjustment ledger.
- [ ] Reconcile produced, QR purchased, bound, voided and unused units.
- [ ] Require an explanation for every non-zero variance.
- [ ] Create BEE tasks for material variances.
- [ ] Add annual CA-certified reconciliation.
- [ ] Add annual retailer/dealer list submission due by 30 April.
- [ ] Block renewal readiness when required returns or dues are incomplete.
- [ ] Build manufacturer and BEE reporting screens.
- [ ] Prove quarterly and annual calculations across boundary dates.
- [ ] Run the end-to-end reconciliation acceptance journey.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP7.

#### WP7 completion evidence

| Evidence | Result or link |
|---|---|
| Production and fee design | Pending |
| Migration range | Pending |
| Contract version | Pending |
| Calculation tests | Pending |
| Database tests | Pending |
| Portal tests | Pending |
| Live check | Pending |
| Full gate | Pending |
| Review | Pending |

#### WP7 acceptance journey

- [ ] A manufacturer submits a quarter with CA evidence.
- [ ] The system shows production, QR purchase, binding, void and unused balances.
- [ ] A variance requires an explanation and a material variance creates a BEE task.
- [ ] BEE accepts or queries the quarter.
- [ ] Label-fee payments and adjustments reconcile.
- [ ] Four quarters roll into an annual CA-certified reconciliation.
- [ ] Renewal readiness reflects reporting and payment completeness.

---

### WP8 Manufacturer 360

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R6 |
| Depends on | WP3, WP4, WP6 and WP7 |
| Manual references | Derived view consolidating Sections 1.3.5, 3.1–3.9, 4.1–4.5 and Annexures 1 and 3 |
| Existing foundation | Executive, Director, Auditor and MIS dashboards already provide manufacturer filters and drill-down patterns |
| Next action | Define the 360 read model and reconciliation rules after the source domains stabilize |

**Outcome:** one role-scoped view of identity, registrations, models, QR, production, finance and compliance.

#### WP8 checklist

- [ ] Define the Manufacturer 360 read model and refresh strategy.
- [ ] Add identity, facility, contact and permittee summary.
- [ ] Add brand and category portfolio.
- [ ] Add model portfolio, status and expiry measures.
- [ ] Add QR requested, paid, generated, bound, unused and voided measures.
- [ ] Add quarterly production and annual reconciliation measures.
- [ ] Add fees, deposits, payments, credits and outstanding balances.
- [ ] Add discrepancies, overdue work and compliance events.
- [ ] Add communications and complete audit timeline.
- [ ] Add drill-down from every measure to source records.
- [ ] Add scoped BEE, designated-agency and manufacturer views.
- [ ] Add date, category, brand and model filters.
- [ ] Add CSV and Excel exports that reconcile to screen totals.
- [ ] Run isolation, drill-down, calculation and export tests.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP8.

#### WP8 completion evidence

| Evidence | Result or link |
|---|---|
| Read-model design | Pending |
| API contract version | Pending |
| Calculation tests | Pending |
| Role and isolation tests | Pending |
| Export proof | Pending |
| Live check | Pending |
| Full gate | Pending |
| Review | Pending |

#### WP8 acceptance

- [ ] BEE can drill from every total to the exact source records.
- [ ] Manufacturers see only their organisation.
- [ ] Designated agencies see only assigned records.
- [ ] Counts and amounts match registration, model, QR, production and fee ledgers.
- [ ] CSV and Excel exports match the filtered screen totals.

---

### WP9 Renewal withdrawal and cancellation

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R6 |
| Depends on | WP3, WP4, WP5 and WP7 |
| Manual references | Sections 3.5–3.9 and Annexure 4, pages 25–28 and 58 |
| Existing foundation | Certificate/register revocation and two-person decisions provide reusable patterns; renewal and applicant withdrawal are not built |
| Next action | Define renewal, withdrawal and cancellation states and authority matrix |

**Outcome:** the complete post-approval registration lifecycle.

#### WP9 checklist

- [ ] Add expiry alerts and renewal readiness.
- [ ] Add production and fee clearance checks.
- [ ] Add Annexure 4 self-declaration for revised label series.
- [ ] Build renewal draft, submit, scrutiny, recommendation and decision.
- [ ] Handle revised technical standards requiring a fresh application.
- [ ] Build manufacturer withdrawal request and model/category selection.
- [ ] Add financial clearance and security-deposit refund case.
- [ ] Add withdrawal approval or rejection and public-status effects.
- [ ] Build show-cause notice and manufacturer response.
- [ ] Add corrective-action evidence.
- [ ] Build cancellation proposal, recommendation and Secretary decision.
- [ ] Add deposit recovery or forfeiture events.
- [ ] Block new QR and update verification after withdrawal/cancellation.
- [ ] Link a corrective fresh application to the cancelled registration.
- [ ] Prove segregation, dues, effective-date and history rules.
- [ ] Run renewal, withdrawal and cancellation live journeys.
- [ ] Create evidence note and backlog updates.
- [ ] Run the required full gate and accept WP9.

#### WP9 completion evidence

| Evidence | Result or link |
|---|---|
| State and authority design | Pending |
| Migration range | Pending |
| Contract version | Pending |
| Backend tests | Pending |
| Portal tests | Pending |
| Live checks | Pending |
| Full gate | Pending |
| Review | Pending |

#### WP9 acceptance

- [ ] A compliant registration renews after reporting and fee clearance.
- [ ] A manufacturer cannot withdraw while dues remain.
- [ ] Approved withdrawal updates model, QR and public status consistently.
- [ ] Cancellation records notice, response, evidence and segregated decisions.
- [ ] A fresh application can cite corrective measures after cancellation.

---

### WP10 Production readiness

| Tracking field | Current value |
|---|---|
| Status | Not started |
| Progress | 0% |
| Target release | R7 |
| Depends on | WP2–WP9 and approved production architecture |
| Manual references | Cross-cutting implementation controls supporting the complete manual lifecycle |
| Existing foundation | Local Docker runtime, Keycloak, PostgreSQL, Spring, Next.js, automated gate and demo integrations |
| Next action | Create the production architecture and non-functional requirement baseline |

**Outcome:** a deployable and operable production service.

#### WP10 checklist

- [ ] Confirm production architecture, environments and responsibility model.
- [ ] Integrate the approved identity provider and MFA.
- [ ] Integrate the approved payment gateway.
- [ ] Integrate approved email and SMS providers.
- [ ] Add production object storage, antivirus scanning and retention.
- [ ] Add secrets management, TLS and certificate rotation.
- [ ] Complete responsive and accessibility remediation.
- [ ] Add application, infrastructure and business monitoring.
- [ ] Add alerting, runbooks and support procedures.
- [ ] Prove backup, restore and disaster recovery.
- [ ] Complete threat model, security review and penetration test.
- [ ] Build data migration, validation, reconciliation and rollback.
- [ ] Run volume, performance, endurance and failure-recovery tests.
- [ ] Complete privacy, retention and audit-log review.
- [ ] Complete operational training and release readiness review.
- [ ] Run the production release gate and accept WP10.

#### WP10 completion evidence

| Evidence | Result or link |
|---|---|
| Architecture approval | Pending |
| Security assessment | Pending |
| Penetration test | Pending |
| Accessibility audit | Pending |
| Migration rehearsal | Pending |
| Backup and recovery test | Pending |
| Performance report | Pending |
| Operational readiness review | Pending |
| Production gate | Pending |

#### WP10 acceptance

- [ ] Security, privacy and accessibility findings are resolved or formally accepted.
- [ ] Migration and rollback reconcile all control totals.
- [ ] Backup and disaster-recovery objectives are proven.
- [ ] Monitoring and support procedures are exercised.
- [ ] Performance tests meet approved volume and response-time targets.
- [ ] Production deployment receives formal authorization.

### 6.1 Work package update log

Add one row whenever a package status or material result changes.

| Date | WP | Previous status | New status | Result | Evidence or next action |
|---|---|---|---|---|---|
| 18 Oct 2026 | WP1 | In progress | Gate pending (90%) | WP01 baseline + Brief 17A review corrections; BL-252/256; live form not fetched (504) | ChatGPT WP1 acceptance; BL-252; then WP2 |
| 18 Oct 2026 | WP1 | Gate pending (90%) | Complete (100%) | ChatGPT accepted the PDF-backed provisional baseline; A01–A20 remain provisional | Begin WP2; retry secondary live-form comparison in WP3 (BL-252) |
| 18 Oct 2026 | WP2 | Not started | In progress (5%) | Brief 18 prepared for common workflow persistence and working-day SLA foundation | Cursor implements WP2A; ChatGPT reviews evidence before journey wiring |

### 6.2 Standard completion record

Copy this block into the applicable package when it reaches Gate pending or Complete.

```text
Status:
Progress:
Started:
Completed:
Branch:
Commit:
Pull request:
Manual sections covered:
Assumptions applied or changed:
Migrations:
Contract version:
Automated tests:
Live checks:
Full gate:
Review result:
Open backlog items:
Accepted by and date:
```

## 7. Route promotion from the current demo

The following demonstrated modules should be promoted into the formal API rather than rebuilt:

| Module | Direction |
|---|---|
| Payments | Keep interaction model; replace simulated gateway with provider adapter and formal contract |
| QR batches and serials | Promote with prepaid-fee and lifecycle controls |
| Production | Promote with label-fee ledger and annual reconciliation |
| MIS and executive dashboards | Reuse components and replace demo reads with formal reporting APIs |
| Public verification | Reuse and extend for QR serial status |
| Messages | Already promoted; connect approved delivery providers later |
| Simulated ledger | Keep only for demonstrations until the real ledger decision is implemented |
| AI demonstrations | Keep outside the core registration and compliance release |

## 8. Release schedule

| Release | Scope | Status | Estimate | Exit condition |
|---|---|---|---:|---|
| R0 | WP1 policy baseline and traceability | In progress | 1–2 weeks | Assumptions, states, roles and field dictionaries approved as implementation defaults |
| R1 | WP2 common workflow and SLA | Not started | 2 weeks | Shared return/respond/decide journey proven |
| R2 | WP3 entity, brand and category registration and WP5 foundation | Not started | 3 weeks | Permittee approved after a return and response |
| R3 | WP4 model registration and WP5 core payment | Not started | 3–4 weeks | Clean model approved within target flow |
| R4 | WP6 QR requisition and serial register | Not started | 3 weeks | Paid batch generated, distributed, bound and verified |
| R5 | WP7 production and fee reconciliation | Not started | 3–4 weeks | Quarterly and annual reconciliation proven |
| R6 | WP8 Manufacturer 360 and WP9 post-approval lifecycle | Not started | 3–4 weeks | Full manufacturer record and renewal/withdrawal/cancellation proven |
| R7 | WP10 production readiness | Not started | 3–5 weeks | Security, operations, migration and production gate passed |

Estimated functional build: **16–20 weeks**. External approvals, integrations, migration and production assurance may extend the calendar.

## 9. Team workflow

ChatGPT owns backend, database migrations, OpenAPI, security policy, integration, audit, automated gates and review. Cursor receives bounded frontend briefs for wizards, queues, record pages and dashboards. Only one tool holds the shared repository baton at a time.

Each work package must include:

- source traceability;
- decision/assumption updates;
- database and API changes;
- portal changes;
- automated unit, contract, database and UI tests;
- a live end-to-end check;
- evidence note and backlog entries;
- full gate on the final commit before merge.

After each accepted change, update both the package checklist and the dashboard at the top of this file. Record test totals and links in the package evidence table rather than only in chat or commit messages.

## 10. Global definition of done

The implementation is complete when:

1. A manufacturer registers its entity, brand and appliance category.
2. Payment and security deposit are recorded.
3. BEE returns a structured request and the manufacturer responds.
4. BEE approves or rejects the registration.
5. The manufacturer files a model with category-specific evidence.
6. Technical scrutiny, recommendation and final approval are completed.
7. The manufacturer pays for and receives unique QR serials.
8. QR serials are bound to production and publicly verifiable.
9. Quarterly production and label fees reconcile.
10. Annual CA-certified reconciliation is recorded.
11. Renewal, withdrawal and cancellation work end to end.
12. Manufacturer 360 reconciles identity, registrations, models, QR, production, money and compliance.
13. Every record is role-scoped, auditable, versioned and covered by the release gate.

## 11. Manual traceability index

| Manual section | Printed pages | Implemented by |
|---|---:|---|
| 1.3.5 Permittee obligations | 15–16 | WP6, WP7, WP8, WP9 |
| 3 General participation requirements | 22 | WP1, WP2, WP3, WP4 |
| 3.1.1 Company Registration | 22–23 | WP3 |
| 3.1.2 Appliance category Registration | 23 | WP3 |
| 3.1.3 Model Registration | 23–24 | WP4 |
| 3.2 Scrutiny | 24 | WP2, WP4 |
| 3.3 Approval | 24 | WP2, WP4 |
| 3.4 Rejection and Holding | 24–25 | WP2, WP3, WP4 |
| 3.5 Model Renewal | 25–26 | WP9 |
| 3.6 Voluntary Agreement Renewal | 26 | WP9 |
| 3.7 Withdrawal | 27 | WP9 |
| 3.8 Cancellation | 27–28 | WP9 |
| 3.9 Fresh Application | 28 | WP9 |
| 3.10 Processing Timelines | 28–30 | WP2 |
| 4.1 Company Registration Fee | 30–31 | WP3, WP5 |
| 4.2 Label Security Deposit | 31 | WP3, WP5 |
| 4.3 Label Permission Fee | 31 | WP4, WP5 |
| 4.4 Renewal Fee | 32 | WP9 |
| 4.5 Label Fee and QR Prepayment | 32 | WP5, WP6, WP7 |
| 5 and 5.1 Label and QR display | 33–35 | WP6 |
| Annexure 1 Company Registration Form | 50–53 | WP3 |
| Annexure 2 Voluntary Agreement | 54–55 | WP3, WP9 |
| Annexure 3 Model Registration Form | 56–57 | WP4 |
| Annexure 4 Self Declaration | 58 | WP9 |
