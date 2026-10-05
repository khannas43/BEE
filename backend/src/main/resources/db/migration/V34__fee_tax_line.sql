-- BL-132 (owner's assumption A1, 4 October 2026, not BEE's decision): tax is a separate line on the fee. Provisional local rules.
--
-- The rate comes from the fee rule version the application was submitted under and is kept on the snapshot, so a later rule
-- never changes a fee already given. Tax and total are DERIVED by the database from the amount and the rate (tax = amount x rate
-- / 100, rounded half up to the paisa; total = amount + tax), so they cannot disagree with the amount. Rows that exist already
-- have rate 0, tax 0 and total equal to the amount.
ALTER TABLE model_application_fee_snapshot
  ADD COLUMN tax_rate_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent BETWEEN 0 AND 100),
  ADD COLUMN tax_inr numeric(14,2) GENERATED ALWAYS AS (round(amount_inr * tax_rate_percent / 100, 2)) STORED,
  ADD COLUMN total_inr numeric(14,2) GENERATED ALWAYS AS (amount_inr + round(amount_inr * tax_rate_percent / 100, 2)) STORED;
