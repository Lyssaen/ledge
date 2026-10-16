import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Turn } from '@ledge/protocol';
import { composerState, threadItems } from '../src/model/thread';
import { isNew, matches, type OpState } from '../src/model/operations';
import { loadDraft, markCleared, saveDraft, wasCleared } from '../src/state/drafts';
import { createMobileStore } from '../src/state/store';

const T = (m: number) => new Date(Date.UTC(2026, 9, 14, 10, m)).toISOString();
const s = (extra: Partial<Session> = {}): Session => ({ id: 'a', name: 'Bix', tool: 'claude', cwd: '/w/a', project: 'x', title: 'Bix · x', tmuxSession: 'ledge-a', state: 'idle', helpers: [], startedAt: T(0), lastActivityAt: T(0), source: 'launcher', ...extra } as Session);
const turn = (id: string, kind: Turn['kind'], m: number, extra: Partial<Turn> = {}): Turn => ({ id, kind, at: T(m), ...extra });
const msg = (extra: Partial<OpState> = {}): OpState => ({ operationId: 'o1', sessionId: 'a', kind: 'message', text: 'Lance les tests', phase: 'sending', startedAt: T(5), ...extra });

describe('threadItems', () => {
  it('keeps the PC order, turns decisions into events and a pending request into an awaiting card', () => {
    const turns = [
      turn('t1', 'prompt', 0, { text: 'Ajoute une recherche', source: 'pc' }),
      turn('t2', 'decision', 1, { decision: 'accept', source: 'phone', pendingId: 'p0' }),
      turn('t3', 'reply', 3, { text: '**Prête.**' }),
      turn('t4', 'decision', 2, { decision: 'deny', source: 'pc' }),
      turn('t5', 'answer', 4, { text: 'Sombre' }), turn('t6', 'resolved', 4), turn('t7', 'interrupt', 4)
    ];
    const pending = { id: 'p1', version: 1, since: T(6), kind: 'permission' as const, text: 'pnpm test', source: 'hook' as const, risk: 'low' as const };
    const items = threadItems(turns, s({ state: 'waiting_permission', pending }), {});
    expect(items.map(i => i.kind)).toEqual(['me', 'event', 'agent', 'event', 'event', 'event', 'event', 'awaiting']);
    expect(items.filter(i => i.kind === 'event').map(i => i.kind === 'event' && i.label)).toEqual([
      'Accord pris en compte · depuis le téléphone', 'Refus pris en compte · depuis le PC', 'Réponse prise en compte · Sombre', 'Traitée dans le terminal', 'Interruption transmise'
    ]);
    expect(items[7]).toMatchObject({ kind: 'awaiting', item: { sessionId: 'a', pendingId: 'p1' } });
  });

  it('a suggestion in the reply is never an action', () => {
    const [it, ...rest] = threadItems([turn('r', 'reply', 1, { text: '**Fait.**\n\n## Suite\n\nJe peux montrer le diff.' })], s(), {});
    expect(rest).toEqual([]);
    expect(it).toMatchObject({ kind: 'agent' });
    expect(it!.kind === 'agent' && it!.doc.sections.some(x => x.kind === 'next')).toBe(true);
  });

  it('shows an instruction on its way, then taken, and never twice once the PC lists it', () => {
    expect(threadItems([], s(), { o1: msg() })).toMatchObject([{ kind: 'me', text: 'Lance les tests', delivery: 'sending' }]);
    expect(threadItems([], s(), { o1: msg({ phase: 'uncertain' }) })).toMatchObject([{ delivery: 'uncertain' }]);
    const at = Date.parse(T(5));
    expect(threadItems([], s(), { o1: msg({ phase: 'applied' }) }, at + 5_000)).toMatchObject([{ delivery: 'taken', fresh: true }]);
    expect(threadItems([], s(), { o1: msg({ phase: 'applied' }) }, at + 60_000)[0]).not.toHaveProperty('fresh');
    expect(threadItems([], s(), { o1: msg({ phase: 'rejected', reason: 'agent_busy' }) })).toEqual([]);
    const listed = [turn('p', 'prompt', 6, { text: 'Lance les tests', source: 'phone' })];
    expect(threadItems(listed, s(), { o1: msg({ phase: 'applied' }) })).toMatchObject([{ key: 'p', delivery: 'taken' }]);
  });
});

describe('composerState', () => {
  const c = (session: Session, link: 'online' | 'offline' | 'connecting' = 'online', sending = false) => composerState(session, link, sending);
  it('is open only for an idle agent on a live link', () => {
    expect(c(s())).toEqual({ enabled: true, placeholder: 'Écrire à Bix…', status: { tone: 'ok', label: 'Disponible pour votre consigne' } });
  });
  it('is disabled while working, awaiting a decision or offline', () => {
    expect(c(s({ state: 'working' }))).toMatchObject({ enabled: false, placeholder: 'L’agent travaille…', status: { label: 'Au travail · consultez le terminal' } });
    expect(c(s({ state: 'waiting_input' }))).toMatchObject({ enabled: false, placeholder: 'Traitez la demande ci-dessus', status: { tone: 'attention', label: 'En attente d’une décision' } });
    expect(c(s(), 'offline')).toMatchObject({ enabled: false, placeholder: 'Reconnectez-vous pour écrire', status: { tone: 'muted', label: 'Connexion perdue · dernier état connu' } });
    expect(c(s(), 'online', true).enabled).toBe(false);
    expect(c(s({ source: 'hook_only' })).enabled).toBe(false);
    expect(c(s({ state: 'exited' })).enabled).toBe(false);
  });
});

