# SNL WP01 — traceability baseline

**Status:** Working baseline for R0 (WP1). Not BEE-approved policy.  
**Date:** 18 October 2026  
**Governing source:** *SnL Disha Advisory Manual* (`SnL_Disha_Advisory_Manual.pdf`, printed footer page numbers).  
**Plan:** [BEE_SNL_IMPLEMENTATION_PLAN.md](BEE_SNL_IMPLEMENTATION_PLAN.md)  
**Companion artifacts:** [SNL_WP01_ROLE_MATRIX.md](SNL_WP01_ROLE_MATRIX.md), [SNL_WP01_STATE_MODELS.md](SNL_WP01_STATE_MODELS.md), [SNL_WP01_FIELD_DICTIONARY.md](SNL_WP01_FIELD_DICTIONARY.md)

## 1. Source hierarchy and conflict handling

| Priority | Source | Use |
|---:|---|---|
| 1 | *SnL Disha Advisory Manual* (PDF) | Functional baseline for S&L participation, registration, fees, labels, QR display, timelines and annexure forms. Citations use the **printed footer page number** (extracted with `pdftotext -f N`; footer `N−1` on physical sheet `N` for most body pages — verified against §3 starting on printed p. 22 at sheet 23). |
| 2 | [BEE_SNL_IMPLEMENTATION_PLAN.md](BEE_SNL_IMPLEMENTATION_PLAN.md) | Approved working plan, release map and provisional assumptions **A01–A20**. |
| 3 | This repository (OpenAPI, migrations, screens, demo notes) | Evidence of what is implemented today. |
| 4 | https://www.beestarlabel.com/Manufacturer/AgencyRegistration | Secondary reference for fields on the live public registration UI only. **Not fetched successfully on 18 October 2026** (504 Gateway Timeout). Differences from the PDF must be recorded when the page is available; they do not override the manual. |

**Conflict rule:** If the manual and the live portal or this codebase disagree, the manual states the requirement; the portal or code records the **gap**; unresolved policy is captured as a **provisional assumption** (A01–A20) in [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) until BEE confirms. Demo-only behaviour is never treated as production policy.

**Known manual internal conflicts (flagged, not resolved here):**

- **Discrepancy communication deadline:** §3.10 narrative (printed p. 28) says discrepancies shall be communicated **within 7 working days** of receipt; Table 2 (brand registration, printed p. 28) gives **12 working days** for incompleteness/discrepancy communication; Table 3 (model registration, printed p. 29) gives **15 working days**. **Disposition:** assumption **A08** (seven working days as statutory ceiling until BEE resolves tables).
- **Entity approval roles:** §3.3 (printed p. 24) names **Programme Director recommendation** and **Secretary** final approval for **model** registration; §3.1.1–§3.1.2 do not name entity/brand/category approvers. **Disposition:** assumptions **A02–A03** for entity/brand/category (scrutiny officer or designated agency; Programme recommend; Director approve).
- **Hold vs return:** Manual uses “put on hold” for incomplete applications (§3.4, printed pp. 24–25) while the portal uses a **returned** state with applicant resubmission. **Disposition:** WP2 unified “discrepancy / return / response” (assumption **A05** for document sets).

## 2. Current implementation inventory

Evidence is from the documented contract (`docs/wp03/bee-local-api.openapi.json`), registration and model screens under `app/app/registrations/**` and `app/app/model-label/**`, and demonstration modules (`docs/demo/API.md`). Database objects are referenced by migration themes in repo docs, not re-listed here.

### 2.1 Entity, brand and agency registration

| Area | Current evidence | Manual expectation (summary) |
|---|---|---|
| Applicant filing | `POST /api/registrations`, draft edit, trade-licence PDF upload, submit → `fee_due`; screens `/app/registrations/*` | §3.1.1 company/brand (pp. 22–23), Annexure 1 (pp. 50–53); online signed/stamped documents (§3, p. 22) |
| Kind | `brand` (manufacturer) and `agency` (PixelCert-style authorisation to represent a brand) | Company per brand (§3.1.1); category registration separate (§3.1.2, p. 23); no separate “agency registration” chapter — **gap** |
| Fee | Registration fee snapshot + Finance **manual** confirmation (`POST …/fee-confirmation`); demo uses ₹5,000 and rule key `RAC:registration` in seeds | §4.1 ₹5,000 company registration (p. 30); §4.2 category security deposit (p. 31); electronic payment on portal (§4, p. 30) |
| Review | Programme recommend / return; Director approve / return / reject; applicant resubmit; register on approve | Model path §3.3 (p. 24); entity path **assumed** A02–A03 |
| Register | `brand` row or `agency_authorisation` on approve; revocation proposals on register screen | Permittee number after scrutiny (§3.1.1, p. 22) — **partial** (reference only) |

