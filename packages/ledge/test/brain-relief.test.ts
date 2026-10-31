import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type ServerMessage, type Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createMemory, type Memory } from '../src/daemon/brain/memory.js';
import { createBrain, BRAIN_CONTEXT_RELIEF, localDay, type Brain, type BrainLaunch } from '../src/daemon/brain/session.js';
import { readBrainSettings, writeBrainSettings } from '../src/daemon/brain/settings.js';
import { DEFAULT_MANDATE } from '../src/daemon/brain/mandate.js';
import { createHandovers, type HandoverDeps, type Handovers } from '../src/daemon/handover.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { authHeaders, until } from './helpers.js';

const at = (ms: number): string => new Date(Date.UTC(2026, 9, 31, 10) + ms).toISOString();
const BRIEF = 'Fait : rig factory suivi. En cours : qi-12. Suite : relancer @qa. Décisions : sqlite, car déjà là.';
const ctx = (used: number, window = 200_000) => ({ used, window, at: at(0) });

type ReliefReq = Parameters<HandoverDeps['launch']>[0];
let root: string; let brainDir: string; let settingsPath: string; let store: Store; let memory: Memory;
let clock: number; let launched: BrainLaunch[]; let reliefs: ReliefReq[]; let closed: string[]; let notified: string[];
let brain: Brain; let handovers: Handovers;
/** A relief launch held before its record exists, or failing. */
let reliefGate: Promise<void> | null; let reliefFails: boolean;

const record = (id: string, name: string, tool: Session['tool'], cwd: string, extra: Partial<Session> = {}): Session => ({ id, name, tool, cwd, project: 'brain',
  title: `${name} · brain`, tmuxSession: `ledge-${id}`, state: 'starting', helpers: [], startedAt: at(clock), lastActivityAt: at(clock), source: 'launcher', brain: true, ...extra });
const close = async (s: Session): Promise<void> => { closed.push(s.id); store.upsert({ ...store.get(s.id)!, state: 'exited', exitedAt: at(clock) }); };

function make(): void {
  // The handovers first, as in the daemon: they see a store change before the brain does.
  handovers = createHandovers({ store, close, dir: join(root, 'handovers'), now: () => at(clock),
    mailbox: { notify: id => { notified.push(id); return true; } },
    launch: async req => { reliefs.push(req); if (reliefGate) await reliefGate; if (reliefFails) throw new Error('tmux gone'); const s = record(req.id ?? 'x', req.name ?? 'Pim', req.tool, req.cwd); store.upsert(s); return s; },
    brainRelief: s => brain.relief(s) });
  brain = createBrain({ store, settingsPath, dir: brainDir, mandate: async () => DEFAULT_MANDATE, memory, env: async () => ({ PATH: '/usr/bin' }), now: () => clock, close,
    launch: async o => { launched.push(o); const s = record(o.resume?.id ?? o.id, o.name, o.tool, o.cwd); store.upsert(s); return s; },
    handovers: { start: (id, o) => handovers.start(id, o) } });
}

/** The brain enabled, launched, and idle. */
async function seated(tool: Session['tool'] = 'claude'): Promise<Session> {
  await writeBrainSettings(settingsPath, { enabled: true, tool });
  make();
  await brain.start();
  const s = store.get('brain')!;
  store.upsert({ ...s, state: 'idle' });
  return store.get('brain')!;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brain-relief-')); brainDir = join(root, 'brain'); settingsPath = join(root, 'brain.json');
  store = new Store({ journalPath: join(root, 'sessions.json') }); memory = createMemory({ dir: join(root, 'memoire') });
  clock = 0; launched = []; reliefs = []; closed = []; notified = []; reliefGate = null; reliefFails = false;
});
afterEach(() => { brain?.dispose(); handovers?.close(); rmSync(root, { recursive: true, force: true }); });

