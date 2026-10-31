import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type BrainStatus, type ClientMessage, type LedgeDecision, type LedgeRule, type ServerMessage, type Session, type Tool } from '@ledge/protocol';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { authHeaders, until } from './helpers.js';
import { Store } from '../src/daemon/store.js';
import { createMemory, type Memory } from '../src/daemon/brain/memory.js';
import { createBrain, RESTARTS_MAX, RESTART_WINDOW_MS, type Brain, type BrainLaunch } from '../src/daemon/brain/session.js';
import { brainInstructions, BRAIN_ROLE } from '../src/daemon/brain/persona.js';
import { readBrainSettings, writeBrainSettings } from '../src/daemon/brain/settings.js';
import { DEFAULT_MANDATE } from '../src/daemon/brain/mandate.js';

const at = (ms: number): string => new Date(Date.UTC(2026, 9, 31, 10) + ms).toISOString();

let root: string; let brainDir: string; let settingsPath: string; let store: Store; let memory: Memory;
let gate: Promise<void> | null = null; let closeFails = false;
let clock: number; let launched: BrainLaunch[]; let closed: string[]; let brain: Brain; let statuses: BrainStatus[];

/** The fake launch registers a brain record in `starting`, as the server's launch path would. */
const launch = async (o: BrainLaunch): Promise<Session> => {
  launched.push(o);
  const id = o.resume?.id ?? o.id;
  const s: Session = { id, name: o.name, tool: o.tool, cwd: o.cwd, project: 'brain', title: `${o.name} · brain`, tmuxSession: `ledge-${id}`,
    state: 'starting', helpers: [], startedAt: at(clock), lastActivityAt: at(clock), source: 'launcher', brain: true };
  store.upsert(s);
  if (gate) await gate;
  return s;
};
const close = async (s: Session): Promise<void> => { if (closeFails) throw new Error('tmux gone'); closed.push(s.id); store.upsert({ ...store.get(s.id)!, state: 'exited', exitedAt: at(clock) }); };
const make = (): Brain => createBrain({ store, settingsPath, dir: brainDir, launch, close, mandate: async () => DEFAULT_MANDATE, memory,
  env: async () => ({ PATH: '/usr/bin:/bin' }), now: () => clock });
const live = (): Session => store.all().find(s => s.brain && s.state !== 'exited')!;
const die = (id: string, extra: Partial<Session> = {}): void => { store.upsert({ ...store.get(id)!, state: 'exited', exitedAt: at(clock), exitCode: 1, ...extra }); };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brain-')); brainDir = join(root, 'brain'); settingsPath = join(root, 'brain.json');
  store = new Store({ journalPath: join(root, 'sessions.json') }); memory = createMemory({ dir: join(root, 'memoire') });
  clock = 0; launched = []; closed = []; statuses = []; gate = null; closeFails = false;
  brain = make(); brain.onStatus(s => statuses.push(s));
});
afterEach(() => { brain.dispose(); rmSync(root, { recursive: true, force: true }); });

describe('brain settings', () => {
  it('default to never asked with claude, and round-trip', async () => {
    expect(readBrainSettings(settingsPath)).toEqual({ enabled: null, tool: 'claude' });
    await writeBrainSettings(settingsPath, { enabled: true, tool: 'codex', day: '2026-10-31' });
    expect(readBrainSettings(settingsPath)).toEqual({ enabled: true, tool: 'codex', day: '2026-10-31' });
  });
  it('fall back to the defaults on a broken file or an OMP tool', () => {
    writeFileSync(settingsPath, '{oops');
    expect(readBrainSettings(settingsPath)).toEqual({ enabled: null, tool: 'claude' });
    writeFileSync(settingsPath, JSON.stringify({ enabled: false, tool: 'omp' }));
    expect(readBrainSettings(settingsPath)).toEqual({ enabled: false, tool: 'claude' });
  });
});