describe('instruction and interrupt operations', () => {
  const reply = { type: 'session.reply' as const, id: 'a', text: 'Lance les tests', operationId: 'o1' };
  it('an instruction names no request; an answer must', () => {
    expect(matches(msg(), reply)).toBe(true);
    expect(matches(msg(), { ...reply, text: 'autre' })).toBe(false);
    expect(matches(msg(), { ...reply, pendingId: 'p' })).toBe(false);
    expect(matches(msg({ kind: 'answer' }), reply)).toBe(false);
  });
  it('an interrupt matches only its own message', () => {
    const op: OpState = { operationId: 'o2', sessionId: 'a', kind: 'interrupt', phase: 'sending', startedAt: T(1) };
    expect(matches(op, { type: 'session.interrupt', id: 'a', operationId: 'o2' })).toBe(true);
    expect(matches(op, { type: 'session.interrupt', id: 'b', operationId: 'o2' })).toBe(false);
    expect(matches(op, reply)).toBe(false);
  });
  it('refuses a second instruction while one is in flight or uncertain, not after it finished', () => {
    const next = msg({ operationId: 'o2' });
    expect(isNew({ o1: msg() }, next)).toBe(false);
    expect(isNew({ o1: msg({ phase: 'uncertain' }) }, next)).toBe(false);
    expect(isNew({ o1: msg({ phase: 'applied' }) }, next)).toBe(true);
    expect(isNew({ o1: msg({ phase: 'failed' }) }, next)).toBe(true);
    expect(isNew({ o1: msg({ sessionId: 'b' }) }, next)).toBe(true);
  });
});

describe('store and drafts', () => {
  let storage: Storage;
  beforeEach(() => { const m = new Map<string, string>(); storage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }; });
  it('keeps the turns the PC sends, in its order, replaced as a whole', () => {
    const store = createMobileStore(storage);
    const a = [turn('2', 'reply', 5, { text: 'x' }), turn('1', 'prompt', 1, { text: 'y' })];
    store.apply({ type: 'session.turns', id: 'a', turns: a });
    expect(store.getState().turns.a!.map(t => t.id)).toEqual(['2', '1']);
    store.apply({ type: 'session.removed', id: 'a' });
    expect(store.getState().turns.a).toBeUndefined();
  });
  it('sends an instruction once, online only', () => {
    const store = createMobileStore(storage);
    const sent: unknown[] = [];
    store.setSender(m => sent.push(m));
    expect(store.submit(msg(), { type: 'session.reply', id: 'a', text: 'Lance les tests', operationId: 'o1' })).toBe(false);
    store.setLink('online');
    expect(store.submit(msg(), { type: 'session.reply', id: 'a', text: 'Lance les tests', operationId: 'o1' })).toBe(true);
    expect(store.submit(msg({ operationId: 'o2' }), { type: 'session.reply', id: 'a', text: 'Lance les tests', operationId: 'o2' })).toBe(false);
    expect(sent).toHaveLength(1);
  });
  it('persists the latest turns with the last state, and drops them with their session', () => {
    const a = createMobileStore(storage);
    a.apply({ type: 'snapshot', sessions: [s()] });
    a.apply({ type: 'session.turns', id: 'a', turns: Array.from({ length: 80 }, (_, i) => turn(`t${i}`, 'reply', 1, { text: 'x' })) });
    const b = createMobileStore(storage);
    expect(b.getState().turns.a).toHaveLength(50);
    expect(b.getState().turns.a![49]!.id).toBe('t79');
    a.apply({ type: 'snapshot', sessions: [] });
    expect(createMobileStore(storage).getState().turns.a).toBeUndefined();
  });
  it('keeps the session list when the turns cannot be saved, and saves the turns only when they arrive', () => {
    const real = storage.setItem.bind(storage);
    const writes: string[] = [];
    storage.setItem = (k: string, v: string) => { writes.push(k); if (k === 'ledge.mobile.turns') throw new DOMException('full', 'QuotaExceededError'); real(k, v); };
    const a = createMobileStore(storage);
    a.apply({ type: 'snapshot', sessions: [s()] });
    a.apply({ type: 'session.preview', id: 'a', lines: ['x'] });
    expect(writes).not.toContain('ledge.mobile.turns');
    a.apply({ type: 'session.turns', id: 'a', turns: [turn('t1', 'reply', 1, { text: 'x' })] });
    expect(writes).toContain('ledge.mobile.turns');
    expect(a.getState().turns.a).toHaveLength(1);
    a.apply({ type: 'session.preview', id: 'a', lines: ['y'] });
    const b = createMobileStore(storage);
    expect(b.getState().sessions.map(x => x.id)).toEqual(['a']);
    expect(b.getState().previews.a).toEqual(['y']);
  });
  it('remembers a cleared instruction across reloads', () => {
    expect(wasCleared('o1', storage)).toBe(false);
    markCleared('o1', storage);
    expect(wasCleared('o1', storage)).toBe(true);
  });
  it('stores a draft per session and forgets an empty one', () => {
    saveDraft('a', 'Salut', storage);
    expect(loadDraft('a', storage)).toBe('Salut');
    expect(storage.getItem('ledge.mobile.draft.a')).toBe('Salut');
    saveDraft('a', '', storage);
    expect(loadDraft('a', storage)).toBe('');
  });
});
