import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { claudeUsage, codexUsage, readContext } from '../src/daemon/context.js';
import { handoverArgs } from '../src/cli/handover.js';
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
const role = (id: string, front: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };
async function start(briefMs = 60_000) {
  tmux = fakeTmux();
  srv = await startServer({ store, tmux, port: 0, verify: { attempts: 2, intervalMs: 10 }, close: { freeMs: 200, exitMs: 200 }, handoverBriefMs: briefMs });
  c = await connect({ port: srv.port }); await c.next('snapshot');
}
const set = (id: string, patch: Partial<Session>) => store.upsert({ ...store.get(id)!, ...patch });
/** A team with one seat `build`, its transcript at `used` tokens of 200 000; the turn ends (→ idle) and Ledge reads it. */
async function seated(used: number) {
  c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'ledge-roles', seats: [{ role: 'build' }] });
  const { team } = await c.next('team.launched', 5000);
  const id = team.seats[0]!.sessionId!;
  const transcript = join(work, `${id}.jsonl`); writeFileSync(transcript, `${claudeLine(used)}\n`);
  set(id, { state: 'working', transcriptPath: transcript });
  set(id, { state: 'idle' });
  await until(() => store.get(id)?.context?.used === used);
  return { team, id };
}
const pointers = (pane: string, tag: string) => tmux.typed.filter(t => t.pane === pane && t.text.includes(tag));

beforeEach(() => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-handover-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  store = new Store();
  role('build', 'label: Build\nmodel: opus\nautonomy: edits');
});
afterEach(async () => { await c?.close(); await srv?.close(); srv = undefined; });

describe('the relief of a session (context handover spec §3.3)', () => {
  it('measured after its turn; asked, its brief written, a relief at its seat with the brief, its tasks passed, the old one closed', async () => {
    await start();
    const { team, id } = await seated(170_000);
    expect(store.get(id)!.context).toMatchObject({ used: 170_000, window: 200_000 });
    // Not a seat working without asking: nothing happens by itself.
    expect(store.get(id)!.handover).toBeUndefined();
    c.send({ type: 'task.cmd', rid: 'g', by: 'ledge', op: 'give', team: team.id, to: '@build', title: 'Implémenter les rôles' });
    const task = (await c.next('task.result')).task!;
    const pane = store.get(id)!.tmuxSession!;
    c.send({ type: 'session.handover', rid: 'h1', id });
    expect(await c.next('session.handover.result')).toMatchObject({ ok: true });
    expect(store.get(id)!.handover?.state).toBe('briefing');
    // Asked at its next free moment (it is free now): one at a time with the task's pointer.
    await until(() => pointers(pane, '<ledge-task').length + pointers(pane, '<ledge-handover>').length >= 1);
    c.send({ type: 'session.handover', rid: 'h2', id });
    expect(await c.next('session.handover.result')).toMatchObject({ ok: false, reason: expect.stringContaining('déjà en cours') });
    // The brief.
    c.send({ type: 'handover.brief', rid: 'b', by: id, text: 'Fait : roles.ts. En cours : le hook. Piège : LEDGE_HOME.' });
    expect((await c.next('handover.result')).reason).toBeUndefined();
    await until(() => store.get(id)?.handover?.state === 'done', 5000);
    const relief = store.get(store.get(id)!.handover!.to!)!;
    expect(relief).toMatchObject({ role: 'build', team: team.id, relieves: { id, name: store.get(id)!.name } });
    const spawned = tmux.created.at(-1)!;
    expect(spawned.env).toMatchObject({ LEDGE_ROLE: 'build', LEDGE_TEAM: team.id });
    expect(spawned.command.join(' ')).toContain('Fait : roles.ts. En cours : le hook. Piège : LEDGE_HOME.');
    expect(spawned.command).toEqual(expect.arrayContaining(['--model', 'opus', '--permission-mode', 'acceptEdits']));
    // The seat is the relief's; its task too, still given by Ledge.
    c.send({ type: 'task.cmd', rid: 's', by: 'ledge', op: 'show', task: task.id });
    expect((await c.next('task.result')).task).toMatchObject({ owner: relief.id, giver: 'ledge', state: 'open' });
    c.send({ type: 'roles.list', requestId: 'x', cwd: work }); await c.next('roles.listing');
    await until(() => store.get(id)!.state === 'exited');
    expect(store.get(id)!.team).toBeUndefined();
    // The relief reads the brief again.
    c.send({ type: 'handover.show', rid: 'v', by: relief.id });
    expect((await c.next('handover.result')).text).toContain('Piège : LEDGE_HOME.');
  }, 20_000);

  it('a session that writes no brief in time gets one from Ledge: its last reply and its tasks', async () => {
    await start(150);
    const { id } = await seated(100_000);
    set(id, { lastReply: { text: 'Étape 1 finie, tests verts.', at: AT } });
    c.send({ type: 'session.handover', rid: 'h', id });
    await c.next('session.handover.result');
    await until(() => store.get(id)?.handover?.state === 'done', 5000);
    expect(tmux.created.at(-1)!.command.join(' ')).toContain('Bilan écrit par Ledge');
    expect(tmux.created.at(-1)!.command.join(' ')).toContain('Étape 1 finie, tests verts.');
  }, 20_000);

  it('a launch refused leaves the session as it was, with its tasks', async () => {
    await start();
    const { team, id } = await seated(170_000);
    c.send({ type: 'task.cmd', rid: 'g', by: 'ledge', op: 'give', team: team.id, to: '@build', title: 'T' });
    const task = (await c.next('task.result')).task!;
    c.send({ type: 'session.handover', rid: 'h', id }); await c.next('session.handover.result');
    rmSync(join(process.env.LEDGE_HOME!, 'roles', 'build.md'));
    c.send({ type: 'handover.brief', rid: 'b', by: id, text: 'bilan' }); await c.next('handover.result');
    await until(() => store.get(id)?.handover?.state === 'failed', 5000);
    expect(store.get(id)!.handover!.reason).toContain('rôle inconnu');
    expect(store.get(id)!.state).not.toBe('exited');
    c.send({ type: 'task.cmd', rid: 's', by: 'ledge', op: 'show', task: task.id });
    expect((await c.next('task.result')).task).toMatchObject({ owner: id });
  }, 20_000);

  it('a seat that works without asking is relieved by Ledge past 80 %; below, or a brief nobody asked for, nothing', async () => {
    role('build', 'label: Build\nautonomy: auto');
    await start();
    const { id } = await seated(150_000);
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
