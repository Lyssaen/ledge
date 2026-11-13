import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingKey, type ChatAction, type ChatPoint, type HumanAsk, type PointItem, type Session } from '@ledge/protocol';
import { Store } from '../../src/daemon/store.js';
import { createChat, type Chat, type ChatDeps, type ChatMessage } from '../../src/chat/service.js';
import { openJournal, type DeviceId } from '../../src/operator/journal.js';
import { createOperator } from '../../src/operator/index.js';
import { actFromChat } from '../../src/chat/act.js';
import { applySuggestionRow, createPointActor, type Fail, type PointActDeps } from '../../src/operator/act.js';
import { pointHandlers } from '../../src/operator/point-handlers.js';

vi.mock('../../src/log.js', () => ({ log: () => {} }));

const AT = '2026-11-13T10:00:00.000Z';
const pending: NonNullable<Session['pending']> = { kind: 'permission', text: 'Run ls', source: 'hook' };
const key = pendingKey(pending);
const session: Session = { id: 's1', name: 'Nova', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: 'l-s1', state: 'idle', helpers: [], startedAt: AT, lastActivityAt: AT, source: 'launcher', pending };
const ask = { id: 'q1', kind: 'decision', summary: 'Which team?', questions: [{ id: 'qq1', prompt: 'Team?', options: [{ id: 'blue', label: 'Blue' }], answer: null }] } as unknown as HumanAsk;

const requestItem: PointItem = { id: `session.request:s1#${key}`, event: 1, group: 'atoi', tone: 'perm', who: 'Nova', text: 'Run ls', at: AT,
  ref: { kind: 'session.request', session: 's1', key }, answers: [{ id: 'deny', label: 'Refuser', style: 'plain' }, { id: 'accept', label: 'Accepter', style: 'primary' }] };
const askItem: PointItem = { id: 'rig.ask:q1', event: 2, group: 'atoi', tone: 'ask', who: 'max', text: 'Which team?', at: AT, ref: { kind: 'rig.ask', qitem: 'q1' }, freeText: true, answers: [{ id: 'blue', label: 'Blue', style: 'plain' }] };

function setup(items: PointItem[], over: Partial<PointActDeps> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ledge-pact-'));
  const store = new Store({ journalPath: join(home, 'j.json') });
  const chatDeps: ChatDeps = { store, tmux: { async capture() { return null; } } as never, home, env: async () => ({ ...process.env }) };
  const chat = createChat(chatDeps);
  const point: ChatPoint = { since: AT, lead: 'lead', leadBy: 'daemon', items };
  const qid = chat.postPoint(point, [], () => {});
  const calls: string[] = []; const settled: unknown[][] = [];
  const ok = async (): Promise<Fail> => undefined;
  const actor = createPointActor({
    chatOf: () => ({ chat, emit: () => {} }), session: id => (id === 's1' ? { ...session } : undefined), asks: () => [ask],
    decide: async (s, d, confirmed) => { calls.push(`decide ${s} ${d} ${confirmed}`); return ok(); },
    reply: async (s, t) => { calls.push(`reply ${s} ${t}`); return ok(); },
    answerAsk: async (q, a) => { calls.push(`ask ${q} ${JSON.stringify(a)}`); return { ok: true }; },
    answerTask: async (t, a, c) => { calls.push(`task ${t} ${a} ${c}`); return ok(); },
    applySuggestion: async (q, i) => { calls.push(`suggest ${q}:${i}`); return undefined; },
    answerBrain: (t, y) => { calls.push(`brain ${t} ${y}`); return undefined; }, isBrain: () => false,
    operator: { settle: (...a) => { settled.push(a); } }, ...over
  });
  const item = (id: string) => chat.points()[0]!.point.items.find(i => i.id === id)!;
  return { actor, qid, calls, settled, item, chat };
}

