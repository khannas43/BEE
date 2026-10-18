# S&L solution blueprint requirement catalogue

**Source:** 13-page S&L solution blueprint (`bee1_merged_compressed.pdf`)  
**Reviewed:** 18 October 2026  
**Purpose:** capture every material point shown in the blueprint and assign it to the implementation strategy  
**Authority:** supplementary design input; subordinate to the governing manual, official notifications and confirmed BEE decisions

## Classification

- **Core:** part of the planned authoritative portal journey.
- **Conditional:** implement only after the stated policy, provider, privacy, security or contractual decision.
- **Reference:** source/version-control obligation rather than a portal feature.
- **Demonstration only:** an existing prototype that is not production evidence.

Status in this catalogue means strategy coverage, not completed software.

## Page 1 - wireframe map

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-001 | Applicant persona includes manufacturer, importer and brand owner | Core | WP3 identity/applicant-type master and authorization rules |
| BP-002 | BEE officer persona is the S&L scrutiny team | Core | WP2 roles, assignments and work queues |
| BP-003 | Consumer/retailer verification is available to anyone with a phone | Core | WP6 public verification; responsive/accessibility gate in WP10 |
| BP-004 | Applicant path is Dashboard -> Company & brand -> Documents -> Model & test report -> Secure QR batch | Core | WP3, WP4, WP5 and WP6 release sequence |
| BP-005 | Model submission enters the BEE scrutiny workbench | Core | WP2/WP4 integration |
| BP-006 | Approval/document/batch hashes may be sent to an integrity anchor before public proof | Conditional | A25; provider-neutral anchor, never a core approval dependency |
| BP-007 | Queries and approvals return to the applicant dashboard | Core | WP2 notification/task projection and WP8 applicant action dashboard |

## Page 2 - A1 applicant dashboard

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-008 | Dashboard shows company/permittee identity | Core | WP3 master plus WP8 projection |
| BP-009 | Status cards show approved models, under-scrutiny/open files, open queries and QR issued | Core | WP8 read model; source totals must reconcile |
| BP-010 | Alerts cover certificate/document expiry, rule changes and query deadlines | Core | WP2 SLA, WP3/WP4 expiry, WP9 renewal; notification rules effective-dated |
| BP-011 | One tracker lists every application/QR batch with current status and update time | Core | WP2/19D projection and WP8 applicant view |
| BP-012 | Applicant can start a model application or QR batch from the dashboard | Core | WP4/WP6 route actions with eligibility checks |
| BP-013 | Navigation exposes company profile, brands/facilities, models, secure QR, queries, payments and help/manuals | Core | WP3-WP8 information architecture; role-scoped routes |

## Page 3 - A2 company and brand registration

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-014 | Six guided steps: account, company details, signatory, facilities/brands, documents, fee/submit | Core | WP3 wizard; exact grouping may adapt to official form |
| BP-015 | Progress remains visible and drafts autosave | Core | WP3 draft/version APIs and wizard |
| BP-016 | Company fields include legal name, constitution, CIN, PAN, GSTIN, IEC where applicable, registered address, state and PIN | Core | WP3 field dictionary; official-form comparison BL-252 |
| BP-017 | CIN/PAN/GSTIN may be fetched/verified against government sources rather than retyped | Conditional | A23/BL-258; adapters, consent, evidence and manual fallback |
| BP-018 | Readiness/completeness score shows whether the application can be submitted | Core | WP3 deterministic checklist; score must not imply approval |
| BP-019 | Mismatch flags compare official-source and entered values | Conditional | A23; structured evidence and applicant/officer resolution |
| BP-020 | Expiry flags warn about expiring facility evidence | Core | WP3 document-expiry rules and dashboard alerts |
| BP-021 | Missing-document flags identify absent brand-use authorization and similar requirements | Core | WP3 effective-dated document requirements |
| BP-022 | Every issue is written in plain language with a “how to fix” action | Core | WP3 UX/content acceptance criterion |

## Page 4 - A3 documents with AI verification

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-023 | Multi-file drag/drop upload with file-type detection | Core | WP3 document intake; accessibility alternative required |
| BP-024 | Example constraint is signed/stamped PDF up to 10 MB | Conditional | File types/sizes are configurable; official decision overrides the example |
| BP-025 | Document set includes incorporation, PAN, GST, facility ISO and trademark/brand evidence | Core | WP3 document requirement versions; exact list remains official-source driven |
| BP-026 | Each file receives verification/variant/expiry/mismatch status | Core + conditional automation | Deterministic checks in WP3; OCR/AI under A22 |
| BP-027 | Evidence view compares each extracted field with the form and explains the result | Conditional | A22/BL-259; source page/field, confidence and human confirmation required |
| BP-028 | Documents retain SHA-256 fingerprints | Core | WP3 document model and immutable version history |
| BP-029 | Document hashes may be anchored at approval | Conditional | A25; optional integrity anchor, no file/personal data outside portal |

