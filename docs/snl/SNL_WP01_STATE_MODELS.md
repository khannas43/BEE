# SNL WP01 — state models

**Status:** Working baseline — target transitions plus portal-as-built notes.
**Governing source:** *SnL Disha Advisory Manual* (printed footer pages).
**Related:** [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md), [SNL_WP01_ROLE_MATRIX.md](SNL_WP01_ROLE_MATRIX.md)

## 1. Manual 60-day outcomes (do not collapse)

| Source | Journey | Outcome wording | Printed pp. |
|---|---|---|---|
| §3.2 | Model scrutiny | No applicant action within 60 days → application **shall stand cancelled** | 24 |
| §3.4(a)–(b) | Brand / model | Failure to respond to discrepancies **within 60 days of notice** → may be **rejected**; same for fee dues | 25 |
| Table 2 row 5 | Brand on hold | Revised documents within **60 days** from hold notice; else **automatically cancelled**, payment returned | 29 |
| Table 3 row 5 | Model | Revised documents within **60 days** from communication — deadline only; table does **not** say auto-cancel | 30 |

**WP2 policy conflict (BL-256):** Implementations must not merge cancel (§3.2, Table 2 row 5) and reject (§3.4) into one silent outcome. Normalization is a **WP2 decision**, not resolved in WP1.

Other timeline conflicts (7 vs 12 vs 15 working days for discrepancy communication) remain **A08** / **BL-255**.

## 2. Portal as-built (summary)

Brand/agency registration today: `draft` → `submitted` → `fee_due` → `under_review` → `returned` / `approved` / `rejected` ([Existing implementation]). Category registration: **no states**. Model: multi-stage pipeline with `returned` and Secretary approval ([Existing implementation]).

## 3. Target — legal entity / company and brand registration

States include payment and exception paths. Later lifecycle rows point to **WP9** for build.

| From | To | Actor | Guard | Evidence / audit | Notification | Deadline (manual) | Basis |
|---|---|---|---|---|---|---|---|
| — | `draft` | Applicant | — | Create draft | — | — | **Assumption A01** (entity master) + **Manual** §3.1.1 |
| `draft` | `submitted` | Applicant | Required fields + document checklist | Submit event | Portal | — | **Manual** §3 (p. 22) |
| `submitted` | `payment_pending` | System | Fee assessed | Fee quote | Fee due | — | **Manual** §4.1 (p. 30) |
| `payment_pending` | `payment_settled` | Gateway / Finance | Successful payment | Payment receipt | Applicant | — | **Manual** §4 (p. 30); confirm **Assumption A16** |
| `payment_pending` | `payment_exception` | Finance | Failed / unmatched | Exception record | Finance queue | — | **Assumption A16** |
| `payment_settled` | `scrutiny` | System | Payment posted | Fee confirmation | Officer queue | — | **Existing implementation** |
| `scrutiny` | `returned` | Scrutiny officer / agency | Discrepancy | Structured return lines | Portal §3.4 | 12 days communicate (Table 2 row 4, p. 28) vs 7 days narrative §3.10 — **BL-255** | **Manual** + **Assumption A02** |
| `returned` | `applicant_response` | Applicant | Uploads / corrections | Response version | Portal | — | **Manual** §3.4 hold (pp. 24–25) |
| `applicant_response` | `scrutiny` | Applicant | Resubmit | Resubmit event | Officer | Table 2 row 5: **60 days** from hold notice (p. 29) | **Manual** |
| `returned` | `cancelled_auto` | System job | No resubmit within 60 days from hold notice | Cancel + refund event | Portal | Table 2 row 5 (p. 29) | **Manual** |
| `scrutiny` | `recommendation_pending` | Scrutiny officer / agency | Complete application | Scrutiny complete | Programme queue | Table 2 row 3: 30 days if complete (p. 28) | **Manual** + **Assumption A02** |
| `recommendation_pending` | `approved` | Director | Programme recommended | Approval + permittee number | Portal | — | **Assumption A03** |
| `scrutiny` / `recommendation_pending` | `rejected` | Director / Bureau | Grounds §3.4 | Rejection decision | Portal | §3.4(a) **60 days** no response to notice → reject (p. 25) | **Manual** |
| `payment_pending` / dues | `rejected` | Bureau | Non-payment | Rejection | Portal | §3.4(b) **60 days** (p. 25) | **Manual** |
| `approved` | `registered_active` | System | Register brand / company number | Register entry | Applicant | §3.1.1 (p. 22) | **Manual** |
| `registered_active` | `renewal_due` | System job | Agreement / registration expiry approaching | Alert | Portal §3.5–§3.6 | — | **Manual**; workflow **Assumption A15** — **WP9** |
| `registered_active` | `withdrawal_requested` | Applicant | §3.7 grounds | Withdrawal request | Portal | — | **Manual** §3.7 (pp. 26–27) — **WP9** |
| `withdrawal_requested` | `withdrawn` | Director | Financial clearance (**A15**) | Withdrawal approved | Portal | §3.7 (pp. 26–27) | **Manual** + **Assumption A15** — **WP9** |
| `registered_active` | `cancelled` | Bureau | §3.8 grounds | Cancellation order | Portal | §3.8 (pp. 27–28) | **Manual** — **WP9** |
| `cancelled` / `cancelled_auto` | `fresh_application` | Applicant | §3.9 corrective measures | New application | Portal | §3.9 (p. 28) | **Manual** — **WP9** |

## 4. Target — appliance category registration

