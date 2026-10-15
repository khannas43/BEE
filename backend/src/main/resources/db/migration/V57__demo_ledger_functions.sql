-- DEMO S3: the simulated ledger's writes. Role checks are made by the Spring module; these functions hold the state rules and the
-- segregation rule (the person who submitted a transaction, or whose role they hold by delegation, cannot commit or fail it).
-- Every function returns a result code as text (never raises for a refusal) and the transaction id.

CREATE FUNCTION ledger_append(p_cert uuid, p_kind text, p_actor uuid, p_valid_to date, p_reason text, p_attempt integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  c      certificate%ROWTYPE;
  last   ledger_tx%ROWTYPE;
  v_seq  integer;
  v_prev text;
  v_id   uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM certificate WHERE id = p_cert;
  SELECT * INTO last FROM ledger_tx WHERE certificate_id = p_cert ORDER BY seq DESC LIMIT 1;
  v_seq := coalesce(last.seq, 0) + 1;
  v_prev := coalesce(last.hash, repeat('0', 64));
  INSERT INTO ledger_tx (id, certificate_id, seq, attempt, kind, state, prev_hash, hash, valid_to, reason, submitted_by)
  VALUES (v_id, p_cert, v_seq, p_attempt, p_kind, 'pending', v_prev,
          ledger_compute_hash(v_prev, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars,
                              c.verified_iseer, c.valid_from, p_valid_to, p_kind, v_seq),
          p_valid_to, p_reason, p_actor);
  RETURN v_id;
END $$;

-- The date the certificate is valid to on the ledger: the last committed amendment, else the certificate's own date.
CREATE FUNCTION ledger_effective_valid_to(p_cert uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT coalesce((SELECT t.valid_to FROM ledger_tx t WHERE t.certificate_id = p_cert AND t.kind = 'amend' AND t.state = 'committed'
                    ORDER BY t.seq DESC LIMIT 1), (SELECT valid_to FROM certificate WHERE id = p_cert))
$$;

CREATE FUNCTION ledger_submit(p_cert uuid, p_actor uuid) RETURNS TABLE (out_result text, out_tx uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE v_tx uuid; v_vt date;
BEGIN
  PERFORM 1 FROM certificate WHERE id = p_cert FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_cert::text));
  IF EXISTS (SELECT 1 FROM ledger_tx WHERE certificate_id = p_cert) THEN
    RETURN QUERY SELECT 'already_submitted'::text, NULL::uuid; RETURN;
  END IF;
  SELECT valid_to INTO v_vt FROM certificate WHERE id = p_cert;
  v_tx := ledger_append(p_cert, 'issue', p_actor, v_vt, NULL, 1);
  INSERT INTO ledger_event (certificate_id, tx_id, action, actor_account_id) VALUES (p_cert, v_tx, 'submit', p_actor);
  RETURN QUERY SELECT 'ok'::text, v_tx;
END $$;

-- p_outcome: commit or fail. Refusals: not_found, nothing_pending, segregation_refused.
CREATE FUNCTION ledger_decide(p_cert uuid, p_actor uuid, p_acting uuid[], p_outcome text, p_reason text) RETURNS TABLE (out_result text, out_tx uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE t ledger_tx%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('commit', 'fail') OR (p_outcome = 'fail' AND (p_reason IS NULL OR btrim(p_reason) = '')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_cert::text));
  IF NOT EXISTS (SELECT 1 FROM certificate WHERE id = p_cert) THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  SELECT * INTO t FROM ledger_tx WHERE certificate_id = p_cert AND state = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'nothing_pending'::text, NULL::uuid; RETURN; END IF;
  IF t.submitted_by = ANY (coalesce(p_acting, ARRAY[]::uuid[])) OR t.submitted_by = p_actor THEN
    RETURN QUERY SELECT 'segregation_refused'::text, t.id; RETURN;
  END IF;
  IF p_outcome = 'commit' THEN
    UPDATE ledger_tx SET state = 'committed', committed_at = now(), decided_by = p_actor WHERE id = t.id;
  ELSE
    UPDATE ledger_tx SET state = 'failed', failure_reason = btrim(p_reason), decided_by = p_actor WHERE id = t.id;
  END IF;
  INSERT INTO ledger_event (certificate_id, tx_id, action, actor_account_id, reason) VALUES (p_cert, t.id, p_outcome, p_actor, p_reason);
  RETURN QUERY SELECT 'ok'::text, t.id;
END $$;

-- A new attempt after a failed transaction: same kind, attempt + 1, pending again; the failed one stays in the chain.
CREATE FUNCTION ledger_retry(p_cert uuid, p_actor uuid) RETURNS TABLE (out_result text, out_tx uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE last ledger_tx%ROWTYPE; v_tx uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_cert::text));
  IF NOT EXISTS (SELECT 1 FROM certificate WHERE id = p_cert) THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  SELECT * INTO last FROM ledger_tx WHERE certificate_id = p_cert ORDER BY seq DESC LIMIT 1;
  IF NOT FOUND OR last.state <> 'failed' THEN RETURN QUERY SELECT 'not_failed'::text, NULL::uuid; RETURN; END IF;
  v_tx := ledger_append(p_cert, last.kind, p_actor, last.valid_to, last.reason, last.attempt + 1);
  INSERT INTO ledger_event (certificate_id, tx_id, action, actor_account_id) VALUES (p_cert, v_tx, 'retry', p_actor);
  RETURN QUERY SELECT 'ok'::text, v_tx;
