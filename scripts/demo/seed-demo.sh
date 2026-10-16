#!/usr/bin/env bash
# npm run demo:seed — the demonstration data on top of the normal seed. Idempotent. Synthetic data only (docs/demo/DEMO_WORK_PLAN.md).
# Not for the gate: run it AFTER local:check, because some live checks count seeded records.
source "$(dirname "$0")/../local/lib.sh"
container_running bee-local-postgres || die "postgres is not running (npm run local:up)"
bash "$ROOT/scripts/local/seed.sh"
for f in s4_production s2_qr s5_mis s3_ledger s1_payments s6_ai; do
  [[ -f "$ROOT/local/seed/demo/$f.sql" ]] || { log "skip $f (no file)"; continue; }
  { echo "SET bee.demo_seeding = 'on';"; cat "$ROOT/local/seed/demo/$f.sql"; } | psql_app >/dev/null || die "demo seed $f failed"
  log "demo seed applied: $f"
done