describe('point.act', () => {
  it('answering a request item decides the session and settles the item with where chat', async () => {
    const { actor, qid, calls, settled } = setup([requestItem]);
    const r = await actor.act('desktop', { qid, item: requestItem.id, answer: { id: 'accept' }, confirmed: true });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual(['decide s1 accept true']);
    expect(settled).toEqual([['session.request', `s1#${key}`, 'chat', 'Accepter']]);
  });

  it('answering an item whose request changed sends nothing and marks changed', async () => {
    const { actor, qid, calls, settled, item } = setup([requestItem], { session: () => ({ ...session, pending: { ...pending, text: 'Run rm' } }) });
    const r = await actor.act('desktop', { qid, item: requestItem.id, answer: { id: 'deny' } });
    expect(r).toMatchObject({ ok: false, error: 'changed' });
    expect(calls).toEqual([]); expect(settled).toEqual([]);
    expect(item(requestItem.id).error).toBe('changed');
  });

  it('shows already settled on a settled item and sends nothing', async () => {
    const settledItem = { ...requestItem, settled: { at: AT, where: 'terminal' as const } };
    const { actor, qid, calls, item } = setup([settledItem]);
    expect(await actor.act('desktop', { qid, item: settledItem.id, answer: { id: 'deny' } })).toMatchObject({ ok: false, error: 'already settled' });
    expect(calls).toEqual([]);
    expect(item(settledItem.id).error).toBe('already settled');
  });

  it('answering a rig ask item calls human.answer with the option id of the first open question', async () => {
    const { actor, qid, calls, settled } = setup([askItem]);
    expect(await actor.act('desktop', { qid, item: askItem.id, answer: { id: 'blue' } })).toEqual({ ok: true });
    expect(calls).toEqual(['ask q1 {"kind":"choice","questionId":"qq1","optionId":"blue"}']);
    expect(settled).toEqual([['rig.ask', 'q1', 'chat', 'Blue']]);
    await actor.act('desktop', { qid, item: askItem.id, answer: { text: 'Green' } });
    expect(calls.at(-1)).toBe('ask q1 {"kind":"words","text":"Green"}');
  });

  it('a failed answer is shown on the item and settles nothing', async () => {
    const { actor, qid, settled, item } = setup([askItem], { answerAsk: async () => ({ ok: false, message: 'channel closed' }) });
    expect(await actor.act('desktop', { qid, item: askItem.id, answer: { id: 'blue' } })).toMatchObject({ ok: false, error: 'channel closed' });
    expect(settled).toEqual([]); expect(item(askItem.id).error).toBe('channel closed');
  });

  it('a refusal to confirm is not shown as an error on the item', async () => {
    const { actor, qid, item } = setup([requestItem], { decide: async () => ({ message: 'confirm', code: 'confirm_required' }) });
    expect(await actor.act('desktop', { qid, item: requestItem.id, answer: { id: 'accept' } })).toMatchObject({ ok: false, code: 'confirm_required' });
    expect(item(requestItem.id).error).toBeUndefined();
  });

  it('a decision is answered with its label text, a proposal about the notes by accept', async () => {
    const decision: PointItem = { id: 'task:t1', event: 3, group: 'atoi', tone: 'ask', who: 'Nova', text: 'Merge?', at: AT, ref: { kind: 'task', task: 't1' }, freeText: true, answers: [{ id: 'Oui', label: 'Oui', style: 'plain' }] };
    const a = setup([decision]);
    await a.actor.act('desktop', { qid: a.qid, item: 'task:t1', answer: { id: 'Oui' }, confirmed: true });
    expect(a.calls).toEqual(['task t1 Oui true']);
    const b = setup([{ ...decision, answers: [{ id: 'accept', label: 'Ajouter', style: 'primary' }] }], { isBrain: () => true });
    await b.actor.act('desktop', { qid: b.qid, item: 'task:t1', answer: { id: 'accept' } });
    expect(b.calls).toEqual(['brain t1 true']);
  });
});

