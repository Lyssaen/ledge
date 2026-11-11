import { act, render, screen, within } from '@testing-library/react';
import type { PhoneHarnessUsage } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
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
});
