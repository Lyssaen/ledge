// The go/no-go checks of the Windows ConPTY spike (design §4.1), played against a running spike daemon as a front would:
// launch, prompts, states, permission, question, hooks, interrupt and kill, Windows glyphs.
//   tsx drive.ts all|launch|prompt|permission|question|interrupt --tool claude|codex
// One JSON line per event on stdout, one result line per check; the preview of each step is saved under
// %TEMP%\ledge-spike\out. It answers only what the daemon parsed as `pending`; it never types raw keys into a dialog.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { Session, ServerMessage, ClientMessage, ThreadItem } from '@ledge/protocol';
import { connect, type Client } from '../../packages/ledge/src/client.js';

const S = join(tmpdir(), 'ledge-spike');
const WORK = join(S, 'work'), OUT = join(S, 'out');
const argv = process.argv.slice(2);
const which = argv[0] ?? 'all';
const tool = (argv[argv.indexOf('--tool') + 1] ?? 'claude') as 'claude' | 'codex';
mkdirSync(OUT, { recursive: true });
// Claude asks before writing a file only outside auto mode: the work folder pins the default mode.
mkdirSync(join(WORK, '.claude'), { recursive: true });
writeFileSync(join(WORK, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }, null, 2) + '\n');

const t0 = Date.now();
const emit = (o: object) => console.log(JSON.stringify({ ms: Date.now() - t0, ...o }));
const sessions = new Map<string, Session>();
const previews = new Map<string, string[]>();
const threads = new Map<string, ThreadItem[]>();
let client!: Client;

/** Reads every message the daemon sends, keeping the last state of each session and its preview. */
async function pump() {
  for (;;) {
    let m: ServerMessage;
    try { m = await client.nextOf(['snapshot', 'session.updated', 'session.preview', 'session.thread', 'error'] as const, 3_600_000) as ServerMessage; } catch { return; }
    if (m.type === 'snapshot') for (const s of m.sessions) sessions.set(s.id, s);
    else if (m.type === 'session.updated') {
      const prev = sessions.get(m.session.id);
      sessions.set(m.session.id, m.session);
      if (prev?.state !== m.session.state || JSON.stringify(prev?.pending) !== JSON.stringify(m.session.pending))
        emit({ ev: 'state', id: m.session.id, state: m.session.state, pending: m.session.pending ? { kind: m.session.pending.kind, text: m.session.pending.text.slice(0, 120), options: m.session.pending.options } : undefined });
    } else if (m.type === 'session.preview') previews.set(m.id, m.lines);
    else if (m.type === 'session.thread') threads.set(m.id, m.items);
    else if (m.type === 'error') emit({ ev: 'daemon-error', message: (m as { message?: string }).message });
  }
}
const send = (msg: ClientMessage) => client.send(msg);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const save = (id: string, label: string) => { const f = join(OUT, `${tool}-${label}.txt`); writeFileSync(f, (previews.get(id) ?? []).join('\n') + '\n'); return f; };
/** A dialog on screen that the daemon did not parse: answering it blind is what the spike must never do. */
const strayDialog = (id: string) => {
  const s = sessions.get(id); const text = (previews.get(id) ?? []).join('\n');
  return !s?.pending && /Enter to confirm|Esc to cancel|Do you trust|trust this (folder|directory)|Press enter to continue/i.test(text);
};
async function until(id: string, pred: (s: Session) => boolean, ms: number, label: string) {
  const end = Date.now() + ms; let stray = 0;
  while (Date.now() < end) {
    const s = sessions.get(id);
    if (s && pred(s)) return s;
    stray = strayDialog(id) ? stray + 1 : 0;
    if (stray > 30) throw new Error(`${label}: a dialog Ledge did not parse is on screen (${save(id, `stray-${label}`)})`);
    await sleep(100);
  }
  throw new Error(`${label}: timeout, state ${sessions.get(id)?.state} (${save(id, `timeout-${label}`)})`);
}
const idle = (s: Session) => s.state === 'idle';
async function thread(id: string) { threads.delete(id); send({ type: 'session.thread', id }); const end = Date.now() + 5000; while (!threads.has(id) && Date.now() < end) await sleep(50); return threads.get(id) ?? []; }
const procs = () => { try { return execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).split('\n').filter(l => /"(claude|codex)\.exe"/i.test(l)).length; } catch { return -1; } };

type Check = { n: number; name: string; run: (id: string) => Promise<string> };
const result = (n: number, name: string, pass: boolean, why: string) => emit({ check: n, name, tool, pass, why });