describe('the brain instructions', () => {
  const rule = (id: string, status: LedgeRule['status']): LedgeRule => ({ id, text: `règle ${id}`, category: 'git', since: '2026-10-30', from: 'e1', appliedCount: 0, status });
  const decision = (i: number): LedgeDecision => ({ id: `d${i}`, escalationId: `e${i}`, by: 'ledge', category: 'tests', summary: `décision numéro ${i}`, answers: { q1: 'o1' }, at: at(i * 1000) });

  it('carry the role, the mandate, active rules and the last 20 decisions', () => {
    const decisions = Array.from({ length: 25 }, (_, i) => decision(25 - i)); // newest first, as Memory gives them
    const text = brainInstructions({ mandate: DEFAULT_MANDATE, rules: [rule('r1', 'active'), rule('r2', 'proposed')], decisions, tool: 'claude' });
    expect(text).toContain(BRAIN_ROLE);
    expect(BRAIN_ROLE).toBe("Tu es Ledge, l'humain des rigs OpenRig de l'utilisateur et son seul interlocuteur");
    expect(text).toContain('## Ledge tranche seul');
    expect(text).toContain('règle r1');
    expect(text).not.toContain('règle r2');
    expect(text.match(/décision numéro \d+/g)).toHaveLength(20);
    expect(text).toContain('décision numéro 25');
    expect(text).not.toContain('décision numéro 5\n');
    expect(text).toContain('<ledge-event kind=');
    for (const op of ['say', 'decide', 'ask', 'rig', 'send', 'propose', 'remember', 'who', 'rigs', 'escalations', 'rules']) expect(text).toContain(`ledge brain ${op}`);
    expect(text).toContain('7433');
    expect(text).toMatch(/confiance/);
  });
});

