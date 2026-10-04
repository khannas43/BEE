-- WP04.1 correction: close an open-ended master version and add its successor, atomically
-- (docs/wp04/WP04.1_MASTERS.md §3).
--
-- V4 rows stay immutable. A closure is a separate, immutable record that gives an
-- open-ended version an end date; the version row itself, its payload and its NULL
-- effective_to are kept exactly as first recorded. The effective end of a version is
-- coalesce(closure.effective_to, version.effective_to), still half-open [from, end).
--
-- The only way to write a closure is master_supersede(), which in one statement locks the
-- rule key, records the closure (who, on what authority, why) and inserts the successor
-- starting on the closure date. A failure anywhere rolls back both.

CREATE TABLE master_closure (
  master_table       text NOT NULL CHECK (master_table IN ('master_category', 'master_standard', 'master_lab_accreditation', 'master_fee_rule', 'master_rating_formula')),
  rule_key           text NOT NULL,
  version            integer NOT NULL,
  effective_to       date NOT NULL,
  successor_version  integer NOT NULL CHECK (successor_version > version),
  closed_by          text NOT NULL CHECK (length(trim(closed_by)) > 0),
  source_reference   text NOT NULL CHECK (length(trim(source_reference)) > 0),
  reason             text NOT NULL CHECK (length(trim(reason)) > 0),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (master_table, rule_key, version),
  UNIQUE (master_table, rule_key, successor_version)
);

-- Replaces the V4 body: overlap is now judged on the effective end, so a closed version
-- no longer blocks a successor that starts on (or after) its closure date.
CREATE OR REPLACE FUNCTION master_reject_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  clash integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME), hashtext(NEW.rule_key));
  -- an existing (rule_key, version) is left to the unique constraint, so a repeat seed's
  -- ON CONFLICT DO NOTHING still skips a version that has since been closed and succeeded
  EXECUTE format('SELECT version FROM %I.%I WHERE rule_key = $1 AND version = $2', TG_TABLE_SCHEMA, TG_TABLE_NAME)
    INTO clash USING NEW.rule_key, NEW.version;
  IF clash IS NOT NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT t.version FROM %1$I.%2$I t LEFT JOIN %1$I.master_closure c ON c.master_table = %3$L AND c.rule_key = t.rule_key AND c.version = t.version '
                 'WHERE t.rule_key = $1 AND t.version <> $4 AND daterange(t.effective_from, coalesce(c.effective_to, t.effective_to), ''[)'') && daterange($2, $3, ''[)'') LIMIT 1',
                 TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_TABLE_NAME)
    INTO clash USING NEW.rule_key, NEW.effective_from, NEW.effective_to, NEW.version;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23P01',
      MESSAGE = format('%s %s v%s [%s, %s) overlaps v%s', TG_TABLE_NAME, NEW.rule_key, NEW.version, NEW.effective_from, coalesce(NEW.effective_to::text, 'open'), clash);
  END IF;
  RETURN NEW;
END $$;

-- Validates every closure, however it is inserted; refuses any not made by master_supersede().
CREATE FUNCTION master_closure_check() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_from date;
  v_to   date;
  found  boolean;
BEGIN
  IF current_setting('bee.master_supersede', true) IS DISTINCT FROM NEW.master_table || ':' || NEW.rule_key || ':' || NEW.version THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'master closures are written only by master_supersede()';
  END IF;
  EXECUTE format('SELECT true, effective_from, effective_to FROM %I.%I WHERE rule_key = $1 AND version = $2', TG_TABLE_SCHEMA, NEW.master_table)
    INTO found, v_from, v_to USING NEW.rule_key, NEW.version;
  IF found IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('%s %s v%s does not exist', NEW.master_table, NEW.rule_key, NEW.version);
  END IF;
  IF EXISTS (SELECT 1 FROM master_closure c WHERE c.master_table = NEW.master_table AND c.rule_key = NEW.rule_key AND c.version = NEW.version) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = format('%s %s v%s is already closed', NEW.master_table, NEW.rule_key, NEW.version);
  END IF;
  IF v_to IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s %s v%s already ends on %s; only an open-ended version can be closed', NEW.master_table, NEW.rule_key, NEW.version, v_to);
  END IF;
  IF NEW.effective_to <= v_from THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('closure date %s must be after %s v%s starts (%s)', NEW.effective_to, NEW.rule_key, NEW.version, v_from);
  END IF;
  RETURN NEW;
