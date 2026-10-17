# SNL WP01 — state models

**Status:** Working baseline comparing manual lifecycle language to portal states.  
**Governing source:** *SnL Disha Advisory Manual* (printed footer pages).  
**Related:** [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md)

## 1. Registration (brand / agency)

### 1.1 Manual language (entity / brand)

| Manual stage | Reference | Notes |
|---|---|---|
| Apply online with documents | §3.1.1 (pp. 22–23) | Each brand separate; permittee number after scrutiny |
| Scrutiny / incompleteness | §3.2 (p. 24); Table 2 (p. 28) | Communicate discrepancies; **7 days** narrative vs **12 days** in Table 2 — **conflict** (A08) |
| Put on hold | §3.4 (pp. 24–25) | Applicant must respond via portal |
| Rejection | §3.4 (p. 25) | If not corrected |
| Cancellation if no response | Table 2 row 6 (p. 28) | **60 days** from receipt if incomplete and no response |
| Approval / registration | §3.1.1 (p. 22) | Active permittee obligations §1.3.5 |

Category registration (§3.1.2, p. 23) and security deposit (§4.2, pp. 30–31) have **no** portal state machine yet.

### 1.2 Portal states (evidence)

Typical registration application statuses in contract/UI flow: `draft` → `submitted` → `fee_due` → (fee confirmed) → `under_review` → `returned` (applicant) / `approved` / `rejected`; registered artefacts on approve (`brand` or agency authorisation).

| Portal state | Manual analogue | Gap |
|---|---|---|
| `draft` | Preparation before online submit | None |
| `submitted` / `fee_due` | Application received | Partial — fee before scrutiny vs manual payment timing (A16) |
| `under_review` | Scrutiny | Partial — no named “designated agency” for brand |
| `returned` | On hold / discrepancy | Partial — not multi-line discrepancy list (WP2) |
| `approved` | Registered permittee | Partial — permittee number not modeled |
| `rejected` | Rejection §3.4 | None |
| *(missing)* | Auto-cancel 60 days | **Major** (WP2/WP9) |
| *(missing)* | Renewal §3.5–§3.6 | **Major** (WP9) |
| *(missing)* | Withdrawal §3.7 | **Major** (WP9) |
| *(missing)* | Cancellation §3.8 | **Major** (WP9) |

### 1.3 Suggested target states (WP3/WP2 — not implemented)

For traceability only: `registered_active`, `renewal_due`, `withdrawn`, `cancelled`, `suspended` with explicit transitions tied to §3.5–§3.8.

## 2. Model (appliance) registration

### 2.1 Manual language

| Stage | Reference |
|---|---|
| Application with Annexure 3 + test report | §3.1.3 (pp. 23–24) |
| Scrutiny for completeness | §3.2 (p. 24) |
| Discrepancy communication | §3.2 (p. 24); Table 3 **15 days** (p. 29) |
| Hold / reject | §3.4 (pp. 24–25) |
| Programme Director recommend → Secretary approve | §3.3 (p. 24) |
| Permission valid / label obligations | §5 (pp. 33–35) |

### 2.2 Portal states (evidence)

Model application pipeline includes document upload, fee, stages such as IAME review, reviewer, rating, director recommendation, secretary approval, certificate issuance; `returned` and resubmit paths exist.

| Portal stage cluster | Manual §3.3 | Gap |
|---|---|---|
| IAME / reviewer | §3.2 scrutiny | Partial — role naming |
| Director recommend | Programme Director recommend | **Aligns** intent |
| Secretary approve | Secretary approve | **Aligns** |
| Certificate issued | Model permission granted | Partial — Annexure 3 field parity |
| `returned` | Hold | Partial (A05) |
| *(missing)* | 60-day cancel (Table 3) | **Major** |

## 3. Fees and payment (cross-cutting)

| Manual | Portal |
|---|---|
| Pay on portal electronically (§4, p. 30) | Fee snapshot + Finance **manual** confirmation |
| Registration ₹5,000 (§4.1, p. 30) | Configurable rule |
| Model ₹5,000 (§4.3, p. 31) | Demo amounts may differ |
| Category deposit (§4.2) | Not implemented |
| Quarterly label fee + annual CA (§4.5, p. 32) | Demo production only |

