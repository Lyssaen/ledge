import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonInfo, Recent, ServerMessage, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { PeerSocket } from '../src/daemon/peers.js';
import { createPeers } from '../src/daemon/peers.js';
import { toRemote } from '../src/daemon/remote/project.js';
import { MOBILE_COMMANDS, PRE_AUTH, remoteMayRun } from '../src/daemon/remote/rights.js';
import type { Tmux } from '../src/tmux.js';

const T0 = '2026-10-14T18:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});
const R: Recent = { cwd: '/w/harness-assistant', project: 'harness-assistant', lastAt: T0 };
const D: DaemonInfo = { version: '0.4.0', install: 'npm', systemd: true };
const view = { deviceId: 'd1' };

const chatDone: ServerMessage = { type: 'chat.done', qid: 'q', text: 'hi', at: T0 };
const docContent = { type: 'document.content', requestId: 'r', path: '/w/a.md', text: '# A' } as unknown as ServerMessage;
const folderListing: ServerMessage = { type: 'folder.listing', path: '/w', parent: '/', entries: ['a'] };
const updateProgress: ServerMessage = { type: 'update.progress', version: '0.4.1', step: 'installing' };
const recents: ServerMessage = { type: 'recents', recents: [R] };
const launched: ServerMessage = { type: 'session.launched', id: 'a' };

/** A socket the test drives by hand: what the daemon sends is queued, what the phone sends is fed with `receive`. */
function fakeSocket(): PeerSocket & { receive(msg: unknown): void; next(type: string, ms?: number): Promise<any>; sent: any[]; closed: number[]; emit(ev: string, ...a: unknown[]): void } {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  const sent: any[] = []; const closed: number[] = []; let read = 0;
  const emit = (ev: string, ...a: unknown[]) => { for (const h of handlers[ev] ?? []) h(...a); };
  return {
    sent, closed, emit, readyState: 1,
    send(data: string) { sent.push(JSON.parse(data)); },
    close(code?: number) { closed.push(code ?? 1000); emit('close'); },
    on(ev, fn) { (handlers[ev] ??= []).push(fn); return this; },
    receive(msg) { emit('message', Buffer.from(JSON.stringify(msg))); },
    async next(type, ms = 1000) {
      const end = Date.now() + ms;
      for (;;) {
        const i = sent.findIndex((m, k) => k >= read && m.type === type);
        if (i >= 0) { read = i + 1; return sent[i]; }
        if (Date.now() > end) throw new Error(`timeout waiting for ${type}`);
        await new Promise(r => setTimeout(r, 10));
      }
    }
  };
}

function fakeTmux(): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession() {}, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture() { return ''; }, async hasSession() { return true; }, async listSessions() { return []; },
    async setOption() {}, async killSession(n) { sent.push(['kill', n]); }, attachArgs: n => ['attach', n]
  };
}

describe('toRemote', () => {
  it('a remote snapshot has sessions only, without launcher, recents and daemon', () => {
    const m = toRemote({ type: 'snapshot', sessions: [mk('a')], recents: [R], launcher: ['node', 'x'], daemon: D }, view)!;
    expect(Object.keys(m).sort()).toEqual(['sessions', 'type']);
    expect((m as any).sessions[0].tmuxSession).toBeNull();
  });
  it('drops chat, document, folder, update, recents and launched messages for a remote peer', () => {
    for (const msg of [chatDone, docContent, folderListing, updateProgress, recents, launched]) expect(toRemote(msg, view)).toBeNull();
  });
  it('drops the device list and the chat history', () => {
    expect(toRemote({ type: 'devices', devices: [], origin: null, listening: false }, view)).toBeNull();
    expect(toRemote({ type: 'chat.history', turns: [] }, view)).toBeNull();
  });
  it('passes session updates without their terminal name, and removals, previews, errors and auth as they are', () => {
    const upd = toRemote({ type: 'session.updated', session: mk('a') }, view) as Extract<ServerMessage, { type: 'session.updated' }>;
    expect(upd.session).toEqual({ ...mk('a'), tmuxSession: null });
    const same: ServerMessage[] = [
      { type: 'session.removed', id: 'a' }, { type: 'session.preview', id: 'a', lines: ['x'] }, { type: 'error', message: 'forbidden' },
      { type: 'auth.ok', deviceId: 'd1', deviceName: 'iPhone', pcName: 'pc' }
    ];
    for (const msg of same) expect(toRemote(msg, view)).toEqual(msg);
  });
  it('drops every pairing message: the live code never reaches a phone, the rest is sent on the pre-auth socket only', () => {
    const pairing: ServerMessage[] = [
      { type: 'pair.code', code: '482913', expiresAt: T0, url: 'https://pc/m/#/pair' }, { type: 'pair.challenge', options: {}, expiresAt: T0 },
      { type: 'pair.done', token: 't', deviceId: 'd1' }, { type: 'pair.error', reason: 'expired' }
    ];
    for (const msg of pairing) expect(toRemote(msg, view)).toBeNull();
  });
  it('does not change the message it projects', () => {
    const s = mk('a'); toRemote({ type: 'snapshot', sessions: [s] }, view);
    expect(s.tmuxSession).toBe('ledge-a');
  });
});

