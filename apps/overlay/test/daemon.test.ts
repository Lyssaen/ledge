// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { daemonStore, attachClient } from '../src/daemon/store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let mock: Awaited<ReturnType<typeof createMockDaemon>>;
beforeEach(async () => { daemonStore.reset(); mock = await createMockDaemon(); });
afterEach(async () => { await mock.close(); });

describe('daemon client + store', () => {
  it('loads the snapshot, applies updates and removals in stable order', async () => {
    mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { name: 'Pim', startedAt: '2026-10-09T18:01:00.000Z' }));
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const detach = attachClient(client); client.connect();
    await sleep(100);
    expect(daemonStore.getState().status).toBe('open');
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a', 'b']);
    mock.upsert(fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    await sleep(50);
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a', 'b']);
    expect(daemonStore.getState().byId.get('a')?.state).toBe('waiting_permission');
    mock.remove('a'); await sleep(50);
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['b']);
    mock.preview('b', ['x', 'y']); await sleep(50);
    expect(daemonStore.getState().previews.get('b')).toEqual(['x', 'y']);
    detach(); client.close();
  });

  it('reports unreachable, reconnects with backoff and reloads the snapshot', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never, minBackoffMs: 50, maxBackoffMs: 100 });
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    attachClient(client); client.connect(); await sleep(80);
    const port = mock.port; await mock.close(); await sleep(80);
    expect(daemonStore.getState().status).toBe('unreachable');
    mock = await createMockDaemon({ port }); mock.sessions.set('z', fakeSession('z'));
    await sleep(300);
    expect(daemonStore.getState().status).toBe('open');
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['z']);
    expect(statuses).toContain('unreachable');
    client.close();
  });

  it('sends client messages as JSON the daemon can parse', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    client.connect(); await sleep(80);
    client.send({ type: 'session.decide', id: 'a', decision: 'accept' }); await sleep(50);
    expect(mock.received).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept' }]);
    client.close();
  });

  it('ignores a stale socket close after close() then connect()', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never, minBackoffMs: 30, maxBackoffMs: 60 });
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    client.connect(); await sleep(80);
    client.close(); client.connect(); await sleep(250);
    expect(client.status()).toBe('open');
    expect(statuses).not.toContain('unreachable');
    expect(mock.clientCount).toBe(1);
    client.close();
  });
});
