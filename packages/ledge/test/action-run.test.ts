import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { runGuard } from '../src/daemon/actions.js';

// `action.run` (#93): a registry action outside the chat, resolved and applied as a generic card's row.
function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let c: Client;
const role = (id: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\nlabel: ${id}\n---\nTu es ${id}.\n`); };
let n = 0;
async function run(action: string, args: Record<string, unknown>, extra: { by?: string; confirmed?: true } = {}) {
  const rid = `r${++n}`;
  c.send({ type: 'action.run', rid, action, args, ...extra } as never);
  const r = await c.next('action.result', 5000);
  expect(r.rid).toBe(rid);
  return r;
}
async function team(): Promise<Team> {
  c.send({ type: 'team.launch', rid: 'launch', cwd: work, name: 'api', seats: [{ role: 'lead' }, { role: 'build' }] });
  return (await c.next('team.launched', 5000)).team;
}

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-run-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  role('lead'); role('build');
  store = new Store();
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  c = await connect({ port: srv.port }); await c.next('snapshot');
});
afterEach(async () => { await c.close(); await srv.close(); });

describe('action.run', () => {
  it('a reversible action by name: resolved to ids, applied, answered with its row', async () => {
    const t = await team();
    const build = t.seats[1]!.sessionId!;
    const r = await run('team.leave', { team: 'api', session: store.get(build)!.name });
    expect(r).toMatchObject({ action: 'team.leave', row: { action: 'team.leave', args: { team: t.id, session: build }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(await run('team.leave', { team: t.id, session: build })).toMatchObject({ code: 'refused', reason: expect.stringContaining('is not in api') });
  });

  it('a destructive action: asked again without confirmed, refused to a session, done for the user who confirmed', async () => {
    const t = await team();
    const lead = t.seats[0]!.sessionId!;
    expect(await run('team.dissolve', { team: 'api' })).toMatchObject({ code: 'confirm_required', row: { args: { team: t.id }, risk: 'destructive' } });
    expect(await run('team.dissolve', { team: 'api' }, { by: lead, confirmed: true })).toMatchObject({ code: 'agent', reason: expect.stringContaining('utilisateur') });
    const done = await run('team.dissolve', { team: t.id }, { confirmed: true });
    expect(done.reason).toBeUndefined();
    expect(await run('team.resume', { team: t.id })).toMatchObject({ code: 'refused', reason: 'team api is dissolved' });
  });

  it('refuses what is not possible now, bad args, and an action the CLI does not run', async () => {
    expect(await run('team.resume', { team: 'zz' })).toMatchObject({ code: 'refused', reason: 'unknown team zz' });
    expect(await run('team.join', { team: 'zz' })).toMatchObject({ code: 'refused', reason: expect.stringContaining('session') });
    expect(await run('session.launch', { cwd: work })).toMatchObject({ code: 'refused', reason: 'session.launch is not run from the CLI' });
  });

  it('team.save answers the template it wrote; a handler refusal is the result\'s reason', async () => {
    await team();
    const r = await run('team.save', { team: 'api', name: 'atelier' });
    expect(r.path).toBe(join(process.env.LEDGE_HOME!, 'teams', 'atelier.yaml'));
    expect(existsSync(r.path!)).toBe(true);
  });

  it('session.close closes a session cleanly; a session never closes itself', async () => {
    const t = await team();
    const [lead, build] = t.seats.map(s => s.sessionId!);
    expect(await run('session.close', { session: lead! }, { by: lead! })).toMatchObject({ code: 'refused', reason: expect.stringContaining('itself') });
    const r = await run('session.close', { session: store.get(build!)!.name }, { by: lead! });
    expect(r).toMatchObject({ row: { action: 'session.close', args: { session: build }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(store.get(build!)!.state).toBe('exited');
  });
});

describe('runGuard (#93 (a), until the user decides: the strictest)', () => {
  it('lets the user run anything, a session nothing destructive', () => {
    expect(runGuard('destructive', undefined)).toBeNull();
    expect(runGuard('reversible', 's1')).toBeNull();
    expect(runGuard('destructive', 's1')).toMatch(/utilisateur/);
  });
});