describe('remote rights', () => {
  it('a remote peer may only run snapshot.request in this lot', () => {
    expect(remoteMayRun({ type: 'snapshot.request' })).toBe(true);
    for (const t of ['session.decide', 'session.reply', 'session.interrupt', 'document.read', 'session.launch', 'folder.create', 'update.daemon', 'pair.begin', 'device.revoke', 'mobile.configure', 'session.event', 'chat.ask'] as const)
      expect(remoteMayRun({ type: t } as never)).toBe(false);
  });
  it('pre-auth and mobile lists are the closed sets of the plan', () => {
    expect([...PRE_AUTH]).toEqual(['auth', 'pair.options', 'pair.complete']);
    expect([...MOBILE_COMMANDS]).toEqual(['snapshot.request']);
  });
});

describe('peers', () => {
  const peer = (ctx: { kind: 'local' } | { kind: 'remote'; deviceId: string }) => {
    const got: ServerMessage[] = []; const closes: number[] = [];
    return { got, closes, p: { ctx, send: (m: ServerMessage) => { got.push(m); }, close: (c: number) => { closes.push(c); } } };
  };
  it('broadcasts to every peer until it is removed, and closes only the peers of a device', () => {
    const peers = createPeers();
    const a = peer({ kind: 'local' }); const b = peer({ kind: 'remote', deviceId: 'd1' }); const c = peer({ kind: 'remote', deviceId: 'd2' });
    peers.add(a.p); const removeB = peers.add(b.p); peers.add(c.p);
    peers.broadcast({ type: 'session.removed', id: 'x' });
    expect([a.got.length, b.got.length, c.got.length]).toEqual([1, 1, 1]);
    expect(peers.closeDevice('d1', 4403)).toBe(1);
    expect([a.closes, b.closes, c.closes]).toEqual([[], [4403], []]);
    removeB();
    expect(peers.all()).toEqual([a.p, c.p]);
  });
});

describe('server: a remote peer', () => {
  let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let tmux: ReturnType<typeof fakeTmux>;
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    store = new Store(); tmux = fakeTmux();
    srv = await startServer({ store, tmux, port: 0, launcher: ['node', 'x'], daemon: D, agentEnv: async () => process.env });
  });
  afterEach(async () => { await srv.close(); });

  it('gets a projected snapshot on attach, and no chat history', async () => {
    store.upsert(mk('a')); store.touchRecent('/w/harness-assistant', 'harness-assistant', T0);
    srv.preview('a', ['line']);
    const sock = fakeSocket(); srv.attach(sock, { kind: 'remote', deviceId: 'd1' });
    const snap = await sock.next('snapshot');
    expect(snap).toEqual({ type: 'snapshot', sessions: [{ ...mk('a'), tmuxSession: null }] });
    expect(await sock.next('session.preview')).toEqual({ type: 'session.preview', id: 'a', lines: ['line'] });
    expect(sock.sent.map(m => m.type)).toEqual(['snapshot', 'session.preview']);
  });
  it('receives broadcasts through the projection', async () => {
    const sock = fakeSocket(); srv.attach(sock, { kind: 'remote', deviceId: 'd1' });
    store.upsert(mk('b'));
    expect((await sock.next('session.updated')).session.tmuxSession).toBeNull();
    srv.broadcast({ type: 'recents', recents: [R] });
    srv.broadcast({ type: 'session.removed', id: 'b' });
    await sock.next('session.removed');
    expect(sock.sent.some(m => m.type === 'recents')).toBe(false);
  });
  it('a remote session.decide is refused as forbidden and nothing is typed', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } }));
    const sock = fakeSocket(); srv.attach(sock, { kind: 'remote', deviceId: 'd1' });
    sock.receive({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect(await sock.next('error')).toMatchObject({ message: 'forbidden' });
    expect(tmux.sent).toEqual([]);
    expect(readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8')).toContain('remote d1 refused session.decide');
  });
  it('a remote snapshot.request is answered with the projected snapshot', async () => {
    const sock = fakeSocket(); srv.attach(sock, { kind: 'remote', deviceId: 'd1' });
    await sock.next('snapshot');
    sock.receive({ type: 'snapshot.request' });
    expect(Object.keys(await sock.next('snapshot')).sort()).toEqual(['sessions', 'type']);
  });
  it('attaching a socket that already closed sends nothing and adds no peer', () => {
    const sock = fakeSocket(); (sock as { readyState: number }).readyState = 3;
    srv.attach(sock, { kind: 'remote', deviceId: 'd1' });
    expect(sock.sent).toEqual([]);
    expect(srv.peers.all()).toEqual([]);
  });
  it('a peer leaves the broadcast list when its socket closes, and closeDevice closes it with the given code', async () => {
    const a = fakeSocket(); srv.attach(a, { kind: 'remote', deviceId: 'd1' });
    const b = fakeSocket(); srv.attach(b, { kind: 'remote', deviceId: 'd2' });
    expect(srv.peers.closeDevice('d1', 4403)).toBe(1);
    expect(a.closed).toEqual([4403]);
    expect(srv.peers.all().map(p => p.ctx)).toEqual([{ kind: 'remote', deviceId: 'd2' }]);
    b.emit('close');
    expect(srv.peers.all()).toEqual([]);
  });
});
