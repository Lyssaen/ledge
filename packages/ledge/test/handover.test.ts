import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { History } from '../src/daemon/history.js';
import { startServer } from '../src/daemon/server.js';
import { claudeUsage, codexUsage, readContext } from '../src/daemon/context.js';
import { briefGaps, heldNames, reliefOf } from '../src/daemon/handover.js';
import { handoverArgs, handoverOnClient } from '../src/cli/handover.js';
import { parseLedgeCommand } from '../src/cli/send.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

const AT = '2026-10-26T08:00:00.000Z';
const claudeLine = (used: number, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'assistant', message: { model: 'claude-opus', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: used - 30, output_tokens: 20 } }, ...extra });
const codexLine = (total: number, window = 272_000) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: total - 100, output_tokens: 100, total_tokens: total }, model_context_window: window } } });

describe('reading a session\'s context (context handover spec §3.1)', () => {
  it('Claude Code: the last assistant message outside a side chain; the 1M window for [1m] or a use past 200 000', () => {
    expect(claudeUsage([claudeLine(50_000), claudeLine(120_000), claudeLine(190_000, { isSidechain: true }), '{"type":"user"}'])).toEqual({ used: 120_000, window: 200_000 });
    expect(claudeUsage([claudeLine(120_000)], 'opus[1m]')).toEqual({ used: 120_000, window: 1_000_000 });
    expect(claudeUsage([claudeLine(300_000)])).toEqual({ used: 300_000, window: 1_000_000 });
    expect(claudeUsage(['not json', '{"type":"assistant"}'])).toBeUndefined();
  });

  it('Codex: the last token_count of the rollout, with the window it names', () => {
    expect(codexUsage([codexLine(20_000), codexLine(230_000), '{"type":"response_item"}'])).toEqual({ used: 230_000, window: 272_000 });
    expect(codexUsage(['{"type":"event_msg","payload":{"type":"token_count","info":null}}'])).toBeUndefined();
  });

  it('a missing transcript, Cursor or OMP: not measured', async () => {
    expect(await readContext({ tool: 'claude', transcriptPath: '/nope/x.jsonl' }, AT)).toBeUndefined();
    expect(await readContext({ tool: 'cursor', transcriptPath: '/nope/x.jsonl' }, AT)).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 'ledge-ctx-'));
    const f = join(dir, 't.jsonl'); writeFileSync(f, `${claudeLine(160_000)}\n`);
    expect(await readContext({ tool: 'claude', transcriptPath: f }, AT)).toEqual({ used: 160_000, window: 200_000, at: AT });
    rmSync(dir, { recursive: true });
  });

  it('`ledge handover` takes a brief or `show`; a Codex runs it through its hook', () => {
    expect(handoverArgs(['show'])).toEqual({ op: 'show' });
    expect(handoverArgs(['Fait :', 'roles.ts'])).toEqual({ op: 'brief', text: 'Fait : roles.ts' });
    expect(handoverArgs([])).toBeUndefined();
    expect(handoverArgs(['x'.repeat(20_001)])).toBeUndefined();
    expect(parseLedgeCommand('ledge handover "Fait : roles.ts"')).toEqual({ cmd: 'handover', args: ['Fait : roles.ts'] });
  });
});

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
function fakeTmux(): Tmux & { created: NewSession[]; typed: Array<{ pane: string; text: string }> } {
  const created: NewSession[] = []; const panes = new Set<string>(); const typed: Array<{ pane: string; text: string }> = [];
  return {
    created, typed,
    async newSession(o) { created.push(o); panes.add(o.name); },
    async sendText(pane, text) { typed.push({ pane, text }); }, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>> | undefined; let store: Store; let tmux: ReturnType<typeof fakeTmux>; let work: string; let c: Client;
let history: History;
async function start(briefMs = 60_000) {
  tmux = fakeTmux(); history = new History({ dir: mkdtempSync(join(tmpdir(), 'ledge-history-')) });
  srv = await startServer({ store, tmux, port: 0, history, verify: { attempts: 2, intervalMs: 10 }, close: { freeMs: 200, exitMs: 200 }, handoverBriefMs: briefMs });
  c = await connect({ port: srv.port }); await c.next('snapshot');
}
const set = (id: string, patch: Partial<Session>) => store.upsert({ ...store.get(id)!, ...patch });
/** A lone session, its transcript at `used` tokens of 200 000; the turn ends (→ idle) and Ledge reads it. */
async function seated(used: number, extra: Partial<Session> = {}) {
  c.send({ type: 'session.launch', tool: 'claude', cwd: work, model: 'opus' });
  const { id } = await c.next('session.launched', 5000);
  const transcript = join(work, `${id}.jsonl`); writeFileSync(transcript, `${claudeLine(used)}\n`);
  set(id, { state: 'working', transcriptPath: transcript, ...extra });
  set(id, { state: 'idle' });
  await until(() => store.get(id)?.context?.used === used);
  return { id };
}
const BRIEF = 'Fait : roles.ts. En cours : le hook. Suite : les tests. Décisions : LEDGE_HOME isolé, car partagé entre tests. Piège : LEDGE_HOME.';
const pointers = (pane: string, tag: string) => tmux.typed.filter(t => t.pane === pane && t.text.includes(tag));

beforeEach(() => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-handover-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  store = new Store();
});
afterEach(async () => { await c?.close(); await srv?.close(); srv = undefined; });

describe('briefGaps', () => {
  it('names the sections a brief lacks, in any case, with or without accents, as headings or inline', () => {
    expect(briefGaps('## Fait\nx\n## En cours\ny\n## Suite\nz\n## Décisions\nw')).toEqual([]);
    expect(briefGaps('FAIT : x. EN COURS : y. SUITE : z. DECISIONS : w.')).toEqual([]);
    expect(briefGaps('- **Fait** : x')).toEqual(['En cours', 'Suite', 'Décisions']);
    expect(briefGaps('Tout est fait, la suite plus tard.')).toEqual(['Fait', 'En cours', 'Suite', 'Décisions']);
  });
});

describe('a relieved name', () => {
  const T = '2026-10-26T19:00:00.000Z';
  const s = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w', project: 'w', title: name, tmuxSession: `ledge-${id}`,
    state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher', ...extra });
  const relieved = (id: string, name: string, to: string) => s(id, name, { state: 'exited', handover: { state: 'done', to, toName: '', at: T } });
  it('leads to the live end of its chain, none when the chain has ended', () => {
    const all = [relieved('a', 'Pim', 'b'), relieved('b', 'Ida', 'c'), s('c', 'Max')];
    const get = (id: string) => all.find(x => x.id === id);
    expect(reliefOf(get, all[0]!)?.id).toBe('c');
    expect(reliefOf(get, s('d', 'Lu', { state: 'exited' }))).toBeUndefined();
    expect(reliefOf(get, relieved('e', 'Lu', 'gone'))).toBeUndefined();
  });
  it('is held while its relief lives, so no other seat gets it', () => {
    const all = [relieved('a', 'Pim', 'b'), s('b', 'Ida'), relieved('c', 'Lu', 'd'), s('d', 'Bix', { state: 'exited' })];
    expect(heldNames(all)).toEqual(['Pim']);
  });
});

describe('the relief of a session (context handover spec §3.3)', () => {
  it('measured after its turn; asked, its brief written, a relief launched with the brief, the old one closed', async () => {
    await start();
    const { id } = await seated(170_000, { autonomy: 'edits' });
    expect(store.get(id)!.context).toMatchObject({ used: 170_000, window: 200_000 });
    // Not a session working without asking: nothing happens by itself.
    expect(store.get(id)!.handover).toBeUndefined();
    const pane = store.get(id)!.tmuxSession!;
    c.send({ type: 'session.handover', rid: 'h1', id });
    expect(await c.next('session.handover.result')).toMatchObject({ ok: true });
    expect(store.get(id)!.handover?.state).toBe('briefing');
    await until(() => pointers(pane, '<ledge-handover>').length >= 1);
    c.send({ type: 'session.handover', rid: 'h2', id });
    expect(await c.next('session.handover.result')).toMatchObject({ ok: false, reason: expect.stringContaining('déjà en cours') });
    const cli = await connect({ port: srv!.port });
    expect(await handoverOnClient(cli, [BRIEF], id, 3000)).toEqual({ line: 'bilan reçu : Ledge lance la session qui prend ta relève. Arrête-toi là.', code: 0 });
    await cli.close();
    await until(() => store.get(id)?.handover?.state === 'done', 5000);
    const relief = store.get(store.get(id)!.handover!.to!)!;
    expect(relief).toMatchObject({ relieves: { id, name: store.get(id)!.name }, autonomy: 'edits' });
    expect(relief).not.toHaveProperty('role'); expect(relief).not.toHaveProperty('team');
    const spawned = tmux.created.at(-1)!;
    expect(spawned.env).not.toHaveProperty('LEDGE_ROLE'); expect(spawned.env).not.toHaveProperty('LEDGE_TEAM');
    expect(spawned.command.join(' ')).toContain(BRIEF);
    expect(spawned.command).toEqual(expect.arrayContaining(['--model', 'opus', '--permission-mode', 'acceptEdits']));
    await until(() => store.get(id)!.state === 'exited');
    c.send({ type: 'handover.show', rid: 'v', by: relief.id });
    expect((await c.next('handover.result')).text).toContain('Piège : LEDGE_HOME.');
  }, 20_000);

  it('a relief launches without role or team, and the default brief lists no tasks', async () => {
    await start(150);
    const { id } = await seated(100_000);
    set(id, { lastReply: { text: 'Étape 1 finie, tests verts.', at: AT }, branch: 'feat/roles', cwd: work });
    c.send({ type: 'session.handover', rid: 'h', id });
    await c.next('session.handover.result');
    await until(() => store.get(id)?.handover?.state === 'done', 5000);
    const said = tmux.created.at(-1)!.command.join(' ');
    expect(said).toContain('Bilan écrit par Ledge');
    expect(said).toContain('Étape 1 finie, tests verts.');
    expect(said).toContain(`Branche : feat/roles (${work})`);
    expect(said).toContain('Il n\'a noté ni décisions ni pièges');
    expect(said).not.toMatch(/tâche|équipe|@build/i);
    expect(tmux.created.at(-1)!.env).not.toHaveProperty('LEDGE_ROLE');
    expect(store.get(store.get(id)!.handover!.to!)).not.toHaveProperty('role');
  }, 20_000);

  it('the request for a brief jumps whatever waits for a busy session', async () => {
    await start();
    const { id } = await seated(170_000);
    const pane = store.get(id)!.tmuxSession!;
    set(id, { state: 'working' });
    c.send({ type: 'session.handover', rid: 'h1', id });
    expect(await c.next('session.handover.result')).toMatchObject({ ok: true });
    const before = tmux.typed.filter(t => t.pane === pane).length;
    set(id, { state: 'idle' });
    await until(() => tmux.typed.filter(t => t.pane === pane).length > before);
    expect(tmux.typed.filter(t => t.pane === pane)[before]!.text).toContain('<ledge-handover>');
  }, 20_000);

  it('a relieved name is not given to another session while its relief lives', async () => {
    await start();
    const { id } = await seated(170_000);
    const old = store.get(id)!.name;
    c.send({ type: 'session.handover', rid: 'h1', id }); await c.next('session.handover.result');
    c.send({ type: 'handover.brief', rid: 'b', by: id, text: BRIEF }); await c.next('handover.result');
    await until(() => store.get(id)?.handover?.state === 'done' && store.get(id)?.state === 'exited', 5000);
    c.send({ type: 'session.launch', tool: 'claude', cwd: work });
    const { id: other } = await c.next('session.launched', 5000);
    expect(store.get(other)!.name).not.toBe(old);
  }, 20_000);

  it('a brief missing a section is refused, naming what is missing; the relief still waits for it', async () => {
    await start();
    const { id } = await seated(170_000);
    c.send({ type: 'session.handover', rid: 'h', id }); await c.next('session.handover.result');
    c.send({ type: 'handover.brief', rid: 'b1', by: id, text: 'Fait : roles.ts.' });
    expect((await c.next('handover.result')).reason).toBe('bilan incomplet, il manque : En cours, Suite, Décisions. Réécris-le en entier.');
    expect(store.get(id)!.handover?.state).toBe('briefing');
    c.send({ type: 'handover.brief', rid: 'b2', by: id, text: BRIEF });
    expect((await c.next('handover.result')).reason).toBeUndefined();
  }, 20_000);

  it('a launch refused leaves the session as it was', async () => {
    await start();
    const { id } = await seated(170_000);
    c.send({ type: 'session.handover', rid: 'h', id }); await c.next('session.handover.result');
    rmSync(work, { recursive: true, force: true });
    c.send({ type: 'handover.brief', rid: 'b', by: id, text: BRIEF }); await c.next('handover.result');
    await until(() => store.get(id)?.handover?.state === 'failed', 5000);
    expect(store.get(id)!.handover!.reason).toBeTruthy();
    expect(store.get(id)!.state).not.toBe('exited');
  }, 20_000);

  it('« Contexte max »: told after the snapshot, set and kept in context.json, broadcast; an `auto` session follows it', async () => {
    await start();
    const other = await connect({ port: srv!.port });
    expect((await other.next('context.prefs')).prefs).toEqual({ near: 0.8 });
    c.send({ type: 'context.set', prefs: { near: 0.7 } });
    expect((await other.next('context.prefs')).prefs).toEqual({ near: 0.7 });
    expect(JSON.parse(readFileSync(join(process.env.LEDGE_HOME!, 'context.json'), 'utf8'))).toEqual({ near: 0.7 });
    // 75 % is past 70 %: Ledge relieves the session.
    const { id } = await seated(150_000, { autonomy: 'auto' });
    await until(() => store.get(id)?.handover?.state === 'briefing');
    await other.close();
  }, 20_000);

  it('an auto session that is not in a team is relieved past the threshold; below, or a brief nobody asked for, nothing', async () => {
    await start();
    const { id } = await seated(150_000, { autonomy: 'auto' });
    expect(store.get(id)!.handover).toBeUndefined();
    c.send({ type: 'handover.brief', rid: 'b', by: id, text: 'rien' });
    expect((await c.next('handover.result')).reason).toContain('aucune relève');
    writeFileSync(store.get(id)!.transcriptPath!, `${claudeLine(165_000)}\n`);
    set(id, { state: 'working' }); set(id, { state: 'idle' });
    await until(() => store.get(id)?.handover?.state === 'briefing');
    expect(store.get(id)!.handover!.auto).toBe(true);
    c.send({ type: 'session.handover', rid: 'h', id: 'nope' });
    expect((await c.next('session.handover.result')).reason).toBe('session inconnue');
  }, 20_000);
});
