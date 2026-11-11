// A device's conversations, kept 7 days (refonte mobile M3 Q33, docs/mobile-chat-m3-contract.md §3): the current one survives a
// restart, « Nouvelle conversation » and a new day put it away, and what is older than 7 days is pruned.
import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChatTurn } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChatThreads } from '../src/chat/threads.js';
import { createConversations, summaryOf } from '../src/chat/conversations.js';

vi.mock('../src/log.js', () => ({ log: () => {} }));
const tmux = { async capture() { return null; } } as never;

/** A CLI that answers each question at once. */
const spawn = (() => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, kill: () => { child.emit('close', null); } });
  setImmediate(() => {
    child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's' }) + '\n');
    setImmediate(() => child.emit('close', 0));
  });
  return child;
}) as unknown as typeof nodeSpawn;

function setup(home = mkdtempSync(join(tmpdir(), 'ledge-conv-')), clock = { t: '2026-10-20T08:00:00.000Z' }) {
  const threads = createChatThreads({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, now: () => clock.t, today: () => clock.t.slice(0, 10), env: async () => ({ ...process.env }), spawn });
  const dir = join(home, 'mobile', 'chat', 'd1', 'conversations');
  return { threads, home, clock, dir, d1: () => threads.device('d1') };
}
const quiet = () => {};
/** Lets the writes under way land. */
const settle = async (s: ReturnType<typeof setup>) => { await s.d1().conversations!(); };