## Page 5 - A4 model registration and test report

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-030 | Four steps: product, test report, label, review/pay | Core | WP4 wizard plus WP5 payment |
| BP-031 | Test report records laboratory, standard and test date | Core | WP4 Annexure/category schema |
| BP-032 | Laboratory accreditation, scope and report-age rules are checked | Core rules, conditional source | WP4 deterministic validation; authoritative lab source under A23 |
| BP-033 | Blueprint example uses a 90-day report-age limit | Conditional / not adopted | A29; no hard-coded 90-day rule without official approval |
| BP-034 | Declared and measured values are stored and compared per parameter/tolerance | Core | WP4 effective-dated parameter and tolerance schema |
| BP-035 | Star rating is computed and compared with the declared rating | Core when formula approved | WP4 rating engine; no unapproved formula may be called official |
| BP-036 | Rating uses an effective label-period/star-band table | Core | WP4 effective-dated rules with immutable applied version |
| BP-037 | Test-report values may be extracted automatically | Conditional | A22/BL-259; officer confirms source evidence |
| BP-038 | Unusual results are flagged against history and routed to an officer, never auto-approved | Conditional assistance | WP4/WP7 anomaly evidence; human decision mandatory |

## Page 6 - B1 BEE officer scrutiny workbench

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-039 | Queue is sortable by risk and deadline, with high-risk/near-due work first | Core | WP2/19D explainable queue projection |
| BP-040 | Case header shows submission date, target and time remaining | Core | WP2 pinned SLA and working-day calculations |
| BP-041 | Officer sees a concise case summary with evidence citations | Core summary; conditional AI | Deterministic projection first; AI summary under A22 |
| BP-042 | Checks are grouped as passed, warning and failed with drill-down evidence | Core | WP2/WP4 read model and evidence links |
| BP-043 | AI may draft a query from findings | Conditional | A22; officer edits and explicitly sends; prompt/model/evidence recorded |
| BP-044 | Draft can be edited or regenerated | Conditional | Governed co-pilot UX; every generated version auditable |
| BP-045 | Officer actions include reject, raise query and approve/forward as authorized | Core | WP2 transition policy and segregation of duties |
| BP-046 | Approval, rejection or suspension hashes may be anchored | Conditional | A25; status remains authoritative in portal DB |

## Page 7 - A5 secure QR batch

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-047 | QR request selects an approved model | Core | WP6 active-model eligibility |
| BP-048 | Batch records production lot, plant and quantity | Core | A27; WP6 schema |
| BP-049 | Label fee is calculated from quantity and paid before issue | Core | WP5/WP6, subject to effective fee rules and A10 |
| BP-050 | Blueprint proposes one batch per production lot | Conditional decision | A27/BL-258; do not enforce until confirmed |
| BP-051 | Batch list shows model, quantity, used quantity, status and optional anchor transaction | Core plus conditional anchor | WP6 projection; anchor field nullable/provider-neutral |
| BP-052 | Statuses include generated, in use, closed and clone-warning/exception state | Core lifecycle plus advisory risk | WP6; clone warning does not change legal status automatically |
| BP-053 | Each unit has an opaque unit ID and signed verification URL | Core design | A26; final format/security decision required before production |
| BP-054 | One Merkle root may be anchored per batch rather than one ledger write per unit | Conditional | A25; optional integrity-anchor adapter |
| BP-055 | Small runs can download a print-ready PDF | Core | WP6 secure audited download |
| BP-056 | Line printers can use authenticated API or CSV feed | Core | WP6 bulk delivery, scope/rate limits and download audit |

## Page 8 - C1 consumer scan and verify

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-057 | Offline signature check distinguishes a BEE-signed payload from an unknown code | Core production target | A26/WP6 key lifecycle and verification library |
| BP-058 | Online lookup combines registry status and optional integrity proof | Core registry; conditional anchor | Portal status remains authoritative |
| BP-059 | Genuine result shows brand, model/product, stars, energy figure, registration number, validity and unit ID | Core | WP6 public-field decision and privacy review |
| BP-060 | Warning result identifies suspicious repeated/geographically distant scans | Conditional | A28; privacy-approved coarse telemetry and explainable threshold |
| BP-061 | Invalid result states that the code was not issued by BEE | Core | WP6 enumeration-safe public response |
| BP-062 | Genuine purchaser may register a purchase | Conditional | A28/BL-260; purpose, consent, retention and access decisions |
| BP-063 | User may report a suspect label | Conditional but recommended | WP6/WP10 abuse controls and investigation workflow |
| BP-064 | Suspect report may include a label photograph | Conditional | A28; malware/content/privacy/retention controls |

