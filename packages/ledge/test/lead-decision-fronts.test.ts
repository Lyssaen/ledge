import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Escalation, type Projects, type ServerMessage, type Task, type Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import type { MailState } from '../src/daemon/mailbox.js';
import { createMemory } from '../src/daemon/brain/memory.js';
import { parseBrainArgs } from '../src/daemon/brain/commands.js';
import { guardDecide, validAnswers } from '../src/daemon/brain/guard.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';
import { createAnswers } from '../src/daemon/openrig/answer.js';
import { createTasks } from '../src/daemon/tasks.js';
import { formatBrainEvent } from '../src/daemon/brain/inbox.js';
import { brainInstructions } from '../src/daemon/brain/persona.js';
import { decisionToEscalation } from '../src/daemon/openrig/decisions.js';
import { engineRefusal, ENGINE_LEDGE } from '../src/daemon/engine/guard.js';
import { sessionKey } from '../src/auth.js';
import { paths } from '../src/paths.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

// Lot E, task 3: a lead's question is one item for the fronts. `task.answer` (the TUI's D key, the phone's card) goes through the
// escalation `task-<id>` when there is one (one memory record, the brain told), and the phone hears of it once.

const GRACE = 700;
const QUESTION = 'Fusionner maintenant ?';
const OPTIONS = 'oui / non, je recommande oui';

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; }, async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}
type Notice = MailState['queue'][number];

let home: string; let work: string; let store: Store; let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null;
let ws: WebSocket | null = null; let msgs: ServerMessage[]; let queued: Map<string, Notice>; let saved: string | undefined;
const role = (id: string, front: string) => { mkdirSync(join(home, 'roles'), { recursive: true }); writeFileSync(join(home, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };

async function start(o: { brain: boolean; mobile?: Parameters<typeof startServer>[0]['mobile'] }) {
  store = new Store(); queued = new Map();
  const mail = { load: () => undefined, save: (s: MailState) => { for (const q of s.queue) queued.set(q.id, q); } };
  fake = await createFakeOpenRig(); fake.humans.push('ledge');
  bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as unknown as Projects, home, file: join(home, 'openrig.json'),
    asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, decisions: { list: () => srv!.decisions.list(), onChange: f => srv!.decisions.onChange(f) },
    sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, home, mail, agentEnv: async () => ({ ...process.env }), openrig: bridge, brainGraceMs: GRACE, ...(o.mobile ? { mobile: o.mobile } : {}),
    claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  await bridge.start();
  if (o.brain) {
    const at = new Date().toISOString();
    store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: home, project: 'x', title: 'Ledge', tmuxSession: 'ledge-brain', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', brain: true } as never);
  }
  msgs = [];
  const w = ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
  w.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { w.once('open', () => res()); w.once('error', rej); });
  await until(() => msgs.some(m => m.type === 'ledge.thread.history'));
}

beforeEach(() => {
  saved = process.env.LEDGE_HOME;
  home = mkdtempSync(join(tmpdir(), 'ledge-lead-decision-')); process.env.LEDGE_HOME = home;
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  role('leader', 'label: Lead');
});
afterEach(async () => {
  if (ws) { const w = ws; await new Promise<void>(r => { w.once('close', () => r()); w.close(); }); ws = null; }
  await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null;
  if (saved === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = saved;
  rmSync(home, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
});

let n = 0;
const send = (m: ClientMessage) => ws!.send(JSON.stringify(m));
async function reply<T extends ServerMessage['type']>(type: T, rid: string, ms = 5000): Promise<Extract<ServerMessage, { type: T }>> {
  let hit: Extract<ServerMessage, { type: T }> | undefined;
  await until(() => !!(hit = msgs.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && (m as { rid?: string }).rid === rid)), ms);
  return hit!;
}
async function launch(): Promise<{ team: Team; lead: string }> {
  const rid = `l${++n}`;
  send({ type: 'team.launch', rid, cwd: work, name: 'api', seats: [{ role: 'leader' }] });
  const { team } = await reply('team.launched', rid);
  return { team, lead: team.seats.find(s => s.role === 'leader')!.sessionId! };
}
async function ask(lead: string): Promise<Task> {
  const rid = `g${++n}`;
  send({ type: 'task.cmd', rid, by: lead, op: 'give', to: 'ledge', title: QUESTION, text: OPTIONS });
  const r = await reply('task.result', rid);
  expect(r.reason).toBeUndefined();
  return r.task!;
}
async function brain(op: string, args: string[]) {
  const rid = `b${++n}`;
  send({ type: 'brain.cmd', rid, by: 'brain', key: sessionKey('brain'), op, args } as ClientMessage);
  return reply('brain.result', rid);
}
async function answer(id: string, text: string) {
  const rid = `a${++n}`;
  send({ type: 'escalation.answer', rid, id, answers: { text }, by: 'user' });
  return reply('rig.result', rid);
}
const updates = (id: string): Escalation[] => msgs.flatMap(m => (m.type === 'escalation.updated' && m.escalation.id === id ? [m.escalation] : []));
const lastUpdate = (id: string) => updates(id).at(-1);
const taskNow = (id: string): Task | undefined => msgs.flatMap(m => (m.type === 'task.updated' && m.task.id === id ? [m.task] : [])).at(-1);
const noticesTo = (id: string) => [...queued.values()].filter(q => q.target === id);
const decisions = () => createMemory({ dir: paths().memoryDir }).decisions();
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));


