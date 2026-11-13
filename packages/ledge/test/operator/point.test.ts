import { describe, it, expect } from 'vitest';
import { pendingKey, type HumanAsk, type Session, type Task } from '@ledge/protocol';
import type { JournalEvent } from '../../src/operator/journal.js';
import { buildPoint, daemonLead, foldIfDone, goneOf, settleItem, type LiveState } from '../../src/operator/point.js';

const T = (m: number): string => new Date(Date.UTC(2026, 10, 13, 10, m)).toISOString();
let n = 0;
const ev = (over: Partial<JournalEvent>): JournalEvent => ({
  id: ++n, at: T(n), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 's', subjectName: 'Otto',
  urgency: 'grouped', payload: {}, settledAt: null, ...over
});
const pending: NonNullable<Session['pending']> = { kind: 'permission', text: 'Run ls', source: 'hook' };
const key = pendingKey(pending);
const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: `l-${id}`, state: 'idle', helpers: [], startedAt: T(0), lastActivityAt: T(0), source: 'launcher', ...over
});
const ask: HumanAsk = {
  id: 'q1', kind: 'decision', alert: false, priority: 'routine', from: { seat: 'max', rig: 'kernel', role: null }, summary: 'Which team?', body: '', bodyTruncated: false, detail: null,
  evidenceRef: null, createdAt: T(0), updatedAt: T(0),
  questions: [{ id: 'k', question: 'Which?', options: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id.toUpperCase(), recommended: false })), answer: null }]
};
const live = (over: Partial<LiveState> = {}): LiveState => ({ sessions: [session('s1', { pending })], asks: [ask], tasks: [], lang: 'fr', ...over });
const lead = { text: 'Voilà', by: 'agent' as const };

const six = (): JournalEvent[] => [
  ev({ kind: 'rig.ask', subjectKind: 'rig.ask', subjectId: 'q1', subjectName: 'max', payload: { kind: 'decision', priority: 'routine', summary: 'Which team?', rig: 'kernel' } }),
  ev({ kind: 'session.request', subjectKind: 'session.request', subjectId: `s1#${key}`, urgency: 'immediate', payload: { session: 's1', key, kind: 'permission', text: 'Run ls', command: 'ls -la' } }),
  ev({ subjectId: 's2', subjectName: 'Pim', payload: { text: 'Done.\nmore' } }),
  ev({ kind: 'session.error', subjectId: 's3', subjectName: 'Zed' }),
  ev({ kind: 'task.stale', subjectKind: 'task', subjectId: 't1', subjectName: 'Refactor', payload: { owner: 'Pim', idleMs: 2_400_000 } }),
  ev({ kind: 'rig.seat_unreachable', subjectKind: 'rig.seat', subjectId: 'kernel/max', subjectName: 'max', payload: { rig: 'kernel', seat: 'max', status: 'stopped' } })
];