/** Sends a prompt as a front does, then waits for the turn to run and end; returns the states seen. */
async function turn(id: string, text: string, label: string, ms = 180_000) {
  const seen: string[] = [];
  const watch = setInterval(() => { const st = sessions.get(id)?.state; if (st && seen.at(-1) !== st) seen.push(st); }, 50);
  send({ type: 'session.reply', id, text });
  try { await until(id, s => s.state !== 'idle', 20_000, `${label}-start`); await until(id, s => idle(s) || s.state.startsWith('waiting'), ms, `${label}-end`); }
  finally { clearInterval(watch); }
  save(id, label);
  return seen;
}

const LONG = Array.from({ length: 24 }, (_, i) => `Ligne ${i + 1} : le renard brun et rapide saute par-dessus le chien paresseux, encore et encore, ${'·'.repeat(10)} fin.`).join('\n') + '\nRéponds seulement OK.';

const checks: Check[] = [
  { n: 2, name: 'prompt', run: async id => {
    const a = await turn(id, 'Réponds seulement OK.', 'prompt-short');
    const b = await turn(id, LONG, 'prompt-long');
    const prompts = (await thread(id)).filter(i => i.kind === 'prompt').map(i => (i as { text: string }).text);
    const long = prompts.filter(p => p.includes('Ligne 24'));
    if (long.length !== 1) throw new Error(`the long prompt arrived ${long.length} times`);
    if (long[0]!.replace(/\s+/g, ' ').trim() !== LONG.replace(/\s+/g, ' ').trim()) throw new Error(`the long prompt arrived changed (${long[0]!.length} vs ${LONG.length} chars)`);
    // Check 3 rides on these turns: working while it runs, idle after.
    result(3, 'states', a.includes('working') && b.includes('working') && idle(sessions.get(id)!), `short ${a.join('→')}, long ${b.join('→')}`);
    // Check 6: the prompts in the thread come from the agent's hooks.
    const s = sessions.get(id)!;
    result(6, 'hooks', !!s.lastHookAt && prompts.length >= 2, `lastHookAt ${s.lastHookAt ?? 'none'}, ${prompts.length} prompts in the thread`);
    return `2 prompts submitted once each; the 2 KB one whole (${LONG.length} chars)`;
  } },
  { n: 4, name: 'permission', run: async id => {
    const file = join(WORK, 'probe.txt'); if (existsSync(file)) execFileSync('cmd', ['/c', 'del', file]);
    await turn(id, 'Crée le fichier probe.txt contenant le mot ok, dans le dossier courant, avec ton outil d\'écriture de fichier.', 'perm-ask');
    let s = await until(id, x => x.state === 'waiting_permission' && (x.pending?.kind === 'permission' || x.pending?.kind === 'diff'), 30_000, 'perm-pending');
    save(id, 'perm-dialog');
    send({ type: 'session.decide', id, decision: 'accept' });
    await until(id, idle, 120_000, 'perm-accepted');
    if (!existsSync(file)) throw new Error('approved, but probe.txt is not there');
    await turn(id, 'Supprime le fichier probe.txt avec une commande shell.', 'perm-ask-2');
    s = await until(id, x => x.state === 'waiting_permission' && (x.pending?.kind === 'permission' || x.pending?.kind === 'diff'), 30_000, 'perm-pending-2');
    save(id, 'perm-dialog-2');
    send({ type: 'session.decide', id, decision: 'deny' });
    await until(id, x => idle(x) || x.state === 'waiting_input', 120_000, 'perm-denied');
    if (!existsSync(file)) throw new Error('denied, but probe.txt is gone');
    return `approved a write (${s.pending?.text.slice(0, 60) ?? ''}…), denied a delete`;
  } },
  { n: 5, name: 'question', run: async id => {
    send({ type: 'session.reply', id, text: 'Utilise l\'outil AskUserQuestion pour me demander de choisir entre Rouge et Bleu, puis réponds seulement avec la couleur choisie.' });
    const s = await until(id, x => x.pending?.kind === 'question', 120_000, 'question-pending');
    save(id, 'question-dialog');
    const i = (s.pending!.options ?? []).findIndex(o => /bleu/i.test(o));
    if (i < 0) throw new Error(`no Bleu among ${JSON.stringify(s.pending!.options)}`);
    send({ type: 'session.reply', id, text: String(i + 1) });
    await until(id, idle, 120_000, 'question-answered');
    save(id, 'question-after');
    const said = (await thread(id)).filter(x => x.kind === 'message').map(x => (x as { text: string }).text).at(-1) ?? '';
    if (!/bleu/i.test(said)) throw new Error(`answered option ${i + 1}, the agent said ${JSON.stringify(said.slice(0, 80))}`);
    return `option ${i + 1} (Bleu) chosen, the agent said ${JSON.stringify(said.slice(0, 40))}`;
  } },
  { n: 7, name: 'interrupt', run: async id => {
    send({ type: 'session.reply', id, text: 'Écris les nombres de 1 à 400 en toutes lettres, un par ligne, sans rien d\'autre.' });
    await until(id, x => x.state === 'working', 30_000, 'interrupt-working');
    await sleep(3000);
    send({ type: 'session.interrupt', id });
    await until(id, x => idle(x) || x.state === 'waiting_input', 30_000, 'interrupt-stopped');
    save(id, 'interrupt-after');
    const before = procs();
    send({ type: 'session.kill', id });
    const s = await until(id, x => x.state === 'exited', 30_000, 'killed');
    await sleep(2000);
    const after = procs();
    if (after >= before && before > 0) throw new Error(`killed, but ${after} claude/codex processes remain (${before} before)`);
    return `interrupted back to ${'idle'}; killed → exited (code ${s.exitCode}); claude/codex processes ${before} → ${after}`;
  } },
];

