-- DEMO: sample simulated e-mail and SMS for the people who sign in during the demonstration (BEE Officer, Finance, Director, the Nova
-- manufacturer and ravik24), so Notifications and messages is not empty. Synthetic data only; nothing is ever sent anywhere.
-- Additive and idempotent: fixed ids (md5 of a label), ON CONFLICT DO NOTHING, recipients looked up by username so a rebuilt demo works.
BEGIN;
DO $$
DECLARE
  r record;
  acct uuid;
  suffix text := ' Simulated message: nothing was sent.';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- recipient, label, channel, event_kind, reference, subject, body, hours ago, read
    ('bee.officer','o1','email','registration_to_approve','MOB/2026/00001','Company registration to approve: MOB/2026/00001','Ravik Appliances Pvt Ltd has filed a company registration. The fee of INR 5000.00 was verified automatically and 17 of 17 automated checks passed. Open the Officer work queue to approve, return or reject it.',2,false),
    ('bee.officer','o2','sms','registration_to_approve','MOB/2026/00001',NULL,'BEE demo: company registration MOB/2026/00001 (Ravik Appliances) awaits your approval.',2,false),
    ('bee.officer','o3','email','anomaly_raised','MOB/2026/00002','Anomaly raised, registration on hold: MOB/2026/00002','BEE Finance raised an anomaly on Kestrel Cooling Systems Pvt Ltd: the GSTIN on its first supplier invoices differs from the registered GSTIN. The registration is on hold until you clear it or revoke it. Open Anomalies and holds.',20,false),
    ('bee.officer','o4','sms','anomaly_raised','MOB/2026/00002',NULL,'BEE demo: MOB/2026/00002 (Kestrel Cooling Systems) is on hold. Your decision is needed.',20,true),
    ('bee.officer','o5','email','anomaly_raised','MOB/2026/00003','Anomaly raised, registration on hold: MOB/2026/00003','BEE Finance raised an anomaly on Brightwave Appliances Pvt Ltd: the registration fee payment was reversed after activation (receipt SIMRCPT-REV-0412). Hold applied until a fresh payment is confirmed or the reversal is withdrawn.',26,true),
    ('bee.officer','o6','email','model_to_recommend','DEMO-Q-0001','Model application waiting for your recommendation: DEMO-Q-0001','Nova Cool NC-RAC-QDIR-1 (rating 4 stars) has completed IAME scrutiny, BEE scrutiny and rating, and now waits for your recommendation. Open the Officer work queue.',48,true),
    ('bee.officer','o7','email','weekly_summary',NULL,'Programme summary for the week','This week: 4 company registrations filed, 2 holds applied, 12 model applications awaiting approval, 84 certificates active on the simulated ledger. Open Programme at a glance for the detail.',72,true),
    ('bee.finance','f1','email','registration_fee_to_confirm','REG-2026-9023','Registration fee to confirm: REG-2026-9023','Glacier One (synthetic), an agency registration from PixelCert, is waiting for its fee of INR 5000 to be confirmed. Open Registration fee confirmation.',3,false),
    ('bee.finance','f2','sms','registration_fee_to_confirm','REG-2026-9023',NULL,'BEE demo: registration fee for REG-2026-9023 awaits confirmation.',3,false),
    ('bee.finance','f3','email','anomaly_recorded','MOB/2026/00003','Your anomaly was recorded: MOB/2026/00003','The anomaly you raised on Brightwave Appliances Pvt Ltd was recorded and the registration is on hold. The BEE Officer will decide whether to clear or revoke it.',26,true),
    ('bee.finance','f4','email','payment_reversed','MOB/2026/00003','Payment reversal notice: SIMRCPT-REV-0412','The simulated gateway reports receipt SIMRCPT-REV-0412 (INR 5000.00) as charged back. Please check the reconciliation for Brightwave Appliances Pvt Ltd.',27,false),
    ('bee.finance','f5','sms','payment_reversed','MOB/2026/00003',NULL,'BEE demo: gateway reversal on SIMRCPT-REV-0412. Please reconcile.',27,true),
    ('bee.finance','f6','email','fee_to_confirm','DEMO-PAY-0004','Model fee to confirm: DEMO-PAY-0004','A model application fee of INR 11,800 was paid at the simulated gateway for Nova Cool and is waiting for your confirmation.',50,true),
    ('bee.director','d1','email','final_approval_needed',NULL,'Applications waiting for your final approval','Four model applications have been recommended by the BEE Officer and wait for the final decision of the Director. Open the Dashboard to see them.',4,false),
    ('bee.director','d2','sms','final_approval_needed',NULL,NULL,'BEE demo: 4 applications await your final approval.',4,false),
    ('bee.director','d3','email','register_status','BRAND-1303','Brand suspended: Breezo Home (synthetic)','The brand Breezo Home (owner Harbor Breeze Cooling Pvt Ltd) is suspended on the register while a second applicant disputes ownership of the name. Open the Register for the reason.',30,true),
    ('bee.director','d4','email','weekly_summary',NULL,'Programme summary for the week','This week: 4 company registrations filed, 2 holds applied, 84 certificates active. Open Programme performance for the trend.',72,true),
    ('ravik24@example.invalid','r1','email','registration_filed','MOB/2026/00001','Registration submitted: MOB/2026/00001','Thank you. Your company registration for Ravik Appliances Pvt Ltd was submitted. The registration fee of INR 5000.00 was received and verified, and the automated document and eligibility checks passed. The BEE Officer will now decide on your application.',5,false),
    ('ravik24@example.invalid','r2','sms','registration_filed','MOB/2026/00001',NULL,'BEE demo: registration MOB/2026/00001 submitted. It awaits BEE Officer approval.',5,false),
    ('ravik24@example.invalid','r3','email','payment_paid','MOB/2026/00001','Payment received: INR 5000.00','Your payment of INR 5000.00 for the company registration was received at the simulated gateway and verified automatically.',5,true),
    ('ravik24@example.invalid','r4','sms','account_created',NULL,NULL,'BEE demo: your applicant account ravik24 is ready. Your verification code is 482913 (simulated).',6,true),
    ('nova.applicant','n1','email','model_with_officer','DEMO-Q-0001','Your model application is with the BEE Officer: DEMO-Q-0001','Nova Cool NC-RAC-QDIR-1 passed scrutiny and rating (4 stars, declared 4.62) and now waits for the BEE Officer to recommend a decision.',10,false),
    ('nova.applicant','n2','sms','model_with_officer','DEMO-Q-0001',NULL,'BEE demo: DEMO-Q-0001 is with the BEE Officer for a recommendation.',10,false),
    ('nova.applicant','n3','email','certificate_issued','BEE/RAC/2026/10101','Certificate issued: BEE/RAC/2026/10101','The certificate for Nova Cool NC-RAC-12D (5 stars) is active on the simulated ledger and valid to 30 Sep 2029.',96,true),
    ('nova.applicant','n4','email','production_reminder',NULL,'Quarterly production due: Q3 2026','Your quarterly production figures for Q3 2026 are due. Open Production reporting to declare the units against your QR serials.',28,false),
    ('nova.applicant','n5','sms','production_reminder',NULL,NULL,'BEE demo: Q3 2026 production figures are due.',28,true),
    ('nova.applicant','n6','email','payment_paid','DEMO-PAY-0001','Fee receipt: DEMO-PAY-0001','Your model application fee of INR 11,800 was verified. Receipt DEMO-PAY-0001.',120,true)
  ) AS t(who, label, channel, kind, ref, subj, body, hrs, is_read) LOOP
    SELECT u.id INTO acct FROM user_account u WHERE u.username = r.who OR (r.who LIKE 'ravik24%' AND u.username = 'ravik24') LIMIT 1;
    IF acct IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO demo_message (id, recipient_account_id, channel, address, event_kind, reference, subject, body, created_at, read_at)
    VALUES (md5('s12-' || r.who || '-' || r.label)::uuid, acct, r.channel,
            CASE WHEN r.channel = 'email' THEN split_part(r.who, '@', 1) || '@bee-demo.invalid' ELSE '+91 9XXXXX' || lpad((abs(hashtext(r.who)) % 10000)::text, 4, '0') || ' (synthetic)' END,
            r.kind, r.ref, r.subj, r.body || suffix, now() - make_interval(hours => r.hrs),
            CASE WHEN r.is_read THEN now() - make_interval(hours => GREATEST(r.hrs - 1, 0)) ELSE NULL END)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
COMMIT;
