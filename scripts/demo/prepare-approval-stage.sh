#!/usr/bin/env bash
# npm run demo:prepare-approval — the demonstration start state: clean data, `ravik24` signed up and its company registration
# already submitted, so it is waiting in the BEE Officer's queue for approval, plus two registrations on hold with an anomaly
# (Anomalies and holds). Takes about eight minutes.
# Re-run it to bring the registration back to the approval stage after it has been approved (the earlier record is cleared by the reset).
set -euo pipefail
cd "$(dirname "$0")/../.."
export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false
bash scripts/demo/reset-demo.sh
node scripts/demo/prepare-ravik24-submission.cjs
node scripts/demo/prepare-hold-cases.cjs
