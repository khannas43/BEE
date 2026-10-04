-- WP05.1b: brand linkage on new model applications, idempotency store for draft writes.
-- Existing rows keep NULL principal_organisation_id and brand_id (legacy brand_name text only).

ALTER TABLE model_application
  ADD COLUMN principal_organisation_id uuid REFERENCES organisation (id),
  ADD COLUMN brand_id uuid REFERENCES brand (id);

CREATE INDEX model_application_brand ON model_application (brand_id) WHERE brand_id IS NOT NULL;

-- Idempotency scope: account + method + route template + target record id (zero UUID for create).
CREATE TABLE idempotency_record (
  account_id         uuid NOT NULL REFERENCES user_account (id),
  http_method        text NOT NULL CHECK (http_method IN ('POST', 'PATCH')),
  route_template     text NOT NULL,
  target_record_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  idempotency_key    text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9-]{16,64}$'),
  body_hash          bytea NOT NULL,
  in_progress        boolean NOT NULL DEFAULT true,
  response_status    integer,
  response_body      jsonb,
  record_version     integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  PRIMARY KEY (account_id, http_method, route_template, target_record_id, idempotency_key)
);

CREATE INDEX idempotency_record_created ON idempotency_record (created_at);
