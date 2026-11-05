import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Projects, Session } from '@ledge/protocol';
import { projectOf } from '@ledge/protocol';
import { sceneOf, walkOrder } from '@ledge/ui/atelier/layout';
import { realTmux, type Tmux } from '../src/tmux.js';
import { spawnSession } from '../src/spawn.js';
import { ensureLedgeDir } from '../src/paths.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import { killTestServer, until } from './helpers.js';

// 2026-11-05: Ledge's tmux server was started by `ledge claude` from the seat advisor-lead@kernel, so its global
// environment kept OPENRIG_SESSION_NAME; every agent launched from Ledge took itself for that seat, the Atelier's
// « Projets » showed none of them (« 12 actifs », an empty floor) and Max was missing from Payment.

const SEAT = 'advisor-lead@kernel';
let n = 0; let socket: string; let tmux: Tmux; let dir: string;
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir();
  dir = mkdtempSync(join(tmpdir(), 'ledge-seat-'));
  socket = `ledge-seat-${process.pid}-${Date.now()}-${n++}`; tmux = realTmux(socket, { scope: async () => false });
});
afterEach(async () => { await killTestServer(socket); });

/** The server started from a seat's shell, as that morning: its global environment holds the seat. */
const serverFromSeat = () => spawnSync('tmux', ['-L', socket, 'new-session', '-d', '-s', 'seat-shell', 'sleep', '600'], { env: { ...process.env, OPENRIG_SESSION_NAME: SEAT } });
const clean = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('OPENRIG_') && k !== 'LEDGE_SESSION'));
/** An agent that writes the seat it sees (what its hook would report) to `file`, then waits. */
const agent = (file: string) => ['sh', '-c', `printf '%s' "$OPENRIG_SESSION_NAME" > ${file}; sleep 30`];
const seen = async (file: string) => { await until(() => existsSync(file)); return readFileSync(file, 'utf8'); };
const launch = (name: string, env: NodeJS.ProcessEnv, cwd = dir) =>
  spawnSession({ tool: 'claude', args: [], command: agent(join(dir, `${name}.seat`)), cwd, tmux, taken: { names: [], ids: [] }, env, name });

describe('a seat\'s identity on a launched agent', () => {
  it('an agent Ledge launches does not take the seat of whoever started the tmux server', async () => {
    serverFromSeat();
    const s = await launch('Max', clean());
    expect(await seen(join(dir, 'Max.seat'))).toBe('');
    expect(await tmux.sessionEnv!(s.tmuxSession!, 'OPENRIG_SESSION_NAME')).toBeNull();
  });
  it('a real seat (OpenRig runs `ledge claude` in its shell) keeps it, in its own tmux session', async () => {
    serverFromSeat();
    const s = await launch('Lead', { ...clean(), OPENRIG_SESSION_NAME: 'dev-back@ledge-dev' });
    expect(await seen(join(dir, 'Lead.seat'))).toBe('dev-back@ledge-dev');
    expect(await tmux.sessionEnv!(s.tmuxSession!, 'OPENRIG_SESSION_NAME')).toBe('dev-back@ledge-dev');
  });
  it('an agent launched from inside a Ledge session is not that session\'s seat', async () => {
    const s = await launch('Sink', { ...clean(), LEDGE_SESSION: 'ab89', OPENRIG_SESSION_NAME: SEAT });
    expect(await seen(join(dir, 'Sink.seat'))).toBe('');
    expect(await tmux.sessionEnv!(s.tmuxSession!, 'OPENRIG_SESSION_NAME')).toBeNull();
  });
  it('Ledge starting the server from a seat\'s shell gives it no seat in its global environment', async () => {
    const was = process.env.OPENRIG_SESSION_NAME;
    process.env.OPENRIG_SESSION_NAME = SEAT;
    try { await launch('Lead', { ...clean(), OPENRIG_SESSION_NAME: SEAT }); } finally { if (was === undefined) delete process.env.OPENRIG_SESSION_NAME; else process.env.OPENRIG_SESSION_NAME = was; }
    const global = spawnSync('tmux', ['-L', socket, 'show-environment', '-g', 'OPENRIG_SESSION_NAME'], { encoding: 'utf8' });
    expect(global.stdout).not.toContain(SEAT);
  });
  it('sessionEnv: the value set by the session, null when it sets none, undefined for no such session', async () => {
    const s = await launch('Lead', { ...clean(), OPENRIG_SESSION_NAME: 'dev-back@ledge-dev' });
    expect(await tmux.sessionEnv!(s.tmuxSession!, 'LEDGE_NAME')).toBe('Lead');
    expect(await tmux.sessionEnv!(s.tmuxSession!, 'NOT_SET_HERE')).toBeNull();
    expect(await tmux.sessionEnv!('ledge-none', 'OPENRIG_SESSION_NAME')).toBeUndefined();
  });
});

