-- WP05.1c: avoid model delete CASCADE on registry; cleanup deletes registry explicitly.

ALTER TABLE local_disposable_application
  DROP CONSTRAINT IF EXISTS local_disposable_application_application_id_fkey;

ALTER TABLE local_disposable_application
  ADD CONSTRAINT local_disposable_application_application_id_fkey
  FOREIGN KEY (application_id) REFERENCES model_application (id) ON DELETE NO ACTION;
