#!/usr/bin/env bash
# Regenerates the English Desktop stills (desktop-*.png): ZZ_LANG=en ZZ_GPU_OFF=1 ./run-stills.sh
set -u
if [ "${ZZ_LANG:-fr}" = en ]; then export ZZ_OUT="${SITE_CAPTURE_OUT:-/tmp/ledge-site-capture}/en/"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"; E2E=$REPO/apps/desktop/e2e
cp "$HERE/zz-rec.ts" "$E2E/zz-rec.ts"; cp "$HERE/zz-stills.spec.ts" "$E2E/zz-stills.spec.ts"
cd "$REPO" && pnpm --filter desktop exec playwright test e2e/zz-stills.spec.ts --workers=2 "$@"; RC=$?
rm -f "$E2E/zz-rec.ts" "$E2E/zz-stills.spec.ts"
exit $RC
