import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, type PhoneServerMessage } from '@ledge/protocol';
import type { ControlProcess } from '../src/mobile/terminal.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { T1, mk, flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Control clients that answer like tmux, and record what they were told. */
function fakeTmux() {
  const procs: Array<{ argv: string[]; written: string[]; emit(s: string): void; killed: boolean }> = [];
  const spawn = (argv: string[]): ControlProcess => {
    let onData: (b: Buffer) => void = () => {};
    let n = 0;
    const reply = (lines: string[]) => { n++; setTimeout(() => onData(Buffer.from(`%begin 1 ${n} 1\n${lines.map(l => `${l}\n`).join('')}%end 1 ${n} 1\n`)), 0); };
    const rec = { argv, written: [] as string[], emit: (s: string) => onData(Buffer.from(s)), killed: false };
    procs.push(rec);
    return {
      write(text) {
        rec.written.push(text.trimEnd());
        if (text.startsWith('display-message')) reply(['%0 200 50 0 1']);
        else if (text.startsWith('capture-pane')) reply(['$ claude']);
        else reply([]);
      },
      kill() { rec.killed = true; },
      onData(fn) { onData = fn; setTimeout(() => fn(Buffer.from('%begin 0 0 0\n%end 0 0 0\n')), 0); },
      onExit() {}
    };
  };
  return { spawn, procs };
}

function make(o: { input?: boolean; terminal?: false } = {}) {
  const tmux = fakeTmux();
  const setting = { input: o.input ?? true };
  const typing = new Set<string>();
  const holders: Array<[string, string | null]> = [];
  const g = setup({
    relayUrl: 'https://relay.test',
    deps: o.terminal === false ? {} : {
      terminal: { controlArgs: n => ['-C', 'attach-session', '-t', `=${n}`, '-f', 'ignore-size,read-only'], inputAllowed: () => setting.input, typing, spawn: tmux.spawn, onHolder: (s, d) => holders.push([s, d]) }
    }
  });
  return { g, tmux, setting, typing, holders };
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
let counter = 0;
const challenge = async (g: G, id: string, purpose = 'terminal') => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose, id });
  await flush();
  return g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
};
const of = <T extends PhoneServerMessage['type']>(g: G, type: T) => g.got('dev1').filter(m => m.type === type) as Array<Extract<PhoneServerMessage, { type: T }>>;
const open = async (g: G, id = 'a') => {
  const op = randomUUID();
  g.send('dev1', { type: 'term.open', op, id });
  await wait(20);
  return { op, opened: of(g, 'term.opened').at(-1) };
};
const hold = async (g: G, auth: ReturnType<typeof softAuthenticator>, tid: string, id = 'a') => {
  const ch = await challenge(g, id);
  if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
  const op = randomUUID();
  g.send('dev1', { type: 'term.hold', op, tid, assertion: auth.get(rp, ch.challenge, { counter: ++counter }) });
  await flush();
  return g.results('dev1').filter(r => r.type === 'operation.result' && r.op === op).at(-1);
};

