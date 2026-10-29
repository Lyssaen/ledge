import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ATTACHMENT_MAX, PREVIEW_MAX, padPlain, PAD_TIERS, PLAIN_MAX, SNAPSHOT_BODY_MAX, TOPIC_MAX, PhoneServerMessageSchema, pendingKey, type Pending, type ServerMessage, type Session, type Task, type Team } from '@ledge/protocol';
import { hostname } from 'node:os';
import { createPhoneGateway } from '../src/mobile/gateway.js';
import { challengeOf } from '../src/mobile/webauthn.js';
import { launchFromChat } from '../src/chat/launch.js';
import { CloseRefused } from '../src/chat/close.js';
import { toPhoneTurn } from '../src/mobile/chat.js';
import { tooWide } from '../src/chat/service.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { T0, T1, PUSH, LS, PICK, seen, SEEN_LS, mk, flush, setup, decide, stopAll } from './helpers/gateway.js';


afterEach(stopAll);

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
      // An error goes ahead of the updates still queued.
      { type: 'error', code: 'unknown_session', request: 'session.thread' },
      { type: 'session.checklist', id: 'a', checklist: null }
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

  it('an assertion no check binds is stale and spends no challenge: a reply with a null expect while idle, a decide on a low request', async () => {
    const { g, auth } = await enrolled();
    g.sessions.set('idle', mk('idle'));
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 1 });
    const reply = { type: 'session.reply', op: randomUUID(), id: 'idle', text: '2', expect: null };
    g.send('dev1', withAssertion(reply, assertion));
    const low = decide('b', 'accept', LS);
    g.send('dev1', withAssertion(low, assertion));
    await flush();
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op: reply.op, status: 'rejected', reason: 'stale' });
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op: low.op, status: 'rejected', reason: 'stale' });
    expect(g.dispatched).toEqual([]);
    const ok = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(ok, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: ok.op, status: 'applied' });
  });

  it('a challenge prepared for one OMP dialog does not verify for another dialog with the same content', async () => {
    const { g, auth } = await enrolled();
    const A: Pending = { ...RPC, requestId: 'dlg-1' };
    g.sessions.set('r', mk('r', { state: 'waiting_permission', pending: { ...A } }));
    const challenge = await challengeFor(g, 'r', A);
    g.sessions.set('r', mk('r', { state: 'waiting_permission', pending: { ...RPC, requestId: 'dlg-2' } }));
    const m = { type: 'session.reply', op: randomUUID(), id: 'r', text: '1', expect: seen(A) };
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.dispatched).toEqual([]);
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

describe('phone gateway: OMP requests answered with their own questions', () => {
  const ASK: Pending = {
    kind: 'question', text: 'Two questions', source: 'rpc', tool: 'omp', requestId: 'ask-2',
    questions: [
      { id: 'q1', question: 'Which colour?', options: [{ label: 'red' }, { label: 'green' }] },
      { id: 'q2', question: 'Which size?', multi: true, options: [{ label: 'S' }, { label: 'M' }] }
    ]
  };
  const omp = () => {
    const g = setup();
    g.sessions.set('o', mk('o', { tool: 'omp', tmuxSession: null, backend: 'omp-rpc', state: 'waiting_input', pending: { ...ASK } }));
    return g;
  };
  const answer = (extra: Record<string, unknown> = {}) => ({
    type: 'session.answer', op: randomUUID(), id: 'o', requestId: 'ask-2',
    answers: [{ id: 'q1', selected: ['red'] }, { id: 'q2', selected: ['S', 'M'], text: 'and XL' }],
    expect: { kind: ASK.kind, text: ASK.text, key: pendingKey(ASK) }, ...extra
  });
  const final = (g: ReturnType<typeof setup>) => g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received');

  it('the snapshot announces what each tool can do', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.capabilities.omp).toEqual({ freeTextAnswer: false, decide: false, questions: true });
    expect(snap?.type === 'snapshot' && snap.capabilities.claude).toMatchObject({ decide: true, questions: false });
  });

  it('an answer to the ask of 2 questions reaches the local front, with no field of the phone added', async () => {
    const g = omp();
    const m = answer({ cancel: true });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'applied' }]);
    expect(g.dispatched).toEqual([{ type: 'session.answer', id: 'o', requestId: 'ask-2', answers: m.answers, cancel: true }]);
    const plain = answer();
    g.send('dev1', plain);
    await flush();
    expect(g.dispatched[1]).toEqual({ type: 'session.answer', id: 'o', requestId: 'ask-2', answers: plain.answers });
    expect(Object.keys(g.dispatched[1]!).sort()).toEqual(['answers', 'id', 'requestId', 'type']);
  });

  it('the requestId of an earlier ask is stale', async () => {
    const g = omp();
    const m = answer({ requestId: 'ask-1' });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' }]);
    expect(g.dispatched).toEqual([]);
  });

  it('an answer to a request that changed is stale', async () => {
    const g = omp();
    const m = answer({ expect: { kind: ASK.kind, text: ASK.text, key: 'k-old' } });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' }]);
    expect(g.dispatched).toEqual([]);
  });

  it('an answer to a session that is not OMP is not offered', async () => {
    const g = setup();
    const m = answer({ id: 'q', expect: seen(PICK) });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'not_offered' }]);
    expect(g.dispatched).toEqual([]);
  });

  it('an answer to an unknown session is refused as such', async () => {
    const g = omp();
    const m = answer({ id: 'nope' });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'unknown_session' }]);
  });

  it('an accept on an OMP session is not offered, never confirm_required, and spends no challenge', async () => {
    const g = omp();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const m = { type: 'session.decide', op: randomUUID(), id: 'o', decision: 'accept', expect: { kind: ASK.kind, text: ASK.text, key: pendingKey(ASK) } };
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'not_offered' }]);
    expect(g.dispatched).toEqual([]);
  });
});

describe('phone gateway: device.forget', () => {
  it('answers applied first, then revokes the device', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', { type: 'device.forget', op });
    await flush();
    expect(g.results('dev1').map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied']);
    expect(g.fm.revoked).toEqual([{ id: 'dev1', sentBefore: 2 }]);
    expect(g.fm.mobile.state().devices.map(d => d.id)).toEqual(['dev2']);
    expect(g.dispatched).toEqual([]);
  });

  it('a resend of the same op raises nothing and revokes once', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', { type: 'device.forget', op });
    await flush();
    g.send('dev1', { type: 'device.forget', op });
    await flush();
    expect(g.fm.revoked).toHaveLength(1);
    expect(g.got('dev1').some(m => m.type === 'error')).toBe(false);
  });
});

