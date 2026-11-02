import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { BROADCAST_SILENT, BROADCAST_TIMEOUT_MS, createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';
import { fakeSession } from './mockDaemon';

const remote = { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' };
function peer() {
  let status: DaemonStatus = 'connecting';
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>();
  const sent: ClientMessage[] = [];
  const set = (s: DaemonStatus) => { status = s; statuses.forEach(f => f(s)); };
  const client: DaemonClient = { connect: () => set('open'), close: () => set('unreachable'), status: () => status, send: m => { sent.push(m); }, onMessage: f => { messages.add(f); return () => { messages.delete(f); }; }, onStatus: f => { statuses.add(f); return () => { statuses.delete(f); }; } };
  return { client, sent, set, emit: (m: ServerMessage) => messages.forEach(f => f(m)) };
}
function setup() {
  const local = peer(), server = peer();
  const client = createFleetClient([LOCAL_MACHINE, remote], o => o.url === LOCAL_MACHINE.url ? local.client : server.client);
  client.connect();
  const daemon = { version: '0.4.0', install: 'npm' as const, systemd: true, routing: true };
  local.emit({ type: 'snapshot', sessions: [fakeSession('pim', { name: 'Pim' }), fakeSession('nova', { name: 'Nova' })], launcher: ['node'], daemon });
  server.emit({ type: 'snapshot', sessions: [fakeSession('zed', { name: 'Zed' })], launcher: ['node'], daemon, sshAlias: remote.ssh });
  return { client, local, server };
}
const broadcasts = (sent: ClientMessage[]) => sent.filter(m => m.type === 'session.broadcast');
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

it('sends session.broadcast to the local daemon even when another machine is selected, its own sessions unqualified', () => {
  const { client, local, server } = setup();
  client.fleet!.select('server');
  client.send({ type: 'session.broadcast', rid: 'b1', to: { project: 'billing' }, text: 'hello' });
  client.send({ type: 'session.broadcast', rid: 'b2', to: { sessions: ['local:pim', 'local:nova'] }, text: 'hello' });
  expect(broadcasts(server.sent)).toEqual([]);
  expect(broadcasts(local.sent)).toEqual([
    { type: 'session.broadcast', rid: 'b1', to: { project: 'billing' }, text: 'hello' },
    { type: 'session.broadcast', rid: 'b2', to: { sessions: ['pim', 'nova'] }, text: 'hello' }
  ]);
});

it('broadcast() resolves on the result of its own rid, the sent sessions qualified', async () => {
  const { client, local } = setup();
  const got = client.fleet!.broadcast({ project: 'billing' }, 'hello');
  const [msg] = broadcasts(local.sent);
  expect(msg).toMatchObject({ type: 'session.broadcast', to: { project: 'billing' }, text: 'hello', rid: expect.any(String) });
  const rid = (msg as { rid: string }).rid;
  let settled = false; void got.then(() => { settled = true; });
  local.emit({ type: 'session.broadcast.result', rid: 'other', sent: [], refused: [], reason: 'nope' });
  await Promise.resolve();
  expect(settled).toBe(false);
  local.emit({ type: 'session.broadcast.result', rid, sent: [{ id: 'pim', name: 'Pim' }], refused: [{ name: 'Zed', reason: 'Zed n’a pas été lancée par Ledge' }] });
  await expect(got).resolves.toEqual({ type: 'session.broadcast.result', rid, sent: [{ id: 'local:pim', name: 'Pim' }], refused: [{ name: 'Zed', reason: 'Zed n’a pas été lancée par Ledge' }] });
});

it('a resend keeps its rid, so the daemon answers it once', async () => {
  const { client, local } = setup();
  void client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b-again');
  void client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b-again');
  expect(broadcasts(local.sent).map(m => (m as { rid: string }).rid)).toEqual(['b-again', 'b-again']);
});

it('another machine’s sessions are refused by the fleet, the local ones still sent', async () => {
  const { client, local, server } = setup();
  const got = client.fleet!.broadcast({ sessions: ['local:pim', 'server:zed'] }, 'hello');
  expect(broadcasts(server.sent)).toEqual([]);
  const [msg] = broadcasts(local.sent);
  expect(msg).toMatchObject({ to: { sessions: ['pim'] } });
  local.emit({ type: 'session.broadcast.result', rid: (msg as { rid: string }).rid, sent: [{ id: 'pim', name: 'Pim' }], refused: [] });
  const r = await got;
  expect(r.sent).toEqual([{ id: 'local:pim', name: 'Pim' }]);
  expect(r.refused).toEqual([{ name: 'Zed', reason: expect.stringContaining('dev-server') }]);
});

it('only other machines’ sessions: nothing is sent, the result says why', async () => {
  const { client, local } = setup();
  const r = await client.fleet!.broadcast({ sessions: ['server:zed'] }, 'hello');
  expect(broadcasts(local.sent)).toEqual([]);
  expect(r).toMatchObject({ sent: [], refused: [{ name: 'Zed' }], reason: expect.any(String) });
});

it('a refusal of the request resolves with its message; a silence past the timeout with BROADCAST_SILENT', async () => {
  const { client, local } = setup();
  const refused = client.fleet!.broadcast({ project: 'billing' }, 'hello');
  local.emit({ type: 'error', message: 'invalid message', request: 'session.broadcast', code: 'invalid' });
  await expect(refused).resolves.toMatchObject({ sent: [], refused: [], reason: expect.stringContaining('invalid message') });
  vi.useFakeTimers();
  const silent = client.fleet!.broadcast({ project: 'billing' }, 'hello');
  vi.advanceTimersByTime(BROADCAST_TIMEOUT_MS);
  await expect(silent).resolves.toMatchObject({ sent: [], refused: [], reason: BROADCAST_SILENT });
});
