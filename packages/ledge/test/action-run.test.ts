import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { runGuard } from '../src/daemon/actions.js';
import { until } from './helpers.js';
import { sessionKey } from '../src/auth.js';

// `action.run` (#93): a registry action outside the chat, resolved and applied as a generic card's row.
function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let c: Client; let tmux: Tmux;
let n = 0;
/** Run as the user, or as session `by` with the key its environment holds (`key` to send another). */
async function run(action: string, args: Record<string, unknown>, extra: { by?: string; key?: string | null; confirmed?: true } = {}) {
  const rid = `r${++n}`;
  const { key, ...rest } = extra;
  const k = key === undefined ? (extra.by ? sessionKey(extra.by) : undefined) : key ?? undefined;
  c.send({ type: 'action.run', rid, action, args, ...rest, ...(k ? { key: k } : {}) } as never);
  const r = await c.next('action.result', 5000);
  expect(r.rid).toBe(rid);
  return r;
}
const T0 = '2026-10-26T10:00:00.000Z';
/** A session of the store, with its pane. */
async function seat(id: string, name: string, extra: Record<string, unknown> = {}) {
  await tmux.newSession({ name: `ledge-${id}` } as never);
  store.upsert({ id, name, tool: 'claude', cwd: work, project: 'api', title: `${name} · api`, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra } as never);
}

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-run-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  store = new Store(); tmux = fakeTmux();
  srv = await startServer({ store, tmux, port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  c = await connect({ port: srv.port }); await c.next('snapshot');
});
afterEach(async () => { await c.close(); await srv.close(); });

describe('action.run', () => {
  it('a reversible action by name: resolved to ids, applied, answered with its row', async () => {
    await seat('old', 'Old', { state: 'exited' });
    const r = await run('session.archive', { session: 'Old' });
    expect(r).toMatchObject({ action: 'session.archive', row: { action: 'session.archive', args: { session: 'old' }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(await run('session.archive', { session: 'old' })).toMatchObject({ code: 'refused', reason: expect.stringContaining('already archived') });
  });

  it('a destructive action: asked again without confirmed, refused to a session', async () => {
    const pending = { kind: 'permission', text: 'rm -rf dist', tool: 'Bash', source: 'hook' };
    await seat('nova', 'Nova', { state: 'waiting_permission', pending });
    await seat('lu', 'Lu');
    expect(await run('session.decide', { session: 'Nova', decision: 'accept' })).toMatchObject({ code: 'confirm_required', row: { args: { session: 'nova' }, risk: 'destructive' } });
    expect(await run('session.decide', { session: 'Nova', decision: 'accept' }, { by: 'lu', confirmed: true })).toMatchObject({ code: 'agent', reason: expect.stringContaining('utilisateur') });
  });

  it('refuses what is not possible now, bad args, and an action the CLI does not run', async () => {
    expect(await run('session.resume', { session: 'zz' })).toMatchObject({ code: 'refused', reason: 'unknown session zz' });
    expect(await run('session.archive', {})).toMatchObject({ code: 'refused', reason: expect.stringContaining('session') });
    expect(await run('session.launch', { cwd: work })).toMatchObject({ code: 'refused', reason: 'session.launch is not run from the CLI' });
  });

  it('session.close: a session closes itself, answered before its close', async () => {
    await seat('lead', 'Lead');
    const self = await run('session.close', { session: 'lead' }, { by: 'lead' });
    expect(self.reason).toBeUndefined();
    await until(() => store.get('lead')!.state === 'exited');
  });

  it('a session is who its key says: a by with a wrong key, or none, is refused before anything', async () => {
    await seat('lead', 'Lead'); await seat('build', 'Build');
    expect(await run('session.close', { session: 'build' }, { by: 'build', key: sessionKey('lead') })).toMatchObject({ code: 'identity', reason: expect.stringContaining('ne correspond pas') });
    // No key at all: a session launched before Ledge gave keys, told to be resumed rather than suspected.
    expect(await run('session.close', { session: 'build' }, { by: 'build', key: null })).toMatchObject({ code: 'identity', reason: expect.stringContaining('pas de clé') });
    expect(store.get('build')!.state).not.toBe('exited');
  });

  it('refuses an agent what the rule does not give it, with the reason', async () => {
    await seat('lead', 'Lead'); await seat('build', 'Build');
    expect(await run('session.close', { session: 'build' }, { by: 'lead' })).toMatchObject({ code: 'agent', reason: expect.stringContaining('utilisateur') });
    expect(store.get('build')!.state).not.toBe('exited');
  });
});

describe('runGuard (#93 (a))', () => {
  const ctx = { sessions: [] };
  const close = (s: string) => ({ action: 'session.close' as const, args: { session: s }, summary: 'Fermer', risk: 'reversible' as const, session: s });
  const archive = { action: 'session.archive' as const, args: { session: 'eve' }, summary: 'Archiver', risk: 'reversible' as const, session: 'eve' };

  it('lets the user run anything', () => {
    for (const row of [close('eve'), archive]) expect(runGuard(row, undefined, ctx)).toBeNull();
  });
  it('lets a session close itself, and nothing else', () => {
    expect(runGuard(close('eve'), 'eve', ctx)).toBeNull();
    expect(runGuard(close('bob'), 'ann', ctx)).toMatch(/utilisateur/);
    expect(runGuard(archive, 'eve', ctx)).toMatch(/utilisateur/);
  });
});
