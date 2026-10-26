// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession, T0 } from './mockDaemon';
import { createDaemonClient } from '../src/client';
import { daemonStore, attachClient } from '../src/store';
import { createTokenSource, type TokenRead } from '../src/token';

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

  it('an archived session leaves sessions for archived, and comes back on restore', async () => {
    mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { archivedAt: '2026-10-09T19:00:00.000Z' })); mock.sessions.set('c', fakeSession('c', { archivedAt: '2026-10-09T20:00:00.000Z' }));
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const detach = attachClient(client); client.connect(); await sleep(100);
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a']);
    expect(daemonStore.getState().archived.map(s => s.id)).toEqual(['c', 'b']);
    expect(daemonStore.getState().byId.size).toBe(3);
    mock.upsert(fakeSession('a', { archivedAt: '2026-10-09T21:00:00.000Z' })); await sleep(50);
    expect(daemonStore.getState().sessions).toEqual([]);
    expect(daemonStore.getState().archived.map(s => s.id)).toEqual(['a', 'c', 'b']);
    mock.upsert(fakeSession('a')); await sleep(50);
    expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a']);
    expect(daemonStore.getState().archived.map(s => s.id)).toEqual(['c', 'b']);
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

  it('connect() after a drop says « connecting » at once, until the socket opens (or drops again)', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never, minBackoffMs: 5000, maxBackoffMs: 5000 });
    client.connect(); await sleep(80);
    const port = mock.port; await mock.close(); await sleep(80);
    expect(client.status()).toBe('unreachable');
    mock = await createMockDaemon({ port });
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    client.connect();
    expect(client.status()).toBe('connecting');
    await sleep(100);
    expect(client.status()).toBe('open');
    expect(statuses).toEqual(['connecting', 'open']);
    client.close();
  });

  it('sends client messages as JSON the daemon can parse', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    client.connect(); await sleep(80);
    client.send({ type: 'session.decide', id: 'a', decision: 'accept' }); await sleep(50);
    expect(mock.received).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept' }]);
    client.close();
  });

  it('answers repos.inspect from repoInfo, an unknown path existing on main', async () => {
    mock.repoInfo.set('/w/gone', { path: '/w/gone', exists: false, branch: null });
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const got: unknown[] = []; client.onMessage(m => { if (m.type === 'repos.info') got.push(m); });
    client.connect(); await sleep(80);
    client.send({ type: 'repos.inspect', requestId: 'r', paths: ['/w/a', '/w/gone'] }); await sleep(50);
    expect(got).toEqual([{ type: 'repos.info', requestId: 'r', repos: [{ path: '/w/a', exists: true, branch: 'main' }, { path: '/w/gone', exists: false, branch: null }] }]);
    client.close();
  });

  it('answers repos.scan from found, empty by default', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const got: unknown[] = []; client.onMessage(m => { if (m.type === 'repos.found') got.push(m); });
    client.connect(); await sleep(80);
    client.send({ type: 'repos.scan', requestId: 's1' }); await sleep(50);
    mock.found.push({ path: '/w/ledge', branch: 'main', remote: 'github.com/paradow/ledge' }, { path: '/w/new', branch: null });
    client.send({ type: 'repos.scan', requestId: 's2' }); await sleep(50);
    expect(got).toEqual([
      { type: 'repos.found', requestId: 's1', repos: [], truncated: false },
      { type: 'repos.found', requestId: 's2', repos: [{ path: '/w/ledge', branch: 'main', remote: 'github.com/paradow/ledge' }, { path: '/w/new', branch: null }], truncated: false }
    ]);
    client.close();
  });

  it('answers folder.list from folders, with error not found for an unknown path', async () => {
    mock.folders.set('/w', { entries: ['a', 'b'], repos: [{ name: 'a', branch: 'dev' }] });
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const got: unknown[] = []; client.onMessage(m => { if (m.type === 'folder.listing') got.push(m); });
    client.connect(); await sleep(80);
    client.send({ type: 'folder.list', path: '/w', requestId: 'q' }); client.send({ type: 'folder.list', path: '/nope', requestId: 'q2' }); await sleep(50);
    expect(got).toEqual([{ type: 'folder.listing', requestId: 'q', path: '/w', parent: '/', entries: ['a', 'b'], repos: [{ name: 'a', branch: 'dev' }] }, { type: 'folder.listing', requestId: 'q2', path: '/nope', parent: null, entries: [], error: 'not found' }]);
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

  it('keeps the recents and the launcher command from the snapshot, follows recents updates, and counts launched answers', async () => {
    const recents = [{ cwd: '/w/api-gateway', project: 'api-gateway', lastAt: '2026-10-10T09:00:00.000Z' }];
    mock.extras.recents = recents; mock.extras.launcher = ['/usr/bin/node', '/opt/ledge/cli.js'];
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    mock.options.autoLaunch = true;
    const detach = attachClient(client); client.connect(); await sleep(100);
    expect(daemonStore.getState().recents).toEqual(recents);
    expect(daemonStore.getState().launcher).toEqual(['/usr/bin/node', '/opt/ledge/cli.js']);
    expect(daemonStore.getState().lastLaunched).toBeNull();
    const more = [{ cwd: '/w/two', project: 'two', lastAt: '2026-10-10T10:00:00.000Z' }, ...recents];
    mock.recents(more); await sleep(50);
    expect(daemonStore.getState().recents).toEqual(more);
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/two' }); await sleep(50);
    // The mock answers a launch itself: a starting session, then session.launched.
    expect(daemonStore.getState().lastLaunched).toEqual({ id: 'launch-1', seq: 1 });
    expect(daemonStore.getState().byId.get('launch-1')).toMatchObject({ state: 'starting', cwd: '/w/two', source: 'launcher' });
    mock.launched(fakeSession('n2', { name: 'Nova', state: 'starting' })); await sleep(50);
    expect(daemonStore.getState().lastLaunched).toEqual({ id: 'n2', seq: 2 });
    // An older daemon's snapshot: no recents, no launcher.
    daemonStore.apply({ type: 'snapshot', sessions: [] });
    expect(daemonStore.getState().recents).toEqual([]); expect(daemonStore.getState().launcher).toBeNull();
    detach(); client.close();
  });

  it('counts folder listings, an error one included, without touching the sessions or the launch error', () => {
    daemonStore.reset();
    daemonStore.apply({ type: 'folder.listing', path: '/w', parent: '/', entries: ['api'] });
    expect(daemonStore.getState().lastListing).toEqual({ path: '/w', parent: '/', entries: ['api'], seq: 1 });
    daemonStore.apply({ type: 'folder.listing', path: '~/nope', parent: null, entries: [], error: 'no such folder' });
    expect(daemonStore.getState().lastListing).toMatchObject({ error: 'no such folder', seq: 2 });
    expect(daemonStore.getState().lastError).toBeNull();
  });

  it('leaves the open state synchronously on a plain close()', async () => {
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never });
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    attachClient(client); client.connect(); await sleep(80);
    expect(daemonStore.getState().status).toBe('open');
    client.close();
    expect(client.status()).not.toBe('open');
    expect(daemonStore.getState().status).toBe('connecting');
    expect(statuses).toEqual(['open', 'connecting']);
    await sleep(100);
    expect(client.status()).toBe('connecting');
  });

  it('keeps the proposal a chat.done carries', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'x', askedAt: T0, steps: [] });
    const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const };
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal });
    expect(daemonStore.getState().chat[0]).toMatchObject({ answer: 'ok', proposal });
  });

  it('keeps every session row a chat.done carries (#24)', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'x', askedAt: T0, steps: [] });
    const a = { cwd: '/w/a', project: 'a', tool: 'claude' as const }, b = { cwd: '/w/b', project: 'b', tool: 'claude' as const };
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: a, proposals: [a, b] });
    expect(daemonStore.getState().chat[0]).toMatchObject({ proposal: a, proposals: [a, b] });
  });

  it('chat.done keeps the generic rows (#94)', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'archive Otto', askedAt: T0, steps: [] });
    const actions = [{ action: 'session.archive' as const, args: { session: 'a' }, summary: 'Archiver **Otto**', risk: 'reversible' as const, session: 'a' }];
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions });
    expect(daemonStore.getState().chat[0]).toMatchObject({ actions });
  });

  it('chat.done keeps the closes', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'ferme Otto', askedAt: T0, steps: [] });
    const closes = [{ id: 's1', name: 'Otto', tool: 'claude' as const }];
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, closes });
    expect(daemonStore.getState().chat[0]!.closes).toEqual(closes);
  });

  it('chat.done keeps the relay', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'dis à Otto', askedAt: T0, steps: [] });
    const relay = { id: 's1', name: 'Otto', tool: 'claude' as const, text: 'Lance les tests' };
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, relay });
    expect(daemonStore.getState().chat[0]!.relay).toEqual(relay);
  });

  it('chat.done keeps the project proposal', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'crée un projet', askedAt: T0, steps: [] });
    const projectProposal = { name: 'Paper', repos: [{ path: '/w/paper', why: 'Nommé paper' }] };
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, projectProposal });
    expect(daemonStore.getState().chat[0]!.projectProposal).toEqual(projectProposal);
  });

  it('keeps the chat turns and the live answer', () => {
    daemonStore.reset();
    daemonStore.apply({ type: 'chat.history', turns: [{ qid: 'q0', question: 'hier', askedAt: T0, steps: [], answer: 'ok', answeredAt: T0 }] });
    daemonStore.beginTurn({ qid: 'q1', question: 'Où en sont les autres ?', askedAt: T0, steps: [] });
    daemonStore.apply({ type: 'chat.step', qid: 'q1', step: { kind: 'sessions' } });
    daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'Deux ' }); daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'bots.' });
    expect(daemonStore.getState().chatLive).toEqual({ qid: 'q1', text: 'Deux bots.' });
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'Deux bots travaillent.', at: T0 });
    const s = daemonStore.getState();
    expect(s.chatLive).toBeNull(); expect(s.chat.map(t => t.qid)).toEqual(['q0', 'q1']); expect(s.chat[1]).toMatchObject({ answer: 'Deux bots travaillent.', steps: [{ kind: 'sessions' }] });
    daemonStore.apply({ type: 'chat.error', qid: 'q1', message: 'boom' }); expect(daemonStore.getState().chat[1]?.error).toBe('boom');
  });

  it('keeps a session thread, updates its items in place, ignores items of a thread it never loaded, forgets removed ones', () => {
    daemonStore.reset();
    const at = '2026-10-13T10:00:00.000Z';
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b')] });
    daemonStore.apply({ type: 'session.thread.item', id: 'b', item: { kind: 'prompt', id: 'p1', at, turn: 1, text: 'x' } });
    expect(daemonStore.getState().threads.has('b')).toBe(false);
    daemonStore.apply({ type: 'session.thread', id: 'a', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Lance les tests' }, { kind: 'tool', id: 'toolu_1', at, turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'running', files: [] }] });
    daemonStore.apply({ type: 'session.thread.item', id: 'a', item: { kind: 'tool', id: 'toolu_1', at, turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'success', output: 'ok', files: [] } });
    daemonStore.apply({ type: 'session.thread.item', id: 'a', item: { kind: 'reply', id: 'r1', at, turn: 1, text: 'Fini' } });
    const thread = daemonStore.getState().threads.get('a')!;
    expect(thread.map(i => i.id)).toEqual(['p1', 'toolu_1', 'r1']);
    expect(thread[1]).toMatchObject({ status: 'success', output: 'ok' });
    // A thread for a session that vanished meanwhile is kept harmlessly until its removal arrives.
    daemonStore.apply({ type: 'session.thread', id: 'gone', items: [] });
    daemonStore.apply({ type: 'session.removed', id: 'gone' });
    daemonStore.apply({ type: 'session.removed', id: 'a' });
    expect(daemonStore.getState().threads.size).toBe(0);
    daemonStore.apply({ type: 'session.thread', id: 'b', items: [] });
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('b')] });
    expect(daemonStore.getState().threads.size).toBe(0);
  });

  it('keeps the thread of a session frozen by keepStale across fleet snapshots, until it comes back live (R10)', () => {
    daemonStore.reset();
    const at = '2026-10-13T10:00:00.000Z';
    const item = { kind: 'prompt' as const, id: 'p1', at, turn: 1, text: 'Vérifie le tunnel' };
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova'), fakeSession('local:otto')] });
    daemonStore.apply({ type: 'session.thread', id: 'devbox:nova', items: [item] });
    daemonStore.apply({ type: 'session.thread', id: 'local:otto', items: [item] });
    // Devbox falls: the fleet republishes its sessions frozen; only live threads are dropped (they are asked again).
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova', { offline: true }), fakeSession('local:otto')] });
    expect([...daemonStore.getState().threads.keys()]).toEqual(['devbox:nova']);
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova', { offline: true }), fakeSession('local:otto')] });
    expect(daemonStore.getState().threads.get('devbox:nova')).toEqual([item]);
    // Devbox is back: its fresh snapshot replaces the frozen one, thread included.
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova'), fakeSession('local:otto')] });
    expect(daemonStore.getState().threads.size).toBe(0);
  });

  it('drops the frozen thread of a session the fleet no longer publishes', () => {
    daemonStore.reset();
    const at = '2026-10-13T10:00:00.000Z';
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova', { offline: true })] });
    daemonStore.apply({ type: 'session.thread', id: 'devbox:nova', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'x' }] });
    daemonStore.apply({ type: 'snapshot', sessions: [] });   // the machine was removed from the list
    expect(daemonStore.getState().threads.size).toBe(0);
  });
  it('keeps the last 20 errors with their request, in order', () => {
    daemonStore.reset();
    for (let i = 1; i <= 25; i++) daemonStore.apply({ type: 'error', id: 'a', message: `e${i}`, ...(i % 2 ? { request: 'session.reply' } : {}) });
    const { errors, lastError } = daemonStore.getState();
    expect(errors.map(e => e.message)).toEqual(Array.from({ length: 20 }, (_, i) => `e${i + 6}`));
    expect(errors[0]).toEqual({ id: 'a', message: 'e6', seq: 6 });
    expect(lastError).toEqual({ id: 'a', message: 'e25', seq: 25, request: 'session.reply' });
  });
  it('keeps an error\'s code', () => {
    daemonStore.reset();
    daemonStore.apply({ type: 'error', id: 'a', message: 'denied, but the note could not be typed', request: 'session.decide', code: 'note_not_typed' });
    expect(daemonStore.getState().lastError).toEqual({ id: 'a', message: 'denied, but the note could not be typed', seq: 1, request: 'session.decide', code: 'note_not_typed' });
  });
});