describe('phone gateway: push', () => {
  const KEYS = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
  const sub = (op: string, endpoint = ENDPOINT, key = 'K1') => ({ type: 'push.subscribe', op, subscription: { endpoint, keys: KEYS }, key: key.padEnd(87, 'k') });
  const pushOf = (g: ReturnType<typeof setup>, d: string) => {
    const snaps = g.got(d).filter(m => m.type === 'snapshot');
    return snaps.length ? (snaps[snaps.length - 1] as { device?: { push?: string } }).device?.push : undefined;
  };

  it('push.subscribe is applied and the next snapshot says on; push.unsubscribe says off', async () => {
    const g = setup();
    g.fm.setRelayKey('K1'.padEnd(87, 'k'));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('off');
    const op = randomUUID();
    g.send('dev1', sub(op));
    await flush();
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received', 'applied']);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('on');
    expect(g.fm.pushes.get('dev1')).toMatchObject({ endpoint: ENDPOINT, p256dh: KEYS.p256dh, auth: KEYS.auth });
    g.send('dev1', { type: 'push.unsubscribe', op: randomUUID() });
    await flush();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('off');
  });

  it('an endpoint off the list is rejected invalid and nothing is stored', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', sub(op, 'https://evil.example.com/x'));
    await flush();
    expect(g.results('dev1')).toEqual([{ type: 'operation.result', op, status: 'rejected', reason: 'invalid' }]);
    expect(g.fm.pushes.size).toBe(0);
  });

  it('the status is unavailable without push on the relay and stale when the relay key changed', async () => {
    const g = setup();
    g.send('dev1', sub(randomUUID(), ENDPOINT, 'K1'));
    await flush();
    g.fm.setRelayKey('K1'.padEnd(87, 'k'));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('on');
    g.fm.setRelayKey('K2');
    await flush();
    expect(pushOf(g, 'dev1')).toBe('stale');
    g.fm.setRelayKey(null);
    await flush();
    expect(pushOf(g, 'dev1')).toBe('unavailable');
  });

  it('a second subscription under the same op is a conflict', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', sub(op, ENDPOINT));
    await flush();
    g.send('dev1', sub(op, 'https://fcm.googleapis.com/fcm/send/other'));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'conflict' });
  });

  it('presence visible is kept until the channel falls', async () => {
    const g = setup();
    expect(g.gw.visible('dev1')).toBe(false);
    g.send('dev1', { type: 'presence', visible: true });
    expect(g.gw.visible('dev1')).toBe(true);
    expect(g.gw.visible('dev2')).toBe(false);
    g.fm.setOnline('dev1', false);
    expect(g.gw.visible('dev1')).toBe(false);
    g.fm.setOnline('dev1', true);
    expect(g.gw.visible('dev1')).toBe(false);
    g.send('dev1', { type: 'presence', visible: true });
    g.send('dev1', { type: 'presence', visible: false });
    expect(g.gw.visible('dev1')).toBe(false);
  });
});


