import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurn, ClientMessage, Escalation, LedgeThreadItem, Projects, Rig, ServerMessage, Session } from '@ledge/protocol';
import { createBrainCommands, parseBrainArgs, BECAUSE_REFUSED, NOT_BRAIN_LINE, type BrainCommandDeps } from '../src/daemon/brain/commands.js';
import { createLedgeThread, type LedgeThread } from '../src/daemon/ledgeThread.js';
import { createMemory, type Memory } from '../src/daemon/brain/memory.js';
import { createChat } from '../src/chat/service.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import WebSocket from 'ws';
import { parseServerMessage } from '@ledge/protocol';
import { sessionKey } from '../src/auth.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const T0 = Date.parse('2026-10-31T10:00:00.000Z');
const HOUR = 3_600_000;
const projects = { version: 1, rules: [], projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }] } as unknown as Projects;
const factory: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [{ ref: 'dev-build@factory', address: '@build', name: 'build', runtime: 'claude-code', state: 'idle' }] };
const esc = (over: Partial<Escalation> = {}): Escalation => ({ id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'dev-build@factory', intent: 'decision',
  summary: 'On fusionne ?', questions: [], createdAt: new Date(T0).toISOString(), state: 'pending', category: 'git', ...over });

describe('parseBrainArgs', () => {
  test('decide parses --answer pairs', () => {
    expect(parseBrainArgs('decide', ['qi-1', '--answer', 'q1=merge', '--answer', 'q2=b', '--category', 'git'])).toMatchObject({ ok: true, value: { answers: { q1: 'merge', q2: 'b' } } });
  });
  test('decide keeps --rule and --why, and a value may hold an =', () => {
    expect(parseBrainArgs('decide', ['qi-1', '--answer', 'q1=a=b', '--category', 'git', '--rule', 'r1', '--why', 'comme hier'])).toEqual({ ok: true,
      value: { op: 'decide', id: 'qi-1', answers: { q1: 'a=b' }, category: 'git', rule: 'r1', why: 'comme hier' } });
  });
  test.each([
    ['decide', ['qi-1', '--answer', 'q1=merge']],                     // no category
    ['decide', ['qi-1', '--category', 'git']],                         // no answer
    ['decide', ['qi-1', '--answer', 'nope', '--category', 'git']],     // not q=opt
    ['decide', ['qi-1', '--answer', 'q1=a', '--category']],            // missing value
    ['decide', ['qi-1', '--answer', 'q1=a', '--category', 'git', '--force']], // unknown flag
    ['say', []], ['ask', ['qi-1']], ['send', ['@build']], ['rig', ['up', 'factory', '--goal', 'x']], ['rig', ['down', 'factory']],
    ['rig', ['explode', 'x']], ['who', ['x']], ['remember', ['texte']], ['propose', ['session.archive']], ['propose', ['session.archive', '--args', '{nope']],
    ['rig', ['up', 'factory', '--goal', 'g', '--because', 'u1', '--project', 'ledge', '--off', 'x']],
  ] as const)('%s %j is a usage error', (op, args) => {
    const r = parseBrainArgs(op, [...args]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.usage).toMatch(/^ledge brain /);
  });
  test('rig up, rig down, restart, propose rig-launch, propose an action', () => {
    expect(parseBrainArgs('rig', ['up', 'factory', '--goal', 'G', '--because', 'u1', '--project', 'ledge'])).toEqual({ ok: true, value: { op: 'rig', verb: 'up', spec: 'factory', goal: 'G', because: 'u1', project: 'ledge' } });
    expect(parseBrainArgs('rig', ['down', 'factory', '--because', 'u1'])).toEqual({ ok: true, value: { op: 'rig', verb: 'down', rig: 'factory', because: 'u1' } });
    expect(parseBrainArgs('rig', ['handover', '@build'])).toEqual({ ok: true, value: { op: 'rig', verb: 'handover', seat: '@build' } });
    expect(parseBrainArgs('propose', ['rig-launch', '--goal', 'G', '--off-project', 'essai'])).toEqual({ ok: true, value: { op: 'propose', rigLaunch: { goal: 'G', off: 'essai' } } });
    expect(parseBrainArgs('propose', ['session.archive', '--args', '{"session":"old"}'])).toEqual({ ok: true, value: { op: 'propose', action: 'session.archive', args: { session: 'old' } } });
  });
});