describe('a device keeps its conversations', { timeout: 20_000 }, () => {
  it('the current conversation survives a restart of the daemon', async () => {
    const s = setup();
    await s.d1().ask('q1', 'Où en est ledge-dev ?', quiet);
    await settle(s);
    const again = setup(s.home, s.clock);
    expect(again.d1().history().map(t => [t.qid, t.question, t.answer])).toEqual([['q1', 'Où en est ledge-dev ?', 'ok']]);
    const { current, past } = await again.d1().conversations!();
    expect(current).toMatchObject({ startedAt: '2026-10-20T08:00:00.000Z', lastAt: '2026-10-20T08:00:00.000Z', first: 'Où en est ledge-dev ?', count: 1 });
    expect(past).toEqual([]);
  });

  it('a question still unanswered when the daemon stopped comes back failed, not running for ever', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-conv-')), clock = { t: '2026-10-20T08:00:00.000Z' };
    // A CLI that never answers: the daemon stops while it reads.
    const silent = (() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, kill: () => {} })) as unknown as typeof nodeSpawn;
    const first = createChatThreads({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, now: () => clock.t, today: () => clock.t.slice(0, 10), env: async () => ({ ...process.env }), spawn: silent });
    void first.device('d1').ask('q1', 'Où en est ledge-dev ?', quiet);
    await vi.waitFor(async () => { expect((await first.device('d1').conversations!()).current).toMatchObject({ count: 1 }); });
    const again = setup(home, clock);
    const [turn] = again.d1().history();
    expect(turn).toMatchObject({ qid: 'q1', error: 'the daemon stopped before the answer', errorCause: 'interrupted' });
    expect(turn!.answeredAt).toBeUndefined();
    // The phone reads it as « Ledge could not answer »; nothing is reading any more, so the next question goes.
    await again.d1().ask('q2', 'Et maintenant ?', quiet);
    expect(again.d1().history().map(t => [t.qid, t.answer])).toEqual([['q1', undefined], ['q2', 'ok']]);
  });

  it('« Nouvelle conversation » puts it away, read-only; nothing without a question', async () => {
    const s = setup();
    await s.d1().reset(quiet);
    expect(await s.d1().conversations!()).toEqual({ past: [] });
    await s.d1().ask('q1', 'un', quiet);
    s.clock.t = '2026-10-20T08:05:00.000Z';
    await s.d1().ask('q2', 'deux', quiet);
    const before = (await s.d1().conversations!()).current!;
    const out: unknown[] = [];
    await s.d1().reset(m => out.push(m));
    expect(out).toEqual([{ type: 'chat.history', turns: [] }]);
    expect(s.d1().history()).toEqual([]);
    const { current, past } = await s.d1().conversations!();
    expect(current).toBeUndefined();
    expect(past).toEqual([{ ...before, lastAt: '2026-10-20T08:05:00.000Z', count: 2 }]);
    expect((await s.d1().conversation!(before.id))!.map(t => t.qid)).toEqual(['q1', 'q2']);
    // Its cards are not the chat's any more: an action on one finds nothing.
    expect(s.threads.owner('q1')).toBeUndefined();
    expect(s.d1().ignore('q1', false, quiet)).toBe('unknown card');
    // The next question opens another one.
    await s.d1().ask('q3', 'trois', quiet);
    expect((await s.d1().conversations!()).current).toMatchObject({ first: 'trois', count: 1 });
    expect((await s.d1().conversations!()).current!.id).not.toBe(before.id);
  });

  it('a new day puts the day before away, a restarted daemon included', async () => {
    const s = setup();
    await s.d1().ask('q1', 'hier', quiet);
    await settle(s);
    s.clock.t = '2026-10-21T07:00:00.000Z';
    const again = setup(s.home, s.clock);
    const { current, past } = await again.d1().conversations!();
    expect(current).toBeUndefined();
    expect(past.map(p => p.first)).toEqual(['hier']);
    expect(again.d1().history()).toEqual([]);
    expect(existsSync(join(s.dir, 'current.json'))).toBe(false);
  });

  it('what is older than 7 days goes, at the daemon start and at each new conversation; the most recent first', async () => {
    const s = setup();
    await s.d1().ask('q1', 'vieux', quiet); await s.d1().reset(quiet);
    s.clock.t = '2026-10-24T08:00:00.000Z';
    await s.d1().ask('q2', 'moins vieux', quiet); await s.d1().reset(quiet);
    expect((await s.d1().conversations!()).past.map(p => p.first)).toEqual(['moins vieux', 'vieux']);
    s.clock.t = '2026-10-27T08:00:01.000Z';
    await s.d1().ask('q3', 'neuf', quiet); await s.d1().reset(quiet);
    expect((await s.d1().conversations!()).past.map(p => p.first)).toEqual(['neuf', 'moins vieux']);
    expect(readdirSync(s.dir).filter(n => n !== 'index.json')).toHaveLength(2);
    // A daemon that starts 8 days after prunes a device that asks nothing.
    s.clock.t = '2026-11-01T08:00:01.000Z';
    setup(s.home, s.clock);
    await vi.waitFor(() => expect(readdirSync(s.dir).filter(n => n !== 'index.json')).toHaveLength(1));
  });

  it('the current conversation of a device that never comes back goes after 7 days, at the daemon start', async () => {
    const s = setup();
    await s.d1().ask('q1', 'oubliée', quiet);
    await settle(s);
    s.clock.t = '2026-10-26T08:00:00.000Z';
    setup(s.home, s.clock);
    await new Promise(r => setTimeout(r, 50));
    expect(existsSync(join(s.dir, 'current.json'))).toBe(true);
    s.clock.t = '2026-10-27T08:00:01.000Z';
    setup(s.home, s.clock);
    await vi.waitFor(() => expect(existsSync(join(s.dir, 'current.json'))).toBe(false));
    expect(await setup(s.home, s.clock).d1().conversations!()).toEqual({ past: [] });
  });

  it('forgetting the device removes its conversations', async () => {
    const s = setup();
    await s.d1().ask('q1', 'un', quiet); await s.d1().reset(quiet);
    await s.d1().ask('q2', 'deux', quiet);
    await s.threads.drop('d1');
    expect(existsSync(join(s.home, 'mobile', 'chat', 'd1'))).toBe(false);
    expect(await s.d1().conversations!()).toEqual({ past: [] });
  });

  describe('a device put back under a new key (passkey recovery): held, its folder moved, then dropped', () => {
    const d1 = (s: ReturnType<typeof setup>) => join(s.home, 'mobile', 'chat', 'd1');
    const d2 = (s: ReturnType<typeof setup>) => join(s.home, 'mobile', 'chat', 'd2');
    /** What restore() and the gateway do: hold, rename, release, then drop the old id. */
    const move = async (s: ReturnType<typeof setup>) => {
      const release = await s.threads.hold('d1');
      renameSync(d1(s), d2(s));
      release();
      await s.threads.drop('d1');
    };

    it('a write still under way when the recovery comes lands before the move: the answer just given is in the moved conversation', async () => {
      const s = setup();
      await s.d1().ask('q1', 'un', quiet);
      // No settle: the answer's write is still queued.
      await move(s);
      expect(existsSync(d1(s))).toBe(false);
      expect(s.threads.device('d2').history().map(t => [t.qid, t.answer])).toEqual([['q1', 'ok']]);
    });

    it('a conversation being put away when the recovery comes is in the moved list', async () => {
      const s = setup();
      await s.d1().ask('q1', 'un', quiet);
      void s.d1().reset(quiet);
      await move(s);
      const { current, past } = await s.threads.device('d2').conversations!();
      expect(current).toBeUndefined();
      expect(past.map(p => p.first)).toEqual(['un']);
    });

    it('a question under way is stopped; nothing is written to the old path after the move', async () => {
      const s = setup();
      await s.d1().ask('q1', 'un', quiet);
      const asked = s.d1().ask('q2', 'deux', quiet);
      await move(s);
      await asked.catch(() => {});
      await new Promise(r => setTimeout(r, 50));
      expect(existsSync(d1(s))).toBe(false);
      expect(s.threads.device('d2').history()[0]).toMatchObject({ qid: 'q1', answer: 'ok' });
    });

    /** Threads whose CLI only stops when the test says so (`stop`), once its question has started (`started`). */
    const slow = () => {
      const home = mkdtempSync(join(tmpdir(), 'ledge-conv-'));
      let child: EventEmitter | undefined; let ready!: () => void;
      const started = new Promise<void>(r => { ready = r; });
      const spawnSlow = (() => {
        child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, kill: () => {} });
        ready();
        return child;
      }) as unknown as typeof nodeSpawn;
      const threads = createChatThreads({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, env: async () => ({ ...process.env }), spawn: spawnSlow });
      return { threads, started, stop: () => child!.emit('close', null), dir: join(home, 'mobile', 'chat', 'd1') };
    };

    it('the device forgotten while a hold stops its question: its folder is gone once all is done (review-qa f6ce9941)', async () => {
      const s = slow();
      const asked = s.threads.device('d1').ask('q1', 'secret', quiet);
      await s.started;
      const holding = s.threads.hold('d1');
      await new Promise(r => setTimeout(r, 20));
      const dropped = s.threads.drop('d1');
      // Time for a drop that would not wait to remove the folder before the question's last write.
      await new Promise(r => setTimeout(r, 20));
      s.stop();
      const release = await holding;
      await asked; await dropped;
      release();
      expect(existsSync(s.dir)).toBe(false);
    });

    it('a hold that comes during a drop waits for it, and the drop does not wait for the hold', async () => {
      const s = slow();
      const asked = s.threads.device('d1').ask('q1', 'secret', quiet);
      await s.started;
      const dropped = s.threads.drop('d1');
      const holding = s.threads.hold('d1');
      s.stop();
      await dropped;
      const release = await holding;
      await asked;
      release();
      expect(existsSync(s.dir)).toBe(false);
    });

    it('held, no thread opens; released without a move, the device finds its conversation again', async () => {
      const s = setup();
      await s.d1().ask('q1', 'un', quiet);
      const release = await s.threads.hold('d1');
      expect(() => s.d1()).toThrow('held');
      release();
      expect(s.d1().history().map(t => [t.qid, t.answer])).toEqual([['q1', 'ok']]);
    });
  });

  it('what was under way when the daemon stopped is not any more', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-conv-'));
    const dir = join(home, 'mobile', 'chat', 'd1', 'conversations');
    mkdirSync(dir, { recursive: true });
    const t: ChatTurn = { qid: 'q1', question: 'x', askedAt: '2026-10-20T08:00:00.000Z', steps: [], answer: 'ok',
      relay: { id: 's', name: 'Otto', tool: 'claude', text: 'go', status: 'queued' },
      actions: [{ action: 'rig.act', args: {}, summary: 'Arrêter', risk: 'destructive', state: 'running' }, { action: 'rig.act', args: {}, summary: 'Lancer', risk: 'reversible', state: 'done', doneAt: '2026-10-20T08:00:00.000Z' }] };
    writeFileSync(join(dir, 'current.json'), JSON.stringify({ id: randomUUID(), day: '2026-10-20', turns: [t] }));
    const s = setup(home);
    const [back] = s.d1().history();
    expect(back!.relay).toEqual({ id: 's', name: 'Otto', tool: 'claude', text: 'go' });
    expect(back!.actions!.map(a => a.state)).toEqual(['failed', 'done']);
    expect(s.d1().queuedRelays()).toEqual([]);
  });
});