/** Chat threads stand-in: one fake chat per device, a record of drops and emitters. */
function fakeChats() {
  const drops: string[] = [];
  const emitters = new Map<string, unknown>();
  const asked: Array<{ id: string; qid: string; tool: unknown }> = [];
  const images: unknown[] = [];
  const cancelled: Array<{ id: string; qid: string }> = [];
  const resets: string[] = [];
  const turns = new Map<string, Array<{ qid: string; question: string; askedAt: string; steps: never[]; answer?: string }>>();
  const dropping = new Set<string>();
  /** Every `device(id)`: it creates the thread when absent. */
  const touched: string[] = [];
  const gone = new Set<string>();
  const chatOf = (id: string) => ({
    async ask(qid: string, text: string, emit: (m: ServerMessage) => void, tool?: unknown, refs?: unknown) {
      asked.push({ id, qid, tool });
      images.push(refs);
      const t = { qid, question: text, askedAt: T0, steps: [] as never[], answer: `answer of ${id}` };
      turns.set(id, [...(turns.get(id) ?? []), t]);
      emit({ type: 'chat.delta', qid, text: 'ans' } as never);
      emit({ type: 'chat.done', qid, text: t.answer, at: T0 } as never);
    },
    cancel(qid: string) { cancelled.push({ id, qid }); },
    async reset(emit: (m: ServerMessage) => void) { resets.push(id); turns.set(id, []); emit({ type: 'chat.history', turns: [] } as never); },
    history: () => turns.get(id) ?? [],
    ignore(qid: string, undo: boolean) {
      const t = (turns.get(id) ?? []).find(x => x.qid === qid) as { ignoredAt?: string; actions?: unknown } | undefined;
      if (!t?.actions) return 'no card to ignore';
      if (undo) delete t.ignoredAt; else t.ignoredAt = T0;
      return null;
    }
  });
  const chats = {
    device(id: string) { touched.push(id); gone.delete(id); if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid device id'); if (dropping.has(id)) throw new Error('device thread is being dropped'); return chatOf(id) as never; },
    async deviceTool() { return 'codex' as const; },
    owner(qid: string) { for (const [id, ts] of turns) if (ts.some(t => t.qid === qid)) return `device:${id}` as const; return undefined; },
    peek(id: string) { return gone.has(id) ? undefined : chatOf(id) as never; },
    async drop(id: string) { drops.push(id); gone.add(id); turns.delete(id); },
    setEmitter(thread: string, e: unknown) { emitters.set(thread, e); }
  };
  return { chats, images, drops, emitters, asked, cancelled, resets, turns, dropping, touched };
}

describe('phone gateway: chat', () => {
  const ask = (qid: string, text = 'hello') => ({ type: 'chat.ask', qid, text });
  const Q1 = randomUUID();

  it('answers only the device that asked, with its own chat tool, and registers its emitter', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', ask(Q1));
    await flush();
    expect(c.asked).toEqual([{ id: 'dev1', qid: Q1, tool: 'codex' }]);
    expect([...c.emitters.keys()]).toEqual(['device:dev1']);
    expect(g.got('dev1').map(m => m.type)).toEqual(['chat.delta', 'chat.done']);
    expect(g.got('dev2')).toEqual([]);
    expect(g.dispatched).toEqual([]);
  });

  it('keeps a cancel to the device that owns the question', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', ask(Q1));
    await flush();
    g.send('dev2', { type: 'chat.cancel', qid: Q1 });
    await flush();
    expect(c.cancelled).toEqual([]);
    g.send('dev1', { type: 'chat.cancel', qid: Q1 });
    await flush();
    expect(c.cancelled).toEqual([{ id: 'dev1', qid: Q1 }]);
  });

  it('sends chat.history and reset results to the asking device only', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', ask(Q1, 'mine'));
    g.send('dev2', ask(randomUUID(), 'theirs'));
    await flush();
    g.send('dev1', { type: 'chat.history' });
    await flush();
    const h = g.got('dev1').filter(m => m.type === 'chat.history');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ turns: [{ qid: Q1, question: 'mine', answer: 'answer of dev1' }] });
    g.send('dev1', { type: 'chat.reset' });
    await flush();
    expect(c.resets).toEqual(['dev1']);
    expect(g.got('dev2').filter(m => m.type === 'chat.history')).toEqual([]);
  });

  it('announces the chat in the snapshot only when threads are served', async () => {
    const withChats = setup({ chats: fakeChats().chats });
    withChats.send('dev1', { type: 'snapshot.request' });
    const without = setup();
    without.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect((withChats.got('dev1')[0] as { device: unknown }).device).toMatchObject({ chat: true });
    expect((without.got('dev1')[0] as { device: object }).device).not.toHaveProperty('chat');
  });

  it('refuses without crashing when the thread cannot be reached', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    c.dropping.add('dev1');
    g.send('dev1', ask(Q1));
    g.send('dev1', { type: 'chat.history' });
    g.send('dev1', { type: 'chat.reset' });
    await flush();
    expect(g.got('dev1')).toEqual([
      { type: 'chat.error', qid: Q1, code: 'failed' },
      { type: 'error', code: 'invalid', request: 'chat.history' },
      { type: 'error', code: 'invalid', request: 'chat.reset' }
    ]);
    const bad = setup({ chats: c.chats, devices: ['../evil'] });
    bad.send('../evil', ask(Q1));
    await flush();
    expect(bad.got('../evil')).toEqual([{ type: 'chat.error', qid: Q1, code: 'failed' }]);
  });

  it('survives a thread dropped while its question ends', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    const emit = c.chats.device('dev1');
    g.send('dev1', ask(Q1));
    await flush();
    c.dropping.add('dev1');
    const e = c.emitters.get('device:dev1') as (m: unknown) => void;
    expect(() => e({ type: 'chat.done', qid: randomUUID(), text: '', at: T0 })).not.toThrow();
    void emit;
  });

  it('sends nothing to a device with no live channel, and still notifies its end', async () => {
    const c = fakeChats();
    const ends: Array<[string, unknown]> = [];
    const g = setup({ chats: c.chats, onChatEnd: (d, e) => ends.push([d, e]) });
    g.fm.setOnline('dev1', false);
    g.send('dev1', ask(Q1));
    await flush();
    expect(c.asked).toHaveLength(1);
    expect(g.got('dev1')).toEqual([]);
    expect(g.logs.filter(l => l.includes('gone'))).toEqual([]);
    expect(ends).toEqual([['dev1', { qid: Q1 }]]);
  });

  it('does not re-create a dropped thread when a late message reaches its emitter', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', ask(Q1));
    await flush();
    const e = c.emitters.get('device:dev1') as (m: unknown) => void;
    g.fm.setDevices(['dev2']);
    await flush();
    expect(c.drops).toEqual(['dev1']);
    c.touched.length = 0;
    e({ type: 'chat.done', qid: Q1, text: '', at: T0 });
    e({ type: 'chat.history', turns: [] });
    expect(c.touched).toEqual([]);
  });

  it('answers a chat message without threads with error invalid', async () => {
    const g = setup();
    g.send('dev1', { type: 'chat.history' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'error', code: 'invalid', request: 'chat.history' }]);
  });

  it('drops the thread of a revoked device, connected or not, and of a forgotten one', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', ask(Q1));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.fm.setDevices(['dev2']);
    await flush();
    expect(c.drops).toEqual(['dev1']);
    // dev2 never connected: it goes too.
    g.fm.setDevices([]);
    await flush();
    expect(c.drops).toEqual(['dev1', 'dev2']);
  });

  it('drops the thread of a device that asked and then fell offline when it is revoked', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', ask(Q1));
    await flush();
    g.fm.setOnline('dev1', false);
    g.fm.setDevices(['dev2']);
    await flush();
    expect(c.drops).toEqual(['dev1']);
  });

  it('drops the thread on device.forget', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'device.forget', op: randomUUID() });
    await new Promise(r => setTimeout(r, 50));
    expect(c.drops).toEqual(['dev1']);
  });
});