### 2.2 Model (appliance) approval

| Area | Current evidence | Manual expectation |
|---|---|---|
| Lifecycle | `POST /api/model-applications`, documents, fee, IAME → reviewer → rating → director → secretary → certificate; return/resubmit/reject | §3.1.3 (pp. 23–24), §3.2–§3.3 (pp. 24), Annexure 3 (pp. 56–57) |
| Category | RAC only in schema (owner assumption A4) | Multiple appliance categories in manual |
| Test report age | Configurable max age (BL-084 / business settings) | Not older than 3 years (5 for distribution transformers) — §3.1.3 (p. 23) |
| Approval authority | Secretary approves after Director recommendation | §3.3 (p. 24) — **aligns** |

### 2.3 Fees and payments

| Area | Current evidence | Manual expectation |
|---|---|---|
| Contract fees | Fee rules, tax line, Finance confirmation, corrections/reversals (OpenAPI) | §4.1–§4.5 (pp. 30–32) |
| Demo payments | `/api/demo/payments` simulated gateway, callbacks, reconciliation panel (`docs/demo/API.md`) | Electronic payment on S&L portal (§4, p. 30); **demo only** until WP5 |

### 2.4 QR codes and labels

| Area | Current evidence | Manual expectation |
|---|---|---|
| Demo QR | `/api/demo/qr` batches, allocate, bind, void, export; public serial check via demo stack | §5 (pp. 33–35): QR adjacent to star label; §4.5 prepaid QR from 1 Apr 2027 (p. 32) |
| Label PDF | Label preview download in demo script | Schedule C design rules (§5, p. 33) — **not validated** in portal |

### 2.5 Production and reconciliation

| Area | Current evidence | Manual expectation |
|---|---|---|
| Demo production | `/api/demo/production` quarterly rows, CA evidence fingerprint, programme review, QR reconciliation margin | §1.3.5 quarterly production (pp. 15–16); §4.5 quarterly label fee statement + annual CA certification (p. 32) |
| Annual reconciliation | Not in contract API | §4.5 (p. 32) — **gap** (WP7) |
| Retailer list by 30 April | Not implemented | §1.3.5(h) (p. 15) — **gap** (WP7) |

### 2.6 Messages, returns and notifications

| Area | Current evidence | Manual expectation |
|---|---|---|
| Portal messages | `GET/POST /api/messages` (promoted from demo, BL-229) | Portal communication (§3, §3.4); assumption **A18** for email/SMS |
| Structured discrepancies | Model/registration **return** with reason; not a multi-line discrepancy list | §3.2 communicate discrepancies via portal (p. 24) — **partial** (WP2) |

### 2.7 Public verification

| Area | Current evidence | Manual expectation |
|---|---|---|
| Certificate verify | `GET /api/public/verification` | Public trust in label/registration — implied §5 |
| QR serial verify | Demo public views + `/verify` in demo script | §5(b) QR display (p. 33) — **demo path** |

### 2.8 Manufacturer 360 and dashboards

| Area | Current evidence | Manual expectation |
|---|---|---|
| MIS / executive / auditor dashboards | `/api/demo/mis`, `/api/demo/dashboard/*` | Consolidated permittee view — **derived** (WP8); assumption **A14** |
| Register screen | `/app/registrations/register`, revocation proposals | Subset of “permittee record” |

## 3. Traceability matrix

**Legend — gap severity:** **Major** = no production path; **Partial** = demonstrated or contract path exists but manual scope not met; **None** = aligned or explicitly deferred to later WP.

