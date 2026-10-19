#!/usr/bin/env bash
# npm run demo:reset — puts this laptop into the clean demonstration state, from any state:
# demo sign-in on, rehearsal guest accounts removed, fresh data and the demo seeds, and the demonstration applicant `ravik24` re-created.
# Takes about two minutes. Keeps ngrok closed. Never pushes or touches git.
set -euo pipefail
cd "$(dirname "$0")/../.."
export BEE_DEMO_LOGIN=1 BEE_MFA_REQUIRED=false
npm run local:down
npm run local:up
npm run local:reset:identity      # re-imports the Keycloak realm: removes every guest account made while rehearsing
npm run local:reset               # app data back to the normal seed
bash scripts/local/ensure-runtime-role.sh
node scripts/demo/login-setup.cjs apply
npm run demo:seed
bash scripts/demo/ensure-ravik24.sh   # the demonstration applicant is re-created after every reset, so it is never lost
node scripts/demo/end-sessions.cjs
echo
echo "Demo ready: http://127.0.0.1:3100/login   (password demo123 for every demo account)"
