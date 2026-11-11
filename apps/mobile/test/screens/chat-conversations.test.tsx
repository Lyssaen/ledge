import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneChatAction, PhoneServerMessage } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import { Chat } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

// m3-chat.html §6 (Q33 A): the clock's « Conversations », a past conversation read-only, and fallback B on an older PC.
const H = copy.chat.history;
const ON = { confirm: true, chat: true as const };
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const Q1 = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const Q2 = '1b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';

function chatSetup(kept: boolean) {
  const t = setup();
  const s = snapshot([session('a', { name: 'Nova', repo: 'ledge' })], 'Atelier', undefined, ON) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...s, daemon: { ...s.daemon, ...(kept ? { conversations: true } : {}) } } as PhoneServerMessage);
  render(<Chat store={t.store} />);
  return t;
}
const at = (daysAgo: number, h: number, m: number) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
const clock = () => screen.getByRole('button', { name: H.title });

describe('« Conversations » (m3-chat.html §6)', () => {
  it('the clock asks the PC for the list; while it comes, the head alone', () => {
    const t = chatSetup(true);
    fireEvent.click(clock());
    expect(t.of('chat.conversations')).toHaveLength(1);
    const sheet = screen.getByRole('dialog', { name: H.title });
    expect(within(sheet).getByRole('button', { name: copy.chat.reset })).toBeInTheDocument();
    expect(within(sheet).queryByText(H.kept)).toBeNull();
  });

  it('the current one on top, then the others by day, each with its first question and its count', () => {
    const t = chatSetup(true);
    fireEvent.click(clock());
    act(() => t.deliver({
      type: 'chat.conversations',
      current: { id: ID(1), startedAt: at(0, 9, 12), lastAt: at(0, 9, 40), first: 'Où en est ledge-dev ?', count: 4 },
      past: [
        { id: ID(2), startedAt: at(0, 7, 40), lastAt: at(0, 7, 50), first: 'Résumer la nuit', count: 7 },
        { id: ID(3), startedAt: at(1, 17, 5), lastAt: at(1, 17, 9), first: 'Qui a touché à layout.ts aujourd’hui ?', count: 3 },
        { id: ID(4), startedAt: at(1, 11, 30), lastAt: at(1, 11, 31), first: 'Redémarre ledge-dev', count: 1 }
      ]
    }));
    const sheet = screen.getByRole('dialog', { name: H.title });
    expect(within(sheet).getByRole('button', { name: /« Où en est ledge-dev \? ».*En cours · 4 questions · depuis 09:12/ })).toHaveAttribute('aria-current', 'true');
    expect(within(within(sheet).getByRole('region', { name: H.today })).getByRole('button', { name: /Résumer la nuit.*7 questions · 07:40/ })).toBeInTheDocument();
    const yesterday = within(sheet).getByRole('region', { name: H.yesterday });
    expect(within(yesterday).getAllByRole('button')).toHaveLength(2);
    expect(within(yesterday).getByRole('button', { name: /Redémarre ledge-dev.*1 question · 11:30/ })).toBeInTheDocument();
    expect(within(sheet).getByText(H.kept)).toBeInTheDocument();
  });

  it('a past conversation opens read-only: its title, the banner, its cards off with their outcome, no composer; then back', () => {
    const t = chatSetup(true);
    fireEvent.click(clock());
    act(() => t.deliver({ type: 'chat.conversations', past: [{ id: ID(4), startedAt: at(1, 11, 30), lastAt: at(1, 11, 31), first: 'Redémarre ledge-dev', count: 1 }] }));
    fireEvent.click(screen.getByRole('button', { name: /Redémarre ledge-dev/ }));
    expect(t.of('chat.conversation')).toEqual([{ type: 'chat.conversation', id: ID(4) }]);
    expect(screen.getByRole('banner')).toHaveTextContent(`${H.yesterday}, 11:30`);
    expect(screen.getByText(H.pastBanner)).toBeInTheDocument();
    expect(screen.queryByLabelText('Question pour Ledge')).toBeNull();
    const archive: PhoneChatAction = { action: 'session.archive', summary: 'Archiver **Nova**', vars: { session: 'Nova' }, risk: 'reversible', session: 'a' };
    act(() => t.deliver({ type: 'chat.conversation', id: ID(4), turns: [chat.turn(Q1, {
      question: 'Redémarre ledge-dev', answer: 'Deux étapes.', answeredAt: '2026-11-10T11:30:05.000Z',
      actions: [{ ...archive, state: 'done', doneAt: '2026-11-10T11:31:00.000Z' }, archive]
    })] }));
    const card = screen.getByRole('region', { name: /Plan de 2 actions/ });
    expect(within(card).getByText(H.notApplied)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Archiver' })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Tout appliquer/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: H.backToday }));
    expect(screen.getByLabelText('Question pour Ledge')).toBeInTheDocument();
  });

  it('control: the same card in the current conversation keeps its buttons', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Nova', repo: 'ledge' })], 'Atelier', undefined, ON));
    const archive: PhoneChatAction = { action: 'session.archive', summary: 'Archiver **Nova**', vars: { session: 'Nova' }, risk: 'reversible', session: 'a' };
    t.deliver(chat.history(chat.turn(Q1, { answer: 'Deux étapes.', answeredAt: '2026-11-10T11:30:05.000Z', actions: [{ ...archive, state: 'done', doneAt: '2026-11-10T11:31:00.000Z' }, archive] })));
    render(<Chat store={t.store} />);
    const card = screen.getByRole('region', { name: /Plan de 2 actions/ });
    expect(within(card).getByRole('button', { name: 'Archiver' })).toBeEnabled();
    expect(within(card).queryByText(H.notApplied)).toBeNull();
  });

  it('« Nouvelle conversation » in the sheet starts over', () => {
    const t = chatSetup(true);
    fireEvent.click(clock());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.chat.reset }));
    expect(t.of('chat.reset')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fallback B, a PC that keeps none: « Aujourd’hui » lists the thread’s questions, nothing is asked', () => {
    const t = chatSetup(false);
    act(() => t.deliver(chat.history(chat.turn(Q1, { question: 'Où en est ledge-dev ?', askedAt: at(0, 9, 12) }), chat.turn(Q2, { question: 'Et mes limites ?', askedAt: at(0, 9, 14) }))));
    fireEvent.click(screen.getByRole('button', { name: H.today }));
    const sheet = screen.getByRole('dialog', { name: H.today });
    expect(within(sheet).getAllByRole('button').map(b => b.textContent)).toEqual(['« Où en est ledge-dev ? »09:12', '« Et mes limites ? »09:14']);
    expect(t.of('chat.conversations')).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole('button', { name: /Et mes limites/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fallback B, empty: Desktop’s words', () => {
    chatSetup(false);
    fireEvent.click(screen.getByRole('button', { name: H.today }));
    expect(within(screen.getByRole('dialog')).getByText(H.none)).toBeInTheDocument();
  });
});
