-- WP05.1c: draft → fee_due submission with immutable event and fee snapshot at submit time.

CREATE TABLE model_application_submission_event (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id         uuid NOT NULL REFERENCES model_application (id),
  from_state             text NOT NULL,
  to_state               text NOT NULL,
  actor_account_id       uuid NOT NULL REFERENCES user_account (id),
  actor_role             text NOT NULL,
  filing_organisation_id uuid NOT NULL REFERENCES organisation (id),
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_event_one_per_application UNIQUE (application_id)
);

CREATE TABLE model_application_fee_snapshot (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       uuid NOT NULL REFERENCES model_application (id),
  submission_event_id  uuid NOT NULL REFERENCES model_application_submission_event (id),
  amount_inr           numeric(14, 2) NOT NULL,
  currency             text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  fee_rule_key         text NOT NULL,
  fee_rule_version     integer NOT NULL,
  verification_status  text NOT NULL CHECK (verification_status IN ('synthetic', 'provisional', 'verified')),
  source_reference     text,
  note                 text,
  captured_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_snapshot_one_per_application UNIQUE (application_id)
);

CREATE INDEX model_application_submission_event_app ON model_application_submission_event (application_id);