describe('the conversations on disk', () => {
  const T = (q: string, at: string): ChatTurn => ({ qid: randomUUID(), question: q, askedAt: at, steps: [] });

  it('a lost index is rebuilt from the files; an unknown or malformed id reads nothing', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-conv-')), 'c');
    const k = createConversations(dir, { now: () => '2026-10-20T09:00:00.000Z' });
    const a = randomUUID(); const b = randomUUID();
    await k.archive(a, [T('a'.repeat(300), '2026-10-20T08:00:00.000Z')]);
    await k.archive(b, [T('b', '2026-10-20T08:10:00.000Z'), T('b2', '2026-10-20T08:20:00.000Z')]);
    rmSync(join(dir, 'index.json'));
    const list = await k.list();
    expect(list.map(s => [s.id, s.count])).toEqual([[b, 2], [a, 1]]);
    expect(list[1]!.first).toHaveLength(200);
    expect(await k.read(randomUUID())).toBeNull();
    expect(await k.read('../x')).toBeNull();
    expect(summaryOf(a, [])).toBeUndefined();
  });

  it('nothing is written once it is closed', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-conv-')), 'c');
    const k = createConversations(dir);
    await k.close();
    await k.saveCurrent({ id: randomUUID(), day: '2026-10-20', turns: [T('x', '2026-10-20T08:00:00.000Z')] });
    expect(existsSync(dir)).toBe(false);
  });
});
