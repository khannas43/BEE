-- WP02.2: the smallest model-application record needed to prove scoped list and
-- read access. WP04 and WP05 own the full schema (brand, fees, rating, history).
-- States are the FIRST_SLICE.md §4 state machine; no transition is implemented yet.
CREATE TABLE model_application (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE,
  organisation_id  uuid NOT NULL REFERENCES organisation (id),
  brand_name       text NOT NULL,
  category         text NOT NULL CHECK (category IN ('RAC')),
  model_number     text NOT NULL,
  state            text NOT NULL CHECK (state IN ('draft', 'fee_due', 'iame_scrutiny', 'bee_scrutiny', 'rating',
                                                  'director_review', 'secretary_approval', 'approved', 'returned', 'rejected')),
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX model_application_organisation ON model_application (organisation_id);
CREATE INDEX assignment_subject ON assignment (subject_type, subject_id) WHERE active;
