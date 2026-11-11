import { act, render, screen, within } from '@testing-library/react';
import type { PhoneHarnessUsage } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { copy, setLang } from '../../src/copy';
import { Chat } from '../../src/screens/Chat';
import { session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { setup } from './setup';

// m3-chat.html §2, Q31 (contract docs/mobile-chat-m3-contract.md §2): the limits under the answer that read them.
const ON = { confirm: true, chat: true as const };
const Q1 = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const Q2 = '1b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const NOW = Date.now();
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const claude: PhoneHarnessUsage = { harness: 'claude', status: 'ok', readAt: at(-1), windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(60) }] };
const wide: PhoneHarnessUsage[] = [
  { harness: 'claude', status: 'ok', readAt: at(-1), windows: [{ kind: 'five_hour', pct: 100, resetsAt: at(60) }, { kind: 'seven_day', pct: 41, resetsAt: null }, { kind: 'model', model: 'Opus', pct: 30, resetsAt: at(60) }] },
  { harness: 'codex', status: 'ok', readAt: at(-1), windows: [{ kind: 'seven_day', pct: 22, resetsAt: at(60 * 24 * 10) }] },
  { harness: 'cursor', status: 'ok', readAt: at(-1), windows: [{ kind: 'month', pct: 50, resetsAt: at(60) }] }
];

function thread() {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Nova', repo: 'ledge' })], 'Atelier', undefined, ON));
  t.deliver({ type: 'usage.state', harnesses: [claude], prefs: { alert: 0.8 } });
  t.deliver(chat.history(
    chat.turn(Q1, { question: 'Où en est Nova ?', answer: 'Elle code.', answeredAt: at(-3) }),
    chat.turn(Q2, { question: 'Et mes limites ?', answer: 'Claude est à 84 %.', answeredAt: at(-1) })
  ));
  render(<Chat store={t.store} />);
  return t;
}
const limits = () => screen.queryAllByRole('group', { name: copy.chat.point.limitsLabel });

