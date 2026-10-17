# SNL WP01 — role matrix

**Status:** Working baseline. Provisional roles marked until BEE confirms.
**Governing source:** *SnL Disha Advisory Manual* (printed footer pages).
**Related:** [SNL_WP01_BASELINE.md](SNL_WP01_BASELINE.md), [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md)

## 1. Actors

| Actor | Manual basis | Portal / implementation today | Notes |
|---|---|---|---|
| Applicant / manufacturer (permittee) | §1.3.5 (pp. 15–16); §3 (p. 22) | Manufacturer organisation user | **Manual** |
| Registration Scrutiny Officer or designated agency | §3.2 scrutiny pattern (p. 24) — named for **model** scrutiny | Programme officer on brand path; IAME/reviewer on model path | Entity/brand: **Assumption A02**. Model scrutiny: **Manual** + **Existing implementation** |
| Programme Director | §3.3 (p. 24) — recommends model registration to Secretary | Portal **Programme** role performs recommend/return on registration; model pipeline includes director stage before Secretary | Registration mapping: **Assumption A03**. Model: Programme Director title vs portal “Programme” — **Assumption A04** |
| Director | §3.4 DG binding on hold/reject/cancel (p. 25); registration approver not named | Approves/returns/rejects registration; model director stage | Registration approve: **Assumption A03**. DG cases: **Manual** |
| Secretary | §3.3 (p. 24) final model approval | Secretary model approval stage | **Manual** + **Existing implementation** |
| Finance | §4 electronic payment (p. 30) | Fee confirmation, corrections | **Manual** intent; **Existing implementation** (manual confirm until A16) |
| Supervisor | Not in S&L manual | Reassignment patterns (legacy B15) | **Assumption** — WP2 |
| Auditor | Not in S&L manual | Read-only demo MIS, register export, verification | **Existing implementation** — WP8 (**A14**) |
| System jobs | §3.10 timelines (pp. 28–30); Table 2 row 5 (p. 29); §3.2 (p. 24); §3.4 (p. 25) | SLA clock, 60-day outcomes, renewal alerts not built | **Manual** triggers; **Assumption A17** for clock rules; WP2 implements (**BL-253**, **BL-256**) |

**Segregation rule:** Each action below has a single **basis** label (`Manual`, `Existing implementation`, or `Assumption`). Approver and performer are separate rows where the manual separates them.

## 2. Legal entity / company and brand registration

Target authority (includes today’s brand registration; legal-entity master is **Assumption A01**).

| Action | Performer | Approver / decider | Basis |
|---|---|---|---|
| Draft and edit application | Applicant | — | **Existing implementation** |
| Submit application | Applicant | — | **Manual** §3, §3.1.1 (pp. 22–23) |
| Pay company registration fee | Applicant | — | **Manual** §4.1 (p. 30) |
| Confirm payment | Finance | — | **Existing implementation** (auto-post target: **Assumption A16**) |
| Scrutinise completeness | Registration Scrutiny Officer or designated agency | — | **Assumption A02** (manual silent on entity/brand officer title) |
| Communicate discrepancies / put on hold | Registration Scrutiny Officer or designated agency | — | **Manual** §3.4 (pp. 24–25); Table 2 row 4 (p. 29) |
| Submit revised documents | Applicant | — | **Manual** Table 2 row 5 (p. 29) |
| Recommend registration | Programme (portal) | — | **Assumption A03** (manual Programme **Director** named only for model §3.3) |
| Approve registration / issue permittee number | Director (portal) | Director | **Assumption A03** |
| Reject application (including 60-day non-response to discrepancy notice) | Director or Bureau process | Director | **Manual** §3.4(a) (p. 25) |
| Auto-cancel after 60 days on hold (brand table) | System job | — | **Manual** Table 2 row 5 (p. 29) — distinct from §3.4 **reject** (**BL-256**, WP2) |
| Reject for non-payment of dues within 60 days | Bureau | — | **Manual** §3.4(b) (p. 25) |
| Renew company agreement (voluntary) | Applicant | Bureau approval | **Manual** §3.5–§3.6 (pp. 25–26); process detail **Assumption A15** |
| Withdraw registration | Applicant request; Bureau review | Director (**Assumption A15**) | **Manual** §3.7 (pp. 26–27); approval chain **Assumption A15** |
| Bureau cancellation of permission | Bureau | Secretary / DG per case | **Manual** §3.8 (pp. 27–28); roles **Assumption A15** |

