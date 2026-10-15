# Sample data added for the demonstration

Synthetic rows only, appended to `local/seed/demo/`. The presenter's records are unchanged: DEMO-PAY-0001..0005 (0001 still has no payment), certificates 10101–10104 (not on the ledger), 10901, 10902, QR serials `BEEQ-S2D0000001`–`25`, `BEEQ-S2D0000030`, `BEEQ-S2D0000040`, ledger certificates 90037 (seeded mismatch), 90038 (failed), 90039 (pending), 90040 (active), and Nova's production quarters 2025-Q4 to 2026-Q3 including the 2026-Q3 spike. 2026-Q4 is still free for the live demo.

Nothing here was executed. `npm run demo:seed` was not run, and no database was started. Counts below are what the statements insert on a fresh seed. A second run is a no-op (`ON CONFLICT`, fixed ids, or `CONTINUE WHEN EXISTS`).

## MIS dashboard (`s5_mis.sql`)

The original 40 applications and 9 registrations are untouched. A second transaction adds:

- 5 manufacturers: Harbor Breeze, Lumen Frost, Cinder Peak, Marigold Air, Northwind Comforts (organisations 504–508). With the original three synthetic makers, that is 8.
- 80 model applications, `SYN-MA-0041` to `SYN-MA-0120`, filed over the last eight months with more of them in the months before summer. States, four of each residue so the counts are exact: 8 draft, 12 fee due, 8 IAME scrutiny, 4 BEE scrutiny, 4 rating, 4 director review, 4 secretary approval, 24 approved, 8 returned, 4 rejected.
- Approved applications take 8 to 15 days. Their certificates use sequences `91000 + n` (about 24 certificates), issued within about eight months so they stay newer than 90037–90040.
- Fee confirmations on the 60 applications that have left fee due, amounts 25,000 / 27,500 / 30,000 / 32,500 with no tax, the same band as the original MIS history. Together with that original history (and the small registration and queue confirmations) the fee card should land near 29 lakh. Confirm the live card.
- 4 queue applications: `DEMO-Q-0001` and `DEMO-Q-0002` (Nova, director review), `DEMO-Q-0003` (Nova, rating), `DEMO-Q-0004` (Pixel, director review). Fee snapshot 10,000 plus 18 percent, confirmation 11,800, no simulated payment.
- 2 Nova brand registrations: `NOVA-REG-001` with programme, `NOVA-REG-002` with the director.
- 3 delegations: director to programme (approved, 14 days), finance to programme (approved, 10 days), programme to helpdesk (left pending, 7 days). Dates are `current_date`, so they are open on the day of the seed and then expire. A later seed cannot extend them: the table refuses a change of dates.

## Payments (`s1_payments.sql`)

16 payments, `DEMO-PAY-0010` to `DEMO-PAY-0025`, across Nova, Pixel and synthetic makers 1–4, from November 2025 onward.

- 5 paid with no fee confirmation (0010–0014): paid, not yet confirmed.
- 2 paid with a confirmation of 10,000 against a payment of 11,800 (0015, 0016): amount differs.
- 1 paid with a matching confirmation of 11,800 (0025).
- 4 initiated (0017–0020).
- 4 failed (0021–0024).

`DEMO-PAY-0001` still has no payment.

## QR batches (`s2_qr.sql`)

8 batches for the production models below. The two Nova batches and the `BEEQ-S2D*` serials are unchanged.

| Batch | Quantity | Status | Serials |
| --- | --- | --- | --- |
| Harbor HB-RAC-15A, HB-RAC-18B | 2,000 each | open | 1,100 bound, 120 allocated, 4 void |
| Lumen LF-RAC-12A, LF-RAC-20C | 1,800 and 2,400 | open | 1,100 bound, 120 allocated |
| Cinder CP-RAC-18A, CP-RAC-24B | 1,600 each | closed | 1,600 bound (the whole batch) |
| Pixel PX-RAC-10A | 1,200 | open | 1,100 bound, 80 allocated, 4 void |
| Pixel PX-RAC-12B | 3,200 | open | 1,100 bound, 120 allocated |