END $$;

-- At commit: every closure has its successor starting on the closure date.
CREATE FUNCTION master_closure_has_successor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  EXECUTE format('SELECT true FROM %I.%I WHERE rule_key = $1 AND version = $2 AND effective_from = $3', TG_TABLE_SCHEMA, NEW.master_table)
    INTO ok USING NEW.rule_key, NEW.successor_version, NEW.effective_to;
  IF ok IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = format('closure of %s %s v%s has no successor v%s starting %s', NEW.master_table, NEW.rule_key, NEW.version, NEW.successor_version, NEW.effective_to);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER check_closure BEFORE INSERT ON master_closure FOR EACH ROW EXECUTE FUNCTION master_closure_check();
CREATE CONSTRAINT TRIGGER closure_has_successor AFTER INSERT ON master_closure DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION master_closure_has_successor();
CREATE TRIGGER reject_row_change BEFORE UPDATE OR DELETE ON master_closure FOR EACH ROW EXECUTE FUNCTION master_reject_change();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON master_closure FOR EACH STATEMENT EXECUTE FUNCTION master_reject_change();

-- Closes open-ended version p_version of p_rule_key on p_effective_to and inserts the
-- successor (version max + 1) for [p_effective_to, successor's effective_to). p_successor is
-- the successor's payload and provenance as JSON object keyed by column name; the key,
-- version, start, id, legacy_id and recorded_at are set here and may not be supplied.
-- Returns the successor's version. Internal: no route or permission calls it yet.
CREATE FUNCTION master_supersede(p_table text, p_rule_key text, p_version integer, p_effective_to date,
                                 p_closed_by text, p_source_reference text, p_reason text, p_successor jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  rel     regclass;
  schema  text;
  v_next    integer;
  bad     text;
BEGIN
  IF p_table IS NULL OR p_table NOT IN ('master_category', 'master_standard', 'master_lab_accreditation', 'master_fee_rule', 'master_rating_formula') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s is not a master table', coalesce(p_table, 'null'));
  END IF;
  IF p_effective_to IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'a closure needs a closure date';
  END IF;
  IF p_successor IS NULL OR jsonb_typeof(p_successor) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'the successor must be a JSON object';
  END IF;
  rel := p_table::regclass;
  SELECT n.nspname INTO schema FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace WHERE r.oid = rel;
  SELECT string_agg(k, ', ' ORDER BY k) INTO bad FROM jsonb_object_keys(p_successor) k
  WHERE k IN ('id', 'rule_key', 'version', 'effective_from', 'legacy_id', 'recorded_at')
     OR k NOT IN (SELECT attname FROM pg_attribute WHERE attrelid = rel AND attnum > 0 AND NOT attisdropped);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('successor may not set: %s', bad);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(schema || '.' || p_table), hashtext(p_rule_key));
  EXECUTE format('SELECT max(version) + 1 FROM %s WHERE rule_key = $1', rel) INTO v_next USING p_rule_key;

  PERFORM set_config('bee.master_supersede', p_table || ':' || p_rule_key || ':' || p_version, true);
  INSERT INTO master_closure (master_table, rule_key, version, effective_to, successor_version, closed_by, source_reference, reason)
  VALUES (p_table, p_rule_key, p_version, p_effective_to, coalesce(v_next, p_version + 1), p_closed_by, p_source_reference, p_reason);
  PERFORM set_config('bee.master_supersede', '', true);

  EXECUTE format('INSERT INTO %1$s SELECT * FROM jsonb_populate_record(NULL::%1$s, $1)', rel)
    USING p_successor || jsonb_build_object('id', gen_random_uuid(), 'rule_key', p_rule_key, 'version', v_next,
                                            'effective_from', p_effective_to, 'legacy_id', NULL, 'recorded_at', now());
  RETURN v_next;
END $$;