describe('point.act with a suggestion', () => {
  const suggestion: ChatAction = { action: 'session.decide', args: { session: 's1', decision: 'accept', expect: { kind: 'permission', text: 'Run ls', key } }, summary: 'Accepter', risk: 'destructive' };
  const withSuggestion: PointItem = { ...requestItem, suggestion: suggestion };
  /** The real card path (`actFromChat`) with a resolve that gives the row back, or refuses it, and an apply that records. */
  const real = (resolve: (row: ChatAction) => unknown, applied: string[]) => (card: Parameters<Parameters<typeof applySuggestionRow>[4]>[0], qid: string, confirmed?: true) =>
    actFromChat({ chat: card.chat, emit: card.emit, inFlight: new Set(), resolve: row => resolve(row) as never, apply: async row => { applied.push(row.action); } }, qid, [0], confirmed);

  it('applies the row through the card path and clears an earlier error', async () => {
    const applied: string[] = [];
    const t = setup([{ ...withSuggestion, error: 'changed' }], { applySuggestion: (q, i, row, c, _by, m) => applySuggestionRow(q, i, row, c, real(r => r, applied), m) });
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true, confirmed: true })).toEqual({ ok: true });
    expect(applied).toEqual(['session.decide']);
    expect(t.item(requestItem.id).error).toBeUndefined();
  });
  it('is refused, and shown on the item, when the target changed', async () => {
    const applied: string[] = [];
    const t = setup([withSuggestion], { applySuggestion: (q, i, row, c, _by, m) => applySuggestionRow(q, i, row, c, real(() => ({ refused: 'the request has changed', code: 'changed' }), applied), m) });
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true, confirmed: true })).toMatchObject({ ok: false, error: 'the request has changed', code: 'changed' });
    expect(applied).toEqual([]);
    expect(t.item(requestItem.id).error).toBe('the request has changed');
  });
  it('asks for the confirmation of a destructive row and sends nothing without it', async () => {
    const applied: string[] = [];
    const t = setup([withSuggestion], { applySuggestion: (q, i, row, c, _by, m) => applySuggestionRow(q, i, row, c, real(r => r, applied), m) });
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true })).toMatchObject({ ok: false, code: 'confirm_required' });
    expect(applied).toEqual([]);
    expect(t.item(requestItem.id).error).toBeUndefined();
  });
  it('marks the suggestion done, so a second click sends nothing', async () => {
    const applied: string[] = [];
    const t = setup([withSuggestion], { applySuggestion: (q, i, row, c, _by, m) => applySuggestionRow(q, i, row, c, real(r => r, applied), m) });
    const go = () => t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true, confirmed: true });
    expect(await go()).toEqual({ ok: true });
    expect(t.item(requestItem.id).suggestion).toMatchObject({ state: 'done' });
    expect(t.item(requestItem.id).suggestion?.doneAt).toBeDefined();
    expect(await go()).toMatchObject({ ok: false, error: 'already settled' });
    expect(applied).toEqual(['session.decide']);
  });
  it('keeps the card\'s own refusal code and shows the refused state on the suggestion', async () => {
    const t = setup([withSuggestion], { applySuggestion: (q, i, row, c, _by, m) => applySuggestionRow(q, i, row, c, real(() => ({ refused: 'gone', code: 'closed' }), []), m) });
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true, confirmed: true })).toMatchObject({ ok: false, code: 'closed' });
    expect(t.item(requestItem.id).suggestion).toMatchObject({ state: 'refused', code: 'closed' });
  });
  it('needs a suggestion, and exactly one of answer and suggest', async () => {
    const t = setup([requestItem]);
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true })).toMatchObject({ ok: false, error: 'no suggestion' });
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await t.actor.act('desktop', { qid: t.qid, item: requestItem.id, suggest: true, answer: { id: 'deny' } })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('point.act input and dispatch', () => {
  it('sends the answer a gateway verified, not one it maps again', async () => {
    const t = setup([askItem]);
    await t.actor.act('desktop', { qid: t.qid, item: askItem.id, answer: { id: 'blue' }, human: { kind: 'choice', questionId: 'verified', optionId: 'blue' } });
    expect(t.calls).toEqual(['ask q1 {"kind":"choice","questionId":"verified","optionId":"blue"}']);
  });
  it('dispatches the PC to the desktop thread and a phone to its own device thread', async () => {
    const seen: string[] = [];
    const h = pointHandlers({ act: async (d, m) => { seen.push(`act ${d} ${m.item}`); return d === 'desktop' ? { ok: true } : { ok: false, error: 'nope', code: 'changed' }; } },
      () => ({ later: (d, q) => { seen.push(`later ${d} ${q}`); }, read: (d, id) => { seen.push(`read ${d} ${id}`); } }));
    expect(await h.pc.act({ qid: 'q', item: 'i', answer: { id: 'x' } })).toBeUndefined();
    h.pc.later('q'); h.pc.read(3);
    expect(await h.phone.act('abc', { qid: 'q', item: 'i', answer: { id: 'x' } }, { kind: 'pc' })).toMatchObject({ ok: false });
    h.phone.later('abc', 'q'); h.phone.read('abc', 4);
    expect(seen).toEqual(['act desktop i', 'later desktop q', 'read desktop 3', 'act device:abc i', 'later device:abc q', 'read device:abc 4']);
  });
  it('turns a failed answer into the error message the PC gets, and does nothing without an operator', async () => {
    const h = pointHandlers({ act: async () => ({ ok: false, error: 'changed', code: 'changed' }) }, () => undefined);
    expect(await h.pc.act({ qid: 'q', item: 'i', suggest: true })).toEqual({ type: 'error', message: 'changed', request: 'point.act', code: 'changed' });
    expect(() => { h.pc.later('q'); h.pc.read(1); h.phone.later('d', 'q'); }).not.toThrow();
  });
});

