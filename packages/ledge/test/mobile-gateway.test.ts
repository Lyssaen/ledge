import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PAD_TIERS, PLAIN_MAX, SNAPSHOT_BODY_MAX, TOPIC_MAX, PhoneServerMessageSchema, pendingKey, type ClientMessage, type MobileState, type Pending, type PhoneServerMessage, type ServerMessage, type Session, type ThreadItem } from '@ledge/protocol';
import { hostname } from 'node:os';
import { createPhoneGateway } from '../src/mobile/gateway.js';
import { createChallengeStore } from '../src/mobile/challenges.js';
import { challengeOf, rpOf, type DeviceCredential } from '../src/mobile/webauthn.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';

const T0 = '2026-10-20T08:00:00.000Z';
const T1 = '2026-10-20T09:00:00.000Z';
const PUSH = { kind: 'permission', text: 'git push', tool: 'Bash', source: 'hook' } as const;
const LS = { kind: 'permission', text: 'ls src', tool: 'Bash', source: 'hook' } as const;
const PICK: Pending = { kind: 'question', text: 'Which one?', options: ['red', 'green', 'blue'], source: 'pane' };
/** What the phone sends back as `expect` for request `p`. */
const seen = (p: Omit<Pending, 'source'> & { source?: Pending['source'] }) => ({ kind: p.kind, text: p.text, key: pendingKey({ source: 'pane', ...p }) });
const SEEN_LS = seen(LS);

const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, tool: 'claude', cwd: '/w/repo', project: 'repo', title: `t ${id}`, tmuxSession: `ledge-${id}`, state: 'working', helpers: [],
  startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

/** A MobileService stand-in: approved devices, sealed texts sent per device, and a hand on its message and change listeners. */
function fakeMobile(ids: string[], relayUrl = 'https://relay.test') {
  let devices = ids;
  const sent: Array<[string, string]> = [];
  const messageFns = new Set<(d: string, t: string) => void>();
  const changeFns = new Set<() => void>();
  return {
    sent,
    receive(deviceId: string, text: string) { for (const fn of messageFns) fn(deviceId, text); },
    setDevices(next: string[]) { devices = next; for (const fn of changeFns) fn(); },
    mobile: {
      async send(deviceId: string, text: string) { sent.push([deviceId, text]); return devices.includes(deviceId); },
      onMessage(fn: (d: string, t: string) => void) { messageFns.add(fn); return () => { messageFns.delete(fn); }; },
      onChange(fn: () => void) { changeFns.add(fn); return () => { changeFns.delete(fn); }; },
      state: (): MobileState => ({
        enabled: true, relayUrl, account: null, signin: null, signinError: null, link: { state: 'online' },
        devices: devices.map(id => ({ id, label: id, approvedAt: T0, online: true })), pairings: []
      })
    }
  };
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

const stops: Array<() => void> = [];
afterEach(() => { for (const s of stops.splice(0)) s(); });

function setup(opts: { boot?: string; dispatch?: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void>; relayUrl?: string } = {}) {
  const fm = fakeMobile(['dev1', 'dev2'], opts.relayUrl);
  const clock = { t: 1_000_000 };
  const challenges = createChallengeStore({ now: () => clock.t });
  const creds = new Map<string, DeviceCredential>();
  const stored: string[] = [];
  const sessions = new Map<string, Session>([
    ['a', mk('a', { state: 'waiting_permission', pending: { ...PUSH }, lastReply: { text: 'done', at: T1 } })],
    ['b', mk('b', { state: 'waiting_permission', pending: { ...LS } })],
    ['c', mk('c', { tmuxSession: null })],
    ['q', mk('q', { state: 'waiting_input', pending: { ...PICK, options: [...PICK.options!] } })]
  ]);
  const previews = new Map<string, string[]>([['a', ['$ ls', 'src']]]);
  const threads = new Map<string, ThreadItem[]>([['a', [{ kind: 'message', id: 'm1', at: T0, turn: 0, text: 'hello' }]]]);
  const dispatched: ClientMessage[] = [];
  const logs: string[] = [];
  const dispatch = opts.dispatch ?? (async (msg: ClientMessage) => { dispatched.push(msg); });
  const gw = createPhoneGateway({
    mobile: fm.mobile,
    sessions: () => [...sessions.values()],
    session: id => sessions.get(id),
    thread: id => threads.get(id),
    preview: id => previews.get(id),
    dispatch: async (msg, reply) => { if (opts.dispatch) dispatched.push(msg); await dispatch(msg, reply); },
    version: '1.2.3',
    boot: opts.boot ?? randomUUID(),
    log: line => logs.push(line),
    now: () => T0,
    rp: () => rpOf(fm.mobile.state().relayUrl),
    challenges,
    credential: id => creds.get(id) ?? null,
    setCredential: (id, c) => { stored.push(id); creds.set(id, c); }
  });
  stops.push(() => gw.stop());
  /** What `deviceId` received, parsed. */
  const got = (deviceId: string): PhoneServerMessage[] => fm.sent.filter(([d]) => d === deviceId).map(([, t]) => JSON.parse(t) as PhoneServerMessage);
  const results = (deviceId: string) => got(deviceId).filter(m => m.type === 'operation.result');
  const send = (deviceId: string, m: unknown) => fm.receive(deviceId, typeof m === 'string' ? m : JSON.stringify(m));
  return { fm, gw, sessions, dispatched, logs, got, results, send, clock, creds, stored };
}

const decide = (id: string, decision: 'accept' | 'deny' | 'always', pending: Session['pending'] & object, extra: { key?: string; op?: string } = {}) => ({
  type: 'session.decide', op: extra.op ?? randomUUID(), id, decision, expect: { kind: pending.kind, text: pending.text, key: extra.key ?? pendingKey(pending) }
});

describe('phone gateway: input', () => {
  it('refuses invalid JSON and every message off the whitelist with error invalid, dispatches nothing, logs no text', async () => {
    const g = setup();
    const SECRET = 'top-secret-words';
    g.send('dev1', `{not json ${SECRET}`);
    g.send('dev1', { type: 'session.message', from: 'a', to: 'b', text: SECRET });
    g.send('dev1', { type: 'chat.ask', qid: 'q', text: SECRET });
    g.send('dev1', { type: 'mobile.device.revoke', id: SECRET });
    g.send('dev1', { type: 'update.daemon', version: SECRET });
    g.send('dev1', { type: 'session.launch', tool: 'claude', cwd: '/', prompt: SECRET });
    await flush();
    const errors = g.got('dev1');
    expect(errors).toHaveLength(6);
    for (const e of errors) expect(e).toMatchObject({ type: 'error', code: 'invalid' });
    expect(errors[0]).not.toHaveProperty('request');
    expect(errors.slice(1).map(e => e.type === 'error' && e.request)).toEqual(['session.message', 'chat.ask', 'mobile.device.revoke', 'update.daemon', 'session.launch']);
    expect(g.dispatched).toEqual([]);
    expect(g.logs.some(l => l.includes(SECRET))).toBe(false);
    expect(g.logs).toContain('phone message refused: ?');
    expect(g.logs).toContain('phone message refused: chat.ask');
  });

  it('names no request longer than 40 characters, nor one off the plain shape of a type', async () => {
    const g = setup();
    g.send('dev1', { type: 'x'.repeat(41) });
    g.send('dev1', { type: 'chat.ask\nphone message refused: forged' });
    g.send('dev1', { type: 'Chat.ask' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'error', code: 'invalid' }, { type: 'error', code: 'invalid' }, { type: 'error', code: 'invalid' }]);
    expect(g.logs.filter(l => l.startsWith('phone message refused'))).toEqual(['phone message refused: ?', 'phone message refused: ?', 'phone message refused: ?']);
    expect(g.logs.some(l => l.includes('forged'))).toBe(false);
  });
});

