-- DEMO: the demonstration accounts carry a person's name, so the top bar reads like a real sign-in (name, then role or company beneath).
-- The accounts, usernames and roles are unchanged; only the display name differs. Synthetic names. Idempotent.
-- Note: the base seed (local/seed/seed.sql) writes the generic names back, so this file runs after it in demo:seed.
BEGIN;
UPDATE user_account SET display_name = v.name FROM (VALUES
  ('bee.officer',     'Ramesh Shukla'),
  ('bee.director',    'Anita Deshmukh'),
  ('bee.finance',     'Sunita Rao'),
  ('bee.programme',   'Vikram Sethi'),
  ('bee.admin',       'Neha Kapoor'),
  ('bee.reviewer',    'Manoj Iyer'),
  ('bee.auditor',     'Rajiv Bansal'),
  ('bee.helpdesk',    'Kavita Joshi'),
  ('iame.officer',    'Prakash Menon'),
  ('nova.applicant',  'Rohan Malhotra'),
  ('pixel.applicant', 'Arjun Verma')
) AS v(username, name) WHERE user_account.username = v.username AND user_account.display_name <> v.name;
COMMIT;