describe('phone gateway: chat cards', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const QA = randomUUID(); const QB = randomUUID(); const QPC = randomUUID();
  type Row = { project: string; tool: 'claude'; cwd: string; prompt: string; launchedId?: string; error?: string };
  const row = (cwd: string, prompt = 'do it'): Row => ({ project: 'repo', tool: 'claude', cwd, prompt });

  /** The device's thread holds QA (a card of `rows`, an instruction) and QB; the PC's QPC is not the device's. */
  function cards(rows: Row[]) {
    const c = fakeChats();
    const turn = (qid: string) => ({ qid, question: 'q', askedAt: T0, steps: [] as never[], proposals: rows, relay: { id: 'sess', name: 'bot', tool: 'claude', text: 'go on' } });
    c.turns.set('dev1', [turn(QA)] as never);
    c.turns.set('dev2', [turn(QB)] as never);
    const launches: Array<{ cwd: string; prompt?: string }> = [];
    const relays: string[] = [];
    const inFlight = new Set<string>();
    const live = (qid: string) => ({ ...(c.chats.device('dev1') as object), proposal: (_q: string, r = 0) => rows[r], markLaunched: (_q: string, id: string, _e: unknown, r = 0) => { rows[r] = { ...rows[r]!, launchedId: id }; }, markFailed: (_q: string, m: string, _e: unknown, r = 0) => { rows[r] = { ...rows[r]!, error: m }; } }) as never;
    const owner = c.chats.owner;
    c.chats.owner = (qid: string) => (qid === QPC ? 'desktop' as never : owner(qid));
    const launchChat = (_thread: string, qid: string, r?: number[]) => launchFromChat({
      chat: live(qid), emit: () => {}, inFlight,
      launch: async p => { launches.push({ cwd: p.cwd, prompt: p.prompt }); return `s${launches.length}`; },
      refuse: p => { const w = tooWide(p.cwd, '/home/me'); return w ? `the folder is ${w}` : null; }
    }, qid, r);
    return { c, rows, launches, relays, launchChat, relay: { async request(qid: string) { relays.push(qid); } } };
  }
  const enroll = async (g: ReturnType<typeof setup>) => {
    const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
    if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
    await flush();
    return auth;
  };
  const prepare = async (g: ReturnType<typeof setup>, qid: string) => {
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'launch', qid });
    await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m;
  };
  const last = (g: ReturnType<typeof setup>) => g.results('dev1').at(-1);
  const RELAYUrl = 'https://relay.test';
  const make = (rows: Row[]) => { const k = cards(rows); return { k, g: setup({ chats: k.c.chats, relay: k.relay, launchChat: k.launchChat, relayUrl: RELAYUrl }) }; };

  it('chat.relay on a turn of the device is applied; on the PC\'s or another device\'s turn unknown_session', async () => {
    const { k, g } = make([row('/w/repo')]);
    const op = randomUUID();
    g.send('dev1', { type: 'chat.relay', op, qid: QA });
    g.send('dev1', { type: 'chat.relay', op: randomUUID(), qid: QPC });
    g.send('dev1', { type: 'chat.relay', op: randomUUID(), qid: QB });
    await flush();
    expect(g.results('dev1').filter(r => r.status !== 'received').map(r => r.status === 'applied' ? 'applied' : r.reason)).toEqual(['applied', 'unknown_session', 'unknown_session']);
    expect(k.relays).toEqual([QA]);
  });

  it('chat.launch on a row of a card that is not projected is invalid, even when the targeted row is short', async () => {
    const { k, g } = make([row('/w/repo', 'short'), row('/w/other', 'x'.repeat(2049))]);
    await enroll(g);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA, rows: [0] });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(k.launches).toEqual([]);
  });

  it('chat.relay is invalid for an over-long instruction and failed when the relay throws', async () => {
    const long = make([]);
    (long.k.c.turns.get('dev1')![0] as unknown as { relay: { text: string } }).relay.text = 'x'.repeat(2049);
    long.g.send('dev1', { type: 'chat.relay', op: randomUUID(), qid: QA });
    await flush();
    expect(last(long.g)).toMatchObject({ status: 'rejected', reason: 'invalid' });
    const k = cards([]);
    const g = setup({ chats: k.c.chats, relay: { async request() { throw new Error('already sent'); } } });
    g.send('dev1', { type: 'chat.relay', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'failed' });
  });

  it('confirm.prepare launch without qid or with another thread\'s qid is invalid; with the device\'s a launch challenge', async () => {
    const { g } = make([row('/w/repo')]);
    await enroll(g);
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'launch' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'launch', qid: QB });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'launch', qid: QPC });
    await flush();
    expect(g.got('dev1').slice(before)).toEqual(Array(3).fill({ type: 'error', code: 'invalid', request: 'confirm.prepare' }));
    expect(await prepare(g, QA)).toMatchObject({ type: 'confirm.challenge', purpose: 'launch', rpId: 'relay.test' });
  });

  it('chat.launch needs an assertion: none is confirm_required, a device without credential too', async () => {
    const { k, g } = make([row('/w/repo')]);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    await enroll(g);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(k.launches).toEqual([]);
  });

  it('chat.launch with an assertion bound to its qid is applied and launches; the replay does not launch twice', async () => {
    const { k, g } = make([row('/w/repo', 'first')]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    const m = { type: 'chat.launch', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) };
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(k.launches).toEqual([{ cwd: '/w/repo', prompt: 'first' }]);
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(k.launches).toHaveLength(1);
  });

  it('an assertion bound to another qid is assertion_invalid, nothing is launched', async () => {
    const { k, g } = make([row('/w/repo')]);
    const auth = await enroll(g);
    k.c.turns.get('dev1')!.push({ qid: QB, question: 'q', askedAt: T0, steps: [] } as never);
    const other = await prepare(g, QB);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA, assertion: auth.get(rp, other.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(k.launches).toEqual([]);
  });

  it('chat.launch on the PC\'s qid is unknown_session and launches nothing', async () => {
    const { k, g } = make([row('/w/repo')]);
    await enroll(g);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QPC });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'unknown_session' });
    expect(k.launches).toEqual([]);
  });

  it('a missing or over-long row is invalid before any challenge is spent', async () => {
    const { k, g } = make([row('/w/repo', 'x'.repeat(2049))]);
    await enroll(g);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA });
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA, rows: [2] });
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['invalid', 'invalid']);
    expect(k.launches).toEqual([]);
  });

  it('a proposal in a folder too wide is failed and the card shows it', async () => {
    const { k, g } = make([row('/home/me')]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'failed' });
    expect(k.launches).toEqual([]);
    expect(k.rows[0]!.error).toBeDefined();
    expect(toPhoneTurn({ qid: QA, question: 'q', askedAt: T0, steps: [], proposals: k.rows } as never).proposals?.[0]).toMatchObject({ failed: true });
  });

  it('rows named twice are rejected invalid by the schema and launch nothing', async () => {
    const { k, g } = make([row('/w/repo')]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    const op = randomUUID();
    g.send('dev1', { type: 'chat.launch', op, qid: QA, rows: [0, 0], assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'operation.result', op, status: 'rejected', reason: 'invalid' });
    expect(k.launches).toEqual([]);
  });

  it('a card already launched is failed before the assertion is spent', async () => {
    const { k, g } = make([{ ...row('/w/repo'), launchedId: 'x' }]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.launch', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'failed' });
    expect(k.launches).toEqual([]);
    expect(g.creds.get('dev1')?.counter).toBe(0);
  });
});

