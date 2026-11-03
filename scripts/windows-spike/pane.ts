// Runs an agent in a ConPTY pane as the daemon does, then prints its capture and what the adapter reads in it.
//   tsx pane.ts <tool> <cwd> <ms> [key,key,...]  (tmux key names, each 2 s apart)
import { conptyPanes } from '../../packages/ledge/src/panes/conpty.js';
import { adapterFor } from '../../packages/ledge/src/adapters/index.js';
import { AGENT_BIN } from '../../packages/ledge/src/spawn.js';
const [tool, cwd, ms, keys] = process.argv.slice(2) as ['claude' | 'codex', string, string, string?];
const panes = conptyPanes();
await panes.newSession({ name: 'probe', cwd, env: process.env as Record<string, string>, command: [AGENT_BIN[tool]] });
const sleep = (t: number) => new Promise(r => setTimeout(r, t));
const show = async (label: string) => {
  const pane = (await panes.capture('probe', 200)) ?? '';
  const a = adapterFor(tool);
  console.log(`=== ${label}: atRest=${a.atRest?.(pane)} prompt=${JSON.stringify(a.detectPrompt(pane))}`);
  console.log(pane.split('\n').filter(l => !/[⣿⠿⢸]/.test(l)).map(l => '|' + l).join('\n'));
};
await sleep(Number(ms)); await show(`after ${ms} ms`);
for (const k of (keys ? keys.split(",") : [])) { await panes.sendKeys('probe', [k]); await sleep(2000); await show(`after ${k}`); }
await panes.killSession('probe'); process.exit(0);