describe('daemon token', () => {
  const T = 'a'.repeat(64), WRONG = 'b'.repeat(64);
  /** Replaces the plain mock with one that requires the token. */
  const authed = async (token = T, port?: number) => { await mock.close(); mock = await createMockDaemon({ token, port }); };
  const fixed = (r: TokenRead) => vi.fn(async () => r);

  it('without a source nothing changes: the socket is opened with the url alone', async () => {
    const args: unknown[][] = [];
    function Recording(...a: unknown[]) { args.push(a); return new (WebSocket as unknown as new (...x: unknown[]) => WebSocket)(...a); }
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: Recording as never });
    client.connect();
    await vi.waitFor(() => expect(client.status()).toBe('open'));
    expect(args).toEqual([[mock.url]]);
    expect(mock.handshakes).toEqual([[]]);
    client.close();
  });

  it('presents the token as a subprotocol', async () => {
    await authed(); mock.sessions.set('a', fakeSession('a'));
    const client = createDaemonClient({ url: mock.url, token: createTokenSource(fixed({ kind: 'token', token: T })), WebSocketImpl: WebSocket as never });
    const detach = attachClient(client); client.connect();
    await vi.waitFor(() => expect(daemonStore.getState().sessions.map(s => s.id)).toEqual(['a']));
    expect(client.status()).toBe('open');
    expect(mock.handshakes).toEqual([[`ledge.${T}`]]);
    detach(); client.close();
  });

  it('stays unreachable and opens nothing while the token is absent', async () => {
    await authed();
    const source = createTokenSource(fixed({ kind: 'absent' }));
    const client = createDaemonClient({ url: mock.url, token: source, WebSocketImpl: WebSocket as never });
    client.connect(); await sleep(300);
    expect(client.status()).toBe('unreachable');
    expect(mock.handshakes).toHaveLength(0);
    expect(source.missing()).toBe(true);
    client.close();
  });

  it('an unavailable token is unreachable but not missing', async () => {
    await authed();
    const source = createTokenSource(fixed({ kind: 'unavailable' }));
    const client = createDaemonClient({ url: mock.url, token: source, WebSocketImpl: WebSocket as never });
    client.connect();
    await vi.waitFor(() => expect(client.status()).toBe('unreachable'));
    expect(mock.handshakes).toHaveLength(0);
    expect(source.missing()).toBe(false);
    client.close();
  });

  it('re-reads the token after a failed connection', async () => {
    await authed();
    let n = 0;
    const read = vi.fn(async (): Promise<TokenRead> => ({ kind: 'token', token: n++ === 0 ? WRONG : T }));
    const client = createDaemonClient({ url: mock.url, token: createTokenSource(read), WebSocketImpl: WebSocket as never, minBackoffMs: 50 });
    client.connect();
    await vi.waitFor(() => expect(client.status()).toBe('open'));
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mock.handshakes[0]).toEqual([`ledge.${WRONG}`]);
    expect(mock.handshakes.at(-1)).toEqual([`ledge.${T}`]);
    client.close();
  });

  it('keeps the cached token after a connection that opened and then dropped', async () => {
    await authed();
    const read = vi.fn(async (): Promise<TokenRead> => ({ kind: 'token', token: T }));
    const client = createDaemonClient({ url: mock.url, token: createTokenSource(read), WebSocketImpl: WebSocket as never, minBackoffMs: 50 });
    client.connect();
    await vi.waitFor(() => expect(client.status()).toBe('open'));
    await mock.dropClients();
    await vi.waitFor(() => expect(mock.handshakes).toHaveLength(2));
    await vi.waitFor(() => expect(client.status()).toBe('open'));
    expect(read).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('reconnects on its own to a daemon restarted with a fresh token', async () => {
    await authed();
    let current = T;
    const read = vi.fn(async (): Promise<TokenRead> => ({ kind: 'token', token: current }));
    const client = createDaemonClient({ url: mock.url, token: createTokenSource(read), WebSocketImpl: WebSocket as never, minBackoffMs: 50, maxBackoffMs: 100 });
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    client.connect();
    await vi.waitFor(() => expect(client.status()).toBe('open'));
    const fresh = 'c'.repeat(64); current = fresh;
    await authed(fresh, mock.port);
    await vi.waitFor(() => expect(statuses.filter(s => s === 'open')).toHaveLength(2));
    expect(statuses).toEqual(['open', 'unreachable', 'open']);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mock.handshakes.at(-1)).toEqual([`ledge.${fresh}`]);
    client.close();
  });

  it('a close during the token read opens nothing', async () => {
    await authed();
    const read = vi.fn(() => new Promise<TokenRead>(r => setTimeout(() => r({ kind: 'token', token: T }), 100)));
    const client = createDaemonClient({ url: mock.url, token: createTokenSource(read), WebSocketImpl: WebSocket as never });
    client.connect(); client.close();
    const left = client.status();
    const statuses: string[] = []; client.onStatus(s => statuses.push(s));
    await sleep(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(mock.handshakes).toHaveLength(0);
    expect(client.status()).toBe(left);
    expect(statuses).toEqual([]);
  });

  it('a newer connect() supersedes a pending token read', async () => {
    await authed();
    const read = vi.fn(() => new Promise<TokenRead>(r => setTimeout(() => r({ kind: 'token', token: T }), 50)));
    const client = createDaemonClient({ url: mock.url, token: createTokenSource(read), WebSocketImpl: WebSocket as never });
    client.connect(); client.connect();
    await vi.waitFor(() => expect(client.status()).toBe('open'));
    await sleep(50);
    expect(mock.handshakes).toHaveLength(1);
    expect(mock.clientCount).toBe(1);
    client.close();
  });
});
