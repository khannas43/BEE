-- WP05.1c: registry is a local marker; FK blocked maint model delete (KEY SHARE).

ALTER TABLE local_disposable_application
  DROP CONSTRAINT IF EXISTS local_disposable_application_application_id_fkey;