describe('the brain relief (Lot 7, Task 10)', () => {
  it('70 % context starts a relief', async () => {
    expect(BRAIN_CONTEXT_RELIEF).toBe(0.7);
    await seated();
    const today = localDay(new Date(clock));
    expect(brain.checkRelief({ context: ctx(139_000), today, idle: true })).toBeNull();
    expect(brain.checkRelief({ context: { used: 1, window: 0, at: at(0) }, today, idle: true })).toBeNull();
    expect(brain.checkRelief({ context: ctx(140_000), today, idle: true })).toBe('context');
    expect(store.get('brain')!.handover).toMatchObject({ state: 'briefing', auto: true });
    expect(notified).toEqual(['brain']);
  });

  it('a cursor brain is never relieved on its context, only by the day', async () => {
    await seated('cursor');
    const today = localDay(new Date(clock));
    expect(brain.checkRelief({ context: ctx(190_000), today, idle: true })).toBeNull();
    expect(brain.checkRelief({ today: '2099-01-01', idle: true })).toBe('day');
  });

  it('a new day starts a relief once idle, then nothing more that day', async () => {
    await seated();
    // A fresh brain is not relieved the day it was launched.
    await until(() => readBrainSettings(settingsPath).day === localDay(new Date(clock)));
    expect(brain.checkRelief({ today: localDay(new Date(clock)), idle: true })).toBeNull();
    const tomorrow = '2099-01-02';
    expect(brain.checkRelief({ today: tomorrow, idle: false })).toBeNull();
    expect(brain.checkRelief({ today: tomorrow, idle: true })).toBe('day');
    await until(() => readBrainSettings(settingsPath).day === tomorrow);
    expect(handovers.brief('brain', BRIEF)).toBeNull();
    await until(() => store.get('brain')?.handover?.state === 'done');
    const fresh = brain.session()!;
    store.upsert({ ...fresh, state: 'idle' });
    expect(brain.checkRelief({ today: tomorrow, idle: true })).toBeNull();
    expect(reliefs).toHaveLength(1);
  });

  it('no relief while one runs', async () => {
    await seated();
    expect(handovers.start('brain')).toBeNull();
    expect(brain.checkRelief({ context: ctx(190_000), today: '2099-01-02', idle: true })).toBeNull();
    expect(notified).toEqual(['brain']);
  });

  it('the relief keeps brain: true and gets the instructions with fresh memory', async () => {
    await seated();
    memory.record({ escalationId: 'qi-9', by: 'ledge', category: 'tests', summary: 'relancé les tests lint', answers: { q1: 'o1' }, at: at(1) });
    expect(brain.checkRelief({ context: ctx(150_000), today: localDay(new Date(clock)), idle: true })).toBe('context');
    expect(handovers.brief('brain', BRIEF)).toBeNull();
    await until(() => store.get('brain')?.handover?.state === 'done');
    expect(reliefs).toHaveLength(1);
    const req = reliefs[0]!;
    expect(req).toMatchObject({ brain: true, name: 'Ledge', cwd: brainDir, tool: 'claude', env: { LEDGE_BRAIN: '1', PATH: `${join(brainDir, 'bin')}:/usr/bin` } });
    expect(req.id).toMatch(/^brain-[0-9a-f]{4}$/);
    expect(req).not.toHaveProperty('autonomy');
    expect(req.prompt).toContain('Fait : rig factory suivi.');
    expect(req.prompt).toContain('Le mandat de Ledge');
    expect(req.prompt).toContain('relancé les tests lint');
    expect(req.prompt.indexOf('Fait : rig factory suivi.')).toBeLessThan(req.prompt.indexOf('Le mandat de Ledge'));
    // The instructions in the brain's folder are rewritten too.
    expect(readFileSync(join(brainDir, 'CLAUDE.md'), 'utf8')).toContain('relancé les tests lint');
    expect(readFileSync(join(brainDir, 'AGENTS.md'), 'utf8')).toContain('relancé les tests lint');
    // The old brain closed is no death; the new one is the brain.
    expect(closed).toEqual(['brain']);
    await brain.settled();
    expect(launched).toHaveLength(1);
    expect(brain.session()?.id).toBe(req.id);
    expect(brain.status()).toMatchObject({ state: 'starting', sessionId: req.id, restarts: 0 });
    store.upsert({ ...store.get(req.id!)!, state: 'idle' });
    expect(brain.status()).toMatchObject({ state: 'on', sessionId: req.id });
    // A death of the new one is handled by the breaker.
    store.upsert({ ...store.get(req.id!)!, state: 'exited', exitedAt: at(1), exitCode: 1 });
    await brain.settled();
    expect(launched).toHaveLength(1 + 1);
    expect(brain.status().restarts).toBe(1);
  });

  it('disabling the brain while it writes its brief: no relief is launched', async () => {
    await seated();
    expect(brain.checkRelief({ context: ctx(150_000), today: '2099-01-02', idle: true })).toBe('context');
    await brain.set({ enabled: false });
    await until(() => store.get('brain')?.handover?.state === 'failed');
    await brain.settled();
    expect(reliefs).toHaveLength(0);
    expect(launched).toHaveLength(1);
    expect(brain.session()).toBeUndefined();
    expect(brain.status()).toMatchObject({ state: 'off', enabled: false });
  });

  it('disabling the brain while its relief launches: the relief is closed, the brain stays off', async () => {
    await seated();
    let open!: () => void; reliefGate = new Promise<void>(r => { open = r; });
    expect(brain.checkRelief({ context: ctx(150_000), today: '2099-01-02', idle: true })).toBe('context');
    expect(handovers.brief('brain', BRIEF)).toBeNull();
    await until(() => reliefs.length === 1);
    await brain.set({ enabled: false });
    open();
    await until(() => store.get('brain')?.handover?.state === 'done');
    const to = reliefs[0]!.id!;
    await until(() => store.get(to)?.state === 'exited');
    expect(closed).toEqual(['brain', to]);
    await brain.settled();
    expect(launched).toHaveLength(1);
    expect(brain.session()).toBeUndefined();
    expect(brain.status()).toMatchObject({ state: 'off', enabled: false });
  });

  it('changing the tool while the brain writes its brief: one live brain, on the new tool', async () => {
    await seated();
    expect(brain.checkRelief({ context: ctx(150_000), today: '2099-01-02', idle: true })).toBe('context');
    await brain.set({ enabled: true, tool: 'codex' });
    await until(() => store.get('brain')?.handover?.state === 'failed');
    await brain.settled();
    expect(reliefs).toHaveLength(0);
    const alive = store.all().filter(x => x.brain && x.state !== 'exited');
    expect(alive).toHaveLength(1);
    expect(alive[0]).toMatchObject({ tool: 'codex' });
    expect(brain.session()?.tool).toBe('codex');
  });

  it('a brain that died during its relief, whose relief then failed, is relaunched by the breaker', async () => {
    await seated();
    reliefFails = true;
    expect(brain.checkRelief({ context: ctx(150_000), today: '2099-01-02', idle: true })).toBe('context');
    store.upsert({ ...store.get('brain')!, state: 'exited', exitedAt: at(1), exitCode: 1 });
    // The relief is tried (and fails); only then is the death counted.
    await until(() => launched.length === 2);
    expect(reliefs).toHaveLength(1);
    await brain.settled();
    expect(launched[1]!.resume?.id).toBe('brain');
    expect(brain.status()).toMatchObject({ restarts: 1, sessionId: 'brain' });
  });

  it('a relief of an ordinary session is unchanged', async () => {
    await seated();
    store.upsert({ ...record('a1', 'Pim', 'claude', root, { brain: undefined, autonomy: 'edits' }), state: 'idle' });
    expect(handovers.start('a1')).toBeNull();
    expect(handovers.brief('a1', BRIEF)).toBeNull();
    await until(() => store.get('a1')?.handover?.state === 'done');
    expect(reliefs[0]).toMatchObject({ tool: 'claude', cwd: root, autonomy: 'edits' });
    expect(reliefs[0]).not.toHaveProperty('brain');
    expect(reliefs[0]!.prompt).not.toContain('Le mandat de Ledge');
  });
});

