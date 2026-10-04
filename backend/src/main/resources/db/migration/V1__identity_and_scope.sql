-- Identity and scope foundation (ADR-001 D-RT3). Keycloak identifies the user;
-- these tables are the authority for active roles, organisation membership,
-- stage assignment and record scope. No model workflow tables yet.

CREATE TABLE organisation (
  id          uuid PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  kind        text NOT NULL CHECK (kind IN ('manufacturer', 'agency', 'bee', 'iame', 'sda', 'laboratory')),
  legal_name  text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_account (
  id                uuid PRIMARY KEY,
  keycloak_subject  uuid NOT NULL UNIQUE,
  username          text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organisation_membership (
  user_id          uuid NOT NULL REFERENCES user_account (id),
  organisation_id  uuid NOT NULL REFERENCES organisation (id),
  active           boolean NOT NULL DEFAULT true,
  valid_from       timestamptz NOT NULL DEFAULT '-infinity',
  valid_to         timestamptz NOT NULL DEFAULT 'infinity',
  PRIMARY KEY (user_id, organisation_id)
);

CREATE TABLE role_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account (id),
  role        text NOT NULL CHECK (role IN ('admin', 'programme', 'reviewer', 'director', 'secretary', 'finance', 'helpdesk', 'auditor',
                                             'manufacturer', 'agency', 'iame', 'sda', 'laboratory')),
  scope       text NOT NULL CHECK (scope IN ('all', 'own-org', 'assigned')),
  active      boolean NOT NULL DEFAULT true,
  valid_from  timestamptz NOT NULL DEFAULT '-infinity',
  valid_to    timestamptz NOT NULL DEFAULT 'infinity',
  UNIQUE (user_id, role),
  CHECK (role NOT IN ('manufacturer', 'agency', 'iame', 'sda', 'laboratory') OR scope <> 'all')
);

-- Stage assignment for assigned-scope roles (IAME, Reviewer and later SDA, laboratory).
-- The subject tables arrive with the model workflow in WP05; none are assigned yet.
CREATE TABLE assignment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account (id),
  subject_type  text NOT NULL CHECK (subject_type IN ('model_application')),
  subject_id    uuid NOT NULL,
  stage         text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, subject_type, subject_id, stage)
);

CREATE TABLE seed_run (
  id            bigserial PRIMARY KEY,
  seed_version  text NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now()
);
