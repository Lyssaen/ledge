import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, UsageStateMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { createUsage } from '../src/daemon/usage/service.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

const API = { five_hour: { utilization: 20, resets_at: '2026-11-05T18:30:00Z' }, seven_day: { utilization: 90, resets_at: '2099-11-09T09:00:00Z' } };
/** The daemon's usage on doubles: Claude Code signed in, the API answering `API`; no network, no real credentials. */
const usageDouble = () => createUsage({
  home: '/h', env: async () => ({}), file: join(process.env.LEDGE_HOME!, 'usage.json'), version: async () => '2.1.318',
  read: async p => (p.endsWith('.credentials.json') ? JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }) : JSON.stringify({ oauthAccount: { accountUuid: 'a' } })),
  get: async () => ({ status: 200, body: JSON.stringify(API), headers: {} })
});

let srv: Awaited<ReturnType<typeof startServer>> | undefined; let store: Store; let c: Client | undefined; let work: string;
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-usage-srv-')); work = mkdtempSync(join(tmpdir(), 'ledge-work-')); store = new Store(); });
afterEach(async () => { await c?.close(); await srv?.close(); srv = undefined; c = undefined; });
const set = (id: string, patch: Partial<Session>) => store.upsert({ ...store.get(id)!, ...patch });

describe('server: usage', () => {
  it('says it has usage, sends it after the snapshot, then each change; the threshold and « Compris » come back to every front', async () => {
    const usage = usageDouble();
    await usage.tick();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false }, usage });
    c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).daemon?.usage).toBe(true);
    const first = await c.next('usage.state') as UsageStateMessage;
    expect(first.harnesses).toEqual([expect.objectContaining({ harness: 'claude', status: 'ok' })]);
    expect(first.alerts.map(a => [a.window.kind, a.level])).toEqual([['seven_day', 'threshold']]);
    const other = await connect({ port: srv.port });
    await other.next('usage.state');
    c.send({ type: 'usage.set', prefs: { alert: 0.95 } });
    const changed = await other.next('usage.state') as UsageStateMessage;
    expect(changed.prefs).toEqual({ alert: 0.95 });
    expect(changed.alerts).toEqual([]);
    c.send({ type: 'usage.set', prefs: { alert: 0.8 } });
    const back = await other.next('usage.state') as UsageStateMessage;
    c.send({ type: 'usage.ack', id: back.alerts[0]!.id });
    expect((await other.next('usage.state') as UsageStateMessage).alerts).toEqual([]);
    // An id this machine does not have: ignored, no error.
    c.send({ type: 'usage.ack', id: 'claude|other-account|seven_day|-|threshold|-' });
    c.send({ type: 'snapshot.request' });
    await c.next('snapshot');
    await other.close();
  }, 20_000);

  it('an older daemon\'s place: without the service, no flag and no usage.state', async () => {
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, daemon: { version: '1.0.0', install: 'npm', systemd: false } });
    c = await connect({ port: srv.port });
    expect((await c.next('snapshot')).daemon?.usage).toBeUndefined();
    c.send({ type: 'usage.set', prefs: { alert: 0.9 } });
    expect((await c.next('error')).request).toBe('usage.set');
  });

  it('a session seen by its hooks: its duration counts from then, its model and effort come from its transcript; a launch keeps its own', async () => {
    const usage = usageDouble();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, usage });
    c = await connect({ port: srv.port });
    await c.next('snapshot');
    c.send({ type: 'session.event', id: 'seen-1', agent: 'claude', cwd: work, event: { name: 'UserPromptSubmit', at: '2026-11-05T13:00:00.000Z', source: 'hook', text: 'go' } });
    await until(() => store.get('seen-1') !== undefined);
    expect(store.get('seen-1')!.startedSeen).toBe(true);
    const transcript = join(work, 'seen.jsonl');
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 10 } } }) + '\n');
    set('seen-1', { state: 'working', transcriptPath: transcript });
    set('seen-1', { state: 'idle' });
    await until(() => store.get('seen-1')?.model === 'claude-opus-5-5');
    expect(store.get('seen-1')).toMatchObject({ model: 'claude-opus-5-5', modelFrom: 'transcript', effort: 'high', effortFrom: 'transcript' });

    // A session that starts with SessionStart: its start is its launch.
    c.send({ type: 'session.event', id: 'seen-2', agent: 'claude', cwd: work, event: { name: 'SessionStart', at: '2026-11-05T13:00:00.000Z', source: 'hook' } });
    await until(() => store.get('seen-2') !== undefined);
    expect(store.get('seen-2')!.startedSeen).toBeUndefined();

    // Launched by Ledge on opus with an effort: the transcript never replaces that choice.
    store.upsert({ ...store.get('seen-2')!, id: 'mine', source: 'launcher', model: 'opus', effort: 'low', transcriptPath: transcript, state: 'working' });
    set('mine', { state: 'idle' });
    await until(() => store.get('mine')?.context !== undefined);
    expect(store.get('mine')).toMatchObject({ model: 'opus', effort: 'low' });
    expect(store.get('mine')!.modelFrom).toBeUndefined();
  }, 20_000);

  it('a Codex turn tells the account\'s limits it reports', async () => {
    const usage = createUsage({ home: '/h', env: async () => ({}), file: join(process.env.LEDGE_HOME!, 'usage.json'), read: async () => { throw new Error('ENOENT'); }, get: async () => ({ status: 0, body: '', headers: {} }) });
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, usage });
    c = await connect({ port: srv.port });
    await c.next('snapshot');
    const at = new Date().toISOString();
    const rollout = join(work, 'rollout.jsonl');
    writeFileSync(rollout, JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 900 }, model_context_window: 258400 },
      rate_limits: { primary: { used_percent: 12, window_minutes: 300, resets_at: 4102444800 }, secondary: null } } }) + '\n');
    store.upsert({ id: 'cx', name: 'Nova', tool: 'codex', cwd: work, project: 'w', title: 'Nova', tmuxSession: null, state: 'working', helpers: [], startedAt: at, lastActivityAt: at, source: 'hook_only', transcriptPath: rollout });
    set('cx', { state: 'idle' });
    await until(() => usage.state().harnesses.some(h => h.harness === 'codex'));
    expect(usage.state().harnesses).toEqual([{ harness: 'codex', account: null, status: 'ok', readAt: at, windows: [{ kind: 'five_hour', pct: 12, resetsAt: '2100-01-01T00:00:00.000Z' }] }]);
  }, 20_000);
});
