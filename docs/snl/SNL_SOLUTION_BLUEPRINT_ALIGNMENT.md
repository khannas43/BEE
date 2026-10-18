# S&L solution blueprint alignment

**Reviewed:** 18 October 2026  
**Reference:** `bee1_merged_compressed.pdf` (13-page solution blueprint)  
**Status:** Strategy baseline; the blueprint is a design input, not a governing BEE rule

**Complete requirement catalogue:** [SNL_SOLUTION_BLUEPRINT_REQUIREMENTS.md](SNL_SOLUTION_BLUEPRINT_REQUIREMENTS.md), containing BP-001 through BP-121.

## 1. Verdict

The implementation plan is aligned with the blueprint's principal journey:

1. applicant dashboard;
2. company, brand and facility registration;
3. document intake and verification;
4. model registration and test evidence;
5. BEE scrutiny, return, response and decision;
6. paid QR batches and unit records;
7. public verification.

The plan is **not yet fully aligned** with the blueprint's advanced automation and architecture. The material gaps are external government-record verification, production-grade OCR/AI evidence, generated and e-signed forms, cryptographically signed unit QR payloads, production-lot linkage, optional integrity anchoring, scan intelligence, purchase registration and suspect-label reporting.

These gaps change the implementation strategy but do not change the current WP2 sequence. The core transactional journey remains first. Advanced capabilities are introduced through governed adapters after the underlying records, permissions, audit events and manual fallbacks exist.

## 2. Source precedence

When sources conflict, use this order:

1. the governing S&L manual, Gazette notifications, official schedules and written BEE decisions;
2. owner-confirmed decisions recorded in `docs/BEE_DECISIONS.md`;
3. this solution blueprint as a target experience and architecture proposal;
4. existing demonstration behaviour.

The blueprint cannot create a statutory deadline, fee, approval authority, document requirement, rating formula or legal status. Every such value remains sourced from the manual or held as a configurable provisional assumption.

## 3. Page-by-page alignment

| PDF page | Blueprint commitment | Current plan | Alignment decision |
|---:|---|---|---|
| 1 | Seven-screen journey for applicant, BEE officer and consumer | WP2–WP8 cover the same end-to-end path | **Aligned.** Use as the experience map. |
| 2 | Applicant dashboard with status, applications, alerts and shortcuts | Existing dashboards plus WP8 Manufacturer 360 | **Partial.** Add an applicant action dashboard before the full 360 view. |
| 3 | Six-step company/brand wizard; MCA/GSTN lookups; completeness and issue guidance | WP3 wizard, legal entity master and document rules are planned | **Partial.** Add verification adapters, readiness scoring and manual fallback. |
| 4 | Multi-file document upload, extraction, field comparison, expiry checks and SHA-256 evidence | Document versioning, hashes, expiry and officer verification are planned | **Partial.** Add structured extraction/evidence as advisory automation; no automatic legal decision. |
| 5 | Test-report extraction, declared/measured tolerance, computed rating and anomaly flag | WP4 plans category schemas, lab/accreditation and rating; current AI/rating is demonstration-only | **Partial.** Deterministic rules first; AI extraction and anomaly scoring assist human review. |
| 6 | Risk-sorted scrutiny queue, evidence-linked summary, drafted query and anchored decision | WP2/19D queue and structured queries are planned | **Partial.** Risk sorting is explainable; AI summaries/drafts require provenance and officer confirmation; anchoring is optional. |
| 7 | QR batch per production lot, prepaid fee, signed codes, batch root, PDF/API/CSV | WP5/WP6 cover prepaid batches, unique serials, downloads, API and public verification | **Partial.** Add required model/plant/lot linkage and signed payload/key lifecycle; keep anchoring provider-neutral. |
| 8 | Genuine, clone-warning and invalid public results; report suspect label or register purchase | WP6 public status verification exists in plan | **Gap.** Add controlled scan telemetry, suspect-label reporting and optional purchase registration with privacy controls. |
| 9 | Six AI use cases with a human final decision | AI demonstrations exist but are outside the production core | **Adopt as optional governed assistance**, never autonomous approval/rejection. |
| 10 | Portal database as system of record; hashes/Merkle roots on ledger; no personal data on-chain | Current plan keeps the simulated ledger out of production pending a decision | **Aligned in principle.** Introduce a provider-neutral integrity-anchor interface only if approved. |
| 11 | Eighteen-domain conceptual data model | WP2–WP9 cover most entities | **Mostly aligned.** Add explicit AI-check provenance, QR scan/sale events and integrity-anchor references. |
| 12 | Portal-generated forms, letters, label and QR outputs; e-sign | WP3/WP4/WP6 generate some approval/label outputs; A19 defers e-sign | **Partial.** Add template/version service and generated PDFs; e-sign remains approval-dependent. |
| 13 | Official templates and formats sourced from portal/Gazette | WP1/BL-252 already records unavailable live-form comparison | **Aligned control.** Current official versions must be obtained and versioned before claiming conformity. |

## 4. Updated architecture strategy

### 4.1 Core records before automation

Build authoritative records and manual review paths first. An integration or AI failure must not corrupt, erase or silently approve a case. Every automated result is attached as evidence to a versioned source record.

### 4.2 External verification adapters

