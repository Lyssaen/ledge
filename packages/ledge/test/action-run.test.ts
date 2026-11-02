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

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let c: Client;
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
/** Two sessions launched by Ledge in the work folder: their ids. */
async function two(): Promise<[string, string]> {
  const ids: string[] = [];
  for (const name of ['ann', 'bob']) {
    c.send({ type: 'session.launch', tool: 'claude', cwd: work, name });
    ids.push((await c.next('session.launched', 5000)).id);
  }
  return [ids[0]!, ids[1]!];
}

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-run-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  store = new Store();
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  c = await connect({ port: srv.port }); await c.next('snapshot');
});
afterEach(async () => { await c.close(); await srv.close(); });

describe('action.run', () => {
  it('a reversible action by name: resolved to ids, applied, answered with its row', async () => {
    const [, bob] = await two();
    const r = await run('session.interrupt', { session: store.get(bob)!.name });
    expect(r).toMatchObject({ action: 'session.interrupt', row: { action: 'session.interrupt', args: { session: bob }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(await run('session.archive', { session: bob })).toMatchObject({ code: 'refused', reason: expect.stringContaining('is still running') });
  });

  it('a destructive action: asked again without confirmed, refused to a session, done for the user who confirmed', async () => {
    const [ann, bob] = await two();
    c.send({ type: 'task.cmd', rid: 'give', by: ann, op: 'give', to: store.get(bob)!.name, title: 'Relire' });
    const t = (await c.next('task.result', 3000)).task!;
    expect(await run('task.cancel', { task: t.id })).toMatchObject({ code: 'confirm_required', row: { args: { task: t.id }, risk: 'destructive' } });
    expect(await run('task.cancel', { task: t.id }, { by: ann, confirmed: true })).toMatchObject({ code: 'agent', reason: expect.stringContaining('utilisateur') });
    const done = await run('task.cancel', { task: t.id }, { confirmed: true });
    expect(done.reason).toBeUndefined();
    expect(await run('task.cancel', { task: t.id }, { confirmed: true })).toMatchObject({ code: 'refused', reason: `task ${t.id} is closed` });
  });

  it('task.answer: the user answers a decision a session put to it, confirmed; never a session, not even the one asking', async () => {
    const [ann] = await two();
    c.send({ type: 'task.cmd', rid: 'ask', by: ann, op: 'give', to: 'ledge', title: 'Fusionner ?', text: 'oui / non' });
    const d = (await c.next('task.result', 3000)).task!;
    expect(await run('task.answer', { task: d.id, answer: 'oui' })).toMatchObject({ code: 'confirm_required', row: { risk: 'destructive', detail: 'oui' } });
    expect(await run('task.answer', { task: d.id, answer: 'oui' }, { by: ann, confirmed: true })).toMatchObject({ code: 'agent' });
    expect((await run('task.answer', { task: d.id, answer: 'Oui, fusionne' }, { confirmed: true })).reason).toBeUndefined();
    c.send({ type: 'task.cmd', rid: 'show', by: 'ledge', op: 'show', task: d.id });
    expect((await c.next('task.result', 3000)).task).toMatchObject({ state: 'done', result: 'Oui, fusionne' });
    expect(await run('task.answer', { task: d.id, answer: 'non' }, { confirmed: true })).toMatchObject({ code: 'refused', reason: `task ${d.id} is closed` });
  });
  it('refuses what is not possible now, bad args, and an action the CLI does not run', async () => {
    expect(await run('session.interrupt', { session: 'zz' })).toMatchObject({ code: 'refused', reason: 'unknown session zz' });
    expect(await run('task.pass', { task: 'tzz' })).toMatchObject({ code: 'refused', reason: expect.stringContaining('to') });
    expect(await run('session.launch', { cwd: work })).toMatchObject({ code: 'refused', reason: 'session.launch is not run from the CLI' });
  });

  it('session.close: the user closes a session by name; a session closes itself, answered before its close', async () => {
    const [ann, bob] = await two();
    const r = await run('session.close', { session: store.get(bob)!.name });
    expect(r).toMatchObject({ row: { action: 'session.close', args: { session: bob }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(store.get(bob)!.state).toBe('exited');
    const self = await run('session.close', { session: ann }, { by: ann });
    expect(self.reason).toBeUndefined();
    await until(() => store.get(ann)!.state === 'exited');
  });

  it('a session is who its key says: a by with a wrong key, or none, is refused before anything', async () => {
    const [ann, bob] = await two();
    expect(await run('session.close', { session: bob }, { by: bob, key: sessionKey(ann) })).toMatchObject({ code: 'identity', reason: expect.stringContaining('ne correspond pas') });
    // No key at all: a session launched before Ledge gave keys, told to be resumed rather than suspected.
    expect(await run('session.close', { session: bob }, { by: bob, key: null })).toMatchObject({ code: 'identity', reason: expect.stringContaining('pas de clé') });
    expect(store.get(bob)!.state).not.toBe('exited');
    expect(await run('session.close', { session: bob }, { by: bob })).not.toHaveProperty('reason');
  });

  it('refuses an agent what the rule does not give it, with the reason', async () => {
    const [ann, bob] = await two();
    expect(await run('session.close', { session: bob }, { by: ann })).toMatchObject({ code: 'agent', reason: expect.stringContaining('utilisateur') });
    expect(store.get(bob)!.state).not.toBe('exited');
  });
});

describe('runGuard (#93 (a), decided by the user on 2026-10-26: option 4)', () => {
  const close = (s: string) => ({ action: 'session.close' as const, session: s });
  const cancel = { action: 'task.cancel' as const, session: 'bob' };
  const archive = { action: 'session.archive' as const, session: 'eve' };

  it('lets the user run anything', () => {
    for (const row of [close('eve'), cancel, archive]) expect(runGuard(row, undefined)).toBeNull();
  });
  it('lets any session close itself, and nothing else', () => {
    expect(runGuard(close('eve'), 'eve')).toBeNull();
    expect(runGuard(close('bob'), 'ann')).toMatch(/utilisateur/);
    expect(runGuard(cancel, 'bob')).toMatch(/utilisateur/);
    expect(runGuard(archive, 'eve')).toMatch(/utilisateur/);
  });
});