describe('phone gateway: close cards', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const QA = randomUUID(); const QB = randomUUID(); const QN = randomUUID(); const QPC = randomUUID();
  type Close = { id: string; name: string; tool: 'claude'; closedAt?: string; how?: 'exit' | 'killed'; error?: string };
  const close = (id: string, extra: Partial<Close> = {}): Close => ({ id, name: `bot-${id}`, tool: 'claude', ...extra });
  const DONE = '2026-10-21T08:00:00.000Z';

  /**
   * The device's thread holds QA (a close card of `rows`) and QN (no card); dev2's QB is not the device's, nor is the PC's
   * QPC, though its card is listed with the device's turns: only its owner tells it apart.
   */
  function make(rows: Close[], result?: Awaited<ReturnType<NonNullable<Parameters<typeof createPhoneGateway>[0]['closeChat']>>> | Error) {
    const c = fakeChats();
    const turn = (qid: string, closes?: Close[]) => ({ qid, question: 'q', askedAt: T0, steps: [] as never[], ...(closes ? { closes } : {}) });
    c.turns.set('dev1', [turn(QA, rows), turn(QN), turn(QPC, rows)] as never);
    c.turns.set('dev2', [turn(QB, rows)] as never);
    const owner = c.chats.owner;
    c.chats.owner = (qid: string) => (qid === QPC ? 'desktop' as never : owner(qid));
    const calls: Array<[string, string, number[] | undefined]> = [];
    const closeChat = async (thread: string, qid: string, r?: number[]) => {
      calls.push([thread, qid, r]);
      if (result instanceof Error) throw result;
      return result ?? { closed: (r ?? []).map(row => ({ row, id: rows[row]!.id, how: 'exit' as const })), failed: [] };
    };
    const g = setup({ chats: c.chats, closeChat: closeChat as never, relayUrl: 'https://relay.test' });
    return { c, calls, g };
  }
  type G = ReturnType<typeof setup>;
  const enroll = async (g: G) => {
    const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
    if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
    await flush();
    return auth;
  };
  const prepare = async (g: G, qid: string, purpose: 'close' | 'launch' = 'close') => {
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose, qid });
    await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m;
  };
  const last = (g: G) => g.results('dev1').at(-1);

  it("closes the rows of the device's own close card after its passkey check", async () => {
    const { calls, g } = make([close('a'), close('b')]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    expect(ch).toMatchObject({ purpose: 'close', rpId: 'relay.test' });
    const m = { type: 'chat.close', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) };
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(calls).toEqual([['device:dev1', QA, [0, 1]]]);
    // The challenge is spent: the replayed assertion under a new op is refused.
    g.send('dev1', { ...m, op: randomUUID() });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(calls).toHaveLength(1);
  });

  it('passes the named rows only', async () => {
    const { calls, g } = make([close('a'), close('b')]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, rows: [1], assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
    expect(calls).toEqual([['device:dev1', QA, [1]]]);
  });

  it('refuses a close without a passkey, then without an assertion', async () => {
    const { calls, g } = make([close('a')]);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    await enroll(g);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(calls).toEqual([]);
  });

  it('refuses a launch assertion for a close of the same turn', async () => {
    const { calls, g } = make([close('a')]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA, 'launch');
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(calls).toEqual([]);
  });

  it("refuses a close of another device's turn", async () => {
    const { calls, g } = make([close('a')]);
    await enroll(g);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QB });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'unknown_session' });
    expect(calls).toEqual([]);
  });

  it("chat.close on the PC's qid is unknown_session and closes nothing", async () => {
    const { calls, g } = make([close('a')]);
    const auth = await enroll(g);
    // Even with a close assertion of the device's own turn: the PC's card is not the phone's to act on.
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QPC, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QPC, rows: [0] });
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['unknown_session', 'unknown_session']);
    expect(calls).toEqual([]);
  });

  it('refuses an unknown row, and a turn with no close card', async () => {
    const { calls, g } = make([close('a')]);
    await enroll(g);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, rows: [3] });
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QN });
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['invalid', 'invalid']);
    expect(calls).toEqual([]);
  });

  it('answers failed when every row is already closed, before it spends the assertion', async () => {
    const { calls, g } = make([close('a', { closedAt: DONE, how: 'exit' })]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'failed' });
    expect(calls).toEqual([]);
    expect(g.creds.get('dev1')?.counter).toBe(0);
  });

  it('answers failed when no row closed, and when the close is refused', async () => {
    for (const result of [{ closed: [], failed: [{ row: 0, message: 'busy' }] }, new CloseRefused('already closed')]) {
      const { calls, g } = make([close('a')], result);
      const auth = await enroll(g);
      const ch = await prepare(g, QA);
      g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
      await flush();
      expect(last(g)).toMatchObject({ status: 'failed' });
      expect(calls).toHaveLength(1);
    }
  });

  it('is applied when every row left is already being closed, as after a reload mid-close', async () => {
    const { calls, g } = make([close('a'), close('b', { closedAt: DONE, how: 'exit' })], new CloseRefused('already closed', true));
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
    expect(calls).toHaveLength(1);
  });

  it('is applied when at least one row closed', async () => {
    const { g } = make([close('a'), close('b')], { closed: [{ row: 1, id: 'b', how: 'killed' }], failed: [{ row: 0, message: 'x' }] });
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.close', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
  });

  it("prepares a close challenge only for the device's own turn", async () => {
    const { g } = make([close('a')]);
    await enroll(g);
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'close' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'close', qid: QB });
    await flush();
    expect(g.got('dev1').slice(before)).toEqual(Array(2).fill({ type: 'error', code: 'invalid', request: 'confirm.prepare' }));
    expect(await prepare(g, QA)).toMatchObject({ type: 'confirm.challenge', purpose: 'close' });
  });

  it('answers an invalid chat.close from an approved device with rejected', async () => {
    const { calls, g } = make([close('a')]);
    await enroll(g);
    const op = randomUUID();
    g.send('dev1', { type: 'chat.close', op, qid: QA, rows: [1, 1] });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'operation.result', op, status: 'rejected', reason: 'invalid' });
    expect(calls).toEqual([]);
  });
});