let dir: string; let clock: number; let thread: LedgeThread; let memory: Memory; let posted: unknown[]; let emitted: unknown[];
let rigActs: Extract<ClientMessage, { type: 'rig.act' }>[]; let prepares: Extract<ClientMessage, { type: 'rig.prepare' }>[]; let sends: unknown[][];
let decides: unknown[][]; let asks: unknown[][]; let sessions: Session[]; let escalations: Escalation[]; let prepareResult: unknown;

function make(over: Partial<BrainCommandDeps> = {}) {
  return createBrainCommands({
    deciding: { decide: async (...a: unknown[]) => { decides.push(a); return { ok: true, line: 'Appliqué.' }; }, ask: (...a: unknown[]) => { asks.push(a); return { ok: true, line: 'Remonté.' }; } } as never,
    thread, memory, seatSend: { send: async (...a: unknown[]) => { sends.push(a); return { ok: true, to: '@build' }; } } as never,
    rigs: () => [factory], escalations: () => escalations, sessions: () => sessions, projects: () => projects,
    chat: { post: (t, emit) => { posted.push(t); emit({ type: 'chat.history', turns: [] }); } }, emit: m => { emitted.push(m); },
    rigAct: async msg => { rigActs.push(msg); return { ok: true }; },
    rigPrepare: async msg => { prepares.push(msg); return prepareResult as never; },
    now: () => clock, ...over });
}
const userItem = (text = 'arrête factory', at = clock) => thread.append({ kind: 'user', text, at: new Date(at).toISOString() }).id;
const ledgeItems = () => thread.page().items.filter((i): i is Extract<LedgeThreadItem, { kind: 'ledge' }> => i.kind === 'ledge');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledge-brain-cmd-'));
  clock = T0;
  thread = createLedgeThread({ path: join(dir, 'thread.jsonl'), now: () => new Date(clock).toISOString() });
  memory = createMemory({ dir: join(dir, 'memoire'), now: () => new Date(clock).toISOString() });
  posted = []; emitted = []; rigActs = []; prepares = []; sends = []; decides = []; asks = []; sessions = []; escalations = [];
  prepareResult = { id: 'plan-1', machine: 'local', spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'x' }, cwd: '/x', seats: [], writes: [], command: 'rig up', required: false };
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('createBrainCommands', () => {
  test('say adds a ledge bubble', async () => {
    expect(await make().run({ op: 'say', text: 'Je regarde factory.' })).toMatchObject({ ok: true });
    expect(ledgeItems().map(i => i.text)).toEqual(['Je regarde factory.']);
    expect(await make().run({ op: 'say', text: '   ' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  test('decide and ask go to Deciding; without OpenRig they answer unreachable', async () => {
    expect(await make().run({ op: 'decide', id: 'qi-1', answers: { q1: 'merge' }, category: 'git', why: 'w' })).toEqual({ ok: true, line: 'Appliqué.' });
    expect(decides).toEqual([['qi-1', { q1: 'merge' }, 'git', { why: 'w' }]]);
    await make().run({ op: 'ask', id: 'qi-1', advice: 'à toi' });
    expect(asks).toEqual([['qi-1', undefined, 'à toi']]);
    const off = make({ deciding: null });
    expect(await off.run({ op: 'decide', id: 'qi-1', answers: { q1: 'a' }, category: 'git' })).toMatchObject({ ok: false, code: 'unreachable', line: expect.stringMatching(/OpenRig/) });
    expect(await off.run({ op: 'ask', id: 'qi-1', advice: 'a' })).toMatchObject({ ok: false, code: 'unreachable' });
  });

  test('rig down without --because is refused', async () => {
    expect(await make().run({ op: 'rig', verb: 'down', rig: 'factory', because: 'nope' })).toEqual({ ok: false, code: 'refused', line: BECAUSE_REFUSED });
    expect(rigActs).toEqual([]);
  });

  test('rig down with a fresh user item runs rig.act down', async () => {
    const u = userItem();
    expect(await make().run({ op: 'rig', verb: 'down', rig: 'factory', because: u })).toMatchObject({ ok: true });
    expect(rigActs).toEqual([expect.objectContaining({ type: 'rig.act', machine: 'local', rigId: 'r1', verb: 'down' })]);
  });

  test('--because: a ledge item, an item older than 24 h, or one already used is refused', async () => {
    const cmds = make();
    const ledge = thread.append({ kind: 'ledge', text: 'moi' }).id;
    expect(await cmds.run({ op: 'rig', verb: 'down', rig: 'factory', because: ledge })).toMatchObject({ code: 'refused', line: BECAUSE_REFUSED });
    const old = userItem('vieux', T0 - 25 * HOUR);
    expect(await cmds.run({ op: 'rig', verb: 'down', rig: 'factory', because: old })).toMatchObject({ code: 'refused' });
    const u = userItem();
    expect(await cmds.run({ op: 'rig', verb: 'down', rig: 'factory', because: u })).toMatchObject({ ok: true });
    expect(await cmds.run({ op: 'rig', verb: 'down', rig: 'factory', because: u })).toMatchObject({ code: 'refused', line: BECAUSE_REFUSED });
    expect(await cmds.run({ op: 'rig', verb: 'up', spec: 'factory', goal: 'G', because: u })).toMatchObject({ code: 'refused' });
    expect(rigActs).toHaveLength(1);
  });

  test('a failed down does not use up its user item; an unknown rig is invalid', async () => {
    const u = userItem();
    const failing = make({ rigAct: async msg => { rigActs.push(msg); return { ok: false, code: 'openrig_down', reason: 'OpenRig arrêté' }; } });
    expect(await failing.run({ op: 'rig', verb: 'down', rig: 'factory', because: u })).toMatchObject({ ok: false, code: 'openrig_down', line: expect.stringContaining('OpenRig arrêté') });
    expect(await failing.run({ op: 'rig', verb: 'down', rig: 'nope', because: u })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await make().run({ op: 'rig', verb: 'down', rig: 'factory', because: u })).toMatchObject({ ok: true });
  });

  test('restart and handover act on the seat, no --because needed', async () => {
    expect(await make().run({ op: 'rig', verb: 'restart', seat: '@build' })).toMatchObject({ ok: true });
    expect(await make().run({ op: 'rig', verb: 'handover', seat: 'dev-build@factory' })).toMatchObject({ ok: true });
    expect(rigActs.map(m => [m.verb, m.seatRef, m.machine])).toEqual([['restart', 'dev-build@factory', 'local'], ['handover', 'dev-build@factory', 'local']]);
    expect(await make().run({ op: 'rig', verb: 'restart', seat: '@ghost' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  test('rig up prepares to validate, then posts a launch card; never launches', async () => {
    const u = userItem('lance factory sur ledge');
    expect(await make().run({ op: 'rig', verb: 'up', spec: 'factory', goal: 'G', because: u, project: 'ledge' })).toMatchObject({ ok: true });
    expect(prepares).toEqual([expect.objectContaining({ type: 'rig.prepare', machine: 'local', spec: 'factory', goal: 'G',
      where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/factory', copy: true } })]);
    expect(posted).toEqual([expect.objectContaining({ rigLaunch: { spec: 'factory', goal: 'G', project: 'ledge' } })]);
    expect(rigActs).toEqual([]);
    // A plan the daemon refuses reaches the brain, and nothing is posted.
    prepareResult = { code: 'failed', reason: 'unknown spec nope' };
    const u2 = userItem();
    expect(await make().run({ op: 'rig', verb: 'up', spec: 'nope', goal: 'G', because: u2 })).toMatchObject({ ok: false, code: 'failed', line: expect.stringContaining('unknown spec nope') });
    expect(posted).toHaveLength(1);
  });

  test('propose posts a chat turn with its cards and a ledge item with its qid', async () => {
    sessions = [{ id: 'old', name: 'Old', tool: 'claude', cwd: '/w', project: 'w', title: 'Old', state: 'exited', helpers: [], startedAt: new Date(T0).toISOString(), lastActivityAt: new Date(T0).toISOString(), source: 'launcher' } as unknown as Session];
    expect(await make().run({ op: 'propose', action: 'session.archive', args: { session: 'Old' } })).toMatchObject({ ok: true });
    const turn = posted[0] as Pick<ChatTurn, 'qid' | 'answer' | 'actions'>;
    expect(turn.actions).toEqual([expect.objectContaining({ action: 'session.archive', args: { session: 'old' } })]);
    expect(ledgeItems()).toEqual([expect.objectContaining({ qid: turn.qid, text: turn.answer })]);
    expect(emitted).toEqual([{ type: 'chat.history', turns: [] }]);
    expect(await make().run({ op: 'propose', action: 'session.archive', args: { session: 'ghost' } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await make().run({ op: 'propose', action: 'session.launch', args: {} })).toMatchObject({ ok: false, code: 'invalid' });
  });

  test('propose rig-launch prepares a plan and posts a card that opens the launch modal prefilled', async () => {
    expect(await make().run({ op: 'propose', rigLaunch: { goal: 'G', spec: 'factory', project: 'ledge' } })).toMatchObject({ ok: true });
    expect(prepares).toEqual([expect.objectContaining({ spec: 'factory', goal: 'G', where: expect.objectContaining({ kind: 'project', projectId: 'ledge' }) })]);
    expect(posted).toEqual([expect.objectContaining({ rigLaunch: { spec: 'factory', goal: 'G', project: 'ledge' } })]);
    // Without a spec there is nothing to validate: the card goes out as it is.
    expect(await make().run({ op: 'propose', rigLaunch: { goal: 'G2', off: 'essai' } })).toMatchObject({ ok: true });
    expect(prepares).toHaveLength(1);
    expect(posted[1]).toMatchObject({ rigLaunch: { goal: 'G2', off: 'essai' } });
    expect(await make().run({ op: 'propose', rigLaunch: { goal: 'G', spec: 'factory', project: 'zz' } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(rigActs).toEqual([]);
  });

  test('send validates the text and the seat', async () => {
    expect(await make().run({ op: 'send', to: '@build', text: 'relance les tests' })).toMatchObject({ ok: true });
    expect(sends).toEqual([['local', 'dev-build@factory', 'relance les tests']]);
    expect(await make().run({ op: 'send', to: '@build', text: '  ' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await make().run({ op: 'send', to: '-rf', text: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await make().run({ op: 'send', to: '@ghost', text: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(sends).toHaveLength(1);
    expect(await make({ seatSend: null }).run({ op: 'send', to: '@build', text: 'x' })).toMatchObject({ ok: false, code: 'openrig_down' });
  });

  test('remember proposes a rule from known decisions', async () => {
    const d = memory.record({ by: 'user', category: 'git', escalationId: 'qi-1', summary: 's', answers: {}, at: new Date(T0).toISOString() });
    expect(await make().run({ op: 'remember', text: 'Toujours merge', from: [d.id] })).toMatchObject({ ok: true });
    expect(memory.rules()).toEqual([expect.objectContaining({ text: 'Toujours merge', category: 'git', status: 'proposed', from: d.id })]);
    expect(await make().run({ op: 'remember', text: 'x', from: ['nope'] })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await make().run({ op: 'remember', text: 'x', from: [d.id], category: 'bogus' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  test('remember cannot use uncategorised decisions as sources (F-I1)', async () => {
    const d = memory.record({ by: 'user', escalationId: 'qi-1', summary: 's', answers: {}, at: new Date(T0).toISOString() });
    expect(await make().run({ op: 'remember', text: 'x', from: [d.id] })).toMatchObject({ ok: false, code: 'invalid', line: expect.stringContaining('sans catégorie') });
    expect(await make().run({ op: 'remember', text: 'x', from: [d.id], category: 'git' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  test('who, rigs, escalations, rules: one line per element', async () => {
    escalations = [esc(), esc({ id: 'qi-2', state: 'answered' }), esc({ id: 'qi-3', state: 'grace', category: undefined, from: 'build' })];
    const lines = (await make().run({ op: 'escalations' })).line.split('\n');
    expect(lines).toEqual(['qi-1 · pending · git · dev-build@factory · On fusionne ?', 'qi-3 · grace · ? · build@factory · On fusionne ?']);
    expect((await make().run({ op: 'rigs' })).line).toMatch(/^factory · running · @build \(idle\)$/);
    memory.propose('Toujours merge', 'git', 'd1');
    expect((await make().run({ op: 'rules' })).line).toMatch(/^\S+ · proposed · git · Toujours merge$/);
    expect((await make().run({ op: 'who' })).ok).toBe(true);
    escalations = [];
    expect((await make().run({ op: 'escalations' })).line).toMatch(/Aucune escalade/);
  });
});

describe('Chat.post', () => {
  test('appends an answered turn without question and emits the history', () => {
    const chat = createChat({ store: new Store(), tmux: { capture: async () => null }, home: dir, env: async () => ({}), now: () => new Date(T0).toISOString() });
    const out: unknown[] = [];
    chat.post({ qid: 'b1', answer: 'Je propose…', rigLaunch: { goal: 'G' } }, m => out.push(m));
    expect(chat.history()).toEqual([expect.objectContaining({ qid: 'b1', question: '', answer: 'Je propose…', answeredAt: new Date(T0).toISOString(), rigLaunch: { goal: 'G' } })]);
    expect(out).toEqual([{ type: 'chat.history', turns: chat.history() }]);
  });
});

// --- through the daemon: who may run `ledge brain` ---
const VARS = ['LEDGE_HOME'] as const;
const fakeTmux = (): Tmux => {
  const panes = new Set<string>();
  return { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; }, async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };
};
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${id}`, createdAt: '2026-10-30 10:00:00' });

describe('brain.cmd through the daemon', () => {
  let saved: Record<string, string | undefined>; let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null;
  let store: Store; let ws: WebSocket; let home: string; let tmux: Tmux; let msgs: ServerMessage[];
  beforeEach(async () => {
    saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
    home = mkdtempSync(join(tmpdir(), 'ledge-brain-srv-')); process.env.LEDGE_HOME = home;
    store = new Store(); tmux = fakeTmux();
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as unknown as Projects, home, file: join(home, 'openrig.json'),
      asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    srv = await startServer({ store, tmux, port: 0, home, agentEnv: async () => ({ ...process.env }), openrig: bridge });
    await bridge.start();
    await until(() => bridge!.status().state === 'running' && bridge!.escalations().length === 1);
    const at = new Date().toISOString();
    for (const [id, name, extra] of [['brain', 'Ledge', { brain: true }], ['otto', 'Otto', {}], ['old', 'Ledge', { brain: true, archivedAt: at, state: 'exited' }]] as const) {
      await tmux.newSession({ name: `ledge-${id}` } as never);
      store.upsert({ id, name, tool: 'claude', cwd: home, project: 'x', title: name, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra } as never);
    }
    msgs = [];
    ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    await until(() => msgs.some(m => m.type === 'ledge.thread.history'));
  });
  afterEach(async () => {
    await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }); await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null;
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(home, { recursive: true, force: true });
  });
  let n = 0;
  const cmd = async (by: string, key: string | undefined, op: string, args: string[]) => {
    const rid = `b${++n}`;
    ws.send(JSON.stringify({ type: 'brain.cmd', rid, by, key: key ?? '', op, args }));
    let r: Extract<ServerMessage, { type: 'brain.result' }> | undefined;
    await until(() => !!(r = msgs.find((m): m is Extract<ServerMessage, { type: 'brain.result' }> => m.type === 'brain.result' && m.rid === rid)), 5000);
    return r!;
  };
  const threadItems = () => msgs.filter(m => m.type === 'ledge.thread.item').length;
  const actionPosts = () => fake!.requests.filter(r => r.method === 'POST').length;

  test('brain.cmd from a non-brain session is refused', async () => {
    const before = threadItems(); const posts = actionPosts();
    const r = await cmd('otto', sessionKey('otto'), 'decide', ['E1', '--answer', 'q1=a', '--category', 'git']);
    expect(r).toMatchObject({ ok: false, code: 'not_brain', line: NOT_BRAIN_LINE });
    expect(await cmd('otto', sessionKey('otto'), 'say', ['coucou'])).toMatchObject({ code: 'not_brain' });
    expect(threadItems()).toBe(before);
    expect(actionPosts()).toBe(posts);
    expect(bridge!.escalation('E1')!.state).toBe('pending');
  });

  test('a wrong key is refused', async () => {
    const before = threadItems();
    expect(await cmd('brain', sessionKey('otto'), 'say', ['x'])).toEqual(expect.objectContaining({ ok: false, code: 'identity', line: NOT_BRAIN_LINE }));
    expect(await cmd('brain', '', 'say', ['x'])).toMatchObject({ ok: false, code: 'identity', line: NOT_BRAIN_LINE });
    expect(await cmd('', '', 'say', ['x'])).toMatchObject({ ok: false, code: 'identity' });
    expect(threadItems()).toBe(before);
  });

  test('an archived brain record is not the brain', async () => {
    expect(await cmd('old', sessionKey('old'), 'say', ['x'])).toMatchObject({ ok: false, code: 'not_brain' });
  });

  test('an exited but unarchived brain cannot issue commands', async () => {
    store.upsert({ ...store.get('brain')!, state: 'exited' });
    expect(await cmd('brain', sessionKey('brain'), 'say', ['x'])).toMatchObject({ ok: false, code: 'not_brain' });
  });

  test('say from the brain adds a ledge bubble; bad args get the usage', async () => {
    expect(await cmd('brain', sessionKey('brain'), 'say', ['Je regarde.'])).toMatchObject({ ok: true });
    await until(() => msgs.some(m => m.type === 'ledge.thread.item' && m.item.kind === 'ledge' && m.item.text === 'Je regarde.'));
    expect(await cmd('brain', sessionKey('brain'), 'decide', ['E1'])).toMatchObject({ ok: false, code: 'invalid', line: expect.stringMatching(/^ledge brain decide/) });
    expect((await cmd('brain', sessionKey('brain'), 'escalations', [])).line).toContain('E1');
  });
});