describe('point.later and operator.read', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(AT)); });
  afterEach(() => { vi.useRealTimers(); });

  function operatorSetup() {
    const home = mkdtempSync(join(tmpdir(), 'ledge-pl-'));
    const store = new Store({ journalPath: join(home, 'j.json') });
    const chatDeps: ChatDeps = { store, tmux: { async capture() { return null; } } as never, home, env: async () => ({ ...process.env }) };
    const desktop = createChat({ ...chatDeps, home: join(home, 'd') });
    const journal = openJournal(':memory:');
    const told: string[][] = [];
    const all = (): Array<[DeviceId, Chat]> => [['desktop', desktop]];
    const operator = createOperator({ journal, machine: 'm', threads: { all, emitterOf: () => (_m: ChatMessage) => {} }, live: () => ({ sessions: [], asks: [], tasks: [], lang: 'fr' }),
      tool: () => 'claude', chatDeps, onNotices: n => told.push(n.map(x => x.id)), onPointPush: () => {} });
    return { operator, desktop, journal, told };
  }

  it('later hides the notice until a newer point', () => {
    const { operator, desktop, told } = operatorSetup();
    const qid = desktop.postPoint({ since: AT, lead: 'one', leadBy: 'daemon', items: [{ ...requestItem }] }, [], () => {});
    operator.refreshNotices();
    expect(told.at(-1)).toEqual([`point:${qid}`]);
    operator.later('desktop', qid);
    expect(told.at(-1)).toEqual([]);
    const next = desktop.postPoint({ since: AT, lead: 'two', leadBy: 'daemon', items: [{ ...requestItem }] }, [], () => {});
    operator.refreshNotices();
    expect(told.at(-1)).toEqual([`point:${next}`]);
  });

  it('operator.read moves only the sender device cursor', () => {
    const { operator, journal } = operatorSetup();
    for (const n of [1, 2, 3]) journal.record({ kind: 'session.finished', subjectKind: 'session', subjectId: `s${n}`, subjectName: 'x', urgency: 'grouped', payload: {}, machine: 'm', at: AT });
    operator.read('device:abc', 2);
    expect(journal.cursor('device:abc')).toBe(2);
    expect(journal.cursor('desktop')).toBe(0);
    // Never past the newest event: a wrong id would hide what comes next.
    operator.read('device:abc', 999);
    expect(journal.cursor('device:abc')).toBe(3);
  });
});