MCA, GSTN, PAN, IEC, NABL or similar checks use provider-neutral adapters with:

- source and request identifiers;
- response time and validity period;
- normalized verified fields plus retained source evidence where legally permitted;
- consent, purpose and access controls;
- timeout/retry state;
- manual verification fallback;
- no claim of verification when the source is unavailable.

### 4.3 AI-assisted evidence, not AI decisions

Every OCR, extraction, comparison, summary, draft or anomaly result records:

- source document/version and page/field evidence;
- rule, model and prompt/version identifiers where applicable;
- confidence and structured output;
- deterministic validations separately from probabilistic findings;
- officer confirmation, correction or override with reason;
- immutable audit history.

AI may prioritize or draft. It may not approve, reject, suspend, cancel, calculate an official rating from an unapproved formula, or overwrite authoritative applicant data without confirmation.

### 4.4 Generated documents and e-sign

Forms and letters are rendered from approved, effective-dated templates and immutable application snapshots. Each output records template version, content hash, generation time and signer/approval evidence. Uploaded signed/stamped documents remain the fallback until BEE confirms accepted e-sign mechanisms.

### 4.5 QR security and integrity anchoring

Each unit QR uses an opaque unit identifier and a versioned digital signature verified against managed BEE keys. The exact algorithm, payload length, rotation, revocation and offline-verification policy require a security decision before production.

The portal database remains the system of record. A separate `integrity_anchor` abstraction may hold approval hashes, document hashes, status-change hashes and one Merkle root per QR batch. No personal data or files are stored in the external anchor. A real blockchain is not required for the core release and the simulated ledger is never production evidence.

### 4.6 Scan intelligence and privacy

Public verification works without collecting unnecessary personal data. Scan telemetry, coarse location, purchase registration and label-photo reporting require purpose limitation, notice/consent where applicable, retention rules, abuse controls and role-scoped investigation access. Clone flags are risk indicators, not automatic enforcement decisions.

## 5. Revised delivery sequence

| Delivery stage | Required blueprint alignment | Deferred or conditional |
|---|---|---|
| WP2 / R1 | Structured return/response, work queue, SLA, risk-ready projection | AI summary and query drafting |
| WP3 / R2 | Six-step entity/brand/category wizard, autosave, readiness score, document expiry/mismatch workflow, generated registration snapshot | Live MCA/GSTN/PAN/IEC adapters and e-sign until access/legal approval |
| WP4 / R3 | Category-driven model form, structured declared/measured values, lab/accreditation/test-age rules, deterministic tolerance and rating calculation from approved rules | OCR/AI extraction and anomaly scoring until governance gate |
| WP5 / R2–R5 | Provider-neutral payments, prepaid QR fee and auditable ledger | Real gateway until provider onboarding |
| WP6 / R4 | Model/plant/lot-linked batch, signed opaque unit IDs, exact paid quantity, PDF/CSV/API delivery, three-state public verification | External integrity anchor, scan geolocation and purchase registration |
| WP7 / R5 | Production/QR/fee reconciliation and anomaly-ready data | AI anomaly prioritization |
| WP8 / R6 | Applicant action dashboard and Manufacturer 360 drill-down | Predictive risk beyond explainable configured rules |
| WP9 / R6 | Status changes propagated to QR verification and optional anchors | Automated enforcement |
| WP10 / R7 | AI governance, integration security, key management, privacy, retention, monitoring and fallback exercises | Production activation of any unapproved external provider |

## 6. Acceptance gates added by this review

- A government-source badge appears only with retained, current verification evidence; failure falls back visibly to manual review.
- AI output always identifies its evidence and version and requires a named human decision for consequential actions.
- Generated documents reproduce the approved template version and application snapshot exactly.
- QR generation cannot exceed paid quantity and every unit remains traceable to model, plant, lot and batch.
- Signature verification distinguishes genuine, unknown and revoked/invalid status without depending on an external anchor being online.
- Optional anchoring failure never creates a false approval; pending/retry/failure is explicit and reconcilable.
- Scan and purchase information respects approved privacy, consent, retention and access rules.

## 7. Decisions still required

1. Which government registries and providers BEE will authorize, and whether manual verification is acceptable when unavailable.
2. Whether production OCR/AI is in the contracted release, and the approved model hosting/data-residency policy.
3. Official rating formulas, tolerance rules, test-report formats and the blueprint's proposed 90-day rule.
4. Accepted e-sign/digital-signature mechanism and official template versions.
5. QR signing algorithm, key custody, rotation, payload size and offline-verification requirements.
6. Whether any external ledger/blockchain is required; if so, network, governance, participants and recovery rules.
7. Whether coarse scan location, purchase registration and label-photo reporting are approved, including retention and lawful-purpose rules.
8. Whether one batch per production lot is mandatory or a lot may receive multiple paid batches.

Until these are answered, the plan uses configurable interfaces and manual fallbacks and does not present the proposed behaviour as BEE policy.

## 8. Traceability rule

Every future brief that implements or changes a blueprint capability must cite its applicable `BP-###` identifiers from [SNL_SOLUTION_BLUEPRINT_REQUIREMENTS.md](SNL_SOLUTION_BLUEPRINT_REQUIREMENTS.md). Conditional items remain visible until implemented, superseded, deferred or rejected by a recorded decision.
