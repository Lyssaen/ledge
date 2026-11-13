import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingKey, type Session } from '@ledge/protocol';
import { Store } from '../../src/daemon/store.js';
import { createChat, type Chat, type ChatDeps, type ChatMessage } from '../../src/chat/service.js';
import { openJournal, type DeviceId } from '../../src/operator/journal.js';
import type { Draft } from '../../src/operator/detect.js';
import type { LeadResult } from '../../src/operator/lead.js';
import { createOperator } from '../../src/operator/index.js';

vi.mock('../../src/log.js', () => ({ log: () => {} }));

const AT = '2026-11-13T10:00:00.000Z';
const pending: NonNullable<Session['pending']> = { kind: 'permission', text: 'Run ls', source: 'hook' };
const key = pendingKey(pending);
const session: Session = { id: 's1', name: 'Nova', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: 'l-s1', state: 'idle', helpers: [], startedAt: AT, lastActivityAt: AT, source: 'launcher', pending };
const finished = (sid: string): Draft => ({ kind: 'session.finished', subjectKind: 'session', subjectId: sid, subjectName: `Bot ${sid}`, urgency: 'grouped', payload: { text: `${sid} is done.` } });
const request: Draft = { kind: 'session.request', subjectKind: 'session.request', subjectId: `s1#${key}`, subjectName: 'Nova', urgency: 'immediate', payload: { session: 's1', key, kind: 'permission', text: 'Run ls', command: 'ls' } };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

function setup(lead: (o: { events: readonly unknown[] }) => Promise<LeadResult> = async () => ({ lead: 'Agent lead.', suggestions: [], actions: [] })) {
  const home = mkdtempSync(join(tmpdir(), 'ledge-op-'));
  const store = new Store({ journalPath: join(home, 'j.json') });
  const chatDeps: ChatDeps = { store, tmux: { async capture() { return null; } } as never, home, env: async () => ({ ...process.env }) };
  const desktop = createChat({ ...chatDeps, home: join(home, 'd') });
  const phone = createChat({ ...chatDeps, home: join(home, 'p') });
  const emitted: Record<string, ChatMessage[]> = { desktop: [], 'device:abc': [] };
  const all = (): Array<[DeviceId, Chat]> => [['desktop', desktop], ['device:abc', phone]];
  const journal = openJournal(':memory:');
  const pushes: Array<{ lead: string; qids: Map<DeviceId, string> }> = [];
  const leadCalls: Array<{ events: readonly unknown[] }> = [];
  const operator = createOperator({
    journal, machine: 'm',
    threads: { all, emitterOf: id => (m: ChatMessage) => { emitted[id]!.push(m); } },
    live: () => ({ sessions: [session], asks: [], tasks: [], lang: 'fr' }),
    tool: () => 'claude', chatDeps,
    onNotices: () => {}, onPointPush: (l, qids) => { pushes.push({ lead: l, qids }); },
    runLead: async o => { leadCalls.push(o); return lead(o); }
  });
  operator.start();
  return { journal, operator, desktop, phone, emitted, pushes, leadCalls };
}

const pointsOf = (c: Chat) => c.points().map(p => p.point);

describe('createOperator', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(AT)); });
  afterEach(() => { vi.useRealTimers(); });

  it("posts one point per thread with items from each thread's own cursor", async () => {
    const { journal, operator, desktop, phone, pushes } = setup();
    operator.record(finished('a'));
    operator.read('device:abc', journal.since(0).at(-1)!.id);
    operator.record(finished('b'));
    await vi.advanceTimersByTimeAsync(60_000);
    const [d] = pointsOf(desktop); const [p] = pointsOf(phone);
    expect(d!.items.map(i => i.id)).toEqual(['session:a', 'session:b']);
    expect(p!.items.map(i => i.id)).toEqual(['session:b']);
    expect(d!).toMatchObject({ lead: 'Agent lead.', leadBy: 'agent' });
    const turn = desktop.history().at(-1)!;
    expect(turn).toMatchObject({ by: 'ledge', question: '' });
    expect(turn.answeredAt).toBeDefined();
    expect(pushes).toHaveLength(1);
    expect([...pushes[0]!.qids.keys()]).toEqual(['desktop', 'device:abc']);
    expect(journal.lastWake()).toMatchObject({ outcome: 'posted', qids: [...pushes[0]!.qids.values()] });
    operator.stop();
  });

  it('lead failure posts with the daemon lead', async () => {
    const { operator, desktop, journal } = setup(async () => ({ lead: null, suggestions: [], actions: [], error: 'not signed in' }));
    operator.record(finished('a'));
    await vi.advanceTimersByTimeAsync(60_000);
    const [d] = pointsOf(desktop);
    expect(d).toMatchObject({ leadBy: 'daemon' });
    expect(d!.lead).toMatch(/^1 chose depuis \d\d:\d\d$/);
    expect(journal.lastWake()!.outcome).toBe('posted');
    operator.stop();
  });

  it('a request settled during the run is posted settled', async () => {
    const gate = deferred();
    let op!: ReturnType<typeof setup>['operator'];
    const ctx = setup(async () => {
      op.settle('session.request', `s1#${key}`, 'terminal');
      await gate.promise;
      return { lead: 'Agent lead.', suggestions: [], actions: [] };
    });
    op = ctx.operator;
    op.record(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(pointsOf(ctx.desktop)).toHaveLength(0);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    const [d] = pointsOf(ctx.desktop);
    expect(d!.items[0]).toMatchObject({ id: `session.request:s1#${key}`, settled: { where: 'terminal' } });
    op.stop();
  });

  it('ten finishes in 30 s give one point', async () => {
    const { operator, desktop, phone, leadCalls } = setup();
    for (let i = 0; i < 10; i++) { operator.record(finished(`f${i}`)); await vi.advanceTimersByTimeAsync(3_000); }
    await vi.advanceTimersByTimeAsync(300_000);
    expect(leadCalls).toHaveLength(1);
    expect(leadCalls[0]!.events).toHaveLength(10);
    expect(pointsOf(desktop)).toHaveLength(1);
    expect(pointsOf(desktop)[0]!.items).toHaveLength(10);
    expect(pointsOf(phone)).toHaveLength(1);
    operator.stop();
  });

  it('settle updates the posted item and folds the point', async () => {
    const { operator, desktop, phone, emitted } = setup();
    operator.record(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(pointsOf(desktop)[0]!.items[0]!.settled).toBeUndefined();
    const before = emitted.desktop!.length;
    operator.settle('session.request', `s1#${key}`, 'phone', 'Autoriser');
    for (const c of [desktop, phone]) {
      const [p] = pointsOf(c);
      expect(p!.items[0]!.settled).toMatchObject({ where: 'phone', answer: 'Autoriser' });
      expect(p!.foldedAt).toBeDefined();
    }
    expect(emitted.desktop!.length).toBe(before + 1);
    expect(emitted.desktop!.at(-1)!.type).toBe('chat.history');
    operator.stop();
  });

  it('attaches the lead suggestions to their items and the plan to the turn', async () => {
    const action = { action: 'session.archive', args: { session: 'a' }, risk: 'reversible', summary: 'Archive a' } as never;
    const { operator, desktop } = setup(async () => ({ lead: 'Agent lead.', suggestions: [{ item: 'session:a', action }], actions: [action] }));
    operator.record(finished('a'));
    await vi.advanceTimersByTimeAsync(60_000);
    const turn = desktop.history().at(-1)!;
    expect(turn.point!.items[0]!.suggestion).toEqual(action);
    expect(turn.actions).toEqual([action]);
    operator.stop();
  });
});