describe('phone gateway: reads and forward', () => {
  it('a device that did not ask for a snapshot gets no session.updated', async () => {
    const g = setup();
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    expect(g.fm.sent).toEqual([]);
  });

  it('each gateway announces its own boot in the snapshot', async () => {
    const boots = [randomUUID(), randomUUID()];
    const seen: unknown[] = [];
    for (const boot of boots) {
      const g = setup({ boot });
      g.send('dev1', { type: 'snapshot.request' });
      await flush();
      const [snap] = g.got('dev1');
      seen.push(snap?.type === 'snapshot' ? snap.daemon.boot : undefined);
    }
    expect(seen).toEqual(boots);
  });

  it('snapshot.request subscribes: the snapshot, then each session.updated projected, without cwd or tmuxSession', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = g.got('dev1');
    expect(PhoneServerMessageSchema.parse(snap)).toMatchObject({ type: 'snapshot', protocol: 1, daemon: { version: '1.2.3', name: hostname().slice(0, 40) } });
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    expect(snap.sessions.map(s => s.id)).toEqual(['a', 'b', 'c', 'q']);
    expect(snap.sessions[0]).toMatchObject({ unread: true, pending: { risk: 'high', riskReason: 'pushes' } });
    g.gw.forward({ type: 'session.updated', session: mk('a', { title: 'renamed' }) });
    await flush();
    const upd = g.got('dev1')[1]!;
    expect(PhoneServerMessageSchema.parse(upd)).toMatchObject({ type: 'session.updated', session: { id: 'a', title: 'renamed' } });
    if (upd.type !== 'session.updated') throw new Error('no update');
    expect(upd.session).not.toHaveProperty('cwd');
    expect(upd.session).not.toHaveProperty('tmuxSession');
    expect(g.got('dev2')).toEqual([]);
    g.gw.forward({ type: 'session.removed', id: 'c' });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'session.removed', id: 'c' });
  });

  it('forward ignores what it does not know: chat.delta, mobile, machines, recents', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'b' });
    await flush();
    const before = g.fm.sent.length;
    g.gw.forward({ type: 'chat.delta', qid: 'q', text: 'x' } as ServerMessage);
    g.gw.forward({ type: 'mobile', state: g.fm.mobile.state() });
    g.gw.forward({ type: 'machines', machines: [] });
    g.gw.forward({ type: 'recents', recents: [] });
    await flush();
    expect(g.fm.sent.length).toBe(before);
  });

  it('session.preview and session.thread.item reach only the device that watches that session', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.watch', id: 'a' });
    g.send('dev2', { type: 'session.watch', id: 'b' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'session.preview', id: 'a', lines: ['$ ls', 'src'] }]);
    expect(g.got('dev2')).toEqual([]);
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['new'] });
    g.gw.forward({ type: 'session.thread.item', id: 'a', item: { kind: 'message', id: 'm2', at: T1, turn: 1, text: 'x'.repeat(9_000) } });
    await flush();
    expect(g.got('dev1').slice(1)).toEqual([
      { type: 'session.preview', id: 'a', lines: ['new'] },
      { type: 'session.thread.item', id: 'a', item: { kind: 'message', id: 'm2', at: T1, turn: 1, text: 'x'.repeat(8_192) }, cut: true }
    ]);
    expect(g.got('dev2')).toEqual([]);
    g.send('dev1', { type: 'session.watch', id: null });
    await flush();
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['later'] });
    await flush();
    expect(g.got('dev1')).toHaveLength(3);
  });

  it('session.thread answers the projected thread, or unknown_session', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.thread', id: 'a' });
    g.send('dev1', { type: 'session.thread', id: 'zz' });
    await flush();
    expect(g.got('dev1')).toEqual([
      { type: 'session.thread', id: 'a', items: [{ kind: 'message', id: 'm1', at: T0, turn: 0, text: 'hello' }], cut: [], more: false },
      { type: 'error', code: 'unknown_session', request: 'session.thread' }
    ]);
  });

  it('session.read: unread turns false for that device only', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    g.send('dev1', { type: 'session.read', id: 'a', at: '2026-10-20T09:00:00Z' });
    await flush();
    const own = g.got('dev1').at(-1);
    expect(own).toMatchObject({ type: 'session.updated', session: { id: 'a', unread: false } });
    expect(g.got('dev2')).toHaveLength(1);
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'session.updated', session: { unread: false } });
    expect(g.got('dev2').at(-1)).toMatchObject({ type: 'session.updated', session: { unread: true } });
    // An older mark never takes the newer one back.
    g.send('dev1', { type: 'session.read', id: 'a', at: '2026-10-20T07:00:00.000Z' });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'session.updated', session: { unread: false } });
  });

  it('session.read from a device that follows no session moves its mark and sends nothing', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.read', id: 'a', at: '2026-10-20T09:00:00Z' });
    await flush();
    expect(g.fm.sent).toEqual([]);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1')[0];
    expect(snap?.type === 'snapshot' && snap.sessions.find(s => s.id === 'a')?.unread).toBe(false);
  });

  it('an archived session never reaches the phone: off the snapshot, forwarded as removed, unknown to reads and writes', async () => {
    const g = setup();
    g.sessions.set('z', mk('z', { archivedAt: T1, lastReply: { text: 'old', at: T1 } }));
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    const snap = g.got('dev1')[0];
    expect(snap?.type === 'snapshot' && snap.sessions.map(s => s.id)).toEqual(['a', 'b', 'c', 'q']);
    g.send('dev1', { type: 'session.read', id: 'a', at: T1 });
    await flush();
    // Session a is archived now: the phone hears it is gone, and forgets its watch and read mark.
    const archived = { ...g.sessions.get('a')!, archivedAt: T1 };
    g.sessions.set('a', archived);
    g.gw.forward({ type: 'session.updated', session: archived });
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['ghost'] });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'session.removed', id: 'a' });
    const before = g.got('dev1').length;
    for (const id of ['a', 'z']) {
      g.send('dev1', { type: 'session.thread', id });
      g.send('dev1', { type: 'session.watch', id });
      g.send('dev1', { type: 'session.read', id, at: T1 });
    }
    const write = { type: 'session.reply', op: randomUUID(), id: 'z', text: 'hi', expect: null };
    g.send('dev1', write);
    await flush();
    const after = g.got('dev1').slice(before);
    expect(after.filter(m => m.type === 'error').map(m => m.type === 'error' && [m.code, m.request])).toEqual([
      ['unknown_session', 'session.thread'], ['unknown_session', 'session.watch'], ['unknown_session', 'session.read'],
      ['unknown_session', 'session.thread'], ['unknown_session', 'session.watch'], ['unknown_session', 'session.read']
    ]);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: write.op, status: 'rejected', reason: 'unknown_session' });
    expect(after.some(m => m.type === 'session.preview')).toBe(false);
    expect(g.dispatched).toEqual([]);
  });

  it('watching an unknown session is refused and keeps the session watched before', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.watch', id: 'a' });
    g.send('dev1', { type: 'session.watch', id: 'zz' });
    await flush();
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['still'] });
    await flush();
    expect(g.got('dev1').slice(1)).toEqual([
      { type: 'error', code: 'unknown_session', request: 'session.watch' },
      { type: 'session.preview', id: 'a', lines: ['still'] }
    ]);
  });

  it('a removed session is no longer watched', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    g.gw.forward({ type: 'session.removed', id: 'a' });
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['ghost'] });
    await flush();
    expect(g.got('dev1')).toHaveLength(1);
  });

  it('a queue that overflows is cut and the device gets a fresh snapshot', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    // The first send hangs, so everything after it stays queued.
    let release!: (ok: boolean) => void;
    const realSend = g.fm.mobile.send;
    g.fm.mobile.send = (d, t) => { g.fm.mobile.send = realSend; g.fm.sent.push([d, t]); return new Promise<boolean>(res => { release = res; }); };
    for (let i = 0; i < 302; i++) g.gw.forward({ type: 'session.removed', id: `gone-${i}` });
    await flush();
    release(true);
    await flush();
    const after = g.got('dev1').slice(2);
    expect(after.map(m => m.type)).toEqual(['snapshot']);
    expect(g.logs).toContain('phone outbox: queue overflow for device dev1');
  });

  it('after stop, nothing is received nor forwarded', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const n = g.fm.sent.length;
    g.gw.stop();
    g.send('dev1', { type: 'snapshot.request' });
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    expect(g.fm.sent.length).toBe(n);
  });

  it('a revoked device (onChange) gets nothing more', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    const before = g.got('dev1').length;
    g.fm.setDevices(['dev2']);
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['x'] });
    g.gw.forward({ type: 'session.removed', id: 'b' });
    await flush();
    expect(g.got('dev1')).toHaveLength(before);
  });

  it('a device whose send fails (onGone) is unsubscribed', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.fm.mobile.send = async (d, t) => { g.fm.sent.push([d, t]); return false; };
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    const n = g.fm.sent.length;
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('b')! });
    await flush();
    expect(g.fm.sent.length).toBe(n);
  });
});