## Page 9 - where AI adds value

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-065 | Document OCR/cross-match covers names, PAN, GSTIN, signatures, stamps and expiry | Conditional | A22/A23; WP3 + WP10 governance |
| BP-066 | Test-report extraction covers measured values, lab scope, report age and rating inputs | Conditional | WP4; official rules remain deterministic |
| BP-067 | Anomaly scoring identifies implausible results and reused reports | Conditional | WP4/WP7; evidence-backed risk only |
| BP-068 | Officer co-pilot summarizes files and drafts queries from findings | Conditional | WP2/WP4; human confirmation mandatory |
| BP-069 | Applicant assistant answers questions on schedules, documents and fees | Conditional | Retrieval only from approved/versioned content with citations and escalation |
| BP-070 | Market intelligence supports clone detection and risk-based check-testing selection | Conditional | WP6/WP7/WP10; no automatic enforcement |

## Page 10 - blockchain and secure QR design

| ID | Captured point | Class | Owner / treatment |
|---|---|---|---|
| BP-071 | Portal database retains records and files as the system of record | Core | A25 |
| BP-072 | Only SHA-256 hashes/Merkle roots move to an external integrity layer | Conditional | A25; cryptographic agility allowed |
| BP-073 | Integrity layer is permissioned and exposes proof through a verification API | Conditional | Provider/network/governance decision required |
| BP-074 | QR payload contains a verification URL, unit identifier and signature | Core design | A26/WP6 |
| BP-075 | Blueprint example uses a 16-character batch+sequence unit ID | Conditional format | Security/capacity analysis decides final opaque format |
| BP-076 | Signature covers at least unit ID and registration number | Conditional cryptographic design | Threat model decides canonical payload and context binding |
| BP-077 | Blueprint suggests Ed25519 or ECDSA | Conditional algorithm | WP10 security decision; do not hard-code from blueprint alone |
| BP-078 | Approval, lab-report and status-change hashes are candidate anchor events | Conditional | A25 event policy |
| BP-079 | One external write per QR batch is preferred over per-unit writes | Conditional | Batch-root design if anchoring is approved |
| BP-080 | Verification works offline for signature and online for registry/integrity status | Core plus conditional proof | WP6 degradation/fallback tests |
| BP-081 | Frequent or geographically distant scans produce a risk flag | Conditional | A28 privacy and risk-policy decision |
| BP-082 | No personal data is placed on-chain; DPDP controls apply | Mandatory if anchoring/scans enabled | WP10 privacy assessment |

## Page 11 - conceptual data model

| ID | Captured entity or link | Class | Owner / treatment |
|---|---|---|---|
| BP-083 | `organisation`: PAN, GSTIN, CIN and status | Core | WP3 legal-entity master |
| BP-084 | `signatory`: name and e-sign reference | Core record; conditional e-sign | WP3/A24 |
| BP-085 | `facility`: ISO 9001 and BIS evidence | Core | WP3 facilities/documents |
| BP-086 | `brand`: trademark number and owner | Core | WP3 brand master |
| BP-087 | `lab`: NABL identifier and accreditation scope | Core master; conditional authoritative source | WP4/A23 |
| BP-088 | `product_category`: star-band table and technical schema | Core | WP3/WP4 effective-dated master |
| BP-089 | `model`: rated parameters, star and registration number | Core | WP4 |
| BP-090 | `test_report`: measured values and computed rating | Core | WP4; computed rating requires approved formula |
| BP-091 | `label_permission`: validity and optional anchor reference | Core plus conditional anchor | WP4/WP9/A25 |
| BP-092 | `surveillance_test`: result and action | Core future compliance record | WP7/WP9; detailed process requires official rules |
| BP-093 | `application`: type, status and assigned officer | Core | WP2 common workflow |
| BP-094 | `document`: file URI, SHA-256 and OCR evidence | Core plus conditional OCR | WP3/WP4/A22 |
| BP-095 | `ai_check`: rule, severity and override | Conditional but schema-ready | BL-259; version/confidence/evidence also required |
| BP-096 | `query`: AI draft and applicant response | Core response; conditional draft | WP2/A22 |
| BP-097 | `qr_batch`: lot, quantity and optional Merkle root | Core plus conditional anchor | WP6/A25/A27 |
| BP-098 | `unit_qr`: unit ID, serial and signature | Core | WP6/A26 |
| BP-099 | `scan/sale_event`: unit, time and coarse geographic cell | Conditional | A28 privacy decision |
| BP-100 | `chain_anchor`: hash, transaction and block reference | Conditional | A25 provider-neutral integrity reference |
| BP-101 | Key relationship: organisation -> facility | Core | WP3 |
| BP-102 | Key relationship: brand -> model -> test report | Core | WP3/WP4 |
| BP-103 | Key relationship: label permission -> QR batch -> unit QR -> events | Core, with conditional events | WP4/WP6 |
| BP-104 | Approvals and batches may reference integrity anchors | Conditional | A25 |

