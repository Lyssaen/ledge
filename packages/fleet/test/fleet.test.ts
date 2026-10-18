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
  it('sends a launch to the machine it names, without machineId, and qualifies session.launched', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server', dirs: ['/w/b'] });
    expect(server.sent).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/a', dirs: ['/w/b'] }]);
    expect(local.sent).toEqual([]);
    server.emit({ type: 'session.launched', id: 'new1' });
    expect(got.filter(m => m.type === 'session.launched')).toEqual([{ type: 'session.launched', id: 'server:new1' }]);
  });
  it('sends a launch without machineId to the selected machine', () => {
    const { client, local, server } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a' });
    expect(local.sent).toHaveLength(1); expect(server.sent).toEqual([]);
  });
  it('routes repos.inspect to its machine and relays repos.info with the same requestId', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'], machineId: 'server' });
    expect(server.sent).toEqual([{ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'] }]);
    server.emit({ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }] });
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }] }]);
    client.send({ type: 'repos.inspect', requestId: 'r2', paths: ['/w/b'] });
    expect(local.sent).toEqual([{ type: 'repos.inspect', requestId: 'r2', paths: ['/w/b'] }]);
    local.emit({ type: 'repos.info', requestId: 'unknown', repos: [] });
    server.emit({ type: 'repos.info', requestId: 'r2', repos: [] }); // not the machine asked
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
  });
  it('routes a folder.list with machineId and requestId to that machine, without machineId, and relays only its listing', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    expect(server.sent).toEqual([{ type: 'folder.list', path: '/w', requestId: 'f1' }]); expect(local.sent).toEqual([]);
    const listing: ServerMessage = { type: 'folder.listing', requestId: 'f1', path: '/w', parent: '/', entries: ['a'], repos: [{ name: 'a', branch: 'main' }] };
    local.emit(listing); // not the machine asked
    server.emit({ ...listing, requestId: 'other' }); // not the request asked
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    server.emit(listing);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([listing]);
    server.emit(listing); // answered once
    expect(got.filter(m => m.type === 'folder.listing')).toHaveLength(1);
  });
  it('a folder.list with requestId and no machineId goes to the local machine, even when another is selected', () => {
    const { client, local, server, got } = setup();
    client.fleet!.select('server');
    client.send({ type: 'folder.list', requestId: 'f1' });
    expect(local.sent).toEqual([{ type: 'folder.list', requestId: 'f1' }]); expect(server.sent).toEqual([]);
    local.emit({ type: 'folder.listing', requestId: 'f1', path: '/h', parent: '/', entries: [] });
    expect(got.filter(m => m.type === 'folder.listing')).toHaveLength(1);
  });
  it('a folder.list with machineId and no requestId (an older front) goes to that machine; its untagged listing follows the selected machine', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server' });
    expect(server.sent).toEqual([{ type: 'folder.list', path: '/w' }]); expect(local.sent).toEqual([]);
    const listing: ServerMessage = { type: 'folder.listing', path: '/w', parent: '/', entries: ['a'] };
    server.emit(listing); // Local is selected: an untagged listing from another machine is not relayed
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    client.fleet!.select('server');
    server.emit(listing);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([listing]);
    local.emit(listing); // not the selected machine
    expect(got.filter(m => m.type === 'folder.listing')).toHaveLength(1);
  });
  it('answers a folder.list for an offline machine with error offline, and for a machine that drops', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'f1', path: '/w', parent: null, entries: [], error: 'offline' }]);
    client.send({ type: 'folder.list', path: '/x', machineId: 'server', requestId: 'f2' });
    expect(got.filter(m => m.type === 'folder.listing').at(-1)).toEqual({ type: 'folder.listing', requestId: 'f2', path: '/x', parent: null, entries: [], error: 'offline' });
    expect(server.sent).toEqual([{ type: 'folder.list', path: '/w', requestId: 'f1' }]);
  });
  it('a machine refusing folder.list answers the pending request with the daemon error text', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    server.emit({ type: 'error', message: 'invalid message', request: 'folder.list' });
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'f1', path: '/w', parent: null, entries: [], error: 'invalid message' }]);
  });
  it('a repos.inspect refusal leaves pending listings alone, and a folder.list refusal leaves inspections alone', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/a'], machineId: 'server' });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.inspect' });
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
    client.send({ type: 'repos.inspect', requestId: 'r2', paths: ['/b'], machineId: 'server' });
    server.emit({ type: 'error', message: 'boom', request: 'folder.list' });
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'f1', path: '/w', parent: null, entries: [], error: 'boom' }]);
  });
  it('a folder.list without requestId keeps the old behaviour: the selected machine, relayed only from it', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w' });
    expect(local.sent).toEqual([{ type: 'folder.list', path: '/w' }]);
    const l: ServerMessage = { type: 'folder.listing', path: '/w', parent: '/', entries: [] };
    server.emit(l); expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    local.emit(l); expect(got.filter(m => m.type === 'folder.listing')).toEqual([l]);
  });
  it('answers for an offline machine: an error for a launch, nothing found for an inspection', () => {
    const { client, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a', '/w/b'], machineId: 'server' });
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server is offline', request: 'session.launch' }]);
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: false, branch: null }, { path: '/w/b', exists: false, branch: null }] }]);
    expect(server.sent).toEqual([]);
  });
  it('a launch in flight on a machine that drops is refused with its request', () => {
    const { client, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server is offline', request: 'session.launch' }]);
  });
  it('answers an inspection pending on a machine that drops', () => {
    const { client, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'], machineId: 'server' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: false, branch: null }] }]);
  });
  it('an older daemon refusing repos.inspect (« invalid message ») answers « not found » for each path, as a drop does', () => {
    const { client, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a', '/w/b'], machineId: 'server' });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.inspect' });
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: false, branch: null }, { path: '/w/b', exists: false, branch: null }] }]);
    server.emit({ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }] }); // the inspection is no longer pending
    server.set('unreachable');
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
  });
  it('a refused inspection of one machine leaves another machine\'s pending', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'], machineId: 'server' });
    client.send({ type: 'repos.inspect', requestId: 'r2', paths: ['/w/b'] });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.inspect' });
    local.emit({ type: 'repos.info', requestId: 'r2', repos: [{ path: '/w/b', exists: true, branch: 'dev' }] });
    expect(got.filter(m => m.type === 'repos.info').map(m => m.type === 'repos.info' && m.requestId)).toEqual(['r1', 'r2']);
  });
  it('routes repos.scan to its machine without machineId (local by default) and relays only that machine\'s repos.found', () => {
    const { client, local, server, got } = setup();
    client.fleet!.select('server');
    client.send({ type: 'repos.scan', requestId: 's1', machineId: 'server' });
    client.send({ type: 'repos.scan', requestId: 's2' });
    expect(server.sent).toEqual([{ type: 'repos.scan', requestId: 's1' }]);
    expect(local.sent).toEqual([{ type: 'repos.scan', requestId: 's2' }]);
    const found: ServerMessage = { type: 'repos.found', requestId: 's1', repos: [{ path: '/w/ledge', branch: 'main', remote: 'github.com/paradow/ledge' }], truncated: false };
    local.emit(found); // not the machine asked
    local.emit({ ...found, requestId: 'unknown' });
    expect(got.filter(m => m.type === 'repos.found')).toEqual([]);
    server.emit(found);
    expect(got.filter(m => m.type === 'repos.found')).toEqual([found]);
    server.emit(found); // answered already
    local.emit({ type: 'repos.found', requestId: 's2', repos: [], truncated: true });
    expect(got.filter(m => m.type === 'repos.found').map(m => m.type === 'repos.found' && m.requestId)).toEqual(['s1', 's2']);
  });
  it('answers a repos.scan for an offline machine, and one pending on a machine that drops, with error offline', () => {
    const { client, server, got } = setup();
    client.send({ type: 'repos.scan', requestId: 's1', machineId: 'server' });
    server.set('unreachable');
    client.send({ type: 'repos.scan', requestId: 's2', machineId: 'server' });
    client.send({ type: 'repos.scan', requestId: 's3', machineId: 'nowhere' });
    expect(got.filter(m => m.type === 'repos.found')).toEqual([
      { type: 'repos.found', requestId: 's1', repos: [], truncated: false, error: 'offline' },
      { type: 'repos.found', requestId: 's2', repos: [], truncated: false, error: 'offline' },
      { type: 'repos.found', requestId: 's3', repos: [], truncated: false, error: 'offline' }
    ]);
    expect(server.sent).toEqual([{ type: 'repos.scan', requestId: 's1' }]);
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('an older daemon refusing repos.scan answers error outdated, leaving inspections, listings and another machine\'s scan pending', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'repos.scan', requestId: 's1', machineId: 'server' });
    client.send({ type: 'repos.scan', requestId: 's2' });
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/a'], machineId: 'server' });
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.scan' });
    expect(got.filter(m => m.type === 'repos.found')).toEqual([{ type: 'repos.found', requestId: 's1', repos: [], truncated: false, error: 'outdated' }]);
    expect(got.filter(m => m.type === 'error' || m.type === 'repos.info' || m.type === 'folder.listing')).toEqual([]);
    server.emit({ type: 'repos.found', requestId: 's1', repos: [], truncated: false }); // no longer pending
    local.emit({ type: 'repos.found', requestId: 's2', repos: [], truncated: false });
    expect(got.filter(m => m.type === 'repos.found').map(m => m.type === 'repos.found' && m.requestId)).toEqual(['s1', 's2']);
    server.set('unreachable'); // the inspection and the listing were still pending
    expect(got.filter(m => m.type === 'repos.found')).toHaveLength(2);
    expect(got.filter(m => m.type === 'repos.info' || m.type === 'folder.listing')).toHaveLength(2);
  });
  it('an unrelated error from a machine keeps its launch in flight: a later drop still refuses the launch', () => {
    const { client, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    server.emit({ type: 'error', id: 'same', message: 'not waiting', request: 'session.decide' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'error').at(-1)).toEqual({ type: 'error', message: 'dev-server is offline', request: 'session.launch' });
  });
  it('the launch\'s own refusal ends it: a later drop says nothing more of it', () => {
    const { client, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    server.emit({ type: 'error', message: 'no such folder', request: 'session.launch' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server: no such folder', request: 'session.launch' }]);
  });
  it('validates loopback connections, aliases and duplicate destinations', () => {
    // The url is never read: a non-loopback local url is replaced by the pinned one, a remote url is dropped.
    expect(parseMachines([{ ...LOCAL_MACHINE, url: 'ws://example.org:47831' }])[0]!.url).toBe(LOCAL_MACHINE.url);
    expect(parseMachines([LOCAL_MACHINE, { ...remote, url: 'ws://example.org:47831' }])[1]!.url).toBeUndefined();
    expect(parseMachines([{ id: 'local', label: 'Local' }])[0]!.url).toBe(LOCAL_MACHINE.url);
    expect(() => parseMachines([{ ...LOCAL_MACHINE, ssh: 'x' }])).toThrow();
    expect(() => parseMachines([LOCAL_MACHINE, { id: 'a', label: 'A' }])).toThrow();
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
  it('keeps a project proposal on the routed turn, with its machine (lot 11 task 5)', () => {
    const { client, local, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Crée un projet Paper' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'local', text: 'Crée un projet Paper' } });
    const projectProposal = { name: 'Paper', repos: [{ path: '/w/paper', why: 'Nommé paper' }] };
    local.emit({ type: 'chat.done', qid: 'q', text: 'Je propose Paper.', at: new Date().toISOString(), projectProposal });
    expect(lastHistory(got)[0]).toMatchObject({ machineId: 'local', projectProposal });
  });
  it('a reply to an offline machine says which request it refuses', () => {
    const { client, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'session.reply', id: 'server:same', text: 'Go' });
    expect(got.at(-1)).toEqual({ type: 'error', id: 'server:same', message: 'dev-server is offline', request: 'session.reply' });
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
