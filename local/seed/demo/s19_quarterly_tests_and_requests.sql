-- DEMO: BEE's test of each product in each quarter that has a production submission, and a few service requests, so the Quarterly submission
-- screen, the QR reconciliation page and the Renewals / Withdrawals / Helpdesk screens show real content.
--  * every product in an ACCEPTED or QUERY submission is recorded as tested and passed, with a measured ISEER close to its certificate;
--  * three products show other results: Nova NC-RAC-12D in 2026-Q3 needs a retest, one Lumen Frost product failed in 2026-Q2, and the
--    SUBMITTED 2026-Q3 products of the other manufacturers are left untested ("Awaiting BEE test").
--  * service requests: a renewal for the certificate ending soon (acknowledged; the EXPIRED one is left for the owner to request live),
--    a withdrawal (resolved), a withdrawal (declined) and two helpdesk tickets (one answered).
-- Synthetic data only. Idempotent (a result is written once per product and quarter; a request once by its fixed id).
DO $$
DECLARE
  officer uuid := '00000000-0000-4000-a000-000000000007';
  nova uuid := '00000000-0000-4000-b000-000000000001';
  nova_user uuid := '00000000-0000-4000-a000-000000000001';
  programme uuid := '00000000-0000-4000-a000-000000000006';
BEGIN
  INSERT INTO quarterly_test_result (organisation_id, quarter, registration_id, model_number, result, measured_iseer, tested_on, laboratory_code, remarks, recorded_by, recorded_at)
  SELECT DISTINCT ON (s.organisation_id, s.quarter, r.registration_id)
         s.organisation_id, s.quarter, r.registration_id, c.model_number,
         CASE WHEN s.quarter = '2026-Q3' AND r.registration_id = 'BEE/RAC/2026/10101' THEN 'retest'
              WHEN s.quarter = '2026-Q2' AND r.registration_id = 'BEE/RAC/2026/10303' THEN 'fail'
              ELSE 'pass' END,
         round((c.verified_iseer - CASE WHEN s.quarter = '2026-Q3' AND r.registration_id = 'BEE/RAC/2026/10101' THEN 0.13
                                        WHEN s.quarter = '2026-Q2' AND r.registration_id = 'BEE/RAC/2026/10303' THEN 0.42
                                        ELSE 0.01 + (abs(hashtext(r.registration_id || s.quarter)) % 4) / 100.0 END)::numeric, 2),
         (CASE s.quarter WHEN '2025-Q4' THEN date '2025-12-18' WHEN '2026-Q1' THEN date '2026-03-19' WHEN '2026-Q2' THEN date '2026-06-18' ELSE date '2026-09-17' END) + (abs(hashtext(r.registration_id)) % 6),
         'LAB',
         CASE WHEN s.quarter = '2026-Q3' AND r.registration_id = 'BEE/RAC/2026/10101' THEN 'Measured efficiency is 0.13 below the declared figure. A retest with a fresh sample from the next batch has been requested.'
              WHEN s.quarter = '2026-Q2' AND r.registration_id = 'BEE/RAC/2026/10303' THEN 'Measured efficiency is 0.42 below the certificate figure, outside the allowed tolerance. The manufacturer has been asked to explain the difference.'
              ELSE NULL END,
         officer, now() - interval '3 days'
    FROM production_row r
    JOIN production_submission s ON s.id = r.submission_id
    JOIN certificate c ON c.registration_id = r.registration_id
   WHERE s.state IN ('accepted', 'query') OR (s.quarter = '2026-Q3' AND s.organisation_id = nova)
  ON CONFLICT (organisation_id, quarter, registration_id) DO NOTHING;

  INSERT INTO service_request (id, reference, kind, organisation_id, subject_ref, subject, message, category, status, created_by, created_at, response_note, responded_by, responded_at) VALUES
    (md5('s19-rn-2')::uuid, 'RN-S19002', 'renewal', nova, 'BEE/RAC/2023/10051', 'Renewal of BEE/RAC/2023/10051 (NC-RAC-12K)', NULL, NULL, 'acknowledged', nova_user, now() - interval '5 days',
       'Received. Please keep the quarterly submission for this model up to date; the renewal inspection will be scheduled before the end date.', officer, now() - interval '4 days'),
    (md5('s19-wd-1')::uuid, 'WD-S19001', 'withdrawal', nova, 'BEE/RAC/2026/10902', 'Withdraw BEE/RAC/2026/10902 (NC-RAC-S2B)', 'Model discontinued; replaced by a new design that will be filed separately.', NULL, 'resolved', nova_user, now() - interval '9 days',
       'Accepted. The certificate stays valid until labels already in the market are sold through; BEE will close it on the ledger at the end of the quarter.', officer, now() - interval '8 days'),
    (md5('s19-wd-2')::uuid, 'WD-S19002', 'withdrawal', nova, 'BEE/RAC/2026/10103', 'Withdraw BEE/RAC/2026/10103 (NC-RAC-24H)', 'Withdrawing to avoid the quarterly test.', NULL, 'declined', nova_user, now() - interval '7 days',
       'Declined: a certificate cannot be withdrawn to avoid a pending test. Complete the test, then ask again.', officer, now() - interval '6 days'),
    (md5('s19-hd-1')::uuid, 'HD-S19001', 'helpdesk', nova, NULL, 'QR codes for a new batch do not appear', 'I created a batch of 100 for NC-RAC-12D but I cannot see the serials on the batch page.', 'QR codes and labels', 'resolved', nova_user, now() - interval '6 days',
       'Serials appear after you press Generate on the batch page. We have added a step to the guide.', programme, now() - interval '5 days'),
    (md5('s19-hd-2')::uuid, 'HD-S19002', 'helpdesk', nova, NULL, 'Quarterly figures for 2026-Q4', 'When can we start the 2026-Q4 submission, and who reviews it?', 'Quarterly submission', 'submitted', nova_user, now() - interval '1 day', NULL, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;
END $$;