async function main() {
  client = await connect({ timeoutMs: 3000 });
  void pump();
  await sleep(300);
  // Check 1 (and 8): launch, reach idle, the preview shows the input prompt as Windows draws it.
  send({ type: 'session.launch', tool, cwd: WORK });
  const launched = await client.next('session.launched', 30_000).catch(e => { throw new Error(`launch: ${(e as Error).message}`); }) as Extract<ServerMessage, { type: 'session.launched' }>;
  const id = launched.id; emit({ ev: 'launched', id });
  const t = Date.now();
  try {
    // First run in the work folder: the agent asks to trust it. Ledge parses it as a permission; the driver accepts that.
    let s = await until(id, x => idle(x) || !!x.pending, 90_000, 'launch');
    let trusted: boolean | null = null;
    // Codex on Windows first asks how to sandbox itself: the design's choice is the strictest one without admin rights.
    if (s.pending?.kind === 'question' && /sandbox/i.test(s.pending.text)) {
      const n = (s.pending.options ?? []).findIndex(o => /non-admin/i.test(o)) + 1;
      if (n < 1) throw new Error(`launch: no non-admin sandbox among ${JSON.stringify(s.pending.options)}`);
      save(id, 'launch-sandbox'); emit({ ev: 'answer-sandbox', option: s.pending.options![n - 1] });
      send({ type: 'session.reply', id, text: String(n) });
      s = await until(id, x => idle(x) || (!!x.pending && !/sandbox/i.test(x.pending.text)), 90_000, 'launch-sandbox');
    }
    if (s.pending?.kind === 'permission') {
      if (!/trust/i.test(s.pending.text + (s.pending.options ?? []).join(' '))) throw new Error(`launch: an unexpected permission ${JSON.stringify(s.pending.text)}`);
      save(id, 'launch-trust'); emit({ ev: 'accept-trust', text: s.pending.text }); trusted = true;
      send({ type: 'session.decide', id, decision: 'accept' });
      s = await until(id, idle, 90_000, 'launch-trusted');
    }
    const f = save(id, 'launch-idle');
    result(1, 'launch', true, `idle after ${Date.now() - t} ms, preview ${f}`);
    // Check 8: Windows draws the cursor as '>'. The adapter read it if the trust dialog was parsed, and the input box is
    // recognized at rest when the preview (which leaves the box out) holds no '>' prompt line.
    const lines = previews.get(id) ?? [];
    const boxLeft = lines.some(l => /^[>❯]\s/.test(l));
    result(8, 'glyphs', trusted !== false && !boxLeft, `trust dialog ${trusted === null ? 'not shown' : 'parsed with > cursor'}; input box ${boxLeft ? 'left in the preview' : 'recognized'}`);
  } catch (e) { result(1, 'launch', false, (e as Error).message); process.exit(1); }
  for (const c of checks) {
    if (which !== 'all' && which !== c.name) continue;
    if (c.name === 'question' && tool !== 'claude') continue;
    try { result(c.n, c.name, true, await c.run(id)); }
    catch (e) { result(c.n, c.name, false, (e as Error).message); }
  }
  if (sessions.get(id)?.state !== 'exited') send({ type: 'session.kill', id });
  await sleep(1000); await client.close(); process.exit(0);
}
void main();
