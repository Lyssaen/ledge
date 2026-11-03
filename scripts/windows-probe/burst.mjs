// Input-burst probe (spike, Task 7): how much of a long text typed into Claude Code through ConPTY reaches it, by way
// of writing it. Each variant types the same ~2.5 KB text, waits, presses Enter, waits for the turn to end, then reads
// the user prompt Claude recorded in its transcript. Harmless prompt ("Réponds seulement OK.").
//   node burst.mjs <work folder>   (in a folder where node-pty and @xterm/headless are installed)
import { spawn } from 'node-pty';
import xterm from '@xterm/headless';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cwd = process.argv[2];
const claude = execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TIMES = Number(process.argv[4] ?? 1);
const TEXT = Array.from({ length: 24 * TIMES }, (_, i) => `Ligne ${i + 1} : le renard brun et rapide saute par-dessus le chien paresseux, encore et encore, fin.`).join(' ') + ' Réponds seulement OK.';
const id = randomUUID();
const transcript = join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
const term = new xterm.Terminal({ cols: 200, rows: 50, scrollback: 5000, allowProposedApi: true });
const pty = spawn(claude, ['--session-id', id], { name: 'xterm-256color', cols: 200, rows: 50, cwd, env: process.env });
let raw = ''; pty.onData(d => { raw += d; term.write(d); });
const screen = () => new Promise(r => term.write('', () => { const b = term.buffer.active, out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString(true)); r(out.join('\n')); }));
const atRest = async () => { const t = await screen(); return /^─{20,}\n[>❯][ \u00a0]/m.test(t) && !/esc to interrupt|…\s*\(/.test(t.split('\n').slice(-12).join('\n')); };
const waitRest = async (ms = 120000) => { const end = Date.now() + ms; await sleep(1500); while (Date.now() < end) { if (await atRest()) return true; await sleep(300); } return false; };
const prompts = () => existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type === 'user' && typeof e.message?.content === 'string').map(e => e.message.content) : [];

const variants = [
  ['one write', async () => { pty.write(TEXT); }],
  ['chunks 256 / 20 ms', async () => { for (let i = 0; i < TEXT.length; i += 256) { pty.write(TEXT.slice(i, i + 256)); await sleep(20); } }],
  ['chunks 64 / 10 ms', async () => { for (let i = 0; i < TEXT.length; i += 64) { pty.write(TEXT.slice(i, i + 64)); await sleep(10); } }],
  ['bracketed paste', async () => { pty.write(`\x1b[200~${TEXT}\x1b[201~`); }],
];

// One variant per run (argv[3]): a fresh Claude each time, so nothing a variant left in the input box leaks into the next.
const pick = variants.find(([n]) => n === process.argv[3]) ?? variants[0];
if (!(await waitRest(60000))) { console.log('no input box'); pty.kill(); process.exit(1); }
const [name, type] = pick;
// argv[5]: ms to wait once the input box shows, before typing (separates a start-up race from burst loss).
await sleep(Number(process.argv[5] ?? 0));
const t = Date.now();
await type();
// Wait for the input box to settle: the same screen for 600 ms (Claude may still be taking a burst in).
let last = '', stableSince = Date.now();
while (Date.now() - stableSince < 600 && Date.now() - t < 15000) { const s = await screen(); if (s !== last) { last = s; stableSince = Date.now(); } await sleep(100); }
const draft = last.split('\n').filter(l => /^[>❯][  ]/.test(l)).at(-1)?.slice(0, 80);
pty.write('\r');
await sleep(1000);
const afterEnter = (await screen()).split('\n').filter(l => /^[>❯][ \u00a0]/.test(l)).at(-1)?.slice(0, 60);
const spinner = /esc to interrupt|…/.test((await screen()).split('\n').slice(-15).join('\n'));
await waitRest();
const got = prompts().at(-1) ?? '';
const body = got.replace(/^<pasted_content[^>]*>\n?/, '').replace(/\n?<\/pasted_content>$/, '');
console.log(JSON.stringify({ afterEnter, spinner, variant: name, text: TEXT.length, settledMs: Date.now() - t, draft, received: got.length, whole: body.trim() === TEXT, lost: TEXT.length - body.trim().length, startsWith: body.slice(0, 30) }));
pty.write('/exit'); await sleep(150); pty.write('\r'); await sleep(3000); try { pty.kill(); } catch {}
process.exit(0);
