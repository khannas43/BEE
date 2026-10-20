-- Demonstration: the label fee for production (paid per financial-year quarter) and the link of QR batches (serial numbers) to a production line
-- (a model in a financial-year quarter). Written only through the demonstration API (/api/demo/production-details). No foreign keys.
-- Local demonstration, not BEE rules: the fee rate is a placeholder until Schedules A and B of the 2026 Regulations are given.
CREATE TABLE label_fee_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  organisation_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  fy_quarter smallint NOT NULL CHECK (fy_quarter BETWEEN 1 AND 4),
  units bigint NOT NULL CHECK (units > 0),
  amount_inr numeric(14, 2) NOT NULL CHECK (amount_inr > 0),
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'paid', 'failed')),
  method text CHECK (method IN ('billdesk', 'razorpay', 'direct_transfer')),
  gateway_ref text,
  receipt_number text,
  started_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (order_id, fy_quarter)
);
CREATE UNIQUE INDEX label_fee_payment_open ON label_fee_payment (organisation_id, financial_year, fy_quarter) WHERE status IN ('initiated', 'paid');
COMMENT ON TABLE label_fee_payment IS 'Demonstration: the label fee of one financial-year quarter; one order may cover several quarters.';

CREATE TABLE production_line_batch (
  batch_id uuid PRIMARY KEY,
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  fy_quarter smallint NOT NULL CHECK (fy_quarter BETWEEN 1 AND 4)
);
CREATE INDEX production_line_batch_line ON production_line_batch (financial_year, fy_quarter);
COMMENT ON TABLE production_line_batch IS 'Demonstration: which production line (the batch''s model, in this financial-year quarter) a QR batch of serial numbers belongs to.';

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_local_maint') THEN
    EXECUTE format('GRANT SELECT, DELETE ON %I.label_fee_payment, %I.production_line_batch TO bee_local_maint', home_schema, home_schema);
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I.label_fee_payment TO bee_runtime', home_schema);
    EXECUTE format('GRANT SELECT, INSERT ON %I.production_line_batch TO bee_runtime', home_schema);
  END IF;
END $$;
