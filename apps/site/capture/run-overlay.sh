#!/usr/bin/env bash
# Regenerates notch.mp4 and the notch60-*.png stills (0.60.0; zz-notch-video-058.spec.ts is the 0.58.0 story): copies the temporary files into apps/overlay/e2e, runs them, removes them.
set -u
# ZZ_LANG=en records the English version into $SITE_CAPTURE_OUT/en/ (French, into $SITE_CAPTURE_OUT/video/, otherwise).
if [ "${ZZ_LANG:-fr}" = en ]; then export ZZ_OUT="${SITE_CAPTURE_OUT:-/tmp/ledge-site-capture}/en/"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"; E2E=$REPO/apps/overlay/e2e
cp "$HERE/zz-rec.ts" "$E2E/zz-rec.ts"; cp "$HERE/zz-notch-video.spec.ts" "$E2E/zz-notch-video.spec.ts"
cd "$REPO" && pnpm --filter overlay exec playwright test e2e/zz-notch-video.spec.ts --workers=1 "$@"; RC=$?
rm -f "$E2E/zz-rec.ts" "$E2E/zz-notch-video.spec.ts"
exit $RC
