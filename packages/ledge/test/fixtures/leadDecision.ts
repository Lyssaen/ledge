import { afterEach, beforeEach, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Escalation, type Projects, type ServerMessage, type Task, type Team } from '@ledge/protocol';
import { Store } from '../../src/daemon/store.js';
import { startServer, type ServerHandle } from '../../src/daemon/server.js';
import { createBridge, type Bridge } from '../../src/daemon/openrig/bridge.js';
import type { MailState } from '../../src/daemon/mailbox.js';
import { createMemory } from '../../src/daemon/brain/memory.js';
import { sessionKey } from '../../src/auth.js';
import { paths } from '../../src/paths.js';
import type { Tmux } from '../../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from '../fakes/openrig.js';
import { authHeaders, until } from '../helpers.js';
// The harness of the lead-question daemon tests (lot E): a real daemon with the real bridge on a fake OpenRig, a team launch, a captured mailbox.
export const GRACE = 700;
export const QUESTION = 'Fusionner maintenant ?';
export const OPTIONS = 'oui / non, je recommande oui';

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; }, async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}
export type Notice = MailState['queue'][number];

export let home: string; export let work: string; export let store: Store; export let srv: ServerHandle | null = null; export let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null;
let ws: WebSocket | null = null; export let msgs: ServerMessage[]; export let queued: Map<string, Notice>; let saved: string | undefined;
const role = (id: string, front: string) => { mkdirSync(join(home, 'roles'), { recursive: true }); writeFileSync(join(home, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };

export async function start(o: { brain: boolean; mobile?: Parameters<typeof startServer>[0]['mobile'] }) {
  store = new Store(); queued = new Map();
  const mail = { load: () => undefined, save: (s: MailState) => { for (const q of s.queue) queued.set(q.id, q); } };
  fake = await createFakeOpenRig(); fake.humans.push('ledge');
  bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as unknown as Projects, home, file: join(home, 'openrig.json'),
    asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, decisions: { list: () => srv!.decisions.list(), onChange: f => srv!.decisions.onChange(f) },
    sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, home, mail, agentEnv: async () => ({ ...process.env }), openrig: bridge, brainGraceMs: GRACE, ...(o.mobile ? { mobile: o.mobile } : {}),
    claudeBin: [process.execPath, fileURLToPath(new URL('../fake-claude.mjs', import.meta.url))] });
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

/** Registers the harness's hooks in the calling test file: a home, a work folder and a role, then everything torn down. */
export function installLeadHarness() {
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
}

let n = 0;
/** The next request id. */
export const nextId = () => ++n;
export const send = (m: ClientMessage) => ws!.send(JSON.stringify(m));
export async function reply<T extends ServerMessage['type']>(type: T, rid: string, ms = 5000): Promise<Extract<ServerMessage, { type: T }>> {
  let hit: Extract<ServerMessage, { type: T }> | undefined;
  await until(() => !!(hit = msgs.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && (m as { rid?: string }).rid === rid)), ms);
  return hit!;
}
export async function launch(): Promise<{ team: Team; lead: string }> {
  const rid = `l${nextId()}`;
  send({ type: 'team.launch', rid, cwd: work, name: 'api', seats: [{ role: 'leader' }] });
  const { team } = await reply('team.launched', rid);
  return { team, lead: team.seats.find(s => s.role === 'leader')!.sessionId! };
}
export async function ask(lead: string): Promise<Task> {
  const rid = `g${nextId()}`;
  send({ type: 'task.cmd', rid, by: lead, op: 'give', to: 'ledge', title: QUESTION, text: OPTIONS });
  const r = await reply('task.result', rid);
  expect(r.reason).toBeUndefined();
  return r.task!;
}
export async function brain(op: string, args: string[]) {
  const rid = `b${nextId()}`;
  send({ type: 'brain.cmd', rid, by: 'brain', key: sessionKey('brain'), op, args } as ClientMessage);
  return reply('brain.result', rid);
}
export async function answer(id: string, text: string) {
  const rid = `a${nextId()}`;
  send({ type: 'escalation.answer', rid, id, answers: { text }, by: 'user' });
  return reply('rig.result', rid);
}
export const updates = (id: string): Escalation[] => msgs.flatMap(m => (m.type === 'escalation.updated' && m.escalation.id === id ? [m.escalation] : []));
export const lastUpdate = (id: string) => updates(id).at(-1);
export const taskNow = (id: string): Task | undefined => msgs.flatMap(m => (m.type === 'task.updated' && m.task.id === id ? [m.task] : [])).at(-1);
export const noticesTo = (id: string): Notice[] => [...queued.values()].filter(q => q.target === id);
export const decisions = () => createMemory({ dir: paths().memoryDir }).decisions();
export const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A lone session's question: no team, no lead. */
export async function lone(): Promise<Task> {
  const at = new Date().toISOString();
  store.upsert({ id: 'solo', name: 'Solo', tool: 'claude', cwd: work, project: 'x', title: 'Solo', tmuxSession: 'ledge-solo', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' } as never);
  return ask('solo');
}
/** Switches the teams engine and checks it took. */
export async function engine(e: 'ledge' | 'openrig') {
  const rid = `e${nextId()}`;
  send({ type: 'teams.engine.set', rid, engine: e });
  expect(await reply('teams.engine.result', rid)).toMatchObject({ ok: true });
}
