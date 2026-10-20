-- DEMO: the date each sample brand entered the register. The earlier seeds wrote every brand on the day they ran, so the register showed one
-- date for all of them; each brand now carries a date after its owner became a permittee (or in early 2025 for the older sample makers).
-- Synthetic data only. Idempotent: only a brand still stamped with a seed-day date is changed.
BEGIN;
UPDATE brand b SET recorded_at = (
    COALESCE((SELECT pa.activated_at FROM manufacturer_onboarding_permittee_activation pa WHERE pa.organisation_id = b.owner_organisation_id), timestamptz '2025-02-03 10:00:00+05:30')
    + ((abs(hashtext(b.name)) % 75 + 7) || ' days')::interval)
 WHERE b.recorded_at >= timestamptz '2026-10-19 00:00:00+05:30';
COMMIT;
