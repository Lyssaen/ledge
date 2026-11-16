#!/usr/bin/env bash
# Regenerates rig.mp4: copies the temporary files into apps/desktop/e2e, runs them, removes them.
set -u
# ZZ_LANG=en records the English version into $SITE_CAPTURE_OUT/en/ (French, into $SITE_CAPTURE_OUT/video/, otherwise).
if [ "${ZZ_LANG:-fr}" = en ]; then export ZZ_OUT="${SITE_CAPTURE_OUT:-/tmp/ledge-site-capture}/en/"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"; E2E=$REPO/apps/desktop/e2e
cp "$HERE/zz-rec.ts" "$E2E/zz-rec.ts"; cp "$HERE/zz-rig-video.spec.ts" "$E2E/zz-rig-video.spec.ts"
cd "$REPO" && pnpm --filter desktop exec playwright test e2e/zz-rig-video.spec.ts --workers=1 "$@"; RC=$?
rm -f "$E2E/zz-rec.ts" "$E2E/zz-rig-video.spec.ts"
exit $RC
