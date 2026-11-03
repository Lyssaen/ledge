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
  await panes.sendText('c', process.env.BRACKET ? `\x1b[200~${LONG}\x1b[201~` : LONG);
  const typedMs = Date.now() - t;
  // With WAITDRAFT: first wait for Codex to show the whole draft (the paste folded, or the text in the input line).
  let draftMs = -1;
  if (process.env.WAITDRAFT) { const t1 = Date.now(); while (Date.now() - t1 < 10000) { const p = (await panes.capture('c', 200)) ?? ''; const input = p.split('\n').filter(l => /^›/.test(l)).at(-1) ?? ''; if (/\[Pasted Content \d+ chars\]/.test(input)) { draftMs = Date.now() - t1; break; } await sleep(50); } }
  await sleep(d);
  await panes.sendKeys('c', ['Enter']);
  await sleep(2500);
  const pane = (await panes.capture('c', 200)) ?? '';
  const submitted = /esc to interrupt|Working|Worked for|^• /m.test(pane) && !/\[Pasted Content/.test(pane.split('\n').filter(l => /^›/.test(l)).at(-1) ?? '');
  const draftHasText = pane.split('\n').some(l => /^›\s+\S/.test(l) && /Ligne/.test(l));
  console.log(JSON.stringify({ delayMs: d, typedMs, draftMs, submitted, draftStillHolds: draftHasText && !submitted }));
  if (process.env.SHOW) console.log(pane.split('\n').filter(l => l.trim() && !/[⣿⠿⢸]/.test(l)).slice(-14).map(l => '|' + l.slice(0, 160)).join('\n'));
  await panes.killSession('c');
}
process.exit(0);