describe('phone gateway: generic cards (spec 2026-10-26 action registry §9)', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const QA = randomUUID(); const QPC = randomUUID();
  type Row = { action: string; args: Record<string, unknown>; summary: string; risk: 'reversible' | 'destructive'; state?: 'done'; detail?: string; detailCut?: true };
  const archive: Row = { action: 'session.archive', args: { session: 'a' }, summary: 'Archiver **A**', risk: 'reversible' };
  const resume: Row = { action: 'session.resume', args: { session: 'b' }, summary: 'Reprendre **B**', risk: 'reversible' };
  const dissolve: Row = { action: 'team.dissolve', args: { team: 't' }, summary: 'Dissoudre **T**', risk: 'destructive' };

  function make(rows: Row[], result?: { done: number[]; failed: Array<{ row: number; message: string }> } | Error) {
    const c = fakeChats(); turnsOf = c.turns;
    const turn = (qid: string) => ({ qid, question: 'q', askedAt: T0, steps: [] as never[], actions: rows });
    c.turns.set('dev1', [turn(QA), turn(QPC)] as never);
    const owner = c.chats.owner;
    c.chats.owner = (qid: string) => (qid === QPC ? 'desktop' as never : owner(qid));
    const calls: Array<[string, string, number[] | undefined, true | undefined]> = [];
    const actChat = async (thread: string, qid: string, _rid: string, r?: number[], confirmed?: true, deny?: true) => {
      calls.push([thread, qid, r, confirmed, ...(deny ? [deny] : [])] as never);
      if (result instanceof Error) throw result;
      return result ?? { done: r ?? [], failed: [] };
    };
    const g = setup({ chats: c.chats, actChat: actChat as never, relayUrl: 'https://relay.test' });
    return { calls, g };
  }
  type G = ReturnType<typeof setup>;
  const enroll = async (g: G) => {
    const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
    if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
    await flush();
    return auth;
  };
  const prepare = async (g: G, qid: string) => {
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'act', qid });
    await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m;
  };
  const last = (g: G) => g.results('dev1').at(-1);
  let turnsOf: ReturnType<typeof fakeChats>['turns'];

  it('« Ignorer » sets the device\'s turn aside, « Revoir » opens it again; an ignored card applies no more', async () => {
    const { calls, g } = make([archive]);
    const ignore = { type: 'chat.ignore', op: randomUUID(), qid: QA };
    g.send('dev1', ignore);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: ignore.op, status: 'applied' });
    expect((turnsOf.get('dev1')![0] as { ignoredAt?: string }).ignoredAt).toBe(T0);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(calls).toEqual([]);
    g.send('dev1', { type: 'chat.ignore', op: randomUUID(), qid: QA, undo: true });
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
    // The PC's card is not the phone's to set aside.
    g.send('dev1', { type: 'chat.ignore', op: randomUUID(), qid: QPC });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'unknown_session' });
  });
  it('a row whose request the phone only saw cut is refused there, never accepted', async () => {
    const accept: Row = { action: 'session.decide', args: { session: 'a', decision: 'accept' }, summary: 'Accepter', risk: 'reversible', detail: 'x'.repeat(3000) };
    const deny: Row = { ...accept, args: { session: 'a', decision: 'deny' }, summary: 'Refuser', detail: 'x…', detailCut: true };
    const one = make([accept]);
    one.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(last(one.g)).toMatchObject({ status: 'rejected', reason: 'not_offered' });
    expect(one.calls).toEqual([]);
    const two = make([deny]);
    two.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    // A deny goes on to its usual check (the passkey, here).
    expect(last(two.g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
  });

  it('« Refuser » a request: no passkey, no confirmation, and allowed on a request shown cut; only on a request', async () => {
    const accept: Row = { action: 'session.decide', args: { session: 'a', decision: 'accept' }, summary: 'Accepter', risk: 'destructive', detail: 'x'.repeat(3000) };
    const { calls, g } = make([accept]);
    const m = { type: 'chat.act', op: randomUUID(), qid: QA, deny: true };
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(calls).toEqual([['device:dev1', QA, [0], undefined, true]]);
    // As on the PC, only the rows still open count: a row already done does not stop « Refuser ».
    const mixed = make([{ ...dissolve, state: 'done' }, { ...accept, detail: 'Bash: rm' }]);
    mixed.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, deny: true });
    await flush();
    expect(last(mixed.g)).toMatchObject({ status: 'applied' });
    expect(mixed.calls).toEqual([['device:dev1', QA, [1], undefined, true]]);
    const other = make([dissolve]);
    other.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, deny: true });
    await flush();
    expect(last(other.g)).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(other.calls).toEqual([]);
  });

  it('applies rows with no device check without a passkey', async () => {
    const { calls, g } = make([archive]);
    const m = { type: 'chat.act', op: randomUUID(), qid: QA };
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(calls).toEqual([['device:dev1', QA, [0], undefined]]);
  });
  it('asks the passkey for a row the registry checks, bound to the turn and spent once', async () => {
    const { calls, g } = make([archive, resume]);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    expect(ch).toMatchObject({ purpose: 'act' });
    const m = { type: 'chat.act', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) };
    g.send('dev1', m);
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
    g.send('dev1', { ...m, op: randomUUID() });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(calls).toHaveLength(1);
  });
  it('a destructive row needs the confirmation and the passkey', async () => {
    const { calls, g } = make([dissolve]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const ch2 = await prepare(g, QA);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, confirmed: true, assertion: auth.get(rp, ch2.challenge, { counter: 2 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
    expect(calls).toEqual([['device:dev1', QA, [0], true]]);
  });
  it('a row destructive by its args (a template replaced) needs the passkey too, though its action names no device check (Max)', async () => {
    const save: Row = { action: 'team.save', args: { team: 't', name: 'existing', seats: [{ role: 'back' }] }, summary: 'Remplacer le modèle', risk: 'destructive' };
    const { calls, g } = make([save]);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, confirmed: true });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(calls).toEqual([]);
    const auth = await enroll(g);
    const ch = await prepare(g, QA);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, confirmed: true, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied' });
    expect(calls).toEqual([['device:dev1', QA, [0], true]]);
  });
  it('passes the done rows over, and answers failed when none is left or one failed', async () => {
    const one = make([{ ...archive, state: 'done' }, archive]);
    one.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(one.calls).toEqual([['device:dev1', QA, [1], undefined]]);
    const none = make([{ ...archive, state: 'done' }]);
    none.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(last(none.g)).toMatchObject({ status: 'failed' });
    expect(none.calls).toEqual([]);
    const failing = make([archive], { done: [], failed: [{ row: 0, message: 'busy' }] });
    failing.g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA });
    await flush();
    expect(last(failing.g)).toMatchObject({ status: 'failed' });
  });
  it("refuses an unknown row, and the PC's card", async () => {
    const { calls, g } = make([archive]);
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QA, rows: [3] });
    g.send('dev1', { type: 'chat.act', op: randomUUID(), qid: QPC });
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['invalid', 'unknown_session']);
    expect(calls).toEqual([]);
  });
});

