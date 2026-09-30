#!/usr/bin/env bash
# Compile the matrix and the navigation policy it is checked against, then run
# the WP01.2 matrix and WP01.3 acceptance-map checks. Pass --write to
# regenerate docs/wp01/SCREEN_ACTION_MATRIX.md and ACCEPTANCE_MAPPING.md;
# without it the script fails if either document is stale.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
npx tsc lib/roles.ts lib/categories.ts lib/screens.ts lib/screenMatrix.ts lib/acceptanceMap.ts \
  --outDir "$BUILD" --module commonjs --target es2022 \
  --moduleResolution node --skipLibCheck --esModuleInterop >/dev/null
AA_BUILD="$BUILD" node scripts/screen-matrix.cjs "$@"
