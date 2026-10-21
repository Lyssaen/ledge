import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChatClose, ChatTurn } from '@ledge/protocol';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider } from '../src/chat/copy';
import { copy } from './chat-copy-fixture';
import { T0, fakeSession } from './fixtures';

const noop = () => {};
const sessions = [fakeSession('n1', { name: 'Nova' }), fakeSession('n2', { name: 'Orion' }), fakeSession('n3', { name: 'Pixel', state: 'exited' })];
const base: ChatViewProps = { turns: [], live: null, sessions, visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop };
const row = (id: string, name: string, extra: Partial<ChatClose> = {}): ChatClose => ({ id, name, tool: 'claude', ...extra });
const turnWith = (closes: ChatClose[]): ChatTurn[] => [{ qid: 'q1', question: 'Ferme a, b et c', askedAt: T0, answeredAt: T0, steps: [], answer: 'Je propose de fermer.', closes }];
const view = (closes: ChatClose[], extra: Partial<ChatViewProps> = {}) =>
  render(<ChatCopyProvider value={copy}><ChatView {...base} turns={turnWith(closes)} now={Date.parse(T0)} {...extra} /></ChatCopyProvider>);
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-close-row]')];

describe('the close card (close from chat)', () => {
  it('shows one row per session with its name, tool and live state', () => {
    const onOpen = vi.fn();
    view([row('n1', 'Nova'), row('n2', 'Orion')], { onCloseSessions: noop, onOpenSession: onOpen });
    const card = screen.getByRole('region', { name: '2 sessions to close' });
    expect(card.hasAttribute('data-close-group')).toBe(true);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent('Claude');
    fireEvent.click(within(rows()[1]!).getByRole('link', { name: 'Orion' }));
    expect(onOpen).toHaveBeenCalledWith('n2');
    expect(document.querySelector('[data-launch-group], [data-launch-card]')).toBeNull();
  });
  it('closes one row, or all open rows', () => {
    const onCloseSessions = vi.fn();
    view([row('n1', 'Nova'), row('n2', 'Orion', { closedAt: T0, how: 'exit' }), row('n4', 'Zed')], { onCloseSessions });
    fireEvent.click(screen.getByRole('button', { name: 'Close all (2)' }));
    expect(onCloseSessions).toHaveBeenLastCalledWith('q1', [0, 2]);
    fireEvent.click(within(rows()[2]!).getByRole('button', { name: 'Close' }));
    expect(onCloseSessions).toHaveBeenLastCalledWith('q1', [2]);
  });
  it('shows closing, closed, force closed, ended and failed rows', () => {
    const onCloseSessions = vi.fn();
    view([row('n1', 'Nova'), row('n2', 'Orion', { closedAt: T0, how: 'exit' }), row('n4', 'Zed', { closedAt: T0, how: 'killed' }), row('n3', 'Pixel'), row('n5', 'Echo', { error: 'tmux gone' })],
      { onCloseSessions, closingQid: 'q1', closingRows: [0] });
    expect(rows().map(r => r.getAttribute('data-close-row'))).toEqual(['closing', 'closed', 'killed', 'ended', 'failed']);
    expect(rows()[0]).toHaveTextContent('Closing');
    expect(rows()[1]).toHaveTextContent('Closed');
    expect(rows()[2]).toHaveTextContent('Force closed');
    expect(rows()[3]).toHaveTextContent('Ended');
    expect(within(rows()[3]!).queryByRole('button')).toBeNull();
    expect(within(rows()[1]!).queryByRole('button')).toBeNull();
    expect(rows()[4]).toHaveTextContent('Failed: tmux gone');
  });
  it('a failed row retries on its own', () => {
    const onCloseSessions = vi.fn();
    view([row('n1', 'Nova'), row('n5', 'Echo', { error: 'tmux gone' })], { onCloseSessions });
    fireEvent.click(within(rows()[1]!).getByRole('button', { name: 'Retry' }));
    expect(onCloseSessions).toHaveBeenLastCalledWith('q1', [1]);
  });
  it('holds every button while busy or disabled', () => {
    const { unmount } = view([row('n1', 'Nova'), row('n2', 'Orion')], { onCloseSessions: noop, closingQid: 'q1', closingRows: [1] });
    for (const b of within(screen.getByRole('region', { name: '2 sessions to close' })).getAllByRole('button')) expect(b).toBeDisabled();
    unmount();
    view([row('n1', 'Nova'), row('n2', 'Orion')], { onCloseSessions: noop, launchingQid: 'other' });
    for (const b of within(screen.getByRole('region', { name: '2 sessions to close' })).getAllByRole('button')) expect(b).toBeDisabled();
  });
});
