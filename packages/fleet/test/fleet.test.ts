import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, parseMachines, probeMachine, sshProblem } from '../src/machines';
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
  const local = peer(), server = peer(), extra = peer();
  const client = createFleetClient([LOCAL_MACHINE, remote], o => o.url === LOCAL_MACHINE.url ? local.client : o.url.endsWith('/ssh/dev-server') ? server.client : extra.client);
  const got: ServerMessage[] = []; client.onMessage(m => got.push(m)); client.connect();
  const snapshot: ServerMessage = { type: 'snapshot', sessions: [fakeSession('same')], launcher: ['node', '/opt/ledge/cli.js'], daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } };
  local.emit(snapshot); server.emit({ ...snapshot, sshAlias: remote.ssh });
  return { client, local, server, extra, got, snapshot };
}
const lastSnapshot = (got: ServerMessage[]) => got.filter(m => m.type === 'snapshot').at(-1)!;
const lastHistory = (got: ServerMessage[]) => got.filter(m => m.type === 'chat.history').at(-1)!.turns;
beforeEach(() => localStorage.clear());

it('keeps its history and machines under the given prefix', () => {
  const local = peer();
  createFleetClient([LOCAL_MACHINE], () => local.client, { prefix: 'desktop' }).fleet!.configure([LOCAL_MACHINE, remote]);
  expect(localStorage.getItem('desktop.machines')).toContain('dev-server');
  expect(localStorage.getItem('ledge.machines')).toBeNull();
});

it('writes the fleet history under the given prefix', () => {
  const local = peer();
  createFleetClient([LOCAL_MACHINE], () => local.client, { prefix: 'desktop' }).connect(); // connect() persists the history
  expect(localStorage.getItem('desktop.fleet.history')).not.toBeNull();
  expect(localStorage.getItem('ledge.fleet.history')).toBeNull();
});

describe('multi-machine connections', () => {
  it('never mistakes an old local daemon answering an SSH URL for the remote host', () => {
    const { client, server, snapshot, got, local } = setup();
    server.set('unreachable'); server.set('open'); server.emit(snapshot);
    expect(client.fleet!.machines().find(m => m.id === 'server')).toMatchObject({ ready: false, error: expect.stringContaining('Update the local') });
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(local.sent).toEqual([]); expect(server.sent).toEqual([]);
  });
  it('qualifies the session of a thread message, whichever machine sent it', () => {
    const { got, local, server } = setup();
    const at = new Date().toISOString();
    const item = { kind: 'message' as const, id: 'm1', at, turn: 1, text: 'hi' };
    local.emit({ type: 'session.thread', id: 'same', items: [item] });
    server.emit({ type: 'session.thread.item', id: 'same', item });
    expect(got.filter(m => m.type === 'session.thread' || m.type === 'session.thread.item').map(m => (m as { id: string }).id)).toEqual(['local:same', 'server:same']);
  });
  it('qualifies colliding IDs and never broadcasts a command', () => {
    const { client, got, local, server } = setup();
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same', 'server:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(server.sent).toEqual([{ type: 'session.decide', id: 'same', decision: 'accept' }]);
    expect(local.sent).toEqual([]);
  });
  it('hides disconnected sessions until a fresh snapshot and never falls back', () => {
    const { client, got, local, server, snapshot } = setup();
    server.set('unreachable');
    expect(client.status()).toBe('open');
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(local.sent).toEqual([]); expect(server.sent).toEqual([]);
    server.set('open'); expect(lastSnapshot(got).sessions).toHaveLength(1);
    server.emit({ ...snapshot, sshAlias: remote.ssh }); expect(lastSnapshot(got).sessions).toHaveLength(2);
  });
  it('can remove and add connections while synchronous callbacks fire', () => {
    const { client, server } = setup();
    client.fleet!.select('server');
    expect(() => client.fleet!.configure([LOCAL_MACHINE, { ...remote, id: 'new', ssh: 'another-server' }])).not.toThrow();
    expect(client.fleet!.selected()).toBe('local');
    server.emit({ type: 'snapshot', sessions: [fakeSession('stale')] });
    expect(client.fleet!.machines().map(m => m.id)).toEqual(['local', 'new']);
  });
  it('keeps remote terminal and document destinations when selection changes', () => {
    const { client, local, server } = setup();
    expect(client.fleet!.terminal('server:same')).toEqual(['ssh', '-t', '--', 'dev-server', "'node' '/opt/ledge/cli.js' 'attach' 'same'"]);
    client.send({ type: 'document.read', requestId: 'd', path: '/w/a.md', sessionId: 'server:same' });
    expect(server.sent[0]).toMatchObject({ type: 'document.read', sessionId: 'same' });
    client.send({ type: 'document.read', requestId: 'unknown', path: '/w/a.md' });
    expect(local.sent).toEqual([]); expect(server.sent).toHaveLength(1);
  });
  it('validates loopback connections, aliases and duplicate destinations', () => {
    expect(() => parseMachines([LOCAL_MACHINE, { ...remote, url: 'ws://example.org:47831' }])).toThrow();
    expect(() => parseMachines([LOCAL_MACHINE, { ...remote, ssh: '-oProxyCommand=evil' }])).toThrow();
    expect(() => parseMachines([LOCAL_MACHINE, remote, { ...remote, id: 'duplicate-alias' }])).toThrow();
    expect(parseMachines([LOCAL_MACHINE, remote])).toHaveLength(2);
  });
});