describe('phone gateway: writes', () => {
  it('decide with a wrong expect.key: received, then rejected/stale, nothing dispatched', async () => {
    const g = setup();
    const m = decide('a', 'deny', PUSH, { key: 'not-the-key' });
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1')).toEqual([
      { type: 'operation.result', op: m.op, status: 'received' },
      { type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' }
    ]);
    expect(g.dispatched).toEqual([]);
  });

  it('accept on git push needs a confirmation; deny on it is dispatched and applied', async () => {
    const g = setup();
    const accept = decide('a', 'accept', PUSH);
    const always = decide('a', 'always', PUSH);
    g.send('dev1', accept);
    g.send('dev1', always);
    await flush();
    expect(g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received').map(r => r.type === 'operation.result' && [r.status, r.reason]))
      .toEqual([['rejected', 'confirm_required'], ['rejected', 'confirm_required']]);
    expect(g.dispatched).toEqual([]);
    const deny = decide('a', 'deny', PUSH);
    g.send('dev1', deny);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'a', decision: 'deny', expect: { kind: 'permission', text: 'git push', key: pendingKey(PUSH) } }]);
    expect(g.results('dev1').slice(-2)).toEqual([
      { type: 'operation.result', op: deny.op, status: 'received' },
      { type: 'operation.result', op: deny.op, status: 'applied' }
    ]);
  });

  it('accept on a low request is dispatched as the local decide', async () => {
    const g = setup();
    const m = decide('b', 'accept', LS);
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'b', decision: 'accept', expect: { kind: 'permission', text: 'ls src', key: pendingKey(LS) } }]);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
  });

  it('maps the reply of dispatch: not_taken failed, a known code rejected, an unknown one invalid, no code failed, a throw failed', async () => {
    const answers: Array<ServerMessage | Error> = [
      { type: 'error', id: 'b', message: 'the terminal did not take it', request: 'session.decide', code: 'not_taken' },
      { type: 'error', id: 'b', message: 'busy', request: 'session.decide', code: 'busy' },
      { type: 'error', id: 'b', message: 'odd', request: 'session.decide', code: 'from_the_future' } as ServerMessage,
      { type: 'error', id: 'b', message: 'tmux exited 1', request: 'session.decide' },
      new TypeError('tmux broke with SECRET-TEXT')
    ];
    const g = setup({
      dispatch: async (_msg, reply) => {
        const a = answers.shift()!;
        if (a instanceof Error) throw a;
        reply(a);
      }
    });
    for (let i = 0; i < 5; i++) { g.send('dev1', decide('b', 'accept', LS)); await flush(); }
    const finals = g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received').map(r => r.type === 'operation.result' && [r.status, r.reason ?? null]);
    expect(finals).toEqual([['failed', 'not_taken'], ['rejected', 'busy'], ['rejected', 'invalid'], ['failed', null], ['failed', null]]);
    expect(g.logs.some(l => l.includes('SECRET-TEXT'))).toBe(false);
    expect(g.logs.some(l => l.includes('session.decide') && l.includes('TypeError'))).toBe(true);
  });

  it('the same op twice is dispatched once, the second answer is the stored one', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'hello', expect: SEEN_LS };
    g.send('dev1', m);
    await flush();
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'b', text: 'hello' }]);
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received', 'applied', 'applied']);
  });

  it('the same op with another text is a conflict', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', { type: 'session.reply', op, id: 'b', text: 'hello', expect: SEEN_LS });
    await flush();
    g.send('dev1', { type: 'session.reply', op, id: 'b', text: 'goodbye', expect: SEEN_LS });
    await flush();
    expect(g.dispatched).toHaveLength(1);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'conflict' });
  });

  it('a reply carrying an escape sequence is untypable, and never dispatched', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'clear \x1b[2J', expect: SEEN_LS };
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'untypable' });
    expect(g.dispatched).toEqual([]);
  });

  it('a note carrying an escape sequence is untypable, even on a deny; a plain note is dispatched', async () => {
    const g = setup();
    const bad = { ...decide('a', 'deny', PUSH), note: 'x\x1b[2J' };
    g.send('dev1', bad);
    await flush();
    expect(g.results('dev1')).toEqual([
      { type: 'operation.result', op: bad.op, status: 'received' },
      { type: 'operation.result', op: bad.op, status: 'rejected', reason: 'untypable' }
    ]);
    expect(g.dispatched).toEqual([]);
    g.send('dev1', { ...decide('a', 'deny', PUSH), note: 'not this one' });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'a', decision: 'deny', note: 'not this one', expect: { kind: 'permission', text: 'git push', key: pendingKey(PUSH) } }]);
  });

  it('a reply names the request it answers: an older one, or a request it never saw, is stale', async () => {
    const g = setup();
    const older = { type: 'session.reply', op: randomUUID(), id: 'q', text: '1', expect: seen({ kind: 'question', text: 'Before?' }) };
    const blind = { type: 'session.reply', op: randomUUID(), id: 'q', text: '1', expect: null };
    g.send('dev1', older);
    g.send('dev1', blind);
    await flush();
    expect(g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received')).toEqual([
      { type: 'operation.result', op: older.op, status: 'rejected', reason: 'stale' },
      { type: 'operation.result', op: blind.op, status: 'rejected', reason: 'stale' }
    ]);
    // A request seen on a session that has none any more is stale too.
    const gone = { type: 'session.reply', op: randomUUID(), id: 'c', text: 'go on', expect: SEEN_LS };
    g.send('dev1', gone);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: gone.op, status: 'rejected', reason: 'stale' });
    expect(g.dispatched).toEqual([]);
  });

  it('a reply with no request seen goes through while the session has none', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'c', text: 'go on', expect: null };
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'c', text: 'go on' }]);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
  });

  it('a digit past the options of the question is invalid; one within them is dispatched', async () => {
    const g = setup();
    const five = { type: 'session.reply', op: randomUUID(), id: 'q', text: '5', expect: seen(PICK) };
    const two = { type: 'session.reply', op: randomUUID(), id: 'q', text: '2', expect: seen(PICK) };
    g.send('dev1', five);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: five.op, status: 'rejected', reason: 'invalid' });
    expect(g.dispatched).toEqual([]);
    g.send('dev1', two);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'q', text: '2' }]);
  });

  it('two operations running at once each get their own outcome', async () => {
    const gates = new Map<string, (m?: ServerMessage) => void>();
    const g = setup({
      dispatch: (msg, reply) => new Promise<void>(res => {
        gates.set(msg.type === 'session.reply' ? msg.text : '', m => { if (m) reply(m); res(); });
      })
    });
    const one = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'one', expect: SEEN_LS };
    const two = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'two', expect: SEEN_LS };
    g.send('dev1', one); g.send('dev1', two);
    await flush();
    expect(gates.size).toBe(2);
    gates.get('two')!();
    await flush();
    gates.get('one')!({ type: 'error', id: 'b', message: 'busy', request: 'session.reply', code: 'busy' });
    await flush();
    const finals = g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received');
    expect(finals).toEqual([
      { type: 'operation.result', op: two.op, status: 'applied' },
      { type: 'operation.result', op: one.op, status: 'rejected', reason: 'busy' }
    ]);
  });

  it('a device revoked while its operation runs gets no result', async () => {
    let release!: () => void;
    const g = setup({ dispatch: () => new Promise<void>(res => { release = res; }) });
    g.send('dev1', { type: 'session.reply', op: randomUUID(), id: 'b', text: 'hi', expect: SEEN_LS });
    await flush();
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received']);
    g.fm.setDevices(['dev2']);
    release();
    await flush();
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received']);
  });

  it('an unknown session is rejected; an interrupt on a session without tmux is read_only', async () => {
    const g = setup();
    const unknown = { type: 'session.interrupt', op: randomUUID(), id: 'zz' };
    const noTmux = { type: 'session.interrupt', op: randomUUID(), id: 'c' };
    const ok = { type: 'session.interrupt', op: randomUUID(), id: 'b' };
    g.send('dev1', unknown); g.send('dev1', noTmux); g.send('dev1', ok);
    await flush();
    const finals = g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received');
    expect(finals).toEqual([
      { type: 'operation.result', op: unknown.op, status: 'rejected', reason: 'unknown_session' },
      { type: 'operation.result', op: noTmux.op, status: 'rejected', reason: 'read_only' },
      { type: 'operation.result', op: ok.op, status: 'applied' }
    ]);
    expect(g.dispatched).toEqual([{ type: 'session.interrupt', id: 'b' }]);
  });

  it('an interrupt on an OMP session goes through: OMP stops over its RPC, not a terminal', async () => {
    const g = setup();
    g.sessions.set('o', mk('o', { tool: 'omp', tmuxSession: null, backend: 'omp-rpc' }));
    const op = randomUUID();
    g.send('dev1', { type: 'session.interrupt', op, id: 'o' });
    await flush();
    expect(g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received')).toEqual([{ type: 'operation.result', op, status: 'applied' }]);
    expect(g.dispatched).toEqual([{ type: 'session.interrupt', id: 'o' }]);
  });

  it('a result goes to the requesting device only', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    g.send('dev1', { type: 'session.reply', op: randomUUID(), id: 'b', text: 'hi', expect: SEEN_LS });
    await flush();
    expect(g.results('dev1')).toHaveLength(2);
    expect(g.results('dev2')).toHaveLength(0);
  });
});