describe('phone gateway: teams and Ledge\'s tasks (ledge home spec §2.4)', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const team = (extra: Partial<Team> = {}): Team => ({ id: 'team-a1b2', name: 'repo-roles', project: 'repo', machine: 'local', cwd: '/w/repo', state: 'active', seats: [{ role: 'build', sessionId: 'a' }, { role: 'qa', sessionId: null }], createdAt: T0, updatedAt: T0, ...extra });
  const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'a', ownerName: 'a', team: 'team-a1b2', state: 'taken', at: T0, updatedAt: new Date().toISOString(), log: [], ...extra });

  it('after a snapshot, the teams (not the dissolved) with Ledge\'s progress, and Ledge\'s tasks only', async () => {
    const tasks = [task('t000001', { state: 'done', result: 'fait' }), task('t000002'), task('t000003', { giver: 'b', giverName: 'b' })];
    const g = setup({ teams: () => [team(), team({ id: 'team-dead', state: 'dissolved' })], tasks: () => tasks });
    g.sessions.set('a', { ...g.sessions.get('a')!, role: 'build', team: 'team-a1b2' });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const got = g.got('dev1');
    for (const m of got) expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    expect(got.find(m => m.type === 'teams')).toEqual({ type: 'teams', teams: [{ id: 'team-a1b2', name: 'repo-roles', project: 'Repo', state: 'active', seats: [{ role: 'build', sessionId: 'a' }, { role: 'qa', sessionId: null }], createdAt: '2026-10-20T08:00:00.000Z', done: 1, given: 2 }] });
    const listed = got.find(m => m.type === 'tasks');
    expect(listed?.type === 'tasks' && listed.tasks.map(x => [x.id, x.ownerRole, x.teamName, x.result])).toEqual([['t000001', 'build', 'repo-roles', 'fait'], ['t000002', 'build', 'repo-roles', undefined]]);
    const snap = got.find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.sessions.find(x => x.id === 'a')).toMatchObject({ role: 'build', team: 'team-a1b2' });
  });

  it('a daemon without teams sends neither', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1').some(m => m.type === 'teams' || m.type === 'tasks')).toBe(false);
  });

  it('team.resume and task.seen are dispatched; their answers make the outcome', async () => {
    const g = setup({ teams: () => [team()], tasks: () => [], dispatch: async (msg, reply) => {
      if (msg.type === 'task.cmd') reply(msg.task === 't000001' ? { type: 'task.result', rid: msg.rid, task: task('t000001', { seen: true }) } as ServerMessage : { type: 'task.result', rid: msg.rid, reason: 'unknown' } as ServerMessage);
    } });
    g.send('dev1', { type: 'team.resume', op: randomUUID(), team: 'team-a1b2' });
    g.send('dev1', { type: 'task.seen', op: randomUUID(), task: 't000001' });
    g.send('dev1', { type: 'task.seen', op: randomUUID(), task: 't0000ff' });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'team.resume', team: 'team-a1b2' }, expect.objectContaining({ type: 'task.cmd', by: 'ledge', op: 'seen', task: 't000001' }), expect.objectContaining({ type: 'task.cmd', task: 't0000ff' })]);
    expect(g.results('dev1').filter(r => r.status !== 'received').map(r => r.status)).toEqual(['applied', 'applied', 'failed']);
  });

  it('chat.team needs the device\'s check over its own turn; then team.launch with the qid, its outcome from team.launched', async () => {
    const c = fakeChats();
    const QA = randomUUID();
    const card = { cwd: '/w/repo', project: 'repo', projectName: 'Repo', name: 'repo-roles', seats: [{ role: 'build', label: 'Build', tool: 'claude', autonomy: 'edits' }] };
    c.turns.set('dev1', [{ qid: QA, question: 'q', askedAt: T0, steps: [], team: card, tasks: [{ to: '@build', title: 'Implémenter' }] } as never]);
    const g = setup({ chats: c.chats, relayUrl: 'https://relay.test', teams: () => [], tasks: () => [], dispatch: async (msg, reply) => {
      if (msg.type === 'team.launch') reply({ type: 'team.launched', rid: msg.rid, team: team() });
      if (msg.type === 'task.cmd') reply({ type: 'task.result', rid: msg.rid, task: task('t91b0d4') } as ServerMessage);
    } });
    g.send('dev1', { type: 'chat.team', op: randomUUID(), qid: QA });
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
    if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
    await flush();
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'launch', qid: QA });
    await flush();
    const ch = g.got('dev1').slice(before).find(m => m.type === 'confirm.challenge');
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    const op = randomUUID();
    g.send('dev1', { type: 'chat.team', op, qid: QA, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op, status: 'applied' });
    expect(g.dispatched).toContainEqual({ type: 'team.launch', rid: op, qid: QA });
    // The task card: given by Ledge, no device check needed (it only gives work to a seat already launched).
    g.send('dev1', { type: 'chat.task', op: randomUUID(), qid: QA, row: 0 });
    g.send('dev1', { type: 'chat.task', op: randomUUID(), qid: QA, row: 3 });
    await flush();
    expect(g.dispatched).toContainEqual(expect.objectContaining({ type: 'task.cmd', by: 'ledge', op: 'give', qid: QA, row: 0 }));
    expect(g.results('dev1').filter(r => r.status !== 'received').slice(-2).map(r => r.status === 'rejected' ? r.reason : r.status).sort()).toEqual(['applied', 'unknown_session']);
  });

  it('team.updated and task.updated reach the following devices; another giver\'s task does not', async () => {
    let forward: ((m: ServerMessage) => void) | undefined;
    const tasks: Task[] = [];
    const g = setup({ teams: () => [team()], tasks: () => tasks });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    forward = (m: ServerMessage) => g.gw.forward(m);
    const before = g.got('dev1').length;
    forward({ type: 'team.updated', team: team({ state: 'resting' }) });
    forward({ type: 'task.updated', task: task('t000004', { giver: 'b', giverName: 'b', team: undefined }) });
    tasks.push(task('t000005'));
    forward({ type: 'task.updated', task: task('t000005') });
    await flush();
    const after = g.got('dev1').slice(before).map(m => m.type);
    expect(after).toEqual(['teams', 'task.updated', 'teams']);
  });
});