## 3. Appliance category registration

No portal journey today. Target responsibilities use **Assumption A01**, **A02**, **A03**, **A07**.

| Action | Performer | Approver / decider | Basis |
|---|---|---|---|
| Select category under registered brand | Applicant | — | **Manual** §3.1.2 (p. 23) |
| Pay label security deposit | Applicant | — | **Manual** §3.1.2 (p. 23); §4.2 (pp. 30–31); amounts **Assumption A07** |
| Confirm deposit payment | Finance | — | **Assumption A16** |
| Scrutinise category enrolment | Registration Scrutiny Officer or designated agency | — | **Assumption A02** |
| Recommend category registration | Programme (portal) | — | **Assumption A03** |
| Approve category registration | Director (portal) | Director | **Assumption A03** |
| Refund security fee on withdrawal | Finance / competent authority | Competent authority | **Manual** §3.7 (p. 27) last paragraph |

## 4. Model registration

| Action | Performer | Approver / decider | Basis |
|---|---|---|---|
| Draft, attach Annexure 3 data and documents | Applicant | — | **Manual** §3.1.3 (pp. 23–24); Annexure 3 (pp. 56–57) |
| Submit and pay model fee | Applicant | — | **Manual** §3.1.3; §4.3 (p. 31) |
| Confirm fee | Finance | — | **Existing implementation**; **Assumption A16** |
| Scrutinise completeness | BEE or designated agency | — | **Manual** §3.2 (p. 24) |
| Communicate discrepancies; put on hold | BEE or designated agency | — | **Manual** §3.2 (p. 24); Table 3 row 4 (p. 30) |
| Applicant response / revised documents | Applicant | — | **Manual** Table 3 row 5 (p. 30) — **60-day deadline only** (no “auto-cancel” in table) |
| Stand cancelled after 60 days no action | System / Bureau update | — | **Manual** §3.2 (p. 24) — **cancel** wording |
| Reject after 60-day failure to respond to notice | Bureau | — | **Manual** §3.4(a) (p. 25) — **reject** wording (**BL-256**) |
| Forward for approval with recommendation | Programme Director | Programme Director | **Manual** §3.3 (p. 24); portal Programme + director stages: **Assumption A04** |
| Final approve or reject model | Secretary | Secretary | **Manual** §3.3 (p. 24); **Existing implementation** |
| Issue approval letter (three years) | Bureau | Secretary decision | **Manual** §3.3 (p. 24) |
| Renew model before expiry | Applicant; Bureau process | Secretary (**Assumption A15**) | **Manual** §3.5 (pp. 25–26); **Assumption A15** |
| Withdraw models | Applicant; Bureau financial review | Director (**Assumption A15**) | **Manual** §3.7 (pp. 26–27) |
| Bureau cancel label permission | Bureau | **Assumption A15** | **Manual** §3.8 (pp. 27–28) |

## 5. Cross-cutting roles

| Capability | Applicant | Scrutiny / agency | Programme | Director | Secretary | Finance | Supervisor | Auditor | System |
|---|---|---|---|---|---|---|---|---|---|
| Structured discrepancy list | — | R | C | I | — | — | — | — | — |
| SLA / working-day clock | — | I | I | I | I | — | I | — | R (**A17**) |
| 60-day brand auto-cancel (Table 2 row 5) | I | I | I | I | — | C (refund) | — | — | R |
| 60-day model cancel (§3.2) vs reject (§3.4) | I | R | I | I | — | — | — | — | R (WP2 policy **BL-256**) |
| Payment exception queue | I | — | — | — | — | R | C | I | — |

R = responsible for the action in the target design; labels in §2–§4 remain the authoritative basis for approvals.

## 6. Assumptions cross-reference

| ID | Topic |
|---|---|
| A02 | Registration scrutiny officer / designated agency for entity, brand, category |
| A03 | Programme recommends; Director approves entity, brand, category |
| A04 | Portal model stages map to Programme Director → Secretary |
| A15 | Renewal, withdrawal, cancellation role defaults |
| A16 | Finance auto-confirm vs manual |
| A17 | Working-day calendar and applicant pause |

Full text: [docs/BEE_DECISIONS.md](../BEE_DECISIONS.md) §18 October 2026.