describe('phone gateway: sizes', () => {
  it('every text sent is padded to one of PAD_TIERS', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    g.send('dev1', { type: 'session.thread', id: 'a' });
    g.send('dev1', 'nope');
    g.send('dev1', decide('a', 'accept', PUSH));
    g.gw.forward({ type: 'session.thread.item', id: 'a', item: { kind: 'message', id: 'm2', at: T1, turn: 1, text: 'y'.repeat(5_000) } });
    await flush();
    expect(g.fm.sent.length).toBeGreaterThan(5);
    for (const [, text] of g.fm.sent) expect(PAD_TIERS).toContain(Buffer.byteLength(text, 'utf8'));
  });

  it('a snapshot of 200 sessions with long replies and topics still fits: previews are clipped', async () => {
    const g = setup();
    g.sessions.clear();
    for (let i = 0; i < 200; i++) {
      g.sessions.set(`s${i}`, mk(`s${i}`, { topic: 't'.repeat(24_000), lastReply: { text: 'r'.repeat(24_000), at: T1 } }));
    }
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = g.got('dev1');
    expect(snap?.type).toBe('snapshot');
    expect(PhoneServerMessageSchema.parse(snap)).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(snap), 'utf8')).toBeLessThanOrEqual(PLAIN_MAX);
    if (snap?.type === 'snapshot') {
      expect(snap.sessions).toHaveLength(200);
      expect(snap.sessions[0]!.lastReply!.text).toHaveLength(2_048);
      expect(snap.sessions[0]!.topic).toHaveLength(TOPIC_MAX);
    }
  });
});

