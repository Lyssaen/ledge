import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Store } from '../src/daemon/store.js';
import { ONE_AT_A_TIME, TOO_MANY, type ChatMessage } from '../src/chat/service.js';
import { createChatThreads, createSlots } from '../src/chat/threads.js';

vi.mock('../src/log.js', () => ({ log: () => {} }));
const tmux = { async capture() { return null; } } as any;

/** Fake CLI processes the test ends by hand: `end(i, code)` answers (or fails) the i-th spawned one. */
function fakes() {
  const kids: Array<EventEmitter & { stdout: PassThrough; killed: boolean }> = [];
  const spawn = (() => {
    const child: any = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, kill: () => { child.killed = true; child.emit('close', null); } });
    kids.push(child);
    return child;
  }) as unknown as typeof nodeSpawn;
  const end = (i: number, code = 0) => {
    const k = kids[i]!;
    if (code === 0) { k.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `answer ${i}`, session_id: 's' }) + '\n'); }
    setImmediate(() => k.emit('close', code));
  };
  return { kids, spawn, end };
}

function setup(extra: { max?: number } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ledge-'));
  const f = fakes();
  const threads = createChatThreads({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-20', env: async () => ({ ...process.env }), spawn: f.spawn, ...extra });
  return { threads, home, ...f };
}
const collect = () => { const out: ChatMessage[] = []; return { out, emit: (m: ChatMessage) => { out.push(m); } }; };
const last = (out: ChatMessage[]) => out.at(-1);

describe('chat threads', { timeout: 20_000 }, () => {
  it('two threads ask at once: two answers, two separate histories', async () => {
    const s = setup(); const a = collect(); const b = collect();
    const pa = s.threads.desktop.ask('qa', 'one', a.emit); const pb = s.threads.device('d1').ask('qb', 'two', b.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(2));
    s.end(0); s.end(1); await Promise.all([pa, pb]);
    expect(last(a.out)?.type).toBe('chat.done'); expect(last(b.out)?.type).toBe('chat.done');
    expect(s.threads.desktop.history().map(t => t.qid)).toEqual(['qa']);
    expect(s.threads.device('d1').history().map(t => t.qid)).toEqual(['qb']);
  });

  it('a thread asking twice gets ONE_AT_A_TIME on the second', async () => {
    const s = setup(); const a = collect(); const b = collect();
    const p = s.threads.desktop.ask('q1', 'x', a.emit);
    await s.threads.desktop.ask('q2', 'y', b.emit);
    expect(b.out).toEqual([{ type: 'chat.error', qid: 'q2', message: ONE_AT_A_TIME }]);
    await vi.waitFor(() => expect(s.kids).toHaveLength(1));
    s.end(0); await p;
  });

  it('four threads with max 3: the fourth gets TOO_MANY, and a question after one ends goes through', async () => {
    const s = setup({ max: 3 }); const outs = [0, 1, 2, 3].map(() => collect());
    const ps = [0, 1, 2].map(i => s.threads.device(`d${i}`).ask(`q${i}`, 'x', outs[i]!.emit));
    await vi.waitFor(() => expect(s.kids).toHaveLength(3));
    await s.threads.device('d3').ask('q3', 'x', outs[3]!.emit);
    expect(outs[3]!.out).toEqual([{ type: 'chat.error', qid: 'q3', message: TOO_MANY }]);
    expect(s.threads.device('d3').history()).toEqual([]);
    s.end(0); await Promise.race(ps); // spawn order between the three is not fixed
    const again = collect(); const p = s.threads.device('d3').ask('q4', 'x', again.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(4));
    s.end(3); await p;
    expect(last(again.out)?.type).toBe('chat.done');
    s.end(1); s.end(2); await Promise.all(ps);
  });

  it('a failing question gives its place back', async () => {
    const s = setup({ max: 1 }); const a = collect();
    const p = s.threads.desktop.ask('q1', 'x', a.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(1));
    s.end(0, 2); await p;
    expect(last(a.out)?.type).toBe('chat.error');
    const b = collect(); const p2 = s.threads.device('d').ask('q2', 'x', b.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(2));
    s.end(1); await p2;
    expect(last(b.out)?.type).toBe('chat.done');
  });

  it('the slots are not leaked by an exception', async () => {
    const slots = createSlots(1);
    expect(slots.take()).toBe(true); expect(slots.take()).toBe(false); slots.give(); expect(slots.take()).toBe(true);
  });

  it('a device day file is under mobile/chat/<id>/, the desktop one stays chat.json', async () => {
    const s = setup(); const a = collect(); const b = collect();
    const pa = s.threads.desktop.ask('qa', 'x', a.emit); const pb = s.threads.device('d1').ask('qb', 'x', b.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(2));
    s.end(0); s.end(1); await Promise.all([pa, pb]);
    expect(existsSync(join(s.home, 'chat.json'))).toBe(true);
    expect(existsSync(join(s.home, 'mobile', 'chat', 'd1', 'chat.json'))).toBe(true);
  });

  it('deviceTool reads the desktop day file, claude without one', async () => {
    const s = setup();
    expect(await s.threads.deviceTool()).toBe('claude');
    writeFileSync(join(s.home, 'chat.json'), JSON.stringify({ day: '2020-01-01', sessionId: 'x', tool: 'codex' }));
    expect(await s.threads.deviceTool()).toBe('codex');
    writeFileSync(join(s.home, 'chat.json'), '{nope');
    expect(await s.threads.deviceTool()).toBe('claude');
  });

  it('drop during a question kills the process, resolves after the question ends, and the folder is gone', async () => {
    const s = setup(); const a = collect();
    const p = s.threads.device('d1').ask('q1', 'x', a.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(1));
    const dir = join(s.home, 'mobile', 'chat', 'd1');
    expect(existsSync(dir)).toBe(true);
    let dropped = false;
    const d = s.threads.drop('d1').then(() => { dropped = true; });
    await vi.waitFor(() => expect(s.kids[0]!.killed).toBe(true));
    await p; await d;
    expect(dropped).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(s.threads.all().map(([id]) => id)).toEqual(['desktop']);
  });

  it('after a drop, a new question on the same id gets a fresh thread', async () => {
    const s = setup();
    const old = s.threads.device('d1'); await s.threads.drop('d1');
    expect(s.threads.device('d1')).not.toBe(old);
  });

  it('owner finds the thread of a qid, undefined for an unknown one', async () => {
    const s = setup(); const a = collect(); const b = collect();
    const pa = s.threads.desktop.ask('qa', 'x', a.emit); const pb = s.threads.device('d1').ask('qb', 'x', b.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(2));
    s.end(0); s.end(1); await Promise.all([pa, pb]);
    expect(s.threads.owner('qa')).toBe('desktop'); expect(s.threads.owner('qb')).toBe('device:d1'); expect(s.threads.owner('nope')).toBeUndefined();
  });

  it('emitterOf returns what setEmitter set', () => {
    const s = setup(); const emit = () => {};
    expect(s.threads.emitterOf('desktop')).toBeUndefined();
    s.threads.setEmitter('desktop', emit);
    expect(s.threads.emitterOf('desktop')).toBe(emit);
  });

  it('all lists the desktop first', () => {
    const s = setup(); s.threads.device('b'); s.threads.device('a');
    expect(s.threads.all().map(([id]) => id)).toEqual(['desktop', 'device:b', 'device:a']);
  });

  it('refuses a device id that is not a plain name, and touches nothing outside the chat dir', async () => {
    const s = setup();
    for (const bad of ['..', 'a/b', '', '../x', '.']) { expect(() => s.threads.device(bad)).toThrow('invalid device id'); await expect(async () => s.threads.drop(bad)).rejects.toThrow('invalid device id'); }
    expect(existsSync(join(s.home, 'mobile'))).toBe(false);
  });

  it('device() throws while the device is being dropped, then makes a fresh thread', async () => {
    const s = setup(); const a = collect();
    const old = s.threads.device('d1');
    const p = old.ask('q1', 'x', a.emit);
    await vi.waitFor(() => expect(s.kids).toHaveLength(1));
    const d = s.threads.drop('d1');
    expect(s.threads.drop('d1')).toBe(d);
    expect(() => s.threads.device('d1')).toThrow('device thread is being dropped');
    await p; await d;
    const fresh = s.threads.device('d1');
    expect(fresh).not.toBe(old);
    expect(existsSync(join(s.home, 'mobile', 'chat', 'd1'))).toBe(false);
  });

  it('queuedRelays sees a device thread\'s queued instruction, with its thread id, and the desktop\'s too', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    const store = new Store({ journalPath: join(home, 'j.json') });
    store.upsert({ id: 's1', name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: 'ledge-s1', state: 'working', helpers: [],
      startedAt: '2026-10-20T08:00:00.000Z', lastActivityAt: '2026-10-20T08:00:00.000Z', source: 'launcher' });
    const f = fakes();
    const threads = createChatThreads({ store, tmux, home, today: () => '2026-10-20', env: async () => ({ ...process.env }), spawn: f.spawn });
    const fence = (text: string) => 'Je transmets.\n\n```ledge-relay\n' + JSON.stringify({ session: 's1', text }) + '\n```';
    const answer = (i: number, text: string) => { f.kids[i]!.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: fence(text), session_id: 's' }) + '\n'); setImmediate(() => f.kids[i]!.emit('close', 0)); };
    const pd = threads.device('d1').ask('qd', 'dis à Otto', () => {}); await vi.waitFor(() => expect(f.kids).toHaveLength(1)); answer(0, 'from phone'); await pd;
    const pp = threads.desktop.ask('qp', 'dis à Otto', () => {}); await vi.waitFor(() => expect(f.kids).toHaveLength(2)); answer(1, 'from pc'); await pp;
    expect(threads.queuedRelays()).toEqual([]);
    const heard: Record<string, number> = { desktop: 0, 'device:d1': 0 };
    threads.setEmitter('desktop', () => { heard.desktop!++; }); threads.setEmitter('device:d1', () => { heard['device:d1']!++; });
    threads.device('d1').markRelay('qd', { status: 'queued' }, () => {}); threads.desktop.markRelay('qp', { status: 'queued' }, () => {});
    expect(threads.queuedRelays().map(q => [q.thread, q.qid, q.relay.text])).toEqual([['desktop', 'qp', 'from pc'], ['device:d1', 'qd', 'from phone']]);
    expect(threads.queuedRelays().every(q => typeof q.askedAt === 'string')).toBe(true);
    expect(threads.owner('qd')).toBe('device:d1');
  });
});
