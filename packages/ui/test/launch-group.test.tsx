import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChatProposal, ChatTurn } from '@ledge/protocol';
import { ChatView, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider } from '../src/chat/copy';
import { copy } from './chat-copy-fixture';
import { T0, fakeSession } from './fixtures';

const noop = () => {};
const base: ChatViewProps = { turns: [], live: null, sessions: [fakeSession('n2', { name: 'Nova' })], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop };
const row = (project: string, extra: Partial<ChatProposal> = {}): ChatProposal => ({ cwd: `/w/${project}`, project, tool: 'claude', ...extra });
const turnWith = (proposals: ChatProposal[]): ChatTurn[] => [{ qid: 'q1', question: 'Lance a, b et c', askedAt: T0, answeredAt: T0, steps: [], answer: 'Trois sessions.', proposal: proposals[0], proposals }];
const view = (proposals: ChatProposal[], extra: Partial<ChatViewProps> = {}) =>
  render(<ChatCopyProvider value={copy}><ChatView {...base} turns={turnWith(proposals)} now={Date.parse(T0)} {...extra} /></ChatCopyProvider>);

describe('the grouped launch card (#24)', () => {
  it('one row per session, each with its own launch, and « Launch all » for the checked rows', () => {
    const onLaunch = vi.fn();
    view([row('a'), row('b', { prompt: 'Rebase' }), row('c')], { onLaunchProposal: onLaunch });
    const card = screen.getByRole('region', { name: '3 sessions' });
    expect(card.querySelectorAll('[data-launch-row]')).toHaveLength(3);
    expect(card).toHaveTextContent('Rebase');
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Launch b' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Launch all (2)' }));
    expect(onLaunch).toHaveBeenLastCalledWith('q1', [0, 2]);
    fireEvent.click(within(card.querySelectorAll<HTMLElement>('[data-launch-row]')[1]!).getByRole('button', { name: 'Launch' }));
    expect(onLaunch).toHaveBeenLastCalledWith('q1', [1]);
  });
  it('a launched row names its session; a failed one says why and offers a retry; « Launch all » counts what is left', () => {
    const onOpen = vi.fn();
    view([row('a', { launchedId: 'n2' }), row('b', { error: 'no such folder' }), row('c')], { onLaunchProposal: noop, onOpenSession: onOpen });
    const rows = document.querySelectorAll<HTMLElement>('[data-launch-row]');
    expect(rows[0]).toHaveAttribute('data-launch-row', 'launched');
    fireEvent.click(within(rows[0]!).getByRole('link', { name: 'Nova' }));
    expect(onOpen).toHaveBeenCalledWith('n2');
    expect(within(rows[0]!).queryByRole('checkbox')).toBeNull();
    expect(rows[1]).toHaveTextContent('no such folder');
    expect(within(rows[1]!).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Launch all (2)' })).toBeInTheDocument();
  });
  it('everything launched: no « Launch all »', () => {
    view([row('a', { launchedId: 'n2' }), row('b', { launchedId: 'n3' })]);
    expect(screen.queryByRole('button', { name: /Launch all/ })).toBeNull();
  });
  it('while a launch runs, every button waits and the rows in flight say so', () => {
    view([row('a'), row('b')], { onLaunchProposal: noop, launchingQid: 'q1', launchingRows: [1] });
    for (const b of screen.getAllByRole('button', { name: /Launch/ })) expect(b).toBeDisabled();
    expect(document.querySelectorAll('[data-launch-row]')[1]).toHaveTextContent('Launching');
  });
  it('a single proposal keeps the one-session card', () => {
    view([row('a')]);
    expect(document.querySelector('[data-launch-card]')).not.toBeNull();
    expect(document.querySelector('[data-launch-group]')).toBeNull();
  });
});