| Capability | Current route / screen / data evidence | Manual requirement (section, printed pp.) | Gap | Target WP | Assumption |
|---|---|---|---|---:|---|
| Online participation & document discipline | Portal login; registration/model document upload | §3 (pp. 22); signed/stamped uploads | Partial — PDF discipline not enforced as “original” | WP3, WP4 | A19 |
| Company / legal entity master | Organisation row only; no entity application | §3.1.1 (pp. 22–23); Annexure 1 (pp. 50–53) | Major — no legal-entity application | WP3 | A01 |
| Brand registration (per brand) | `/api/registrations` kind `brand`; register → `brand` | §3.1.1 each brand separately (p. 22) | Partial — no permittee number workflow | WP3 | A01 |
| Appliance category registration | Not in API | §3.1.2 (p. 23); §4.2 deposit (p. 31) | Major | WP3, WP5 | A01, A07 |
| Agency / trader representation | kind `agency` + authorisation row | Manual focuses on manufacturer/importer/trader registration — agency path unclear | **Conflict / gap** — record as implementation pattern, not manual quote | WP3 | A01 |
| Model registration form & annexure fields | Model application + test report document | §3.1.3, Annexure 3 (pp. 23–24, 56–57) | Partial — Annexure 3 not fully mapped | WP4 | A05 |
| Model scrutiny (completeness) | IAME + reviewer stages | §3.2 designated agency/BEE (p. 24) | Partial — roles differ | WP2, WP4 | A02, A04 |
| Model approval chain | Director recommend → Secretary approve | §3.3 (p. 24) | None for authority chain | WP4 | A04 |
| Hold / reject / 60-day cancel | Return + reject; no auto-cancel job | §3.2 (p. 24), §3.4 (pp. 24–25), Table 2 row 6 (p. 28) | Partial — no 60-day cancellation automation | WP2, WP9 | A08, A17 |
| Company registration fee ₹5,000 | Registration fee snapshot (amount configurable) | §4.1 (p. 30) | Partial — key/rule differs from REG fee in tests | WP3, WP5 | A07 |
| Category security deposit | Not implemented | §4.2 (pp. 30–31) | Major | WP3, WP5 | A07 |
| Model permission fee ₹5,000 | Model fee rule (demo ₹10,000+tax in places) | §4.3 (p. 31) | Partial | WP4, WP5 | A07 |
| Label fee quarterly + annual CA | Demo production only | §4.5 (p. 32); §1.3.5(g) (p. 15) | Major | WP7 | A12, A13 |
| Prepaid QR label fee (Apr 2027) | Demo QR without formal fee link | §4.5 (p. 32) | Major | WP5, WP6 | A10, A11 |
| QR beside label; display rules | Demo QR + label preview | §5–§5.1 (pp. 33–35) | Partial — not production | WP6 | A11 |
| Quarterly production return | `/api/demo/production` | §1.3.5(a) (p. 15) | Partial — demo | WP7 | A12 |
| Retailer/dealer list by 30 Apr | None | §1.3.5(h) (p. 15) | Major | WP7 | — |
| Renewal / agreement renewal | Not in registration API | §3.5–§3.6 (pp. 25–26) | Major | WP9 | A15 |
| Withdrawal / cancellation | Register revocation demo; manual cancellation reasons not modeled | §3.7–§3.8 (pp. 26–27) | Major | WP9 | A15 |
| Fresh application after cancel | Not implemented | §3.9 (p. 28) | Major | WP9 | — |
| Processing timelines & SLA tables | Ad hoc dates in seeds; no SLA engine | §3.10, Tables 2–3 (pp. 28–29) | Major | WP2 | A08, A09, A17 |
| Finance auto-confirm on gateway success | Manual fee confirmation in contract | §4 electronic payment (p. 30) | Partial | WP5 | A16 |
| Manufacturer 360 | Demo MIS + dashboards | Derived from §1.3.5, §3, §4 | Major — no formal 360 API | WP8 | A14 |
| Public verification | `/api/public/verification` | Label/registration credibility §5 | Partial — QR serial via demo | WP6, WP9 | — |
| Portal notifications | `/api/messages` | §3.4 inform via portal (pp. 24–25) | Partial — delivery providers | WP2 | A18 |

## 4. Demo-only routes and data — disposition

From [docs/demo/API.md](../demo/API.md) and [BEE_SNL_IMPLEMENTATION_PLAN.md](BEE_SNL_IMPLEMENTATION_PLAN.md) §7.

| Module | Disposition for S&L production |
|---|---|
| `/api/demo/payments` | **Replace** with WP5 provider adapter; keep UX patterns (payer vs Finance, replay-safe callbacks). |
| `/api/demo/qr` | **Promote** to formal contract (WP6) with prepaid fee and A11 serial rules. |
| `/api/demo/production` | **Promote** with label-fee ledger and annual reconciliation (WP7). |
| `/api/demo/ledger` | **Remain demo** until real ledger decision (plan §7). |
| `/api/demo/mis`, `/api/demo/dashboard/*` | **Reuse UI**; back with formal reporting/360 APIs (WP8). |
| `/api/demo/ai` | **Out of scope** for core S&L compliance release. |
| `/api/messages` | **Keep** (promoted); extend with approved providers (A18). |
| Demo seed SQL (`local/seed/demo/*`) | **Not** source of truth for S&L policy; synthetic only. |

## 5. WP1 evidence note

- Manual sections listed in Brief 17 were extracted from the owner’s PDF on 18 October 2026 (`pdftotext`); printed footer pages cited in companion documents match footers in that extract.
- Public registration form was **not** retrieved; field dictionary marks portal comparison as pending (BL-252).
- Final WP1 **acceptance** and ChatGPT review remain open per [BEE_SNL_IMPLEMENTATION_PLAN.md](BEE_SNL_IMPLEMENTATION_PLAN.md).