| From | To | Actor | Guard | Evidence / audit | Notification | Deadline | Basis |
|---|---|---|---|---|---|---|---|
| — | `draft` | Applicant | Brand already registered | Draft | — | — | **Manual** §3.1.2 (p. 23) |
| `draft` | `submitted` | Applicant | Category selected | Submit | Portal | — | **Manual** |
| `submitted` | `deposit_pending` | System | Deposit amount | Deposit invoice | Applicant | — | **Manual** §4.2 (pp. 30–31); **Assumption A07** |
| `deposit_pending` | `deposit_settled` | Gateway / Finance | Payment success | Deposit receipt | Applicant | — | **Assumption A16** |
| `deposit_pending` | `deposit_exception` | Finance | Exception | Exception row | Finance | — | **Assumption A16** |
| `deposit_settled` | `scrutiny` | System | Deposit gate passed | Gate event | Officer | — | **Manual** §3.1.2 |
| `scrutiny` | `returned` | Scrutiny officer / agency | Discrepancy | Return lines | Portal | Align with brand Table 2 where applicable | **Assumption A02** |
| `returned` | `scrutiny` | Applicant | Resubmit | Resubmit | Portal | 60-day brand table row 5 if same hold pattern adopted — **WP2** | **Manual** / **BL-256** |
| `scrutiny` | `recommendation_pending` | Scrutiny officer / agency | Complete | Complete flag | Programme | — | **Assumption A03** |
| `recommendation_pending` | `category_active` | Director | Programme recommended | Category registration | Portal | — | **Assumption A03** |
| `scrutiny` / hold | `rejected` | Director | §3.4 grounds | Rejection | Portal | §3.4(a)–(b) (p. 25) | **Manual** |
| `category_active` | `withdrawn` | Applicant + Bureau | §3.7; deposit refund rules | Withdrawal | Portal | §3.7 (pp. 26–27) | **Manual** — **WP9** |
| `category_active` | `cancelled` | Bureau | §3.8 | Cancellation; deposit forfeit note §3.8 | Portal | §3.8 (pp. 27–28) | **Manual** — **WP9** |

## 5. Target — model registration

| From | To | Actor | Guard | Evidence / audit | Notification | Deadline | Basis |
|---|---|---|---|---|---|---|---|
| — | `draft` | Applicant | Brand + category active | Draft | — | — | **Manual** §3.1.3 |
| `draft` | `submitted` | Applicant | Annexure 3 + test report | Submit | Portal | — | **Manual**; **Existing implementation** (B1) |
| `submitted` | `payment_pending` | System | Model fee | Fee quote | Applicant | — | **Manual** §4.3 (p. 31) |
| `payment_pending` | `payment_settled` | Gateway / Finance | Paid | Receipt | Applicant | — | **Assumption A16** |
| `payment_pending` | `payment_exception` | Finance | Exception | Exception | Finance | — | **Assumption A16** |
| `payment_settled` | `scrutiny` | Designated agency / BEE | Fee posted | Fee confirm | Agency queue | Table 3 row 2: 15 days scrutiny (p. 29) | **Manual** §3.2 |
| `scrutiny` | `returned` | Designated agency / BEE | Discrepancy | Return lines | Portal | Table 3 row 4: 15 days (p. 29) | **Manual** |
| `returned` | `scrutiny` | Applicant | Revised documents | Resubmit | Portal | Table 3 row 5: **60 days** from communication (p. 30) | **Manual** |
| `returned` | `cancelled` | System / Bureau | No action 60 days | Cancel event | Portal | §3.2 (p. 24) **stand cancelled** | **Manual** |
| `returned` | `rejected` | Bureau | 60 days from **notice** per §3.4 | Rejection | Portal | §3.4(a) (p. 25) | **Manual**; reconcile with §3.2 in **WP2 BL-256** |
| `scrutiny` | `recommendation_pending` | Designated agency / BEE | Complete | Forward to BEE | Programme Director queue | Table 3 rows 2–3 (pp. 29–30) | **Manual** |
| `recommendation_pending` | `secretary_decision` | Programme Director | Recommend | Recommendation record | Secretary | §3.3 (p. 24) | **Manual** |
| `secretary_decision` | `approved` | Secretary | Compliant | Approval letter + certificate | Applicant | Table 3 row 7: 15 days from recommendation (p. 30) | **Manual** §3.3; **Existing implementation** |
| `secretary_decision` | `rejected` | Secretary | Reject grounds | Rejection | Applicant | — | **Manual** §3.3 |
| `approved` | `label_permission_active` | System | Certificate issued | Certificate event | Applicant | 3-year validity §3.3 (p. 24) | **Manual** |
| `label_permission_active` | `renewal_due` | System job | Expiry alert | Alert | Portal §3.5 | — | **Manual** — **WP9**; **Assumption A15** |
| `label_permission_active` | `withdrawal_requested` | Applicant | §3.7 | Request | Portal | §3.7 (pp. 26–27) | **Manual** — **WP9** |
| `label_permission_active` | `cancelled` | Bureau | §3.8 | Cancellation | Portal | §3.8 (pp. 27–28) | **Manual** — **WP9** |
| `cancelled` | `fresh_application` | Applicant | §3.9 undertaking | New application | Portal | §3.9 (p. 28) | **Manual** — **WP9** |

## 6. Portal mapping notes (existing implementation)

| Target state cluster | Portal today | Gap |
|---|---|---|
| Payment pending / exception | `fee_due` + Finance confirm | No exception queue |
| Structured return | Single `returned` reason | WP2 discrepancy lines |
| `cancelled_auto` / §3.2 cancel | Not implemented | **BL-253**, **BL-256** |
| Category deposit gate | Missing | **BL-251** |
| Renewal / withdrawal / cancellation | Missing | WP9 |

## 7. Timeline / SLA (WP2)

Manual Tables 2–3 (printed pp. 28–30) define step timelines. **Assumption A17:** working-day calendar; clock paused while awaiting applicant. **Assumption A09:** internal targets stricter than 30-day narrative ceiling where configured.