describe('phone gateway: request bodies on demand', () => {
  const BIG = 'x'.repeat(65_536);
  const withPlans = (g: ReturnType<typeof setup>, n = 12) => {
    for (let i = 0; i < n; i++) g.sessions.set(`p${i}`, mk(`p${i}`, { state: 'waiting_permission', pending: { kind: 'plan', text: `plan ${i}`, body: BIG, source: 'hook' } }));
  };

  it('a snapshot of 12 sessions waiting on a 64 KiB body stays under PLAIN_MAX, every body cut', async () => {
    const g = setup();
    withPlans(g);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = g.got('dev1');
    expect(g.got('dev1').filter(m => m.type === 'error')).toEqual([]);
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    const plans = snap.sessions.filter(s => s.id.startsWith('p'));
    expect(plans).toHaveLength(12);
    for (const s of plans) expect(s.pending).toMatchObject({ cut: true, body: 'x'.repeat(SNAPSHOT_BODY_MAX) });
    expect(Buffer.byteLength(g.fm.sent[0]![1], 'utf8')).toBeLessThanOrEqual(PLAIN_MAX);
  });

  it('session.updated cuts the body too', async () => {
    const g = setup();
    withPlans(g, 1);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('p0')! });
    await flush();
    const upd = g.got('dev1').find(m => m.type === 'session.updated');
    expect(upd?.type === 'session.updated' && upd.session.pending).toMatchObject({ cut: true, body: 'x'.repeat(SNAPSHOT_BODY_MAX) });
  });

  it('session.pending gives the whole body, with its key and risk', async () => {
    const g = setup();
    withPlans(g, 1);
    g.send('dev1', { type: 'session.pending', id: 'p0' });
    await flush();
    const [m] = g.got('dev1');
    expect(PhoneServerMessageSchema.parse(m)).toMatchObject({ type: 'session.pending', id: 'p0', pending: { kind: 'plan', body: BIG, risk: 'high', riskReason: 'plan' } });
    if (m?.type === 'session.pending') expect(m.pending.cut).toBeUndefined();
  });

  it('session.pending on a session without a request, or an unknown one, is error unknown_session', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.pending', id: 'c' });
    g.send('dev1', { type: 'session.pending', id: 'nope' });
    await flush();
    expect(g.got('dev1')).toEqual([
      { type: 'error', code: 'unknown_session', request: 'session.pending' },
      { type: 'error', code: 'unknown_session', request: 'session.pending' }
    ]);
  });
});