**Target (WP5):** `fee_quoted` → `payment_pending` → `payment_settled` → `finance_posted` with optional manual override (A16).

## 4. QR and label lifecycle (manual vs demo)

| Manual | Demo / portal |
|---|---|
| Display QR with label §5(b) (p. 33) | Demo bind/export |
| Prepaid QR from 1 Apr 2027 (§4.5, p. 32) | Not linked to fee ledger |
| Void / replacement rules | Demo void — **promote** WP6 |

States (target): `batch_ordered` → `allocated` → `bound_to_unit` → `void` / `replaced`.

## 5. Production and compliance returns

| Manual | Demo |
|---|---|
| Quarterly production (§1.3.5(a), p. 15) | Quarterly rows in demo API |
| Label fee statement quarterly (§4.5, p. 32) | Partial in demo |
| Annual reconciliation + CA (§4.5, p. 32) | **Missing** |
| Retailer list by 30 April (§1.3.5(h), p. 15) | **Missing** |

## 6. Transition tables (selected)

Deadlines shown only where the manual states them. **Conflict:** discrepancy communication **7 working days** (§3.10 narrative, p. 28) vs **12** (Table 2, brand, p. 28) vs **15** (Table 3, model, p. 29) — use **A08** until BEE resolves.

### 6.1 Brand registration (portal today)

| From | To | Actor | Guard | Audit / evidence | Notification | Manual deadline |
|---|---|---|---|---|---|---|
| `draft` | `submitted` | Applicant | Required fields + documents per policy | Submit event | Portal (A18) | — |
| `submitted` | `fee_due` | System | Submit accepted | Fee snapshot created | Fee due message | Pay per §4 (p. 30) |
| `fee_due` | `under_review` | Finance | Payment confirmed (A16) | Fee confirmation | Applicant informed | — |
| `under_review` | `returned` | Programme | Discrepancy identified | Return reason | Portal §3.4 (pp. 24–25) | **7 vs 12 days — conflict** |
| `returned` | `under_review` | Applicant | Resubmission | Resubmit event | Officer queue | Applicant response; else cancel **60 days** Table 2 (p. 28) |
| `under_review` | `approved` | Director | Programme recommended | Approval decision | Registration outcome | Table 2 **45 days** processing (p. 28) |
| `under_review` | `rejected` | Director | Rejection grounds | Rejection decision | Portal | §3.4 (p. 25) |

### 6.2 Model registration (portal today)

| From | To | Actor | Guard | Audit | Notification | Manual deadline |
|---|---|---|---|---|---|---|
| `draft` | submitted/fee path | Applicant | Test report required (B1) | Submit | Portal | §3.1.3 (p. 23) |
| scrutiny stages | `returned` | IAME / reviewer | Incomplete | Return | Portal §3.2 (p. 24) | **15 days** Table 3 (p. 29) |
| `returned` | scrutiny | Applicant | Fixes uploaded | Resubmit | Portal | 60-day cancel Table 3 |
| director stage | secretary stage | Director | Recommend | Recommendation | — | §3.3 (p. 24) |
| secretary stage | certificate | Secretary | Approve | Approval + certificate | Applicant | §3.3 (p. 24); **60 days** Table 3 (p. 29) |

### 6.3 Manual-only outcomes (not in portal)

| Transition | Manual reference | WP |
|---|---|---:|
| Renewal agreement / registration renewal | §3.5–§3.6 (pp. 25–26) | WP9 |
| Withdrawal | §3.7 (p. 26) | WP9 |
| Cancellation | §3.8 (pp. 26–27) | WP9 |
| Fresh application after cancellation | §3.9 (p. 28) | WP9 |

## 7. Timeline / SLA states (WP2)

Manual Tables 2–3 (printed pp. 28–29) define processing day counts (e.g. brand registration **45 days**, model **60 days** from complete application). Portal has **no** SLA clock entity. **Assumption A09:** SLA measured from “complete application” timestamp once discrepancy cycle closes (A08).
