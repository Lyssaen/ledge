// How long after a long text Codex takes Enter as "submit" rather than a newline inside a paste (spike, ConPTY).
//   tsx codex-enter.ts <cwd> <delay-ms>...
import { conptyPanes } from '../../packages/ledge/src/panes/conpty.js';
import { adapterFor } from '../../packages/ledge/src/adapters/index.js';
const [cwd, ...delays] = process.argv.slice(2);
const LONG = Array.from({ length: 24 }, (_, i) => `Ligne ${i + 1} : le renard brun et rapide saute par-dessus le chien paresseux, encore et encore, fin.`).join(' ') + ' Réponds seulement OK.';
const sleep = (t: number) => new Promise(r => setTimeout(r, t));
const codex = adapterFor('codex');
for (const d of delays.map(Number)) {
  const panes = conptyPanes();
  await panes.newSession({ name: 'c', cwd, env: process.env as Record<string, string>, command: ['codex'] });
  const end = Date.now() + 30000;
  while (Date.now() < end && !codex.atRest!((await panes.capture('c', 200)) ?? '')) await sleep(200);
  await sleep(1500);
  const t = Date.now();
  await panes.sendText('c', LONG);
  const typedMs = Date.now() - t;
  await sleep(d);
  await panes.sendKeys('c', ['Enter']);
  await sleep(2500);
  const pane = (await panes.capture('c', 200)) ?? '';
  const submitted = /esc to interrupt|Working|Worked for/.test(pane);
  const draftHasText = pane.split('\n').some(l => /^›\s+\S/.test(l) && /Ligne/.test(l));
  console.log(JSON.stringify({ delayMs: d, typedMs, submitted, draftStillHolds: draftHasText && !submitted }));
  await panes.killSession('c');
}
process.exit(0);