describe('common chat routing', () => {
  it('asks for clarification without launching or asking either target', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance les tests' });
    expect(local.sent[0]).toMatchObject({ type: 'chat.route', context: { machines: [expect.objectContaining({ id: 'local' }), expect.objectContaining({ id: 'server' })] } });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: null, text: 'Sur quelle machine ?', choices: ['local', 'server'] } });
    expect(lastHistory(got)[0]).toMatchObject({ answer: 'Sur quelle machine ?', choices: [{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server' }] });
    expect(server.sent).toEqual([]); expect(local.sent).toHaveLength(1);
  });
  it('keeps proposal ownership, history and confirmation separate from routing', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance sur le serveur' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance une session dans /w/repo' } });
    expect(server.sent).toEqual([{ type: 'chat.ask', qid: 'q', text: 'Lance une session dans /w/repo', tool: undefined }]);
    server.emit({ type: 'chat.done', qid: 'q', text: 'Confirmer ?', at: new Date().toISOString(), proposal: { cwd: '/w/repo', project: 'repo', tool: 'claude' } });
    expect(lastHistory(got)[0]).toMatchObject({ question: 'Lance sur le serveur', machineId: 'server', proposal: { cwd: '/w/repo' } });
    client.fleet!.select('local');
    client.send({ type: 'session.launch', cwd: '/w/repo', tool: 'claude', qid: 'q' });
    expect(server.sent.at(-1)).toMatchObject({ type: 'session.launch', qid: 'q' });
    expect(local.sent).toHaveLength(1);
    server.set('unreachable');
    expect(got.at(-2)).toMatchObject({ type: 'error' });
  });
  it('refuses an offline routed destination even while the coordinator stays online', () => {
    const { client, local, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'chat.ask', qid: 'q', text: 'Sur serveur' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance' } });
    expect(lastHistory(got)[0]?.error).toContain('offline');
    expect(local.sent).toHaveLength(1); expect(server.sent).toEqual([]);
  });
});

class FakeProbe {
  static last: FakeProbe; url: string; closed = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeProbe.last = this; }
  close() { this.closed = true; }
  emit(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const probeSnapshot = (sshAlias?: string): ServerMessage => ({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b')], daemon: { version: '0.4.1', install: 'npm', systemd: true, routing: true }, sshAlias });

describe('connection test', () => {
  it('opens the SSH route of the local daemon and answers with the remote version and sessions', async () => {
    const done = probeMachine('ws://127.0.0.1:47831', 'dev-server', { WebSocketImpl: FakeProbe });
    expect(FakeProbe.last.url).toBe('ws://127.0.0.1:47831/ssh/dev-server');
    FakeProbe.last.emit(probeSnapshot('dev-server'));
    await expect(done).resolves.toEqual({ ok: true, version: '0.4.1', sessions: 2 });
    expect(FakeProbe.last.closed).toBe(true);
  });
  it('reports the SSH error that preceded the close', async () => {
    const done = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe });
    FakeProbe.last.emit({ type: 'error', message: 'ssh: Could not resolve hostname box' });
    FakeProbe.last.onclose?.();
    await expect(done).resolves.toEqual({ ok: false, error: 'ssh: Could not resolve hostname box' });
  });
  it('refuses a snapshot from an old local daemon that ignores the SSH route', async () => {
    const done = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe });
    FakeProbe.last.emit(probeSnapshot());
    const r = await done;
    expect(r.ok).toBe(false);
    expect(!r.ok && sshProblem(r.error)).toBe('local');
  });
  it('gives up when nothing answers', async () => {
    vi.useFakeTimers();
    try {
      const done = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe, timeoutMs: 1000 });
      vi.advanceTimersByTime(1000);
      const r = await done;
      expect(r).toEqual({ ok: false, error: 'SSH: no Ledge snapshot received.' });
      expect(FakeProbe.last.closed).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    ['ssh: Could not resolve hostname box: Name or service not known', 'alias'],
    ['agent@host: Permission denied (publickey).', 'key'],
    ['Host key verification failed.', 'hostKey'],
    ['ssh: connect to host box port 22: Connection timed out', 'unreachable'],
    ['bash: line 1: ledge: command not found', 'ledge'],
    ['connect ECONNREFUSED 127.0.0.1:47831', 'stopped'],
    ['Update the local Ledge daemon: SSH transport is unavailable', 'local'],
    ['something odd', 'other'],
  ] as const)('explains %s as %s', (raw, kind) => { expect(sshProblem(raw)).toBe(kind); });
});