describe('phone gateway: device key', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const prepare = async (g: ReturnType<typeof setup>, deviceId = 'dev1') => {
    const before = g.got(deviceId).length;
    g.send(deviceId, { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const m = g.got(deviceId).slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m;
  };
  const register = (g: ReturnType<typeof setup>, cred: unknown, op: string = randomUUID(), deviceId = 'dev1') => g.send(deviceId, { type: 'credential.register', op, credential: cred });

  it('answers confirm.prepare register with a challenge for the relay host', async () => {
    const g = setup();
    const c = await prepare(g);
    expect(c).toMatchObject({ purpose: 'register', rpId: 'relay.test', expiresInMs: 60_000 });
    expect(c.challenge.length).toBeGreaterThan(20);
  });

  it('registers a passkey: applied, then a snapshot that says device.confirm', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1').find(m => m.type === 'snapshot')).toMatchObject({ device: { confirm: false } });
    const c = await prepare(g);
    const op = randomUUID();
    register(g, softAuthenticator().create(rp, c.challenge), op);
    await flush();
    expect(g.results('dev1').map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied']);
    expect(g.stored).toEqual(['dev1']);
    expect(g.creds.get('dev1')).toMatchObject({ rpId: 'relay.test', counter: 0 });
    const snaps = g.got('dev1').filter(m => m.type === 'snapshot');
    expect(snaps.at(-1)).toMatchObject({ device: { confirm: true } });
    expect(g.got('dev1').at(-1)?.type).toBe('snapshot');
  });

  it('replays the same op with the same result and stores the key once', async () => {
    const g = setup();
    const c = await prepare(g);
    const op = randomUUID();
    const cred = softAuthenticator().create(rp, c.challenge);
    register(g, cred, op);
    await flush();
    register(g, cred, op);
    await flush();
    expect(g.results('dev1').map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied', 'applied']);
    expect(g.stored).toEqual(['dev1']);
  });

  it('refuses a challenge issued to another device', async () => {
    const g = setup();
    const c = await prepare(g, 'dev2');
    register(g, softAuthenticator().create(rp, c.challenge));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(g.stored).toEqual([]);
  });

  it('refuses an unknown or unreadable challenge, and a challenge used twice', async () => {
    const g = setup();
    register(g, softAuthenticator().create(rp, 'never-issued'));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    const c = await prepare(g);
    const cred = softAuthenticator().create(rp, c.challenge);
    expect(challengeOf(cred.clientDataJSON)).toBe(c.challenge);
    register(g, cred);
    await flush();
    register(g, cred);
    await flush();
    expect(g.results('dev1').slice(-4).map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied', 'received', 'rejected']);
    expect(g.stored).toEqual(['dev1']);
  });

  it('refuses an expired challenge with assertion_expired', async () => {
    const g = setup();
    const c = await prepare(g);
    g.clock.t += 60_001;
    register(g, softAuthenticator().create(rp, c.challenge));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_expired' });
    expect(g.stored).toEqual([]);
  });

  it('refuses a registration that does not verify', async () => {
    const g = setup();
    const c = await prepare(g);
    register(g, softAuthenticator().create(rp, c.challenge, { origin: 'https://evil.test' }));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(g.stored).toEqual([]);
  });

  it('without a secure relay URL there is no challenge and no device check', async () => {
    const g = setup({ relayUrl: 'http://192.168.1.10' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1')[0]).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(g.got('dev1').find(m => m.type === 'snapshot')).toMatchObject({ device: { confirm: false } });
  });
});

describe('phone gateway: a high-impact accept carries a device assertion', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const RPC: Pending = { kind: 'question', text: 'Allow the edit?', tool: 'omp', options: ['Allow', 'Reject'], source: 'rpc' };
  type G = ReturnType<typeof setup>;
  const challengeFor = async (g: G, id: string, pending: Pending, purpose: 'decide' | 'register' = 'decide'): Promise<string> => {
    const before = g.got('dev1').length;
    g.send('dev1', purpose === 'register'
      ? { type: 'confirm.prepare', purpose }
      : { type: 'confirm.prepare', purpose, id, expect: { kind: pending.kind, text: pending.text, key: pendingKey(pending) } });
    await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m.challenge;
  };
  /** A device with a registered passkey. */
  const enrolled = async () => {
    const g = setup();
    g.sessions.set('r', mk('r', { state: 'waiting_permission', pending: { ...RPC } }));
    const auth = softAuthenticator();
    const c = await challengeFor(g, '', RPC, 'register');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, c) });
    await flush();
    g.stored.length = 0;
    return { g, auth };
  };
  const last = (g: G) => g.results('dev1').at(-1);
  const withAssertion = (m: object, assertion: unknown) => ({ ...m, assertion });

  it('confirm.prepare decide without id or expect is invalid; for an unknown session unknown_session; without a credential invalid', async () => {
    const { g } = await enrolled();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide', id: 'a' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide', id: 'nope', expect: seen(PUSH) });
    g.send('dev2', { type: 'confirm.prepare', purpose: 'decide', id: 'a', expect: seen(PUSH) });
    await flush();
    expect(g.got('dev1').slice(-3)).toEqual([
      { type: 'error', code: 'invalid', request: 'confirm.prepare' },
      { type: 'error', code: 'invalid', request: 'confirm.prepare' },
      { type: 'error', code: 'unknown_session', request: 'confirm.prepare' }
    ]);
    expect(g.got('dev2')).toEqual([{ type: 'error', code: 'invalid', request: 'confirm.prepare' }]);
  });

  it('answers confirm.prepare decide with a challenge, the credential id and the relay host', async () => {
    const { g, auth } = await enrolled();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide', id: 'a', expect: seen(PUSH) });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'confirm.challenge', purpose: 'decide', rpId: 'relay.test', credentialId: auth.id, expiresInMs: 60_000 });
  });

  it('accepts a high request with a valid assertion: applied, the local front gets no assertion, the counter is stored', async () => {
    const { g, auth } = await enrolled();
    const m = decide('a', 'accept', PUSH);
    const challenge = await challengeFor(g, 'a', PUSH);
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: 'git push', key: pendingKey(PUSH) } }]);
    expect(g.dispatched[0]).not.toHaveProperty('assertion');
    expect(g.stored).toEqual(['dev1']);
    expect(g.creds.get('dev1')?.counter).toBe(1);
  });

  it('refuses always on a high request without an assertion, or without a credential; deny and a low accept need none', async () => {
    const { g } = await enrolled();
    const always = decide('a', 'always', PUSH);
    g.send('dev1', always);
    const bare = setup();
    const m = decide('a', 'accept', PUSH);
    bare.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: always.op, status: 'rejected', reason: 'confirm_required' });
    expect(last(bare)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'confirm_required' });
    expect(g.dispatched).toEqual([]);
    const deny = decide('a', 'deny', PUSH);
    const low = decide('b', 'accept', LS);
    g.send('dev1', deny);
    g.send('dev1', low);
    await flush();
    const results = g.results('dev1');
    expect(results).toContainEqual({ type: 'operation.result', op: deny.op, status: 'applied' });
    expect(results).toContainEqual({ type: 'operation.result', op: low.op, status: 'applied' });
    expect(g.dispatched.map(d => d.type === 'session.decide' && [d.id, d.decision])).toEqual([['a', 'deny'], ['b', 'accept']]);
  });

  it('a stale expect.key is stale even with a valid assertion, and the challenge stays usable', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 1 });
    const old = decide('a', 'accept', PUSH, { key: 'old-key' });
    g.send('dev1', withAssertion(old, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: old.op, status: 'rejected', reason: 'stale' });
    const fresh = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(fresh, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: fresh.op, status: 'applied' });
  });

  it('an assertion bound to another request is assertion_invalid', async () => {
    const { g, auth } = await enrolled();
    g.sessions.set('p2', mk('p2', { state: 'waiting_permission', pending: { ...PUSH, text: 'git push -f' } }));
    const challenge = await challengeFor(g, 'p2', { ...PUSH, text: 'git push -f' });
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.dispatched).toEqual([]);
  });

  it('the same assertion under a new op is assertion_invalid (challenge spent); the same op again replays applied', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 1 });
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, assertion));
    await flush();
    // The replay answers from the registry: a re-run would find the challenge spent and answer assertion_invalid.
    g.send('dev1', withAssertion(m, assertion));
    await flush();
    expect(g.results('dev1').slice(-2).map(r => r.type === 'operation.result' && r.status)).toEqual(['applied', 'applied']);
    expect(g.dispatched).toHaveLength(1);
    expect(g.stored).toEqual(['dev1']);
    const again = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(again, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: again.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.dispatched).toHaveLength(1);
  });

  it('an expired challenge is assertion_expired', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    g.clock.t += 61_000;
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_expired' });
  });

  it('a replayed counter is assertion_invalid and the stored counter does not move', async () => {
    const { g, auth } = await enrolled();
    const first = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(first, auth.get(rp, await challengeFor(g, 'a', PUSH), { counter: 5 })));
    await flush();
    g.sessions.get('a')!.pending = { ...PUSH };
    const second = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(second, auth.get(rp, await challengeFor(g, 'a', PUSH), { counter: 5 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: second.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.creds.get('dev1')?.counter).toBe(5);
    expect(g.stored).toEqual(['dev1']);
  });

  it('a reply to an OMP rpc request needs an assertion; with one it goes through', async () => {
    const { g, auth } = await enrolled();
    const expect_ = seen(RPC);
    const bare = { type: 'session.reply', op: randomUUID(), id: 'r', text: 'yes', expect: { ...expect_, key: pendingKey(RPC) } };
    g.send('dev1', bare);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: bare.op, status: 'rejected', reason: 'confirm_required' });
    expect(g.dispatched).toEqual([]);
    const m = { ...bare, op: randomUUID() };
    g.send('dev1', withAssertion(m, auth.get(rp, await challengeFor(g, 'r', RPC), { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'r', text: 'yes' }]);
  });

  it('logs carry neither the challenge nor the signature, even when verification fails', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 0, type: 'webauthn.create' });
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.logs).toContain('phone: assertion refused for device dev1');
    for (const secret of [challenge, assertion.signature, assertion.clientDataJSON, assertion.authenticatorData]) expect(g.logs.some(l => l.includes(secret))).toBe(false);
  });
});
