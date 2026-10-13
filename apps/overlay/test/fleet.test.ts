import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/daemon/fleet';
import type { DaemonClient, DaemonStatus } from '../src/daemon/client';
import { LOCAL_MACHINE, parseMachines, probeMachine, sshProblem } from '../src/daemon/machines';
import { groupSessions } from '../src/surface/groups';
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

describe('multi-machine connections', () => {
  it('never mistakes an old local daemon answering an SSH URL for the remote host', () => {
    const { client, server, snapshot, got, local } = setup();
    server.set('unreachable'); server.set('open'); server.emit(snapshot);
    expect(client.fleet!.machines().find(m => m.id === 'server')).toMatchObject({ ready: false, error: expect.stringContaining('Update the local') });
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(local.sent).toEqual([]); expect(server.sent).toEqual([]);
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
  it('groups matching Git origins across hosts but not unrelated same-name folders', () => {
    const a = fakeSession('a', { machineId: 'local', repoId: 'github.com/org/repo' });
    const b = fakeSession('b', { machineId: 'server', cwd: '/other/repo', repoId: a.repoId });
    expect(groupSessions([a, b])).toHaveLength(1);
    expect(groupSessions([{ ...a, repoId: undefined }, { ...b, cwd: a.cwd, repoId: undefined }])).toHaveLength(2);
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
