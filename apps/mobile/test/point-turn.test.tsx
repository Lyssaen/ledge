import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatPoint, HumanAsk, PhoneChatTurn, PhoneServerMessage, PointItem } from '@ledge/protocol';
import { copy, setLang } from '../src/copy';
import { getAssertion } from '../src/link/webauthn';
import { Chat } from '../src/screens/Chat';
import { pointCheck } from '../src/model/point';
import { pending, session } from './model/fixtures';
import { chat, snapshot } from './state/helpers';
import { setup } from './screens/setup';

vi.mock('../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

// The operator's point on the phone (docs/mockups/ledge-operator.html, board 7): the compact form, in the Ledge tab.

const QID = '5c1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const AT = '2026-11-13T13:32:00.000Z';
const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };

const ask: PointItem = {
  id: 'rig.ask:q1', event: 4, group: 'atoi', tone: 'ask', who: 'pilot-lead', rig: 'ledge-dev', text: 'Fusionner #309 ?', at: AT,
  ref: { kind: 'rig.ask', qitem: 'q1' }, answers: [{ id: 'merge', label: 'Fusionner', style: 'primary' }, { id: 'wait', label: 'Attendre', style: 'plain' }]
};
const perm: PointItem = {
  id: 'session.request:a', event: 5, group: 'atoi', tone: 'perm', who: 'Nova', text: 'pnpm -r test -u', at: AT,
  ref: { kind: 'session.request', session: 'a', key: 'p1' }, answers: [{ id: 'accept', label: 'Autoriser', style: 'primary' }, { id: 'deny', label: 'Refuser', style: 'plain' }]
};
const done: PointItem = { id: 'session.finished:r', event: 6, group: 'done', tone: 'idle', who: 'Rex', text: 'a fini', sub: 'PR #41', at: AT };
const task = (n: number): PointItem => ({ id: `task:t${n}`, event: 6 + n, group: 'ongoing', tone: 'work', who: 'Otto', text: `Tâche ${n}`, sub: 'ouverte', at: AT });
const point: ChatPoint = { since: AT, lead: 'Deux choses pour toi : pilot-lead attend ta décision sur #309, et Rex a fini.', leadBy: 'agent', items: [ask, perm, done, task(1), task(2), task(3)] };
const turn: PhoneChatTurn = chat.turn(QID, { question: '', askedAt: AT, by: 'ledge', point, answer: point.lead, answeredAt: AT });

const humanAsk = { id: 'q1', kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Fusionner #309 ?', body: '', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q', question: 'Fusionner ?', options: [{ id: 'merge', label: 'Fusionner', recommended: true }, { id: 'wait', label: 'Attendre', recommended: false }] }],
  createdAt: AT, updatedAt: AT } as HumanAsk;

function open(o: { confirm?: boolean } = {}) {
  const t = setup();
  const snap = snapshot([session('a', { name: 'Nova', pending: pending({ text: 'pnpm -r test -u', risk: 'high' }) })], 'Atelier', undefined, { confirm: o.confirm ?? true, chat: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...snap, daemon: { ...snap.daemon, openrig: true } });
  t.deliver({ type: 'openrig.asks', channel: { state: 'ready', person: null, slack: false }, asks: [humanAsk] } as PhoneServerMessage);
  t.deliver(chat.history(turn));
  render(<Chat store={t.store} />);
  return t;
}
const card = () => screen.getByRole('article', { name: /Le point/ });