describe('phone gateway: the agent\'s terminal', () => {
  it('says so in the snapshot, typing only while the PC allows it', async () => {
    const on = make();
    const ro = make({ input: false });
    const off = make({ terminal: false });
    for (const { g } of [on, ro, off]) g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const daemon = (g: G) => { const s = PhoneServerMessageSchema.parse(g.got('dev1')[0]); return s.type === 'snapshot' ? s.daemon : null; };
    expect(daemon(on.g)).toMatchObject({ terminal: true, terminalInput: true });
    expect(daemon(ro.g)).toMatchObject({ terminal: true });
    expect(daemon(ro.g)).not.toHaveProperty('terminalInput');
    expect(daemon(off.g)).not.toHaveProperty('terminal');
  });

  it('opens a read-only stream with no passkey, on the session\'s own tmux, then streams its output', async () => {
    const { g, tmux } = make();
    const { op, opened } = await open(g);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op, status: 'applied' });
    expect(tmux.procs[0]!.argv).toEqual(['-C', 'attach-session', '-t', '=ledge-a', '-f', 'ignore-size,read-only']);
    expect(opened).toMatchObject({ op, id: 'a', cols: 200, rows: 50, screen: '$ claude', seq: 0 });
    tmux.procs[0]!.emit('%output %0 hello\n');
    await wait(150);
    expect(of(g, 'term.output')).toEqual([{ type: 'term.output', tid: opened!.tid, seq: 0, data: 'hello' }]);
  });

  it('a subagent\'s terminal is its parent\'s pane, read-only for good; an unknown subagent is refused', async () => {
    counter = 0;
    const { g, tmux } = make();
    const auth = await enroll(g);
    g.sessions.set('a', mk('a', { helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }] }));
    const op = randomUUID();
    g.send('dev1', { type: 'term.open', op, id: 'a', helper: 'h1' });
    await wait(20);
    const opened = of(g, 'term.opened').at(-1);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op, status: 'applied' });
    expect(tmux.procs[0]!.argv).toEqual(['-C', 'attach-session', '-t', '=ledge-a', '-f', 'ignore-size,read-only']);
    expect(opened).toMatchObject({ op, id: 'a', readOnly: true });
    // « Prendre la main » is refused even with a passkey made for the session.
    expect(await hold(g, auth, opened!.tid)).toMatchObject({ status: 'rejected', reason: 'read_only' });
    // The parent's own page is not read-only.
    expect((await open(g)).opened).not.toHaveProperty('readOnly');
    const other = randomUUID();
    g.send('dev1', { type: 'term.open', op: other, id: 'a', helper: 'gone' });
    await flush();
    expect(g.results('dev1').find(x => x.type === 'operation.result' && x.op === other && x.status !== 'received')).toMatchObject({ status: 'rejected', reason: 'unknown_session' });
  });

  it('refuses a session started outside Ledge, an OpenRig seat, one with no pane, one ended, and an unknown one', async () => {
    const { g, tmux } = make();
    g.sessions.set('h', mk('h', { source: 'hook_only' }));
    // A seat now has a control client on its own server for Desktop; the phone still refuses it before asking for one.
    g.sessions.set('r', mk('r', { source: 'rig', tmuxSession: 'dev-build@starter', rig: { seat: 'dev-build@starter', name: 'starter' } }));
    g.sessions.set('x', mk('x', { state: 'exited', exitedAt: T1 }));
    const reasons: unknown[] = [];
    for (const id of ['h', 'r', 'c', 'x', 'zz']) {
      const op = randomUUID();
      g.send('dev1', { type: 'term.open', op, id });
      await flush();
      const r = g.results('dev1').find(x => x.type === 'operation.result' && x.op === op && x.status === 'rejected');
      reasons.push(r?.type === 'operation.result' ? r.reason : null);
    }
    expect(reasons).toEqual(['read_only', 'read_only', 'unavailable', 'unavailable', 'unknown_session']);
    expect(tmux.procs).toEqual([]);
  });

  it('types only after a passkey made for that session, and only while held', async () => {
    counter = 0;
    const { g, tmux, holders } = make();
    const auth = await enroll(g);
    const { opened } = await open(g);
    const tid = opened!.tid;
    const keys = () => tmux.procs[0]!.written.filter(w => w.startsWith('send-keys'));
    g.send('dev1', { type: 'term.input', tid, n: 0, data: 'rm -rf /\r' });
    await wait(20);
    expect(keys()).toEqual([]);
    // No assertion, then one made for another session, then one made for a close.
    const bare = randomUUID();
    g.send('dev1', { type: 'term.hold', op: bare, tid });
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op: bare, status: 'rejected', reason: 'confirm_required' });
    const other = await challenge(g, 'b');
    if (other?.type !== 'confirm.challenge') throw new Error('no challenge');
    const wrong = randomUUID();
    g.send('dev1', { type: 'term.hold', op: wrong, tid, assertion: auth.get(rp, other.challenge, { counter: ++counter }) });
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op: wrong, status: 'rejected', reason: 'assertion_invalid' });
    const close = await challenge(g, 'a', 'close');
    expect(close).toBeUndefined();
    expect(await hold(g, auth, tid)).toMatchObject({ status: 'applied' });
    expect(of(g, 'term.held')).toHaveLength(1);
    expect(holders).toEqual([['a', 'dev1']]);
    expect(g.gw.terminalHolder('a')).toBe('dev1');
    g.send('dev1', { type: 'term.input', tid, n: 0, data: '/help\r' });
    await wait(20);
    expect(keys()).toEqual(['send-keys -t %0 -H 2f 68 65 6c 70 0d']);
  });

  it('gives no terminal challenge, and takes no hold, while the PC does not allow typing', async () => {
    counter = 0;
    const { g, setting } = make();
    const auth = await enroll(g);
    const { opened } = await open(g);
    setting.input = false;
    expect(await challenge(g, 'a')).toBeUndefined();
    const op = randomUUID();
    g.send('dev1', { type: 'term.hold', op, tid: opened!.tid, assertion: auth.get(rp, 'never-issued', { counter: ++counter }) });
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'rejected', reason: 'unavailable' });
  });

  it('takes the hand back when the app goes to the background, from the PC, and when the setting is turned off', async () => {
    counter = 0;
    const { g, setting } = make();
    const auth = await enroll(g);
    g.send('dev1', { type: 'snapshot.request' });
    const { opened } = await open(g);
    const tid = opened!.tid;
    await hold(g, auth, tid);
    g.send('dev1', { type: 'presence', visible: false });
    await flush();
    await hold(g, auth, tid);
    g.gw.terminalRelease('a');
    await flush();
    await hold(g, auth, tid);
    setting.input = false;
    g.gw.terminalInputChanged();
    await flush();
    expect(of(g, 'term.released').map(m => m.why)).toEqual(['background', 'pc', 'pc']);
    const last = of(g, 'snapshot').at(-1);
    expect(last?.daemon).not.toHaveProperty('terminalInput');
  });

  it('ends the terminal when its session ends, and when the device is gone', async () => {
    const { g, tmux } = make();
    g.send('dev1', { type: 'snapshot.request' });
    const { opened } = await open(g);
    g.gw.forward({ type: 'session.updated', session: mk('a', { state: 'exited', exitedAt: T1 }) });
    await flush();
    expect(of(g, 'term.exit')).toEqual([{ type: 'term.exit', tid: opened!.tid, why: 'ended' }]);
    expect(tmux.procs[0]!.killed).toBe(true);
    await open(g, 'b');
    g.gw.stop();
    expect(tmux.procs[1]!.killed).toBe(true);
  });
});