describe('the Atelier with the server started from a seat (regression, 2026-11-05)', () => {
  let srv: ServerHandle | undefined;
  afterEach(async () => { await srv?.close(); srv = undefined; });
  it('the agent launched in a project folder sits at its project\'s table, not as a seat; the counter and both views agree', async () => {
    serverFromSeat();
    const store = new Store();
    srv = await startServer({ store, tmux, port: 0 });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const payment = join(dir, 'payment'); mkdirSync(payment);
    const projects: Projects = { projects: [{ id: 'payment', name: 'Payment', color: 'pink', description: '', repos: [{ machine: 'local', path: payment }] }], rules: [] };
    const max = await launch('Max', clean(), payment);
    const lead = await launch('Lead', { ...clean(), OPENRIG_SESSION_NAME: SEAT });
    for (const s of [max, lead]) c.send({ type: 'session.register', session: s });
    await until(() => !!store.get(max.id) && !!store.get(lead.id));
    // Each hook reports the seat its process sees; Max's also as one started before the fix would (its process kept the seat).
    const hook = (s: Session, seat: string) => c.send({ type: 'session.event', id: s.id, event: { name: 'SessionStart', at: new Date().toISOString(), source: 'hook' }, agent: 'claude', ...(seat ? { rigSeat: seat } : {}) });
    hook(max, await seen(join(dir, 'Max.seat')));
    hook(lead, await seen(join(dir, 'Lead.seat')));
    hook(max, SEAT);
    await until(() => store.get(lead.id)?.rig?.seat === SEAT);
    await new Promise(r => setTimeout(r, 300));
    expect(store.get(max.id)?.rig).toBeUndefined();

    const sessions = store.all().filter(s => s.id === max.id || s.id === lead.id);
    const idOf = (s: Session) => projectOf(s, projects);
    const rigProject = ({ id, name }: { id: string; name: string }) => ({ id, name, color: 'violet' as const, description: '', repos: [] });
    const byProjects = sceneOf(sessions, projects.projects, idOf, 'all', false, rigProject);
    const byRigs = sceneOf(sessions, projects.projects, idOf, 'all', true, rigProject);
    expect(byProjects.rooms.map(r => [r.project.id, r.tables[0]!.mains.map(s => s.name)])).toEqual([['payment', ['Max']]]);
    expect(byRigs.rooms.map(r => [r.project.id, r.tables[0]!.mains.map(s => s.name)])).toEqual([['rig:kernel', ['Lead']], ['payment', ['Max']]]);
    // The counter (« 2 actifs ») is what the Rigs view seats; the Projets view seats all but the seats.
    const active = sessions.filter(s => !s.offline && s.state !== 'exited');
    expect(walkOrder(byRigs).map(s => s.id).sort()).toEqual(active.map(s => s.id).sort());
    expect(walkOrder(byProjects).map(s => s.id)).toEqual(active.filter(s => !s.rig).map(s => s.id));
    await c.close();
  });
});
