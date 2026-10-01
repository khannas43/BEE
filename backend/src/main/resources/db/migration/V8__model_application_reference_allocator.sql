-- WP05.1b: serial reference allocation for LOCAL-MA-* (concurrent-safe; V7 unchanged).

CREATE TABLE model_application_reference_allocator (
  scope      text PRIMARY KEY,
  next_value integer NOT NULL CHECK (next_value >= 0)
);

INSERT INTO model_application_reference_allocator (scope, next_value)
SELECT 'LOCAL-MA', COALESCE(MAX(CAST(substring(reference FROM 10) AS integer)), 0)
FROM model_application
WHERE reference LIKE 'LOCAL-MA-%';
