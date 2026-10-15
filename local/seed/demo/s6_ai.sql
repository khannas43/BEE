-- Demo slice S6 seed: SYNTHETIC data for the AI demonstration. Idempotent (ON CONFLICT DO NOTHING). Not BEE content.
BEGIN;
INSERT INTO ai_kb (id, category, title, body) VALUES
  (1, 'registration', 'How do I register my brand on the portal?', 'Sign in as the applicant of your organisation, open Brand registration and file the brand name, the category and the supporting details. A programme officer reviews it and a director approves it. When approved the brand appears in the register. This is a local demonstration process, not a BEE rule.'),
  (2, 'registration', 'What happens after I file a brand registration?', 'The filing is reviewed by the programme team. It can be approved, returned to you with a reason, or rejected. A returned filing can be edited and sent again. You see each step in the history of the registration.'),
  (3, 'registration', 'Can an agency file on behalf of a manufacturer?', 'An agency can act for a principal only with an agency authorisation that names the principal and the brand and is in date. Without it the portal refuses the filing. Ask the principal to arrange the authorisation.'),
  (4, 'application', 'How do I apply for approval of a model?', 'Create a model application, choose the brand, enter the model number, the laboratory, the test date and the declared efficiency, attach the test report PDF and submit. The fee is then due. After Finance confirms the fee the application goes through scrutiny, rating, director review and secretary approval.'),
  (5, 'application', 'What does returned mean on my application?', 'A reviewer has sent the application back with a reason. You can edit it and send it again, and it goes back to the stage that returned it. If you change the declared efficiency, laboratory or test date after a rating exists, the rating is computed again.'),
  (6, 'application', 'Why was my application rejected?', 'A rejection is final and always has a written reason, visible in the application history. To try again you file a new application. The model number is free again once an application is rejected.'),
  (7, 'application', 'Which documents must I upload?', 'One test report in PDF format per application, up to 5 megabytes. Newer uploads become new versions and older versions are kept. The report should show the laboratory, the test date and the measured efficiency.'),
  (8, 'application', 'How long does a model application take?', 'The portal does not promise a time in this demonstration. Each stage shows who holds the application now. Fee confirmation, scrutiny, rating, director review and secretary approval each happen in turn.'),
  (9, 'fees', 'How is the application fee calculated?', 'The fee comes from the fee rule in force on the day you submit, for the category and the application type, plus tax where the rule says so. The amount is fixed on your application at submission and shown on the fee due screen. The rules shown are provisional local rules.'),
  (10, 'fees', 'How do I pay the fee?', 'In this demonstration the payment is simulated: pay at the simulated gateway from the fee due screen. In the base flow Finance records the receipt reference and the date received to confirm the fee. Nothing is sent to a real bank.'),
  (11, 'fees', 'My fee is confirmed but the application did not move', 'Confirmation moves the application to IAME scrutiny. If it is still at fee due, refresh the page and check the history for a fee confirmation event. If none is shown, contact the helpdesk with the application reference.'),
  (12, 'fees', 'Can a fee be refunded or corrected?', 'A wrongly confirmed fee can be corrected or reversed only through a proposal that a second person approves. The applicant cannot change it. Raise a helpdesk request with the reference and the reason.'),
  (13, 'certificate', 'When is my certificate issued?', 'When the secretary approves the application, a certificate is issued automatically with a registration id of the form BEE slash category slash year slash number. It is valid for three years under the provisional local rules.'),
  (14, 'certificate', 'How do I check that a certificate is valid?', 'Use the public verifier and enter the registration id or scan the QR code. It shows whether the certificate is active, pending or revoked, and the model and star rating it was issued for.'),
  (15, 'certificate', 'What does a revoked certificate mean?', 'A revoked certificate is no longer valid for the model. The register keeps the record with the date and reason. The public verifier shows it as revoked.'),
  (16, 'qr', 'What is the QR code on my product?', 'Each unit carries a serial that resolves to your certificate. Scanning it opens the public verifier. Serials are allocated to a batch for an approved model, then bound to the certificate.'),
  (17, 'qr', 'How do I get QR serials for my model?', 'After the model is approved, request a batch for the model and the quantity. Each serial is unique; a duplicate request is refused. Serials move from allocated to bound when attached to the certificate.'),
  (18, 'account', 'I cannot sign in or my code is not accepted', 'Sign in uses a one-time code from your authenticator app. Check the time on your device, and use the newest code. If you still cannot sign in, the helpdesk can check that your account is active. Never share your code.'),
  (19, 'account', 'How do I change who can act for my organisation?', 'Membership of an organisation and the role you hold are set by the administrator. Ask the administrator, giving your account name and the role needed. A temporary delegation can be arranged for a short period.'),
  (20, 'production', 'Why does the portal show a production anomaly warning?', 'A warning means the units in a quarter are unusual against your earlier quarters, or exceed the QR serials bound. It is advisory: a person looks at the evidence and decides. It is not a finding of any fault.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_demo_entity (entity_key, name, kind, applications, returned, rejected, resubmissions, efficiency_gap_pct, fee_delay_days, production_ratio) VALUES
  ('SYN-MFR-SUNRISE', 'Sunrise Electra (synthetic)', 'manufacturer', 6, 3, 1, 3, 9.4, 12.5, 2.8),
  ('SYN-MFR-FROST', 'FrostMax Industries (synthetic)', 'manufacturer', 8, 2, 2, 2, 6.1, 9.0, 3.6),
  ('SYN-MFR-GREEN', 'GreenVolt (synthetic)', 'manufacturer', 5, 0, 0, 0, 0.4, 2.0, 1.1),
  ('SYN-MFR-AQUA', 'AquaBreeze Pvt (synthetic)', 'manufacturer', 4, 1, 0, 1, 1.8, 5.5, 1.3),
  ('SYN-MDL-FROST15', 'FrostMax 1.5T (synthetic model)', 'model', 2, 1, 1, 1, 7.8, 10.0, 3.9),
  ('SYN-MDL-AQUA2', 'AquaBreeze 2T (synthetic model)', 'model', 1, 0, 0, 0, 0.9, 3.0, 1.0)
ON CONFLICT (entity_key) DO NOTHING;
INSERT INTO ai_demo_production (id, series_key, organisation, model_label, quarter, units, serials_bound) VALUES
  (1, 'SYN-S1', 'Nova Cool (synthetic)', 'NC-RAC-12D', '2025-Q1', 1200, NULL),
  (2, 'SYN-S1', 'Nova Cool (synthetic)', 'NC-RAC-12D', '2025-Q2', 1260, NULL),
  (3, 'SYN-S1', 'Nova Cool (synthetic)', 'NC-RAC-12D', '2025-Q3', 1180, NULL),
  (4, 'SYN-S1', 'Nova Cool (synthetic)', 'NC-RAC-12D', '2025-Q4', 1310, NULL),
  (5, 'SYN-S1', 'Nova Cool (synthetic)', 'NC-RAC-12D', '2026-Q1', 1250, NULL),
  (6, 'SYN-S1', 'Nova Cool (synthetic)', 'NC-RAC-12D', '2026-Q2', 4100, 3600),
  (7, 'SYN-S2', 'Nova Cool (synthetic)', 'NC-RAC-18F', '2025-Q1', 800, NULL),
  (8, 'SYN-S2', 'Nova Cool (synthetic)', 'NC-RAC-18F', '2025-Q2', 820, NULL),
  (9, 'SYN-S2', 'Nova Cool (synthetic)', 'NC-RAC-18F', '2025-Q3', 790, NULL),
  (10, 'SYN-S2', 'Nova Cool (synthetic)', 'NC-RAC-18F', '2025-Q4', 850, NULL),
  (11, 'SYN-S2', 'Nova Cool (synthetic)', 'NC-RAC-18F', '2026-Q1', 830, NULL),
  (12, 'SYN-S2', 'Nova Cool (synthetic)', 'NC-RAC-18F', '2026-Q2', 860, 4800),
  (13, 'SYN-S3', 'Aurora Air (synthetic)', 'AU-RAC-15X', '2025-Q1', 500, NULL),
  (14, 'SYN-S3', 'Aurora Air (synthetic)', 'AU-RAC-15X', '2025-Q2', 540, NULL),
  (15, 'SYN-S3', 'Aurora Air (synthetic)', 'AU-RAC-15X', '2025-Q3', 2100, NULL),
  (16, 'SYN-S3', 'Aurora Air (synthetic)', 'AU-RAC-15X', '2025-Q4', 520, NULL),
  (17, 'SYN-S3', 'Aurora Air (synthetic)', 'AU-RAC-15X', '2026-Q1', 510, NULL),
  (18, 'SYN-S3', 'Aurora Air (synthetic)', 'AU-RAC-15X', '2026-Q2', 530, NULL),
  (19, 'SYN-S4', 'Sunrise Electra (synthetic)', 'SE-RAC-20K', '2025-Q1', 300, NULL),
  (20, 'SYN-S4', 'Sunrise Electra (synthetic)', 'SE-RAC-20K', '2025-Q2', 320, NULL),
  (21, 'SYN-S4', 'Sunrise Electra (synthetic)', 'SE-RAC-20K', '2025-Q3', 310, NULL),
  (22, 'SYN-S4', 'Sunrise Electra (synthetic)', 'SE-RAC-20K', '2025-Q4', 330, NULL),
  (23, 'SYN-S4', 'Sunrise Electra (synthetic)', 'SE-RAC-20K', '2026-Q1', 340, NULL),
  (24, 'SYN-S4', 'Sunrise Electra (synthetic)', 'SE-RAC-20K', '2026-Q2', 360, NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_demo_rating (id, month, category, stars, iseer) VALUES
  (1, '2026-03', 'RAC', 3, 3.96),
  (2, '2026-03', 'RAC', 4, 4.17),
  (3, '2026-03', 'RAC', 4, 4.03),
  (4, '2026-03', 'RAC', 4, 4.24),
  (5, '2026-04', 'RAC', 4, 4.16),
  (6, '2026-04', 'RAC', 4, 4.02),
  (7, '2026-04', 'RAC', 4, 4.23),
  (8, '2026-04', 'RAC', 4, 4.09),
  (9, '2026-05', 'RAC', 4, 4.36),
  (10, '2026-05', 'RAC', 4, 4.22),
  (11, '2026-05', 'RAC', 4, 4.08),
  (12, '2026-05', 'RAC', 4, 4.29),
  (13, '2026-06', 'RAC', 4, 4.21),
  (14, '2026-06', 'RAC', 4, 4.42),
  (15, '2026-06', 'RAC', 4, 4.28),
  (16, '2026-06', 'RAC', 4, 4.14),
  (17, '2026-07', 'RAC', 4, 4.41),
  (18, '2026-07', 'RAC', 4, 4.27),
  (19, '2026-07', 'RAC', 4, 4.48),
  (20, '2026-07', 'RAC', 4, 4.34),
  (21, '2026-08', 'RAC', 4, 4.26),
  (22, '2026-08', 'RAC', 4, 4.47),
  (23, '2026-08', 'RAC', 4, 4.33),
  (24, '2026-08', 'RAC', 5, 4.54),
  (25, '2026-09', 'RAC', 4, 4.46),
  (26, '2026-09', 'RAC', 4, 4.32),
  (27, '2026-09', 'RAC', 5, 4.53),
  (28, '2026-09', 'RAC', 4, 4.39),
  (29, '2026-03', 'FAN', 3, 3.06),
  (30, '2026-03', 'FAN', 3, 3.27),
  (31, '2026-03', 'FAN', 3, 3.13),
  (32, '2026-03', 'FAN', 3, 3.34),
  (33, '2026-04', 'FAN', 3, 3.23),
  (34, '2026-04', 'FAN', 3, 3.09),
  (35, '2026-04', 'FAN', 3, 3.3),
  (36, '2026-04', 'FAN', 3, 3.16),
  (37, '2026-05', 'FAN', 3, 3.4),
  (38, '2026-05', 'FAN', 3, 3.26),
  (39, '2026-05', 'FAN', 3, 3.12),
  (40, '2026-05', 'FAN', 3, 3.33),
  (41, '2026-06', 'FAN', 3, 3.22),
  (42, '2026-06', 'FAN', 3, 3.43),
  (43, '2026-06', 'FAN', 3, 3.29),
  (44, '2026-06', 'FAN', 3, 3.15),
  (45, '2026-07', 'FAN', 3, 3.39),
  (46, '2026-07', 'FAN', 3, 3.25),
  (47, '2026-07', 'FAN', 3, 3.46),
  (48, '2026-07', 'FAN', 3, 3.32),
  (49, '2026-08', 'FAN', 3, 3.21),
  (50, '2026-08', 'FAN', 3, 3.42),
  (51, '2026-08', 'FAN', 3, 3.28),
  (52, '2026-08', 'FAN', 3, 3.49),
  (53, '2026-09', 'FAN', 3, 3.38),
  (54, '2026-09', 'FAN', 3, 3.24),
  (55, '2026-09', 'FAN', 3, 3.45),
  (56, '2026-09', 'FAN', 3, 3.31),
  (57, '2026-03', 'REF', 2, 2.46),
  (58, '2026-03', 'REF', 2, 2.67),
  (59, '2026-03', 'REF', 2, 2.53),
  (60, '2026-03', 'REF', 2, 2.74),
  (61, '2026-04', 'REF', 2, 2.58),
  (62, '2026-04', 'REF', 2, 2.44),
  (63, '2026-04', 'REF', 2, 2.65),
  (64, '2026-04', 'REF', 2, 2.51),
  (65, '2026-05', 'REF', 2, 2.7),
  (66, '2026-05', 'REF', 2, 2.56),
  (67, '2026-05', 'REF', 2, 2.42),
  (68, '2026-05', 'REF', 2, 2.63),
  (69, '2026-06', 'REF', 2, 2.47),
  (70, '2026-06', 'REF', 2, 2.68),
  (71, '2026-06', 'REF', 2, 2.54),
  (72, '2026-06', 'REF', 2, 2.4),
  (73, '2026-07', 'REF', 2, 2.59),
  (74, '2026-07', 'REF', 2, 2.45),
  (75, '2026-07', 'REF', 2, 2.66),
  (76, '2026-07', 'REF', 2, 2.52),
  (77, '2026-08', 'REF', 2, 2.36),
  (78, '2026-08', 'REF', 2, 2.57),
  (79, '2026-08', 'REF', 2, 2.43),
  (80, '2026-08', 'REF', 2, 2.64),
  (81, '2026-09', 'REF', 2, 2.48),
  (82, '2026-09', 'REF', 2, 2.34),
  (83, '2026-09', 'REF', 2, 2.55),
  (84, '2026-09', 'REF', 2, 2.41)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_demo_report_text (application_reference, report_text) VALUES
  ('LOCAL-MA-0004', 'TEST REPORT
Laboratory: Synthetic Test Laboratory
Date of test: 2026-08-14
Model: NC-RAC-24H
Measured ISEER: 4.62
This is a seeded sample report text (synthetic).'),
  ('LOCAL-MA-0002', 'TEST REPORT
Laboratory: Synthetic Test Laboratory
Date of test: 2026-07-09
Model: NC-RAC-18F
Measured ISEER: 4.10
This is a seeded sample report text (synthetic).'),
  ('LOCAL-MA-0003', 'TEST REPORT
Laboratory: Other Test House (synthetic)
Date of test: 2026-06-20
Model: AU-RAC-15X
Measured ISEER: 3.95
This is a seeded sample report text (synthetic).')
ON CONFLICT (application_reference) DO NOTHING;

INSERT INTO ai_kb (id, category, title, body) VALUES
  (21, 'fees', 'What does the fee of 10000 plus tax mean?', 'For a room air conditioner model in this demonstration the fee rule is 10000 rupees plus 18 percent tax, 11800 rupees in all. The figure is fixed when you submit and the simulated gateway cannot change it.'),
  (22, 'fees', 'Where do I see a payment receipt?', 'After a simulated payment is marked paid, open Payments and use the Receipt button on that row. The receipt number looks like SIMRCPT, then the date, then a serial. It is not a tax invoice.'),
  (23, 'fees', 'Why is a paid fee not yet confirmed?', 'Paying at the simulated gateway and Finance confirming the fee are two steps. Finance types the gateway reference in the Finance queue. Until then the reconciliation panel shows the payment as paid but not confirmed.'),
  (24, 'fees', 'A payment failed. Can I try again?', 'A failed simulated payment stays on the application as history. Start a new payment from the fee due row. Only one open or paid payment is allowed at a time.'),
  (25, 'qr', 'What is a QR batch?', 'A batch is a quantity of serials for one approved model and its certificate. You allocate serials from the batch, then bind a serial to a unit. The quantity is a ceiling, not a count of labels already printed.'),
  (26, 'qr', 'Why does a serial show as not found on the public page?', 'The public verifier answers not found for an unknown code, an allocated serial that is not yet bound, and a void serial. Only a bound serial resolves to a certificate.'),
  (27, 'qr', 'Can I bind the same serial twice?', 'No. The database refuses a duplicate in one request. Binding a serial that is already bound to the same certificate is treated as already done.'),
  (28, 'certificate', 'How long is a certificate valid?', 'Under the provisional local rules a certificate is valid for three years from the approval date. The ledger can record a shorter validity or a revocation; the certificate row itself is not edited.'),
  (29, 'certificate', 'What is the difference between pending and active on the ledger?', 'Pending means a second person has not yet committed the submission. Active means the issue was committed. The person who submitted it cannot commit it.'),
  (30, 'certificate', 'What does a ledger mismatch mean?', 'Verification recomputes every hash. A mismatch means a stored hash does not match the certificate fields. One seeded certificate is labelled as tampered so the check can be shown.'),
  (31, 'certificate', 'Can a certificate be renewed here?', 'Renewal is not built in this demonstration. When a certificate is close to its end date, the manufacturer files a new model application. The old registration id stays in the register.'),
  (32, 'application', 'What belongs in a test report?', 'The report should name the laboratory, the date of test, the model number and the measured efficiency. Upload one PDF, up to 5 megabytes. This demonstration does not call a real laboratory.'),
  (33, 'application', 'The extracted efficiency does not match. What now?', 'Document extraction only suggests values. Confirm or correct each field. Nothing is written back to the application until a person decides, and this tool never writes the application itself.'),
  (34, 'application', 'Which laboratory names are accepted?', 'The portal lists laboratories that have a synthetic accreditation in this local database. A name that is not on that list is refused at submit. The list is not the BEE laboratory list.'),
  (35, 'qr', 'What should be printed on the label?', 'The serial, beginning with BEEQ, and the registration id of the certificate. The public page reads the serial. This demonstration does not print labels or talk to a printer.'),
  (36, 'production', 'How do I file quarterly production?', 'Open Quarterly production, create the quarter, paste the model rows, validate them, attach the chartered accountant statement and submit. After submit the rows are closed unless the programme officer raises a query.'),
  (37, 'production', 'Why was my quarter flagged against QR serials?', 'Declared units are compared with serials bound to that model. If the units are more than about ten percent above the bound serials, the row is flagged for a person to read. The flag is not a penalty.'),
  (38, 'production', 'What is the chartered accountant file for?', 'It is stored and fingerprinted with SHA-256. Nobody in this demonstration opens it to check the figures. Say that it is recorded, not verified.'),
  (39, 'account', 'Who can see my organisation applications?', 'A manufacturer sees only their own organisation. Programme, director, secretary, admin and auditor see across organisations, each within the screens their role allows. Another manufacturer sees nothing of yours.'),
  (40, 'registration', 'How do I ask for a new brand name?', 'File a brand registration with the proposed name. Programme reviews it and the director approves it. Until it is approved the name is not on the register and cannot be used on a model application as a registered brand.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_demo_entity (entity_key, name, kind, applications, returned, rejected, resubmissions, efficiency_gap_pct, fee_delay_days, production_ratio) VALUES
  ('SYN-MFR-HARBOR', 'Harbor Breeze Cooling (synthetic)', 'manufacturer', 11, 4, 2, 4, 8.6, 14.0, 4.2),
  ('SYN-MFR-LUMEN', 'Lumen Frost Appliances (synthetic)', 'manufacturer', 9, 1, 0, 1, 1.2, 3.0, 1.1),
  ('SYN-MFR-CINDER', 'Cinder Peak Cooling (synthetic)', 'manufacturer', 7, 2, 1, 2, 4.4, 7.5, 1.8),
  ('SYN-MFR-MARIGOLD', 'Marigold Air Systems (synthetic)', 'manufacturer', 4, 0, 0, 0, 0.3, 1.5, 0.9),
  ('SYN-MFR-NORTH', 'Northwind Comforts (synthetic)', 'manufacturer', 6, 3, 2, 3, 11.2, 16.0, 5.4),
  ('SYN-MDL-HARBOR18', 'Harbor Breeze 1.8T (synthetic model)', 'model', 3, 2, 1, 2, 9.1, 13.0, 4.8),
  ('SYN-MDL-LUMEN12', 'Lumen Frost 1.2T (synthetic model)', 'model', 2, 0, 0, 0, 0.6, 2.0, 1.0),
  ('SYN-MDL-NORTH20', 'Northwind 2.0T (synthetic model)', 'model', 2, 1, 1, 1, 7.4, 11.0, 3.3)
ON CONFLICT (entity_key) DO NOTHING;

INSERT INTO ai_demo_production (id, series_key, organisation, model_label, quarter, units, serials_bound) VALUES
  (25, 'SYN-S5', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', '2025-Q1', 980, 1100),
  (26, 'SYN-S5', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', '2025-Q2', 1010, 1100),
  (27, 'SYN-S5', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', '2025-Q3', 990, 1100),
  (28, 'SYN-S5', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', '2025-Q4', 1040, 1100),
  (29, 'SYN-S5', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', '2026-Q1', 6400, 1100),
  (30, 'SYN-S5', 'Harbor Breeze (synthetic)', 'HB-RAC-18B', '2026-Q2', 1020, 1100),
  (31, 'SYN-S6', 'Northwind Comforts (synthetic)', 'NW-RAC-20A', '2025-Q1', 640, NULL),
  (32, 'SYN-S6', 'Northwind Comforts (synthetic)', 'NW-RAC-20A', '2025-Q2', 660, NULL),
  (33, 'SYN-S6', 'Northwind Comforts (synthetic)', 'NW-RAC-20A', '2025-Q3', 630, NULL),
  (34, 'SYN-S6', 'Northwind Comforts (synthetic)', 'NW-RAC-20A', '2025-Q4', 670, NULL),
  (35, 'SYN-S6', 'Northwind Comforts (synthetic)', 'NW-RAC-20A', '2026-Q1', 690, NULL),
  (36, 'SYN-S6', 'Northwind Comforts (synthetic)', 'NW-RAC-20A', '2026-Q2', 710, NULL),
  (37, 'SYN-S7', 'Cinder Peak (synthetic)', 'CP-RAC-18A', '2025-Q1', 1500, 1600),
  (38, 'SYN-S7', 'Cinder Peak (synthetic)', 'CP-RAC-18A', '2025-Q2', 1480, 1600),
  (39, 'SYN-S7', 'Cinder Peak (synthetic)', 'CP-RAC-18A', '2025-Q3', 1520, 1600),
  (40, 'SYN-S7', 'Cinder Peak (synthetic)', 'CP-RAC-18A', '2025-Q4', 1490, 1600),
  (41, 'SYN-S7', 'Cinder Peak (synthetic)', 'CP-RAC-18A', '2026-Q1', 1510, 1600),
  (42, 'SYN-S7', 'Cinder Peak (synthetic)', 'CP-RAC-18A', '2026-Q2', 1470, 1600)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_demo_report_text (application_reference, report_text) VALUES
  ('LOCAL-MA-0001', 'Laboratory report (synthetic)
Lab: Synthetic Test Laboratory
Tested on: 12 March 2026
Equipment model NC-RAC-12D
ISEER result 4.48
Cooling capacity 3.5 kW. This text is synthetic.'),
  ('DEMO-MA-0101', 'FORM TR-1
Issuing laboratory: Synthetic Test Laboratory
Date: 2026-01-20
Model under test: NC-RAC-12D
Declared ISEER 5.10 / measured ISEER 5.05
Star band suggested by the laboratory: 5. Synthetic sample, not a BEE report.'),
  ('DEMO-MA-0102', 'Summary of test — Synthetic Test Laboratory
Model NC-RAC-18F was tested on 18 January 2026.
Measured seasonal energy efficiency ratio: 4.55.
The full tables are not reproduced in this demonstration extract.')
ON CONFLICT (application_reference) DO NOTHING;

-- 24 months of ratings per category (October 2024 through September 2026). March to September 2026 are already seeded; this fills the earlier months.
-- Efficiency drifts upward so the trend line is not flat. The table has no monthly grain other than the month column.
DO $$
DECLARE
  m int;
  cat text;
  cats text[] := ARRAY['RAC', 'FAN', 'REF'];
  ci int;
  base numeric;
  iseer numeric;
  stars int;
  month_key text;
BEGIN
  FOR ci IN 1..3 LOOP
    cat := cats[ci];
    base := CASE cat WHEN 'RAC' THEN 3.70 WHEN 'FAN' THEN 2.70 ELSE 2.10 END;
    FOR m IN 0..16 LOOP
      month_key := to_char(date '2024-10-01' + (m || ' months')::interval, 'YYYY-MM');
      iseer := round(base + m * 0.04 + 0.05, 2);
      stars := CASE WHEN iseer >= 5 THEN 5 WHEN iseer >= 4.50 THEN 4 WHEN iseer >= 4.00 THEN 3 WHEN iseer >= 3.50 THEN 2 ELSE 1 END;
      INSERT INTO ai_demo_rating (id, month, category, stars, iseer) VALUES
        (1000 + ci * 100 + m * 2, month_key, cat, stars, iseer),
        (1000 + ci * 100 + m * 2 + 1, month_key, cat, greatest(1, stars - 1), round(iseer - 0.15, 2))
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO ai_run (id, use_case, model_version, data_version, input_ref, output, confidence, created_at, created_by) VALUES
  ('00000000-0000-4000-c000-00000000a601', 'compliance-risk', '1.0.0', 'a601c0ffee01', 'SYN-MFR-NORTH',
   '{"summary":"Northwind Comforts ranks high for review","band":"high","top":"SYN-MFR-NORTH"}'::jsonb, 0.820, now() - interval '6 days', '00000000-0000-4000-a000-000000000006'),
  ('00000000-0000-4000-c000-00000000a602', 'compliance-risk', '1.0.0', 'a602c0ffee02', 'SYN-MFR-LUMEN',
   '{"summary":"Lumen Frost ranks low","band":"low","top":"SYN-MFR-LUMEN"}'::jsonb, 0.640, now() - interval '5 days', '00000000-0000-4000-a000-000000000006'),
  ('00000000-0000-4000-c000-00000000a603', 'production-anomaly', '1.0.0', 'a603c0ffee03', 'SYN-S5',
   '{"summary":"Harbor Breeze 2026-Q1 is a spike against earlier quarters","series":"SYN-S5","flagged":true}'::jsonb, 0.910, now() - interval '4 days', '00000000-0000-4000-a000-000000000006'),
  ('00000000-0000-4000-c000-00000000a604', 'rating-trends', '1.0.0', 'a604c0ffee04', 'RAC',
   '{"summary":"Room air conditioner efficiency has drifted upward since October 2024","category":"RAC","direction":"up"}'::jsonb, 0.730, now() - interval '3 days', '00000000-0000-4000-a000-000000000006'),
  ('00000000-0000-4000-c000-00000000a605', 'helpdesk-assist', '1.0.0', 'a605c0ffee05', 'How do I pay the fee?',
   '{"summary":"Draft answer from the fee article","escalated":false}'::jsonb, 0.780, now() - interval '2 days', '00000000-0000-4000-a000-000000000010'),
  ('00000000-0000-4000-c000-00000000a606', 'document-extraction', '1.0.0', 'a606c0ffee06', 'LOCAL-MA-0004',
   '{"summary":"Extracted laboratory, date and efficiency","reference":"LOCAL-MA-0004"}'::jsonb, 0.560, now() - interval '1 day', '00000000-0000-4000-a000-000000000005')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_disposition (id, run_id, actor_account_id, actor_role, decision, reason, override_value, at) VALUES
  ('00000000-0000-4000-c000-00000000a611', '00000000-0000-4000-c000-00000000a601', '00000000-0000-4000-a000-000000000006', 'programme', 'accept', NULL, NULL, now() - interval '6 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a612', '00000000-0000-4000-c000-00000000a602', '00000000-0000-4000-a000-000000000006', 'programme', 'override', 'Treated as medium because two returns are still open (synthetic)', 'medium', now() - interval '5 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a613', '00000000-0000-4000-c000-00000000a603', '00000000-0000-4000-a000-000000000006', 'programme', 'accept', NULL, NULL, now() - interval '4 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a614', '00000000-0000-4000-c000-00000000a604', '00000000-0000-4000-a000-000000000007', 'director', 'accept', NULL, NULL, now() - interval '3 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a615', '00000000-0000-4000-c000-00000000a605', '00000000-0000-4000-a000-000000000010', 'helpdesk', 'override', 'Reworded the draft before it would be sent (synthetic)', 'Pay at the simulated gateway, then wait for Finance to confirm the gateway reference.', now() - interval '2 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a616', '00000000-0000-4000-c000-00000000a606', '00000000-0000-4000-a000-000000000005', 'reviewer', 'reject', 'The extract missed the laboratory address line (synthetic)', NULL, now() - interval '1 day' + interval '1 hour')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_audit_event (id, run_id, action, actor_account_id, actor_role, detail, at) VALUES
  ('00000000-0000-4000-c000-00000000a621', '00000000-0000-4000-c000-00000000a601', 'run', '00000000-0000-4000-a000-000000000006', 'programme', 'Seeded compliance-risk run', now() - interval '6 days'),
  ('00000000-0000-4000-c000-00000000a622', '00000000-0000-4000-c000-00000000a601', 'disposition', '00000000-0000-4000-a000-000000000006', 'programme', 'Accepted', now() - interval '6 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a623', '00000000-0000-4000-c000-00000000a602', 'run', '00000000-0000-4000-a000-000000000006', 'programme', 'Seeded compliance-risk run', now() - interval '5 days'),
  ('00000000-0000-4000-c000-00000000a624', '00000000-0000-4000-c000-00000000a602', 'disposition', '00000000-0000-4000-a000-000000000006', 'programme', 'Overridden to medium', now() - interval '5 days' + interval '1 hour'),
  ('00000000-0000-4000-c000-00000000a625', '00000000-0000-4000-c000-00000000a603', 'run', '00000000-0000-4000-a000-000000000006', 'programme', 'Seeded production-anomaly run', now() - interval '4 days'),
  ('00000000-0000-4000-c000-00000000a626', '00000000-0000-4000-c000-00000000a606', 'disposition', '00000000-0000-4000-a000-000000000005', 'reviewer', 'Rejected', now() - interval '1 day' + interval '1 hour')
ON CONFLICT (id) DO NOTHING;
COMMIT;