const u32 = (n: number) => Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const png = (w: number, h: number, size = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(Math.max(0, size - 29), 7)]);
const ATTACH_FULL = ATTACHMENT_MAX;
/** Waits for the store's file writes: `flush` only spins the event loop. */
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
const put = (requestId: string, image: Buffer, preview?: Buffer) => ({
  type: 'attachment.put', requestId,
  image: { mime: 'image/png', data: image.toString('base64'), ...(preview ? { preview: { mime: 'image/png', data: preview.toString('base64') } } : {}) }
});

describe('phone gateway: images', () => {
  it('refuses a 400 001-byte put with too_large', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(100, 100, ATTACHMENT_MAX + 1)));
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'attachment.error', requestId: 'r1', reason: 'too_large' }]);
  });

  it('stores a 400 000-byte image with a 40 000-byte preview, and the answer fits the transport', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(1600, 1200, ATTACH_FULL), png(480, 360, PREVIEW_MAX)));
    await until(() => g.got('dev1').length > 0);
    const [m] = g.got('dev1');
    expect(m).toMatchObject({ type: 'attachment.stored', requestId: 'r1', ref: { mime: 'image/png', width: 1600, height: 1200, bytes: ATTACHMENT_MAX, preview: true } });
    expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    // Sent as a stored answer, not the outbox's too_large error: the frame passed `padPlain`.
    expect(padPlain(g.fm.sent[0]![1].trimEnd())).not.toBeNull();
  });

  it('the largest attachment.data frame (a 400 000-byte image) passes the transport frame cap', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(1600, 1200, ATTACHMENT_MAX)));
    await until(() => g.got('dev1').length > 0);
    const id = (g.got('dev1')[0] as { ref: { id: string } }).ref.id;
    g.send('dev1', { type: 'attachment.get', requestId: 'r2', attachment: id });
    await until(() => g.got('dev1').length > 1);
    const frame = g.fm.sent[1]![1].trimEnd();
    expect(JSON.parse(frame)).toMatchObject({ type: 'attachment.data', requestId: 'r2' });
    expect(padPlain(frame)).not.toBeNull();
    expect(Buffer.byteLength(frame)).toBeLessThan(PLAIN_MAX);
  });

  it('answers a get with the bytes, the preview on request, and not_found for an unknown id', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(10, 10, 100), png(5, 5, 60)));
    await until(() => g.got('dev1').length > 0);
    const ref = (g.got('dev1')[0] as { ref: { id: string } }).ref;
    g.send('dev1', { type: 'attachment.get', requestId: 'r2', attachment: ref.id });
    g.send('dev1', { type: 'attachment.get', requestId: 'r3', attachment: ref.id, preview: true });
    g.send('dev1', { type: 'attachment.get', requestId: 'r4', attachment: 'a'.repeat(64) });
    await until(() => g.got('dev1').length >= 4);
    const byId = (r: string) => (g.got('dev1') as Array<Record<string, unknown>>).find(m => m.requestId === r);
    const full = byId('r2'), small = byId('r3'), missing = byId('r4');
    expect(full).toMatchObject({ type: 'attachment.data', requestId: 'r2', attachment: ref.id, mime: 'image/png' });
    expect(Buffer.from(full!.data as string, 'base64')).toHaveLength(100);
    expect(Buffer.from(small!.data as string, 'base64')).toHaveLength(60);
    expect(missing).toEqual({ type: 'attachment.error', requestId: 'r4', reason: 'not_found' });
  });

  it('a device that is not approved gets nothing', async () => {
    const g = setup({ devices: ['dev1'] });
    g.send('stranger', put('r1', png(10, 10, 100)));
    await flush();
    expect(g.got('stranger')).toEqual([]);
  });

  it('dispatches a reply with images and no text', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(10, 10, 100)));
    await until(() => g.got('dev1').length > 0);
    const id = (g.got('dev1')[0] as { ref: { id: string } }).ref.id;
    g.send('dev1', { type: 'session.reply', op: randomUUID(), id: 'c', text: '', attachments: [id], expect: null });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'c', text: '', attachments: [id] }]);
  });

  it('refuses an empty reply with no images as invalid, dispatching nothing', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'c', text: '', expect: null };
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'invalid' });
    expect(g.dispatched).toEqual([]);
  });

  it('reports a daemon refusal of the images as that reason', async () => {
    const g = setup({ dispatch: async (msg, reply) => { reply({ type: 'error', message: 'no', request: msg.type, code: 'attachments_not_accepted' }); } });
    const m = { type: 'session.reply', op: randomUUID(), id: 'c', text: 'hi', attachments: ['a'.repeat(64)], expect: null };
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'attachments_not_accepted' });
  });

  it('resolves a chat question\'s image ids to refs; a missing id fails the question', async () => {
    const c = fakeChats();
    const g = setup({ chats: c.chats });
    g.send('dev1', put('r1', png(10, 10, 100)));
    await until(() => g.got('dev1').length > 0);
    const ref = (g.got('dev1')[0] as { ref: unknown }).ref as { id: string };
    const q1 = randomUUID(), q2 = randomUUID();
    g.send('dev1', { type: 'chat.ask', qid: q1, text: '', attachments: [ref.id] });
    g.send('dev1', { type: 'chat.ask', qid: q2, text: 'x', attachments: ['b'.repeat(64)] });
    await flush();
    expect(c.images).toEqual([[ref]]);
    expect(g.got('dev1')).toContainEqual({ type: 'chat.error', qid: q2, code: 'failed' });
  });
});
