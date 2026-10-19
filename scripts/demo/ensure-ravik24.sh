#!/usr/bin/env bash
# npm run demo:ensure-ravik24 — makes sure the demonstration applicant `ravik24` (password demo123) exists.
# Safe to run any time: if the account is already there the sign-up is refused and nothing changes.
set -euo pipefail
WEB="${BEE_WEB_URL:-http://127.0.0.1:3100}"
code=$(curl -s -o /tmp/ensure-ravik24.out -w "%{http_code}" -X POST "$WEB/api/runtime/public/manufacturer-signup" \
  -H 'content-type: application/json' -H "Idempotency-Key: demo-ravik24-$(date +%s)-ensure" \
  -d '{"legalName":"Ravik Appliances Pvt Ltd","fullName":"Ravi Kumar","username":"ravik24","email":"ravik24@example.invalid","mobile":"9876543210","password":"demo123"}')
case "$code" in
  201) echo "ravik24 created (password demo123)";;
  409) echo "ravik24 already exists";;
  *)   echo "could not ensure ravik24: HTTP $code $(cat /tmp/ensure-ravik24.out)"; exit 1;;
esac