## Page 12 - templates and formats

| ID | Captured template/format | Class | Owner / treatment |
|---|---|---|---|
| BP-105 | Online company registration form becomes a generated PDF and may be e-signed | Core generation; conditional e-sign | WP3/A24 |
| BP-106 | BEE-format covering letter is generated from company/model data | Core after official template obtained | WP3/WP4 template service |
| BP-107 | Clarification covering letter is replaced by a structured query-response screen | Core | WP2 discrepancy/response UX |
| BP-108 | Online model registration form is category-driven | Core | WP4 schema/template service |
| BP-109 | BEE-format test report is uploaded by the lab and stored with signed hash/evidence | Core upload; conditional signature validation | WP4/A24 |
| BP-110 | Specimen star label is auto-built from approved data | Core after official artwork/rules obtained | WP4/WP6 |
| BP-111 | Authorization letter uses a template and may be e-signed | Core template; conditional e-sign | WP3/A24 |
| BP-112 | Undertaking/declaration may use click-through plus e-sign | Conditional | WP3/WP9; legal acceptance decision required |
| BP-113 | Secure QR PDF supports batch download and API delivery | Core | WP6 |
| BP-114 | Current blank formats must be downloaded/versioned because regulations and label periods change | Reference control | WP3/WP4/WP9 template/version registry |

## Page 13 - template and authority sources

| ID | Captured source | Class | Owner / treatment |
|---|---|---|---|
| BP-115 | BEE Important Instructions PDF for document order and covering-letter formats | Reference | Retrieve, hash, date and review before implementation |
| BP-116 | Authenticated BEE Star Label portal for company/model forms, undertakings, authorization and QR PDFs | Reference | BL-252/BL-258; authorized access and version capture required |
| BP-117 | Gazette of India for label specimens and product schedules | Governing/reference | WP1/WP4 effective-dated source registry |
| BP-118 | Draft Appliance Labelling Regulations 2025 copy linked through TUV | Reference only | Draft must never override final Gazette/official notification |
| BP-119 | S&L programme overview/schedules linked through an external policy repository | Secondary reference | Validate against BEE originals before use |
| BP-120 | BEE QR information page | Secondary reference | WP6 discovery; official technical specification still required |
| BP-121 | Direct public links to individual blank forms were not found | Known limitation | Keep BL-252 open; do not claim template conformity until current versions are obtained |

### URLs printed in the blueprint

These addresses are transcribed from page 13 and are **not** treated as verified or current merely because they appear in the blueprint:

| Source | URL shown in PDF |
|---|---|
| BEE Important Instructions | `https://beeindia.gov.in/sites/default/files/Important%20Instructions.pdf` |
| BEE Star Label portal | `https://www.beestarlabel.com` |
| Gazette of India | `https://egazette.gov.in` |
| Draft Appliance Labelling Regulations 2025 copy | `https://www.tuv.com/content-media-files/master-content/rs/Attachments%5C47685%20draft%20regulations.pdf` |
| S&L programme summary | `https://policy.asiapacificenergy.org/sites/default/files/Standards%20%26%20Labelling%20%28S%26L%29%20Programme.pdf` |
| BEE QR page | `https://beeindia.gov.in/en/node/38059` |

## Coverage control

Every blueprint implementation brief must list the applicable `BP-###` identifiers. A row is closed only when it has one of these recorded outcomes:

1. implemented and accepted with evidence;
2. superseded by a named official source or BEE decision;
3. explicitly deferred with owner and prerequisite;
4. rejected by an owner/BEE decision with rationale.

No conditional item becomes a core release blocker merely because it appears in the blueprint. Conversely, no item may disappear silently: conditional and reference items remain visible until formally resolved.
