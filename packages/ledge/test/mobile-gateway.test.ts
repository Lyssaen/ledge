import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PAD_TIERS, PLAIN_MAX, SNAPSHOT_BODY_MAX, TOPIC_MAX, PhoneServerMessageSchema, pendingKey, type ClientMessage, type MobileState, type Pending, type PhoneServerMessage, type ServerMessage, type Session, type ThreadItem } from '@ledge/protocol';
import { hostname } from 'node:os';
import { createPhoneGateway } from '../src/mobile/gateway.js';

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
function fakeMobile(ids: string[]) {
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
        enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' },
        devices: devices.map(id => ({ id, label: id, approvedAt: T0, online: true })), pairings: []
      })
    }
  };
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

const stops: Array<() => void> = [];
afterEach(() => { for (const s of stops.splice(0)) s(); });

function setup(opts: { dispatch?: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void> } = {}) {
  const fm = fakeMobile(['dev1', 'dev2']);
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
    log: line => logs.push(line),
    now: () => T0
  });
  stops.push(() => gw.stop());
  /** What `deviceId` received, parsed. */
  const got = (deviceId: string): PhoneServerMessage[] => fm.sent.filter(([d]) => d === deviceId).map(([, t]) => JSON.parse(t) as PhoneServerMessage);
  const results = (deviceId: string) => got(deviceId).filter(m => m.type === 'operation.result');
  const send = (deviceId: string, m: unknown) => fm.receive(deviceId, typeof m === 'string' ? m : JSON.stringify(m));
  return { fm, gw, sessions, dispatched, logs, got, results, send };
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