describe('the brain relief in the daemon', () => {
  let srv: ServerHandle | null = null; let home: string; const savedHome = process.env.LEDGE_HOME;
  let spawned: { name: string; cwd: string; env: Record<string, string>; command: string[] }[];
  const panes = new Set<string>();
  const tmux = new Proxy({} as Tmux, { get: (_t, k) => k === 'newSession' ? async (o: (typeof spawned)[number]) => { spawned.push(o); panes.add(o.name); }
    : k === 'hasSession' ? async (n: string) => panes.has(n) : k === 'listSessions' ? async () => [...panes] : k === 'killSession' ? async (n: string) => { panes.delete(n); }
    : k === 'capture' ? async () => '' : k === 'attachArgs' ? (n: string) => ['attach', n] : async () => undefined });
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'brain-relief-srv-')); process.env.LEDGE_HOME = home; spawned = []; panes.clear(); });
  afterEach(async () => { await srv?.close(); srv = null; process.env.LEDGE_HOME = savedHome; rmSync(home, { recursive: true, force: true }); });

  async function client(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = [];
    ws.on('message', m => msgs.push(parseServerMessage(JSON.parse(String(m)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return { msgs, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => ws.close() };
  }
  const serve = async (store: Store) => (srv = await startServer({ store, tmux, port: 0, home, verify: { attempts: 2, intervalMs: 10 }, close: { freeMs: 200, exitMs: 200 }, agentEnv: async () => ({ PATH: '/login/bin', HOME: home }) }));
  const claudeLine = (used: number) => JSON.stringify({ type: 'assistant', message: { model: 'claude-opus', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: used - 30, output_tokens: 20 } } });

  it('measured at 75 %, the brain is relieved by « Ledge », a brain again, pinned and instructed', async () => {
    await writeBrainSettings(join(home, 'brain.json'), { enabled: true, tool: 'claude' });
    const store = new Store(); const s = await serve(store);
    await until(() => store.get('brain')?.state === 'starting');
    const transcript = join(home, 't.jsonl'); writeFileSync(transcript, `${claudeLine(150_000)}\n`);
    store.upsert({ ...store.get('brain')!, state: 'working', transcriptPath: transcript });
    store.upsert({ ...store.get('brain')!, state: 'idle' });
    await until(() => store.get('brain')?.handover?.state === 'briefing');
    expect(store.get('brain')!.handover).toMatchObject({ auto: true });
    const c = await client(s.port);
    c.send({ type: 'handover.brief', rid: 'b', by: 'brain', text: BRIEF });
    await until(() => store.get('brain')?.handover?.state === 'done', 5000);
    const to = store.get('brain')!.handover!.to!;
    expect(to).toMatch(/^brain-[0-9a-f]{4}$/);
    expect(store.get(to)).toMatchObject({ brain: true, name: 'Ledge', cwd: join(home, 'brain') });
    expect(store.get(to)).not.toHaveProperty('autonomy');
    const relief = spawned.at(-1)!;
    expect(relief.env).toMatchObject({ LEDGE_BRAIN: '1', LEDGE_NAME: 'Ledge', LEDGE_SESSION: to, PATH: `${join(home, 'brain')}/bin:/login/bin` });
    expect(relief.command.join(' ')).toContain('--permission-mode default');
    expect(relief.command.join(' ')).toContain('Le mandat de Ledge');
    await until(() => store.get('brain')?.state === 'exited');
    // The old brain's close is no death: no relaunch.
    await new Promise(r => setTimeout(r, 50));
    expect(spawned).toHaveLength(2);
    c.close();
  }, 20_000);

  it('a brain resumed after a death never keeps an autonomy', async () => {
    await writeBrainSettings(join(home, 'brain.json'), { enabled: true, tool: 'claude' });
    const store = new Store();
    store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: join(home, 'brain'), project: 'brain', title: 'Ledge · brain', tmuxSession: 'ledge-brain', state: 'exited', exitedAt: at(0), helpers: [], startedAt: at(0), lastActivityAt: at(0), source: 'launcher', brain: true, agentSessionId: 'conv-1', autonomy: 'auto' });
    await serve(store);
    await until(() => store.get('brain')?.state === 'starting');
    expect(store.get('brain')).not.toHaveProperty('autonomy');
    expect(spawned[0]!.command.join(' ')).not.toContain('bypassPermissions');
  });
});