describe('session traffic through the fleet', () => {
  it('relays a session update, a removal and the recents as themselves, never as a fresh snapshot', () => {
    const { client, got, local, server } = setup();
    const before = got.filter(m => m.type === 'snapshot').length;
    local.emit({ type: 'session.updated', session: fakeSession('same', { state: 'idle' }) });
    server.emit({ type: 'session.updated', session: fakeSession('other', { name: 'Pim' }) });
    local.emit({ type: 'recents', recents: [{ cwd: '/w/x', project: 'x', lastAt: '2026-10-09T18:00:00.000Z' }] });
    server.emit({ type: 'recents', recents: [] }); // not the selected machine: its recents stay out of the list
    server.emit({ type: 'session.removed', id: 'other' });
    expect(got.filter(m => m.type === 'snapshot').length).toBe(before);
    expect(got.slice(-4)).toEqual([
      { type: 'session.updated', session: expect.objectContaining({ id: 'local:same', state: 'idle', machineId: 'local' }) },
      { type: 'session.updated', session: expect.objectContaining({ id: 'server:other', name: 'Pim', machineId: 'server' }) },
      { type: 'recents', recents: [{ cwd: '/w/x', project: 'x', lastAt: '2026-10-09T18:00:00.000Z' }] },
      { type: 'session.removed', id: 'server:other' }
    ]);
    // The fleet's own inventory followed anyway.
    expect(client.fleet!.machines().find(m => m.id === 'server')!.sessions.map(s => s.id)).toEqual(['same']);
    expect(client.fleet!.machines().find(m => m.id === 'local')!.sessions[0]).toMatchObject({ state: 'idle' });
    expect(client.fleet!.machines().find(m => m.id === 'local')!.recents).toHaveLength(1);
  });
  it('a peer without a snapshot yet keeps its updates to itself until its snapshot publishes them', () => {
    const { got, extra } = setup();
    const n = got.length;
    extra.emit({ type: 'session.updated', session: fakeSession('early') });
    expect(got.length).toBe(n);
  });
});

describe('updating a remote daemon', () => {
  it('sends to one machine only, and not to a machine that is not connected', () => {
    const { client, local, server } = setup();
    expect(client.fleet!.sendTo('server', { type: 'update.daemon', version: '0.5.0' })).toBe(true);
    expect(server.sent).toEqual([{ type: 'update.daemon', version: '0.5.0' }]); expect(local.sent).toEqual([]);
    server.set('unreachable');
    expect(client.fleet!.sendTo('server', { type: 'update.daemon', version: '0.5.0' })).toBe(false);
  });
  it('gives each daemon message with its machine, and the daemon info with the machine', () => {
    const { client, server } = setup();
    const seen: Array<[string, string]> = []; client.fleet!.onMachineMessage((machine, m) => seen.push([machine, m.type]));
    server.emit({ type: 'update.progress', version: '0.5.0', step: 'installing' });
    expect(seen).toEqual([['server', 'update.progress']]);
    expect(client.fleet!.machines().find(m => m.id === 'server')?.daemon).toMatchObject({ version: '0.4.0', install: 'npm' });
  });
  it('keeps quiet about the SSH bridge closing while the remote daemon restarts', () => {
    const { got, server, snapshot } = setup();
    server.emit({ type: 'update.progress', version: '0.5.0', step: 'restarting' });
    server.emit({ type: 'error', message: 'SSH connection closed (1). Ledge daemon disconnected (1001)' });
    server.set('connecting'); server.set('open'); server.emit({ ...snapshot, sshAlias: remote.ssh });
    server.emit({ type: 'error', message: 'later failure' });
    expect(got.filter(m => m.type === 'error').map(m => (m as { message: string }).message)).toEqual(['dev-server: later failure']);
  });
});