describe('buildPoint', () => {
  it('groups and orders items as board 1', () => {
    const p = buildPoint(six(), live(), T(0), lead);
    expect(p.items.map(i => i.group)).toEqual(['atoi', 'atoi', 'done', 'done', 'ongoing', 'rigs']);
    // The immediate permission comes before the older routine rig ask.
    expect(p.items[0]).toMatchObject({ id: `session.request:s1#${key}`, tone: 'perm', text: 'ls -la', nav: [{ kind: 'session', id: 's1' }] });
    expect(p.items[0]!.answers).toEqual([{ id: 'deny', label: 'Refuser', style: 'plain' }, { id: 'accept', label: 'Autoriser', style: 'primary' }]);
    expect(p.items[1]!.answers).toHaveLength(4);
    expect(p.items[1]!.freeText).toBe(true);
    expect(p.items[2]).toMatchObject({ tone: 'idle', sub: 'Done.' });
    expect(p.items[4]).toMatchObject({ tone: 'work', id: 'task:t1' });
    expect(p.items[5]).toMatchObject({ tone: 'perm', rig: 'kernel', nav: [{ kind: 'rig', id: 'kernel' }] });
  });
  it('collapses events of a subject to the latest and skips request.settled', () => {
    const p = buildPoint([ev({ subjectId: 'a', payload: { text: 'old' } }), ev({ subjectId: 'a', payload: { text: 'new' } }), ev({ kind: 'request.settled', subjectKind: 'session.request', subjectId: 'x' })], live(), T(0), lead);
    expect(p.items.map(i => i.sub)).toEqual(['new']);
  });
  it('adds the open tasks of the live state to ongoing, and brain proposals get Ajouter / Refuser', () => {
    const task = { id: 't9', title: 'Port', giver: 'x', giverName: 'X', owner: 'o', ownerName: 'Pim', state: 'taken', at: T(0), updatedAt: T(1), log: [] } as Task;
    const brain = { ...task, id: 'b1', owner: 'ledge', brain: { kind: 'add', note: 'n', fact: 'A fact' } } as Task;
    const p = buildPoint([ev({ kind: 'brain.proposed', subjectKind: 'task', subjectId: 'b1', subjectName: 'Note', payload: { giver: 'Otto', brain: { fact: 'A fact' } } })], live({ tasks: [task, brain] }), T(0), lead);
    expect(p.items.find(i => i.group === 'ongoing')).toMatchObject({ id: 'task:t9', who: 'Pim' });
    expect(p.items.find(i => i.id === 'task:b1')!.answers!.map(a => a.label)).toEqual(['Ajouter', 'Refuser']);
  });
  it('a request answered before build is created settled elsewhere', () => {
    const p = buildPoint(six(), live({ sessions: [session('s1')], asks: [] }), T(0), lead);
    const atoi = p.items.filter(i => i.group === 'atoi');
    expect(atoi.every(i => i.settled?.where === 'elsewhere')).toBe(true);
    expect(atoi.every(i => !i.answers)).toBe(true);
  });
  it("a goal update says Max's proposal and leads to its rig", () => {
    const e = ev({ kind: 'rig.goal_update', subjectKind: 'rig.goal', subjectId: 'g1', subjectName: 'max@kernel', payload: { goalId: 'g1', goal: 'Port the TUI', state: 'proposed', text: 'Two developers', rig: 'kernel' } });
    const [item] = buildPoint([e], live({ asks: [] }), T(0), lead).items;
    expect(item).toMatchObject({ id: 'rig.goal:g1', group: 'rigs', text: 'Two developers', rig: 'kernel', nav: [{ kind: 'rig', id: 'kernel' }] });
  });

  it('goneOf gives the waiting events whose target left, never a settled or a done one', () => {
    const request = ev({ kind: 'session.request', subjectKind: 'session.request', subjectId: `s1#${key}`, urgency: 'immediate', payload: { session: 's1', key, kind: 'permission', text: 'Run ls', command: 'ls' } });
    const decision = ev({ kind: 'decision.asked', subjectKind: 'task', subjectId: 't9', subjectName: 'Merge?', urgency: 'immediate', payload: { giver: 'Nova', text: 'oui / non' } });
    const askGone = ev({ kind: 'rig.ask', subjectKind: 'rig.ask', subjectId: 'q-gone', subjectName: 'max', payload: { summary: 'Old?' } });
    const settled = { ...ev({ kind: 'rig.ask', subjectKind: 'rig.ask', subjectId: 'q-old', subjectName: 'max', payload: {} }), settledAt: T(1) };
    const done = ev({ subjectId: 's2' });
    const gone = goneOf([request, decision, askGone, settled, done], live({ sessions: [session('s1')] }));
    expect(gone.map(e => e.subjectId)).toEqual([`s1#${key}`, 't9', 'q-gone']);
    expect(goneOf([request], live())).toEqual([]);
  });

  it('caps items at 40 dropping oldest done first', () => {
    const many = Array.from({ length: 45 }, (_, i) => ev({ subjectId: `d${i}` }));
    const p = buildPoint([...many, ...six().slice(0, 2)], live(), T(0), lead);
    expect(p.items).toHaveLength(40);
    expect(p.items.filter(i => i.group === 'atoi')).toHaveLength(2);
    expect(p.items.some(i => i.id === 'session:d0')).toBe(false);
    expect(p.items.some(i => i.id === 'session:d44')).toBe(true);
  });
});

describe('settleItem and foldIfDone', () => {
  const settled = { at: T(5), where: 'terminal' as const };
  it('settleItem marks the matching item with where terminal and leaves others', () => {
    const p = buildPoint(six(), live(), T(0), lead);
    const out = settleItem(p, { subjectKind: 'session.request', subjectId: `s1#${key}` }, settled)!;
    expect(out.items[0]!.settled).toEqual(settled);
    expect(out.items.slice(1).every(i => !i.settled)).toBe(true);
    expect(settleItem(p, { subjectKind: 'session.request', subjectId: 'nope' }, settled)).toBeNull();
  });
  it('foldIfDone folds only when every atoi item is settled', () => {
    let p = buildPoint(six(), live(), T(0), lead);
    p = settleItem(p, { subjectKind: 'session.request', subjectId: `s1#${key}` }, settled)!;
    expect(foldIfDone(p, T(6)).foldedAt).toBeUndefined();
    p = settleItem(p, { subjectKind: 'rig.ask', subjectId: 'q1' }, settled)!;
    expect(foldIfDone(p, T(6)).foldedAt).toBe(T(6));
  });
});

describe('daemonLead', () => {
  it('counts items and waiting ones in fr and en', () => {
    const p = buildPoint(six(), live(), T(0), lead);
    const hhmm = new Date(T(0)).toTimeString().slice(0, 5);
    expect(daemonLead(p, 'fr')).toBe(`6 choses depuis ${hhmm} · 2 t'attendent`);
    expect(daemonLead(p, 'en')).toBe(`6 things since ${hhmm} · 2 waiting for you`);
    expect(daemonLead({ since: p.since, items: p.items.filter(i => i.group === 'done') }, 'fr')).toBe(`2 choses depuis ${hhmm}`);
  });
});