END $$;

-- Amend (kind amend, only valid_to) or revoke. Refusals: not_found, not_active (issue not committed, or already revoked), busy (a transaction is
-- pending or failed), no_change (same date), date_invalid.
CREATE FUNCTION ledger_change(p_cert uuid, p_actor uuid, p_kind text, p_valid_to date, p_reason text) RETURNS TABLE (out_result text, out_tx uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE c certificate%ROWTYPE; last ledger_tx%ROWTYPE; v_eff date; v_tx uuid;
BEGIN
  IF p_kind NOT IN ('amend', 'revoke') OR p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'validation_failed';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_cert::text));
  SELECT * INTO c FROM certificate WHERE id = p_cert;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM ledger_tx WHERE certificate_id = p_cert AND kind = 'issue' AND state = 'committed')
     OR EXISTS (SELECT 1 FROM ledger_tx WHERE certificate_id = p_cert AND kind = 'revoke' AND state = 'committed') THEN
    RETURN QUERY SELECT 'not_active'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO last FROM ledger_tx WHERE certificate_id = p_cert ORDER BY seq DESC LIMIT 1;
  IF last.state <> 'committed' THEN RETURN QUERY SELECT 'busy'::text, NULL::uuid; RETURN; END IF;
  v_eff := ledger_effective_valid_to(p_cert);
  IF p_kind = 'amend' THEN
    IF p_valid_to IS NULL OR p_valid_to <= c.valid_from THEN RETURN QUERY SELECT 'date_invalid'::text, NULL::uuid; RETURN; END IF;
    IF p_valid_to = v_eff THEN RETURN QUERY SELECT 'no_change'::text, NULL::uuid; RETURN; END IF;
  ELSE
    p_valid_to := v_eff;
  END IF;
  v_tx := ledger_append(p_cert, p_kind, p_actor, p_valid_to, btrim(p_reason), 1);
  INSERT INTO ledger_event (certificate_id, tx_id, action, actor_account_id, reason) VALUES (p_cert, v_tx, p_kind, p_actor, btrim(p_reason));
  RETURN QUERY SELECT 'ok'::text, v_tx;
END $$;

REVOKE ALL ON FUNCTION ledger_append(uuid, text, uuid, date, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_effective_valid_to(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_submit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_decide(uuid, uuid, uuid[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_retry(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_change(uuid, uuid, text, date, text) FROM PUBLIC;