12 void serials in all. A normal quarter declares 1,020 units; 1,100 bound serials times 1.10 is 1,210, so those quarters should not flag. The three spikes below should.

## Certificate ledger (`s3_ledger.sql`)

The original loop still runs first and still tags the four oldest certificates (90040, 90039, 90038, 90037). After that:

- The 8 production certificates (sequences 10301–10306 and 10311–10312) are submitted and committed: active. 10101–10104, 10901 and 10902 are not submitted.
- 22 further certificates, `DEMO-LDG-0001` to `0022`, sequences 10801–10822, issued in the last few weeks: 14 active, 2 pending, 2 failed with a second failed attempt, 2 amended (validity shortened by 40 days), 2 revoked.
- Hashes are `ledger_compute_hash`. An amendment's hash uses the new `valid_to` stored on that transaction, which is what verification recomputes. Only 90037 should mismatch. This was not executed.

## Quarterly production (`s4_production.sql`)

8 approved models with certificates, then 16 submissions: Harbor, Lumen, Cinder and Pixel, each for 2025-Q4, 2026-Q1, 2026-Q2 and 2026-Q3. Each submission has 6 rows (2 models, 3 months) and one chartered-accountant file. Most are accepted. Lumen 2026-Q3 stays submitted. Cinder 2026-Q2 is a query.

Over-declaration (one month of 6,400, quarter sum 7,060, against 1,100 bound serials): Harbor `HB-RAC-18B` in 2026-Q1, Lumen `LF-RAC-12A` in 2026-Q2, Pixel `PX-RAC-10A` in 2025-Q4. Nova's quarters, including the 2026-Q3 spike, are skipped when they already exist.

## AI use cases (`s6_ai.sql`)

- Compliance risk: 8 more entities. Northwind and Harbor are high, Cinder is in the middle, Lumen and Marigold are low, plus three models.
- Production anomaly: three more quarterly series. `SYN-S5` spikes in 2026-Q1 (6,400 against about 1,000). `SYN-S6` and `SYN-S7` are calm. The table has no month column; the existing `SYN-S1` and `SYN-S3` spikes are unchanged.
- Rating trends: October 2024 through February 2026, two samples a month, for RAC, FAN and REF (102 rows), efficiency drifting up. March to September 2026 were already there, so each category has 24 months.
- Helpdesk: articles 21–40 (fees, QR, certificates including renewal, test reports, labels, production, account, registration). With 1–20, the base is 40.
- Document extraction: report texts for `LOCAL-MA-0001`, `DEMO-MA-0101` and `DEMO-MA-0102`, different layouts from the three already seeded.
- 6 stored runs: three accepted, two overridden, one rejected, with audit rows.

## Dashboards

Nova has the two director-review applications, the rating application, and the two brand registrations, plus the existing Nova production and the unpaid `DEMO-PAY-0001`. Pixel has a director-review application, four production quarters and payments. Finance has the paid-but-unconfirmed rows and the two amount differences. Programme and the director have those queues, and two open delegations onto programme.

## Unsure about

- No statement was run. Column lists, checks and the hash function were read against the migrations only.
- `model_application.category` allows only `RAC`. Refrigerator and ceiling fan appear in the AI rating table, which does not use that check. They were not invented as application categories.
- The MIS history keeps the existing 25,000–32,500 band. The live fee rule of 10,000 plus 18 percent (11,800) is used on `DEMO-PAY-*` and on the four queue applications.
- The live average approval time mixes the original 40 applications (6 to 16 days) with the new approved ones (8 to 15).
- Delegations expire, and re-seeding will not push the dates out.
- Harbor, Lumen and Cinder brands are the rows created with the production models. The MIS seed reuses them instead of inserting a second name for the same owner.
