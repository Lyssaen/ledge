import { describe, it, expect } from 'vitest';
import { PushPayloadSchema, type ChatPoint, type HumanAsk, type PointItem } from '@ledge/protocol';
import { createNoticeFeed, noticesOf, pointPush } from '../../src/operator/notices.js';

const T = (m: number): string => new Date(Date.UTC(2026, 10, 13, 10, m)).toISOString();
const item = (id: string, over: Partial<PointItem> = {}): PointItem => ({ id, event: 1, group: 'atoi', tone: 'ask', who: 'Otto', text: 'Which db?', at: T(1), ...over });
const point = (lead: string, items: PointItem[], over: Partial<ChatPoint> = {}): ChatPoint => ({ since: T(0), lead, leadBy: 'daemon', items, ...over });
const ask = (id: string, over: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'max', rig: 'kernel', role: null }, summary: 'Which team?', body: '', bodyTruncated: false, detail: null,
  evidenceRef: null, createdAt: T(0), updatedAt: T(0),
  questions: [{ id: 'k', question: 'Which?', options: ['a', 'b', 'c', 'd'].map(o => ({ id: o, label: o.toUpperCase(), recommended: false })), answer: null }], ...over
});

describe('noticesOf', () => {
  it('noticesOf returns the newest open point and urgent rig asks only', () => {
    const points = [
      { qid: 'q1', point: point('old', [item('a')]) },
      { qid: 'q2', point: point('mid', [item('b', { settled: { at: T(2), where: 'phone' } })]) },
      { qid: 'q3', point: point('new', [item('c')]) },
      { qid: 'q4', point: point('folded', [item('d')], { foldedAt: T(3) }) },
      { qid: 'q5', point: point('only done', [item('e', { group: 'done' })]) }
    ];
    const n = noticesOf(points, [ask('r1'), ask('r2', { priority: 'urgent' }), ask('r3', { priority: 'critical', from: { seat: 'max', rig: null, role: null } })], T(9));
    expect(n.map(x => x.id)).toEqual(['point:q3', 'rig.ask:r2', 'rig.ask:r3']);
    expect(n[0]).toMatchObject({ kind: 'point', qid: 'q3', text: 'new', priority: 'routine' });
    // At most three options, the first open question's.
    expect(n[1]).toMatchObject({ kind: 'rig.ask', qitem: 'r2', who: 'max', rig: 'kernel', priority: 'urgent', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] });
    expect(n[2]).not.toHaveProperty('rig');
    // An urgent ask whose questions are all answered is settled.
    const answered = ask('r4', { priority: 'urgent', questions: [{ id: 'k', question: '?', options: [], answer: { optionId: 'a' } as never }] });
    expect(noticesOf([], [answered], T(9))).toEqual([]);
  });

  it('a point set aside with later is not a notice until a newer point', () => {
    const a = { qid: 'q1', point: point('one', [item('a')]), laterAt: T(5) };
    expect(noticesOf([a], [], T(9))).toEqual([]);
    expect(noticesOf([{ ...a, laterAt: undefined as never, point: { ...a.point, laterAt: T(5) } }], [], T(9))).toEqual([]);
    const b = { qid: 'q2', point: point('two', [item('b')]) };
    expect(noticesOf([a, b], [], T(9)).map(x => x.id)).toEqual(['point:q2']);
  });
});

describe('pointPush', () => {
  it('is a point titled Ledge, its body the lead cut to 120, opening the chat tab', () => {
    const p = pointPush('x'.repeat(300), 3);
    expect(p).toMatchObject({ kind: 'point', title: 'Ledge', url: '/#/chat', badge: 3, tag: 'point' });
    expect(p.body.length).toBeLessThanOrEqual(120);
    expect(PushPayloadSchema.parse(p)).toEqual(p);
  });
});

describe('noticesOf times', () => {
  it('an ask with an unreadable createdAt takes its updatedAt, else a fixed time, so two calls agree', () => {
    const a = ask('r1', { priority: 'urgent', createdAt: 'x', updatedAt: T(4) });
    expect(noticesOf([], [a], T(9))[0]!.at).toBe(T(4));
    const b = ask('r2', { priority: 'urgent', createdAt: 'x', updatedAt: 'y' });
    expect(noticesOf([], [b], T(9))).toEqual(noticesOf([], [b], T(10)));
  });
});

describe('createNoticeFeed', () => {
  const n = { id: 'point:q1', kind: 'point' as const, qid: 'q1', text: 't', priority: 'routine' as const, at: T(1) };
  it('sends a change once, not an unchanged list, and replays the last to a later client', () => {
    const sent: unknown[] = [];
    const feed = createNoticeFeed(x => sent.push(x));
    expect(feed.current()).toBeUndefined();
    feed.tell([]); feed.tell([]);
    expect(sent).toHaveLength(1);
    feed.tell([n]); feed.tell([{ ...n }]);
    expect(sent).toHaveLength(2);
    expect(feed.current()).toEqual([n]);
    feed.tell([]);
    expect(sent).toHaveLength(3);
  });
});
