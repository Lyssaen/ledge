import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { startPoller } from '../src/daemon/poller.js';
import { killTestServer, until } from './helpers.js';
import { realTmux } from '../src/tmux.js';
import { ensureLedgeDir } from '../src/paths.js';
import { connect } from '../src/client.js';
import { createSession } from '../src/cli/launch.js';

const agent = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));
const socket = `ledge-e2e-${process.pid}-${Date.now()}`;
const tmux = realTmux(socket, { scope: async () => false });
let srv: Awaited<ReturnType<typeof startServer>>; let poller: ReturnType<typeof startPoller>; let store: Store;

beforeAll(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir();
  store = new Store(); srv = await startServer({ store, tmux, port: 0 });
  poller = startPoller({ store, tmux, intervalMs: 150, deadCheckMs: 300, broadcastPreview: srv.preview });
});
afterAll(async () => { poller.stop(); await srv.close(); await killTestServer(socket); });

describe('end to end with a fake Claude Code', () => {
  it('tracks a permission, approves it from the client, sees the agent continue and exit', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: ['node', agent, 'permission', 'npm test', 'work', '1500', 'exit', '0'], cwd: '/tmp', tmux, client });
    expect(s.name).toBe('Otto');
    await until(() => store.get(s.id)?.state === 'waiting_permission');
    expect(store.get(s.id)!.pending).toMatchObject({ text: 'npm test', options: ['Yes', "Yes, and don't ask again for this command", 'No'] });
    client.send({ type: 'session.decide', id: s.id, decision: 'accept' });
    await until(() => store.get(s.id)?.state === 'working');
    await until(async () => (await tmux.capture(s.tmuxSession!, 10))?.includes('✓ accepted 1') ?? false);
    await until(() => store.get(s.id)?.state === 'exited', 6000);
    expect(store.get(s.id)!.pending).toBeUndefined();
    await client.close();
  });

  it('denies a permission with Escape', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: ['node', agent, 'permission', 'rm -rf x', 'work', '1500', 'exit', '0'], cwd: '/tmp', tmux, client });
    await until(() => store.get(s.id)?.state === 'waiting_permission');
    client.send({ type: 'session.decide', id: s.id, decision: 'deny' });
    await until(async () => (await tmux.capture(s.tmuxSession!, 10))?.includes('✗ denied') ?? false);
    await until(() => store.get(s.id)?.state === 'exited', 6000);
    await client.close();
  });

  it('answers a question by option number: the digit alone selects it', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: [], command: ['node', agent, 'question', 'work', '1500', 'exit', '0'], cwd: '/tmp', tmux, client });
    await until(() => store.get(s.id)?.state === 'waiting_input');
    expect(store.get(s.id)!.pending).toMatchObject({ kind: 'question', text: 'Which migration strategy?', options: ['Backfill', 'Shadow table', 'Type something.'] });
    client.send({ type: 'session.reply', id: s.id, text: '2' });
    // Read the pane while the agent is still alive: a dead session has nothing left to capture.
    await until(async () => (await tmux.capture(s.tmuxSession!, 10))?.includes('You chose: 2') ?? false);
    await until(() => store.get(s.id)?.state === 'exited', 6000);
    await client.close();
  });

  it('survives a daemon restart: sessions are reloaded and dead ones marked exited', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const alive = await createSession({ tool: 'claude', args: [], command: ['node', agent, 'work', '60000'], cwd: '/tmp', tmux, client });
    const dead = await createSession({ tool: 'claude', args: [], command: ['node', agent, 'exit', '0'], cwd: '/tmp', tmux, client });
    await until(() => store.get(dead.id)?.state === 'exited');
    await store.save(); poller.stop(); await srv.close(); await client.close();
    const store2 = new Store(); await store2.load();
    expect(store2.get(alive.id)?.state).toBe('starting');
    expect(store2.get(dead.id)?.state).toBe('exited');
    store = store2; srv = await startServer({ store, tmux, port: 0 });
    poller = startPoller({ store, tmux, intervalMs: 150, deadCheckMs: 300 });
    await tmux.killSession(alive.tmuxSession!);
    await until(() => store.get(alive.id)?.state === 'exited');
  });
});
