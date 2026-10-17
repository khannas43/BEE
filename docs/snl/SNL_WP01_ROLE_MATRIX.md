# SNL WP01 — role matrix

**Status:** Working baseline. Provisional roles marked **(A02–A04)** until BEE confirms.  
**Governing source:** *SnL Disha Advisory Manual* (printed footer pages).  
**Related:** [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md), [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md)

## 1. Manual roles (explicit in PDF)

| Manual role / actor | Manual reference | Stated responsibility |
|---|---|---|
| Permittee (manufacturer / importer / trader) | §1.3.5 (pp. 15–16); §3 (p. 22) | Register on S&L portal; submit returns, fees, production, label/QR obligations |
| Designated agency / BEE (scrutiny) | §3.2 (p. 24) | Check completeness of model registration; communicate discrepancies via portal |
| Programme Director | §3.3 (p. 24) | Recommend model registration to Secretary after scrutiny |
| Secretary, BEE | §3.3 (p. 24) | Final approval of model registration |
| Finance / payment | §4 (p. 30) | Electronic payment on portal (fee types §4.1–§4.5) |

**Not named in manual for entity/brand/category path:** specific officer titles for company or category registration approval (§3.1.1–§3.1.2, pp. 22–23). **Assumption A02–A03** maps portal roles until BEE specifies otherwise.

## 2. Portal roles today (contract + UI)

Evidence: OpenAPI security schemes and registration/model route handlers; screens under `app/app/registrations/**`, `app/app/model-label/**`.

| Portal role (BEE) | Typical actions in repo | Manual alignment |
|---|---|---|
| Applicant (manufacturer user) | Create/edit/submit registration or model application; upload documents; pay or await fee; resubmit after return | Permittee filing — **aligns** |
| Programme (officer) | Recommend or return registration; model stages through IAME/reviewer/rating | Model recommend path **aligns** §3.3; registration **assumed** A02 |
| Director | Approve/return/reject registration; model director stage | Registration **assumed** A03; model chain **partial** |
| Secretary | Model final approval | **Aligns** §3.3 (p. 24) |
| Finance | Confirm registration/model fees; corrections | Manual expects electronic payment — **partial** (manual confirm in contract, A16) |
| Auditor / read-only | Demo dashboards and verification views | Not in manual — **derived** (WP8) |

## 3. RACI-style matrix (capability × role)

**R** = responsible (does work), **A** = approves, **C** = consulted, **I** = informed, **—** = not in scope today.

| Capability | Applicant | Programme | Director | Secretary | Finance | Designated agency / IAME | Public |
|---|---|---|---|---|---|---|---|
| Entity master data | R | C | A* | — | — | — | — |
| Brand registration | R | R/A* | A* | — | C | — | — |
| Category registration | — | — | — | — | — | — | — |
| Agency authorisation | R | R/A* | A* | — | C | — | — |
| Model application | R | C | C | A | C | R (scrutiny) | — |
| Registration fee | R (pay) | I | I | — | A (confirm) | — | — |
| Model fee | R (pay) | I | I | I | A (confirm) | — | — |
| Category deposit | — | — | — | — | — | — | — |
| Discrepancy / return | R (fix) | R (issue) | C | — | — | R (model) | — |
| Reject / cancel | I | R | A | C (model) | — | C | — |
| Certificate / register entry | I | C | A | A (model) | — | — | I (verify) |
| QR / label | R (display) | C | — | — | C (fees) | — | C (verify) |
| Production return | R | A (review) | I | — | C | — | — |
| Label fee / reconciliation | R | C | — | — | A | — | — |
| Renewal / withdrawal | — | — | — | — | — | — | — |

\* **Provisional (A02–A03):** entity/brand/category approval chain mirrors registration screens, not a manual quote.

## 4. Gaps and WP mapping

| Gap | Roles affected | WP |
|---|---|---:|
| Category registration officer path undefined | Programme, Director, Finance | WP3 |
| Designated agency vs IAME vs Programme for model scrutiny | Programme, IAME | WP2, WP4 |
| Finance auto-post vs manual confirm | Finance | WP5 |
| SLA breach / auto-cancel (60 days) | Programme, system job | WP2, WP9 |
| Annual reconciliation sign-off | Programme, Finance, permittee | WP7 |

## 5. Supervisor, auditor and system jobs

| Actor | Source | Responsibility today | Target |
|---|---|---|---|
| **Supervisor** | **Assumption** (legacy B15: reassign work) | Demo/workflow reassignment patterns; not S&L-specific | WP2 supervisor queue and recorded reassignment |
| **Auditor / read-only officer** | **Existing implementation** | Demo MIS, register export, verification read paths | WP8 Manufacturer 360 read scopes (**A14**) |
| **System job — SLA clock** | **Manual** §3.10 (pp. 28–29); **Assumption A17** | Not implemented | WP2 working-day calendar, pause while awaiting applicant |
| **System job — 60-day cancel** | **Manual** Table 2 row 6 (p. 28) | Not implemented | WP2/WP9 scheduled cancellation on incomplete/no response |
| **System job — renewal reminders** | **Manual** §3.5–§3.6 (pp. 25–26) | Not implemented | WP9 |

Each row above is labeled **Manual**, **Existing implementation**, or **Assumption** per Brief 17.

## 6. Assumptions cross-reference

| ID | Topic |
|---|---|
| A02 | Registration scrutiny officer = Programme (provisional) |
| A03 | Registration approver = Director (provisional) |
| A04 | Model stage names map to §3.3 chain |
| A16 | Finance confirmation until gateway auto-post |
| A18 | Email/SMS providers for notifications |

Full text: [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) §18 October 2026.
