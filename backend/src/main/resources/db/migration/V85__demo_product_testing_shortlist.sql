-- Demonstration: a product is shortlisted for testing (by the risk ranking, a risk-weighted draw or a grievance) and the BEE Officer then approves it
-- for testing or declines, with remarks. Adds the two stages (shortlisted, not_approved) and the Officer's decision to test_case.
-- Local demonstration, not BEE rules.
ALTER TABLE test_case DROP CONSTRAINT test_case_stage_check;
ALTER TABLE test_case ADD CONSTRAINT test_case_stage_check CHECK (stage IN ('shortlisted', 'not_approved', 'selected', 'procured', 'at_lab', 'result_in', 'closed'));
ALTER TABLE test_case ADD COLUMN approval_remarks text CHECK (char_length(approval_remarks) <= 500);
ALTER TABLE test_case ADD COLUMN approved_by uuid;
ALTER TABLE test_case ADD COLUMN approved_at timestamptz;