describe('the brain session', () => {
  it('stays off until the user enables it', async () => {
    await brain.start();
    expect(launched).toHaveLength(0);
    expect(brain.status()).toMatchObject({ state: 'off', enabled: null, tool: 'claude' });
  });

  it('enabling launches Ledge as brain in ledge-brain with the shims first in PATH', async () => {
    await brain.set({ enabled: true });
    expect(launched[0]).toMatchObject({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: brainDir,
      env: { LEDGE_BRAIN: '1', PATH: expect.stringMatching(new RegExp(`^${brainDir}/bin:/usr/bin`)) } });
    for (const shim of ['rig', 'tmux']) {
      const f = join(brainDir, 'bin', shim);
      expect(readFileSync(f, 'utf8')).toMatch(/^#!\/bin\/sh\n[\s\S]*ledge brain[\s\S]*exit 1/);
      expect(statSync(f).mode & 0o777).toBe(0o755);
    }
    expect(readFileSync(join(brainDir, 'CLAUDE.md'), 'utf8')).toContain(BRAIN_ROLE);
    expect(readFileSync(join(brainDir, 'AGENTS.md'), 'utf8')).toContain(BRAIN_ROLE);
    const perms = JSON.parse(readFileSync(join(brainDir, '.claude', 'settings.json'), 'utf8'));
    expect(perms).toEqual({ permissions: { defaultMode: 'default', allow: ['Bash(ledge brain:*)'],
      deny: ['Bash(rig:*)', 'Bash(tmux:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'WebFetch'] } });
    expect(readBrainSettings(settingsPath)).toMatchObject({ enabled: true, tool: 'claude' });
    expect(brain.status()).toMatchObject({ state: 'starting', enabled: true, sessionId: 'brain', restarts: 0 });
    store.upsert({ ...live(), state: 'idle', context: { used: 50_000, window: 200_000, at: at(0) } });
    expect(brain.status()).toMatchObject({ state: 'on', contextPct: 25 });
    expect(statuses.at(-1)).toMatchObject({ state: 'on' });
    expect(brain.session()?.id).toBe('brain');
  });

  it('refuses OMP as the brain', async () => {
    await expect(brain.set({ enabled: true, tool: 'omp' as Tool })).rejects.toThrow(/OMP/);
    expect(launched).toHaveLength(0);
  });

  it('a brain alive in the store is adopted, not relaunched', async () => {
    await writeBrainSettings(settingsPath, { enabled: true, tool: 'claude' });
    store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: brainDir, project: 'brain', title: 'Ledge · brain', tmuxSession: 'ledge-brain', state: 'idle', helpers: [], startedAt: at(0), lastActivityAt: at(0), source: 'launcher', brain: true });
    await brain.start();
    expect(launched).toHaveLength(0);
    expect(brain.status()).toMatchObject({ state: 'on', sessionId: 'brain' });
  });

  it('an exited brain record is resumed at start', async () => {
    await writeBrainSettings(settingsPath, { enabled: true, tool: 'claude' });
    store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: brainDir, project: 'brain', title: 'Ledge · brain', tmuxSession: 'ledge-brain', state: 'exited', exitedAt: at(0), helpers: [], startedAt: at(0), lastActivityAt: at(0), source: 'launcher', brain: true, agentSessionId: 'abc' });
    await brain.start();
    expect(launched).toHaveLength(1);
    expect(launched[0]!.resume?.id).toBe('brain');
  });

  it('a dead brain is relaunched', async () => {
    await brain.set({ enabled: true });
    die('brain'); await brain.settled();
    expect(launched).toHaveLength(2);
    expect(launched[1]!.resume?.id).toBe('brain');
    expect(brain.status()).toMatchObject({ restarts: 1, state: 'starting' });
  });

  it('three deaths in 10 min mark the brain down', async () => {
    await brain.set({ enabled: true });
    for (let i = 0; i < RESTARTS_MAX; i++) { clock += 60_000; die('brain'); await brain.settled(); }
    expect(launched).toHaveLength(1 + RESTARTS_MAX);
    clock += 60_000; die('brain', { lastError: 'Error: boom' }); await brain.settled();
    expect(launched).toHaveLength(1 + RESTARTS_MAX);
    expect(brain.status()).toMatchObject({ state: 'down', reason: 'Error: boom', restarts: RESTARTS_MAX });
    expect(statuses.at(-1)).toMatchObject({ state: 'down' });
  });

  it('a down brain without stderr gives its exit code', async () => {
    await brain.set({ enabled: true });
    for (let i = 0; i <= RESTARTS_MAX; i++) { die('brain', { exitCode: 7 }); await brain.settled(); }
    expect(brain.status()).toMatchObject({ state: 'down', reason: expect.stringContaining('7') });
    await brain.set({ enabled: true }); // re-enabling clears the breaker
    expect(brain.status()).toMatchObject({ state: 'starting', restarts: 0 });
    expect(launched).toHaveLength(2 + RESTARTS_MAX);
  });

  it('deaths spread over more than 10 min keep relaunching', async () => {
    await brain.set({ enabled: true });
    for (let i = 0; i < 6; i++) { clock += RESTART_WINDOW_MS / 2 + 1; die('brain'); await brain.settled(); }
    expect(launched).toHaveLength(7);
    expect(brain.status().state).not.toBe('down');
  });

  it('disabling closes the session and writes enabled false, without a relaunch', async () => {
    await brain.set({ enabled: true });
    await brain.set({ enabled: false }); await brain.settled();
    expect(closed).toEqual(['brain']);
    expect(launched).toHaveLength(1);
    expect(readBrainSettings(settingsPath).enabled).toBe(false);
    expect(brain.status()).toMatchObject({ state: 'off', enabled: false });
  });

  it('an exit expected by a relief, or during a handover, is no death', async () => {
    await brain.set({ enabled: true });
    brain.expectExit('brain'); die('brain'); await brain.settled();
    expect(launched).toHaveLength(1);
    await brain.set({ enabled: true }); // nothing alive: starts again
    expect(launched).toHaveLength(2);
    store.upsert({ ...live(), handover: { state: 'launching', at: at(0) } as Session['handover'] });
    die('brain'); await brain.settled();
    expect(launched).toHaveLength(2);
  });

  it('a death during a launch in flight is judged once the launch is over', async () => {
    let open!: () => void; gate = new Promise<void>(r => { open = r; });
    const p = brain.set({ enabled: true });
    await new Promise(r => setTimeout(r, 20)); // the record is in the store, the launch not over
    expect(launched).toHaveLength(1);
    die('brain'); gate = null; open(); await p; await brain.settled();
    expect(launched).toHaveLength(2);
    expect(brain.status()).toMatchObject({ state: 'starting', restarts: 1 });
  });

  it('restarts older than the window are no longer counted', async () => {
    await brain.set({ enabled: true });
    die('brain'); await brain.settled();
    expect(brain.status().restarts).toBe(1);
    clock += RESTART_WINDOW_MS + 1;
    expect(brain.status().restarts).toBe(0);
  });

  it('a failed close never shows a live brain as off', async () => {
    await brain.set({ enabled: true });
    closeFails = true;
    await expect(brain.set({ enabled: false })).rejects.toThrow('tmux gone');
    expect(brain.status()).toMatchObject({ state: 'starting', enabled: false, sessionId: 'brain' });
  });

  it('a context without a window gives no percentage', async () => {
    await brain.set({ enabled: true });
    store.upsert({ ...live(), state: 'idle', context: { used: 10, window: 0, at: at(0) } });
    expect(brain.status().state).toBe('on');
    expect(brain.status().contextPct).toBeUndefined();
  });

  it('changing the tool replaces the session', async () => {
    await brain.set({ enabled: true });
    await brain.set({ enabled: true, tool: 'codex' }); await brain.settled();
    expect(closed).toEqual(['brain']);
    expect(launched).toHaveLength(2);
    expect(launched[1]).toMatchObject({ tool: 'codex', name: 'Ledge' });
    expect(launched[1]!.resume).toBeUndefined();
    expect(launched[1]!.id).toMatch(/^brain-[0-9a-f]+$/);
    expect(existsSync(join(brainDir, 'AGENTS.md'))).toBe(true);
  });
});

describe('the brain in the daemon', () => {
  let srv: ServerHandle | null = null; let home: string; const savedHome = process.env.LEDGE_HOME;
  let spawned: { name: string; cwd: string; env: Record<string, string>; command: string[] }[];
  const tmux = new Proxy({} as Tmux, { get: (_t, k) => k === 'newSession' ? async (o: (typeof spawned)[number]) => { spawned.push(o); } : async () => undefined });
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'brain-srv-')); process.env.LEDGE_HOME = home; spawned = []; });
  afterEach(async () => { await srv?.close(); srv = null; process.env.LEDGE_HOME = savedHome; rmSync(home, { recursive: true, force: true }); });

  async function client(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = [];
    ws.on('message', m => msgs.push(parseServerMessage(JSON.parse(String(m)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return { msgs, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => ws.close() };
  }
  const serve = async (store: Store) => (srv = await startServer({ store, tmux, port: 0, home, agentEnv: async () => ({ PATH: '/login/bin', HOME: home }) }));

  it('sends brain.status at connection, refuses OMP, and launches the brain on brain.set', async () => {
    const store = new Store(); const s = await serve(store);
    const c = await client(s.port);
    await until(() => c.msgs.some(m => m.type === 'brain.status'));
    expect(c.msgs.find(m => m.type === 'brain.status')).toMatchObject({ status: { state: 'off', enabled: null, tool: 'claude' } });
    c.send({ type: 'brain.set', rid: 'r1', enabled: true, tool: 'omp' });
    await until(() => c.msgs.some(m => m.type === 'rig.result' && m.rid === 'r1'));
    expect(c.msgs.find(m => m.type === 'rig.result' && m.rid === 'r1')).toMatchObject({ ok: false, code: 'invalid', reason: expect.stringContaining('OMP') });
    expect(spawned).toHaveLength(0);
    c.send({ type: 'brain.set', rid: 'r2', enabled: true });
    await until(() => c.msgs.some(m => m.type === 'rig.result' && m.rid === 'r2'));
    expect(c.msgs.find(m => m.type === 'rig.result' && m.rid === 'r2')).toMatchObject({ ok: true });
    const dir = join(home, 'brain');
    expect(spawned[0]).toMatchObject({ name: 'ledge-brain', cwd: dir, env: { PATH: `${dir}/bin:/login/bin`, HOME: home, LEDGE_BRAIN: '1', LEDGE_SESSION: 'brain', LEDGE_NAME: 'Ledge' } });
    expect(store.get('brain')).toMatchObject({ brain: true, name: 'Ledge', state: 'starting' });
    expect(spawned[0]!.command.join(' ')).toContain('--permission-mode default');
    expect(readBrainSettings(join(home, 'brain.json'))).toMatchObject({ enabled: true, tool: 'claude' });
    await until(() => c.msgs.some(m => m.type === 'brain.status' && m.status.state === 'starting' && m.status.sessionId === 'brain'));
    c.close();
  });

  it('never gives another session the brain arguments', async () => {
    const store = new Store(); const s = await serve(store);
    const c = await client(s.port);
    c.send({ type: 'session.launch', tool: 'claude', cwd: home } as ClientMessage);
    await until(() => spawned.length === 1);
    expect(spawned[0]!.command.join(' ')).not.toContain('--permission-mode');
    expect(spawned[0]!.env.LEDGE_BRAIN).toBeUndefined();
    c.close();
  });

  it('resumes an exited brain at start with its shims and keeps it a brain', async () => {
    await writeBrainSettings(join(home, 'brain.json'), { enabled: true, tool: 'claude' });
    const store = new Store();
    store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: join(home, 'brain'), project: 'brain', title: 'Ledge · brain', tmuxSession: 'ledge-brain', state: 'exited', exitedAt: at(0), helpers: [], startedAt: at(0), lastActivityAt: at(0), source: 'launcher', brain: true, agentSessionId: 'conv-1' });
    await serve(store);
    await until(() => store.get('brain')?.state === 'starting');
    expect(spawned[0]!.command).toEqual(expect.arrayContaining(['--resume', 'conv-1']));
    expect(spawned[0]!.command.join(' ')).toContain('--permission-mode default');
    expect(spawned[0]!.env).toMatchObject({ LEDGE_BRAIN: '1', PATH: `${join(home, 'brain')}/bin:/login/bin` });
    expect(store.get('brain')).toMatchObject({ brain: true, agentSessionId: 'conv-1' });
    expect(existsSync(join(home, 'brain', 'CLAUDE.md'))).toBe(true);
  });
});