describe('the limits in an answer (Q31)', () => {
  it('under the answer that read them only, with when', () => {
    const t = thread();
    expect(limits()).toHaveLength(0);
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    expect(limits()).toHaveLength(1);
    const after = screen.getByText('Claude est à 84 %.');
    expect(after.compareDocumentPosition(limits()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Elle code.').compareDocumentPosition(limits()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(limits()[0]!).getByText('84 %')).toBeInTheDocument();
    expect(screen.getByText(copy.chat.point.stale('1 min'))).toBeInTheDocument();
  });

  it('compact rows as the board: harness and window, the percent, « ↺ » and its time, no « Limites » block', () => {
    const t = thread();
    act(() => t.deliver({ type: 'usage.state', harnesses: wide, prefs: { alert: 0.8 } }));
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    const g = within(limits()[0]!);
    expect(g.queryByText(copy.chat.point.limits)).toBeNull();
    expect(g.getByText(`Claude ${copy.chat.point.five}`)).toBeInTheDocument();
    expect(g.getByText('100 %')).toHaveClass('text-approval');
    expect(g.getByText(`Claude ${copy.chat.point.weekShort}`)).toBeInTheDocument();
    // No reset known: nothing after the percent.
    expect(g.getByText('41 %').nextElementSibling).toBeNull();
    // A reset beyond a week reads as a date.
    expect(g.getByText(`Codex ${copy.chat.point.weekShort}`)).toBeInTheDocument();
    expect(g.getByText('22 %').nextElementSibling?.textContent).toMatch(/^↺ \d{1,2} \S+$/);
    // Q89 A: a model's week by its name; Cursor's total alone; « ↺ » kept at 100 %.
    expect(g.getByText(`Opus ${copy.chat.point.weekShort}`)).toBeInTheDocument();
    expect(g.getByText('Cursor mois')).toBeInTheDocument();
    expect(g.getByText('100 %').nextElementSibling?.textContent).toMatch(/^↺ /);
  });

  it('Cursor: its total alone, never its pools (Q89 A)', () => {
    const t = thread();
    act(() => t.deliver({ type: 'usage.state', harnesses: [{ harness: 'cursor', status: 'ok', readAt: at(-1), windows: [
      { kind: 'month', pct: 50, resetsAt: at(60) }, { kind: 'pool', pool: 'cursor', pct: 70, resetsAt: at(60) }, { kind: 'pool', pool: 'other', pct: 20, resetsAt: at(60) }] }], prefs: { alert: 0.8 } }));
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    const g = within(limits()[0]!);
    expect(g.getByText('Cursor mois')).toBeInTheDocument();
    expect(g.queryByText('70 %')).toBeNull();
    expect(g.queryByText(copy.chat.point.poolOther)).toBeNull();
  });

  // Q90 A: a harness without a readable window, a row with « Limites »' sentence in the gauge's place.
  it('a harness without a readable window says why, in its row', () => {
    const t = thread();
    act(() => t.deliver({ type: 'usage.state', harnesses: [
      claude,
      { harness: 'codex', status: 'expired', readAt: at(-30), windows: [] },
      { harness: 'cursor', status: 'ok', readAt: at(-1), windows: [] }
    ], prefs: { alert: 0.8 } }));
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    const g = within(limits()[0]!);
    expect(g.getByText('Lecture impossible : reconnecte Codex sur le PC.')).toHaveClass('text-attention');
    expect(g.getByText('Limite non lue : Cursor ne la donne pas pour cette offre.')).toHaveClass('text-muted');
    expect(g.getByText('Codex')).toBeInTheDocument();
  });

  it('reading, and a PC silent for 25 min', () => {
    const t = thread();
    act(() => t.deliver({ type: 'usage.state', harnesses: [
      { harness: 'claude', status: 'loading', readAt: null, windows: [] },
      { harness: 'codex', status: 'unreachable', readAt: at(-90), windows: [] }
    ], prefs: { alert: 0.8 } }));
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    const g = within(limits()[0]!);
    expect(g.getByText('Lecture en cours…')).toHaveClass('text-muted');
    expect(g.getByText(/^Pas de lecture depuis /)).toHaveClass('text-attention');
    // No value: no « Lu il y a ».
    expect(g.queryByText(/^Lu il y a/)).toBeNull();
  });

  it('old values at half, « Lu il y a » the oldest one\'s age', () => {
    const t = thread();
    act(() => t.deliver({ type: 'usage.state', harnesses: [
      claude, { harness: 'codex', status: 'stale', readAt: at(-25), windows: [{ kind: 'five_hour', pct: 30, resetsAt: at(60) }] }
    ], prefs: { alert: 0.8 } }));
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    const g = within(limits()[0]!);
    expect(g.getByText(`Codex ${copy.chat.point.five}`).parentElement).toHaveClass('opacity-50');
    expect(g.getByText(`Claude ${copy.chat.point.five}`).parentElement).not.toHaveClass('opacity-50');
    expect(g.getByText(copy.chat.point.stale('25 min'))).toBeInTheDocument();
  });

  it('the PC sends them whole: a read it no longer lists goes', () => {
    const t = thread();
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    act(() => t.deliver({ type: 'chat.limits', reads: [] }));
    expect(limits()).toHaveLength(0);
  });

  it('« Nouvelle conversation » forgets them', () => {
    const t = thread();
    act(() => t.deliver({ type: 'chat.limits', reads: [{ qid: Q2, at: at(-1) }] }));
    act(() => t.store.resetChat());
    act(() => t.deliver(chat.history(chat.turn(Q2, { question: 'Et mes limites ?', answer: 'Claude est à 84 %.', answeredAt: at(-1) }))));
    expect(limits()).toHaveLength(0);
  });

  it('the English words of Q86, Q87 and Q89', () => {
    setLang('en');
    try {
      const c = copy.chat;
      expect([c.point.weekShort, c.point.monthShort]).toEqual(['wk', 'mo.']);
      expect([c.plusImage, c.enterSends]).toEqual(['+ Image', 'Enter sends']);
      expect(c.inAnswer.more(1)).toBe('See the other one in For you');
      expect(c.history.empty).toBe('No conversation yet.');
      expect(c.history.gone).toBe('This conversation is no longer kept on the PC.');
    } finally { setLang('fr'); }
  });
});