const run = async (action: string, args: Record<string, unknown>) => {
  const rid = `r${++n}`;
  send({ type: 'action.run', rid, action, args, confirmed: true } as ClientMessage);
  return reply('action.result', rid);
};

describe('task.answer on a mirrored decision', () => {
  it('goes through the escalation: one memory record, the escalation answered, the task done once, the lead told', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'pending');
    const r = await run('task.answer', { task: t.id, answer: 'oui, vas-y' });
    expect(r.reason).toBeUndefined();
    await until(() => taskNow(t.id)?.state === 'done');
    expect(taskNow(t.id)!.log.filter(e => e.op === 'done')).toHaveLength(1);
    expect(lastUpdate(id)).toMatchObject({ state: 'answered', answer: { by: 'user', answers: { text: 'oui, vas-y' } } });
    await until(() => decisions().length === 1);
    expect(decisions()[0]).toMatchObject({ by: 'user', escalationId: id, answers: { text: 'oui, vas-y' } });
    await until(() => noticesTo(lead).some(q => q.text.includes(t.id) && q.text.includes('oui, vas-y')));
    await pause(150);
    expect(decisions()).toHaveLength(1);
  });

  it('a second answer is refused, the first one stays', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    await until(() => lastUpdate(`task-${t.id}`)?.state === 'pending');
    expect((await run('task.answer', { task: t.id, answer: 'un' })).reason).toBeUndefined();
    await until(() => taskNow(t.id)?.state === 'done');
    await run('task.answer', { task: t.id, answer: 'deux' });
    await pause(100);
    expect(decisions()).toHaveLength(1);
    expect(taskNow(t.id)!.log.filter(e => e.op === 'done')).toHaveLength(1);
  });
});

describe('the phone hears of a lead\'s question once', () => {
  it('one push (the escalation\'s), not one for the task and one for the escalation', async () => {
    const { createECDH, randomBytes } = await import('node:crypto');
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), key: 'K1' };
    const sends: { topic?: string }[] = [];
    const state = { enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [{ id: 'dev1', label: 'dev1', approvedAt: new Date().toISOString(), online: true }], pairings: [] };
    const mobile = {
      state: () => state, onChange: () => () => {}, handle: async () => {}, send: async () => true, revoke: async () => {},
      credential: () => null, setCredential: () => {}, pushOf: (id: string) => (id === 'dev1' ? sub : null), setPush: () => {}, relayPushKey: () => 'K1',
      sendPush: async (m: { topic?: string }) => { sends.push(m); return { result: 'sent' as const }; },
      onMessage: () => () => {}, stop: async () => {}
    } as unknown as Parameters<typeof startServer>[0]['mobile'];
    await start({ brain: false, mobile });
    const { lead } = await launch();
    const t = await ask(lead);
    await until(() => sends.length >= 1);
    await pause(300);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.topic).toContain(`task-${t.id}`.replace(/[^a-z0-9_-]/gi, ''));
  });
});
