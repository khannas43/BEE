-- Brief 19C-B1: trusted read of the latest return bound to the application's open cycle.

CREATE OR REPLACE FUNCTION registration_return_response_latest_open_cycle_return(p_application_id uuid)
RETURNS TABLE (
  return_id uuid,
  returned_from_stage text,
  reason text,
  returned_at timestamptz,
  returned_by_account_id uuid,
  returned_by_role text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT r.id,
         r.returned_from_state,
         r.reason,
         r.returned_at,
         r.returned_by_account_id,
         te.actor_role
    FROM registration_return_response_cycle c
    JOIN registration_return_response_cycle_return cr ON cr.cycle_id = c.id
    JOIN registration_application_return r ON r.id = cr.return_id
    JOIN registration_transition_event te ON te.id = r.transition_event_id
   WHERE c.application_id = p_application_id
     AND c.status = 'open'
   ORDER BY r.returned_at DESC, r.id DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION registration_return_response_latest_open_cycle_return(uuid) FROM PUBLIC;

DO $$
DECLARE
  home_schema text := current_schema();
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.registration_return_response_latest_open_cycle_return(uuid) SET search_path = %I, pg_temp',
    home_schema, home_schema);
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bee_runtime') THEN
    EXECUTE format(
      'REVOKE SELECT ON %I.registration_return_response_cycle_return FROM bee_runtime',
      home_schema);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.registration_return_response_latest_open_cycle_return(uuid) TO bee_runtime',
      home_schema);
  END IF;
END $$;
