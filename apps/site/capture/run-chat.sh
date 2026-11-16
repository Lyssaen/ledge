#!/usr/bin/env bash
# Regenerates chat.mp4 (0.60.0, Ledge the operator): copies the temporary files into apps/desktop/e2e, runs them, removes them.
# ZZ_GPU_OFF=1 launches Chromium with --disable-gpu --disable-gpu-compositing --disable-software-rasterizer.
set -u
# ZZ_LANG=en records the English version into $SITE_CAPTURE_OUT/en/ (French, into $SITE_CAPTURE_OUT/video/, otherwise).
if [ "${ZZ_LANG:-fr}" = en ]; then export ZZ_OUT="${SITE_CAPTURE_OUT:-/tmp/ledge-site-capture}/en/"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"; E2E=$REPO/apps/desktop/e2e
cp "$HERE/zz-rec.ts" "$E2E/zz-rec.ts"; cp "$HERE/zz-chat-video.spec.ts" "$E2E/zz-chat-video.spec.ts"
# zz-daemon.ts: e2e/daemon.ts with the chat answer paced (steps one by one, the text streamed in small deltas).
python3 - "$E2E" <<'PY'
import sys
d=sys.argv[1]; s=open(d+'/daemon.ts').read()
a=s.index("        for (const step of steps) ws.send(JSON.stringify({ type: 'chat.step'")
b=s.index("\n", s.index("ws.send(JSON.stringify({ type: 'chat.done'", a))
done=s[s.index("        ws.send(JSON.stringify({ type: 'chat.done'", a):b].strip()
paced="""        void (async () => {
          const nap = (ms: number) => new Promise(r => setTimeout(r, ms));
          const say = (m: unknown) => { try { ws.send(JSON.stringify(m)); } catch { /* the page is gone */ } };
          await nap(500);
          for (const step of steps) { say({ type: 'chat.step', qid: msg.qid, step }); await nap(520); }
          const words = reply.text.split(/(?<=\\s)/);
          for (let i = 0; i < words.length; i += 2) { say({ type: 'chat.delta', qid: msg.qid, text: words.slice(i, i + 2).join('') }); await nap(60); }
          await nap(300);
          try { %s } catch { /* the page is gone */ }
        })();""" % done
open(d+'/zz-daemon.ts','w').write(s[:a]+paced+s[b:])
PY
cd "$REPO" && pnpm --filter desktop exec playwright test e2e/zz-chat-video.spec.ts --workers=1 "$@"; RC=$?
rm -f "$E2E/zz-rec.ts" "$E2E/zz-chat-video.spec.ts" "$E2E/zz-daemon.ts"
exit $RC
