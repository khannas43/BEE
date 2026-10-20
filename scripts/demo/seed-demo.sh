#!/usr/bin/env bash
# npm run demo:seed — the demonstration data on top of the normal seed. Idempotent. Synthetic data only (docs/demo/DEMO_WORK_PLAN.md).
# Not for the gate: run it AFTER local:check, because some live checks count seeded records.
source "$(dirname "$0")/../local/lib.sh"
container_running bee-local-postgres || die "postgres is not running (npm run local:up)"
bash "$ROOT/scripts/local/seed.sh"
for f in s4_production s2_qr s5_mis s3_ledger s1_payments s6_ai s7_register s8_registrations s9_wp3_wp9_showcase s10_officer_cases s11_register_reasons s12_notifications s13_ai_entities s14_company_profiles s15_brand_dates s16_person_names s18_expiry_samples s17_approved_model_details s19_quarterly_tests_and_requests s20_ledger_backfill s21_sign_in_activity s22_product_testing s23_product_shortlist s24_product_testing_decisions s25_production_details; do
  [[ -f "$ROOT/local/seed/demo/$f.sql" ]] || { log "skip $f (no file)"; continue; }
  { echo "SET bee.demo_seeding = 'on';"; cat "$ROOT/local/seed/demo/$f.sql"; } | psql_app >/dev/null || die "demo seed $f failed"
  log "demo seed applied: $f"
done
