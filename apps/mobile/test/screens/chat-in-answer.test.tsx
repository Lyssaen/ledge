import { act, render, screen } from '@testing-library/react';
import type { PhoneSession } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import { Chat } from '../../src/screens/Chat';
import { pending, session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

// m3-chat.html §2, Q30: a request waiting in a session the answer read shows as « À toi »'s card under the latest answer.
const ON = { confirm: true, chat: true as const };
const Q1 = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const Q2 = '1b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const asking = (id: string, name: string, key = `k-${id}`) =>
  session(id, { name, repo: 'ledge', state: 'waiting_permission', pending: pending({ key, text: `pnpm build ${name}` }) });
const read = (...names: string[]) => names.map(name => ({ kind: 'reply' as const, name }));

function thread(sessions: PhoneSession[], ...turns: Parameters<typeof chat.turn>[]) {
  const t = setup();
  t.deliver(snapshot(sessions, 'Atelier', undefined, ON));
  t.deliver(chat.history(...turns.map(a => chat.turn(...a))));
  render(<Chat store={t.store} />);
  return t;
}
const label = (name: string) => copy.chat.inAnswer.request(name);

describe('a request in the answer (Q30)', () => {
  it('under the latest answer, for its sources that wait now; not for a session it did not read', () => {
    thread([asking('a', 'Nova'), asking('b', 'Otto'), session('c', { name: 'Pim' })],
      [Q1, { question: 'Où en est Nova ?', answer: 'Nova attend.', answeredAt: '2026-11-11T10:00:05.000Z', steps: read('Nova', 'Pim') }]);
    expect(screen.getByText(label('Nova'))).toBeInTheDocument();
    expect(screen.getByText('pnpm build Nova')).toBeInTheDocument();
    expect(screen.queryByText(label('Otto'))).toBeNull();
    expect(screen.queryByText(label('Pim'))).toBeNull();
  });

  it("two sessions with one name: the step's session id finds the one that waits", () => {
    thread([session('a', { name: 'Nova', repo: 'ledge' }), asking('b', 'Nova')],
      [Q1, { question: 'Où en est Nova ?', answer: 'Nova attend.', answeredAt: '2026-11-11T10:00:05.000Z', steps: [{ kind: 'reply', id: 'b', name: 'Nova' }] }]);
    expect(screen.getByText(label('Nova'))).toBeInTheDocument();
    expect(screen.getByText('pnpm build Nova')).toBeInTheDocument();
  });

  it('control: the same names, the step read the session that does not wait', () => {
    thread([session('a', { name: 'Nova', repo: 'ledge' }), asking('b', 'Nova')],
      [Q1, { question: 'Où en est Nova ?', answer: 'Nova travaille.', answeredAt: '2026-11-11T10:00:05.000Z', steps: [{ kind: 'reply', id: 'a', name: 'Nova' }] }]);
    expect(screen.queryByText(label('Nova'))).toBeNull();
  });

  it('three at most, then « Voir les N autres dans À toi »', () => {
    const names = ['Ada', 'Bix', 'Cy', 'Dee', 'Eve'];
    thread(names.map((n, i) => asking(String(i), n)),
      [Q1, { answer: 'Ils attendent.', answeredAt: '2026-11-11T10:00:05.000Z', steps: read(...names) }]);
    expect(screen.getAllByText(/^En attente dans la session de/)).toHaveLength(3);
    expect(screen.getByRole('link', { name: copy.chat.inAnswer.more(2) })).toHaveAttribute('href', '#/');
  });

  it('an older answer keeps « Réglée depuis » once its request is gone; the newer one shows no card for it', () => {
    const t = thread([asking('a', 'Nova')],
      [Q1, { question: 'Où en est Nova ?', answer: 'Nova attend.', answeredAt: '2026-11-11T10:00:05.000Z', steps: read('Nova') }]);
    expect(screen.getByText(label('Nova'))).toBeInTheDocument();
    act(() => t.deliver({ type: 'session.updated', session: session('a', { name: 'Nova', repo: 'ledge', state: 'working' }) }));
    act(() => t.deliver(chat.history(
      chat.turn(Q1, { question: 'Où en est Nova ?', answer: 'Nova attend.', answeredAt: '2026-11-11T10:00:05.000Z', steps: read('Nova') }),
      chat.turn(Q2, { question: 'Et Pim ?', answer: 'Pim dort.', answeredAt: '2026-11-11T10:01:05.000Z', steps: [] })
    )));
    expect(screen.getByText(`${copy.chat.inAnswer.settled} · Nova`)).toBeInTheDocument();
    expect(screen.queryByText(label('Nova'))).toBeNull();
  });

  it('control: no line under an older answer whose request still waits', () => {
    const t = thread([asking('a', 'Nova')],
      [Q1, { question: 'Où en est Nova ?', answer: 'Nova attend.', answeredAt: '2026-11-11T10:00:05.000Z', steps: read('Nova') }]);
    act(() => t.deliver(chat.history(
      chat.turn(Q1, { question: 'Où en est Nova ?', answer: 'Nova attend.', answeredAt: '2026-11-11T10:00:05.000Z', steps: read('Nova') }),
      chat.turn(Q2, { question: 'Et Pim ?', answer: 'Pim dort.', answeredAt: '2026-11-11T10:01:05.000Z', steps: [] })
    )));
    expect(screen.queryByText(new RegExp(copy.chat.inAnswer.settled))).toBeNull();
  });
});
