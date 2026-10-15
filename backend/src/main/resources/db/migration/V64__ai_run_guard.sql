-- Demo slice S6: a stored run's output must be a JSON object that carries an evidence array (every output shows its evidence).
ALTER TABLE ai_run
  ADD CONSTRAINT ai_run_output_shape CHECK (jsonb_typeof(output) = 'object' AND jsonb_typeof(output -> 'evidence') = 'array');
