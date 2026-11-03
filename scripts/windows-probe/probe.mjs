// ConPTY probe for the native-Windows study (docs/superpowers/specs/2026-11-03-windows-native-daemon-study.md §6.3).
// Starts the real `claude` in a 120x40 ConPTY (node-pty), mirrors its output into a headless xterm, and checks what the
// tmux-based adapters rely on: reading the screen with wrapped-line flags, typing, Ctrl+U, `/exit` + Enter, exit code.
// Submits no prompt.
//
// Usage (Windows, in a folder where `npm i node-pty @xterm/headless` was run):
//   node probe.mjs [path\to\claude.exe] [--out dir] [--timeout ms]
// Writes capture-*.txt and result.json into --out (default: the current folder).
import { spawn } from 'node-pty';
import xterm from '@xterm/headless';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { Terminal } = xterm;
const COLS = 120, ROWS = 40;
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const out = opt('--out', process.cwd());
const timeout = Number(opt('--timeout', '60000'));
const claude = args[0] ?? execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
mkdirSync(out, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
const log = (...a) => console.log(`[${String(ms()).padStart(6)} ms]`, ...a);

const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: 2000, allowProposedApi: true });
let raw = '';
log('spawn', claude);
const pty = spawn(claude, [], { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: process.cwd(), env: process.env });
let exit = null;
const exited = new Promise(r => pty.onExit(e => { exit = { ...e, atMs: ms() }; r(e); }));
pty.onData(d => { raw += d; term.write(d); });

// The whole buffer (scrollback + screen), one entry per row, with xterm's isWrapped flag: what `capture-pane -J` joins.
const lines = () => {
  const b = term.buffer.active, rows = [];
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i); rows.push({ i, wrapped: l.isWrapped, text: l.translateToString(true) }); }
  return rows;
};
// Settles the parser: write('') resolves once everything written before it is parsed.
const flush = () => new Promise(r => term.write('', r));
const screenText = async () => { await flush(); return lines().map(l => l.text).join('\n'); };
const capture = async (name) => {
  await flush();
  const rows = lines();
  const last = rows.findLastIndex(r => r.text.trim());
  const body = rows.slice(0, last + 1).map(r => `${String(r.i).padStart(3)}${r.wrapped ? '~' : '|'}${r.text}`).join('\n');
  writeFileSync(join(out, `capture-${name}.txt`), body + '\n');
  log(`capture ${name}: ${last + 1} rows, ${rows.filter(r => r.wrapped).length} wrapped`);
  return rows;
};
const waitFor = async (pred, label, limit = timeout) => {
  const end = performance.now() + limit;
  while (performance.now() < end && !exit) { if (pred(await screenText())) return true; await sleep(100); }
  log(`timeout/exit waiting for ${label}`);
  return false;
};
const type = async (s, gap = 40) => { for (const c of s) { pty.write(c); await sleep(gap); } };

// Claude Code's input box: a full-width rule and a prompt line starting with ❯ or >.
const inputBox = t => /^─{20,}/m.test(t) && /^\s*[❯>]( | |$)/m.test(t) && !/trust (the files in )?this folder/i.test(t);
const result = { claude, cols: COLS, rows: ROWS, cwd: process.cwd(), timings: {} };
try {
  const ready = await waitFor(inputBox, 'input box');
  result.timings.inputBoxMs = ready ? ms() : null;
  await capture('1-ready');
  if (!ready) { result.blockedOn = (await screenText()).split('\n').filter(l => l.trim()).slice(0, 12); throw new Error('no input box'); }
  await sleep(500);
  await type('bonjour');
  result.typed = await waitFor(t => /[❯>]\s*bonjour/.test(t), 'bonjour echoed', 5000);
  await sleep(300);
  await capture('2-typed');
  pty.write('\x15'); // Ctrl+U
  result.ctrlUCleared = await waitFor(t => !/bonjour/.test(t), 'Ctrl+U cleared', 5000);
  await sleep(300);
  await capture('3-ctrl-u');
  await type('/exit');
  await sleep(150);
  const exitAt = ms();
  pty.write('\r');
  await Promise.race([exited, sleep(15000)]);
  result.exitedOnSlashExit = !!exit;
  result.timings.exitAfterEnterMs = exit ? exit.atMs - exitAt : null;
  if (!exit) await capture('4-no-exit');
} catch (e) {
  result.error = String(e.message ?? e);
} finally {
  if (!exit) { pty.kill(); await Promise.race([exited, sleep(3000)]); result.killed = true; }
  result.exit = exit;
  result.timings.totalMs = ms();
  result.rawBytes = raw.length;
  // Unicode sanity: box-drawing and the prompt glyph seen in the raw stream, and any replacement char.
  result.unicode = { boxDrawing: /[─│╭╮╰╯]/.test(raw), promptGlyph: raw.includes('❯'), replacementChar: raw.includes('�') };
  writeFileSync(join(out, 'raw.txt'), raw);
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  log('result', JSON.stringify(result));
  term.dispose();
  process.exit(0);
}