describe('the operator point on the phone (board 7)', () => {
  it('renders the compact point of board 7', () => {
    const t = open();
    const c = card();
    expect(within(c).getByText('Le point')).toBeInTheDocument();
    // The lead is the push's: the compact point shows its rows only.
    expect(within(c).queryByText(point.lead)).toBeNull();
    const row = (id: string) => c.querySelector(`[data-point-item="${id}"]`) as HTMLElement;
    expect(row(ask.id)).toHaveTextContent('pilot-lead : Fusionner #309 ?');
    expect(within(row(ask.id)).getByRole('button', { name: 'Fusionner' })).toBeInTheDocument();
    expect(within(row(ask.id)).getByRole('button', { name: 'Attendre' })).toBeInTheDocument();
    expect(row(perm.id)).toHaveTextContent('Nova : pnpm -r test -u');
    expect(within(row(perm.id)).getByText('pnpm -r test -u').tagName).toBe('CODE');
    expect(within(row(perm.id)).getByRole('button', { name: 'Autoriser' })).toBeInTheDocument();
    expect(row(done.id)).toHaveTextContent('Rex a fini · PR #41');
    expect(within(row(done.id)).queryByRole('button')).toBeNull();
    // The tasks under way fold to one line.
    expect(within(c).getByText('3 tâches en cours')).toBeInTheDocument();
    expect(within(c).queryByText('Tâche 1')).toBeNull();
    // Seen in the Ledge tab: the newest point is read up to its highest event.
    expect(t.of('operator.read')).toEqual([expect.objectContaining({ type: 'operator.read', eventId: 9 })]);
  });

  it('answering a rig ask item asks for verification', async () => {
    const t = open();
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    fireEvent.click(within(card()).getByRole('button', { name: 'Fusionner' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'rig', qitem: 'q1', answer: { kind: 'choice', questionId: 'q', optionId: 'merge' } }]));
    expect(t.of('point.act')).toHaveLength(0);
    t.deliver({ type: 'confirm.challenge', purpose: 'rig', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 });
    await waitFor(() => expect(t.of('point.act')).toHaveLength(1));
    const [sent] = t.of('point.act');
    expect(sent).toMatchObject({ qid: QID, item: ask.id, answer: { id: 'merge' }, assertion });
    expect(sent).not.toHaveProperty('confirmed');
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' });
  });

  it('a check dismissed is said under the row, and nothing is sent', async () => {
    const t = open();
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    fireEvent.click(within(card()).getByRole('button', { name: 'Fusionner' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    t.deliver({ type: 'confirm.challenge', purpose: 'rig', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 });
    expect(await within(card()).findByText(copy.confirm.cancelled)).toBeInTheDocument();
    expect(t.of('point.act')).toHaveLength(0);
  });

  it('a deny goes at once, without a check', async () => {
    const t = open();
    fireEvent.click(within(card()).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(t.of('point.act')).toHaveLength(1));
    expect(t.of('confirm.prepare')).toHaveLength(0);
    expect(t.of('point.act')[0]).toMatchObject({ item: perm.id, answer: { id: 'deny' } });
  });

  it('settled rows keep their receipt, and a point all settled folds to one line', () => {
    const t = setup();
    t.deliver(snapshot([], 'Atelier', undefined, { confirm: true, chat: true }));
    const settled = { ...ask, settled: { at: AT, where: 'phone' as const, answer: 'Fusionner' } };
    t.deliver(chat.history({ ...turn, point: { ...point, items: [settled] } }));
    const { unmount } = render(<Chat store={t.store} />);
    expect(card().querySelector(`[data-point-item="${ask.id}"]`)).toHaveTextContent(/Fusionner · réglé sur le téléphone/);
    expect(within(card()).queryByRole('button')).toBeNull();
    unmount();
    t.deliver(chat.history({ ...turn, point: { ...point, items: [settled], foldedAt: AT } }));
    render(<Chat store={t.store} />);
    expect(screen.getByRole('article', { name: /Tout est réglé depuis/ })).toBeInTheDocument();
  });
});

describe('pointCheck: what a row needs before it is sent, as the PC asks it', () => {
  const state = { asks: [humanAsk], sessions: new Map([['a', session('a', { pending: pending({ risk: 'high' }) })]]), tasks: new Map() };
  it('a rig ask: a `rig` check over the exact answer, no confirmation', () => {
    expect(pointCheck(QID, ask, { id: 'merge' }, state)).toEqual({ check: { purpose: 'rig', qitem: 'q1', answer: { kind: 'choice', questionId: 'q', optionId: 'merge' } } });
    expect(pointCheck(QID, ask, { text: 'Oui' }, state)).toEqual({ check: { purpose: 'rig', qitem: 'q1', answer: { kind: 'words', text: 'Oui' } } });
  });
  it('a request accepted: confirmed, and a `decide` check unless low risk; a deny needs nothing', () => {
    expect(pointCheck(QID, perm, { id: 'accept' }, state)).toEqual({ confirmed: true, check: { purpose: 'decide', id: 'a', expect: { key: 'p1', kind: 'permission', text: 'pnpm test' } } });
    const low = { ...state, sessions: new Map([['a', session('a', { pending: pending() })]]) };
    expect(pointCheck(QID, perm, { id: 'accept' }, low)).toEqual({ confirmed: true });
    expect(pointCheck(QID, perm, { id: 'deny' }, state)).toEqual({});
  });
  it('a decision: confirmed with an `act` check bound to the row and the answer', () => {
    const d: PointItem = { ...done, id: 'task:t9', group: 'atoi', tone: 'ask', ref: { kind: 'task', task: 't9' } };
    expect(pointCheck(QID, d, { id: 'yes' }, state)).toEqual({ confirmed: true, check: { purpose: 'act', qid: QID, item: 'task:t9', pointAnswer: { id: 'yes' } } });
  });
  it('a suggestion: an `act` check when it is destructive or the action asks for one', () => {
    const s: PointItem = { ...done, suggestion: { action: 'session.archive', summary: 'Archiver **Rex**', vars: { session: 'Rex' }, args: {}, risk: 'reversible' } };
    expect(pointCheck(QID, s, 'suggest', state)).toEqual({});
    const x: PointItem = { ...done, suggestion: { action: 'task.cancel', summary: 'Annuler', args: {}, risk: 'destructive' } };
    expect(pointCheck(QID, x, 'suggest', state)).toEqual({ confirmed: true, check: { purpose: 'act', qid: QID, item: done.id, suggest: true } });
  });
  it('a rig ask the phone does not see: nothing can be sent', () => {
    expect(pointCheck(QID, ask, { id: 'merge' }, { ...state, asks: [] })).toBeNull();
  });
});

describe('the point\'s words in English', () => {
  it('folds the tasks under way', () => {
    setLang('en');
    try { expect(copy.chat.operator.ongoing(3)).toBe('3 tasks in progress'); } finally { setLang('fr'); }
  });
});
