import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingKey, type ChatPoint, type HumanAsk, type PointItem, type Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChat, type Chat, type ChatDeps, type ChatMessage } from '../src/chat/service.js';
import { openJournal, type DeviceId } from '../src/operator/journal.js';
import { createOperator } from '../src/operator/index.js';
import { createPointActor, type Fail, type PointActDeps } from '../src/operator/act.js';

vi.mock('../src/log.js', () => ({ log: () => {} }));

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
    operator.read('device:abc', 7);
    expect(journal.cursor('device:abc')).toBe(7);
    expect(journal.cursor('desktop')).toBe(0);
  });
});
