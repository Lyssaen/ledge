import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatTurn } from '@ledge/protocol';
import { ChatView, TurnCards, type ChatViewProps } from '../src/chat/ChatView';
import { ChatCopyProvider, type ChatCopy } from '../src/chat/copy';
import { copy } from './chat-copy-fixture';
import { T0, fakeSession } from './fixtures';

const noop = () => {};
const withRig: ChatCopy = { ...copy, chat: { ...copy.chat, rigLaunch: { label: 'Rig to launch', launch: 'Launch this rig' } } };
const posted: ChatTurn = { qid: 'brain-1', question: '', askedAt: T0, answeredAt: T0, steps: [], answer: 'Je propose de lancer le rig starter : réparer le build',
  rigLaunch: { spec: 'starter', goal: 'réparer le build', project: 'ledge', machine: 'local' } };
const asked: ChatTurn = { qid: 'q1', question: 'Où en est Otto ?', askedAt: T0, answeredAt: T0, steps: [], answer: 'Il teste.' };
const base: ChatViewProps = { turns: [asked, posted], live: null, sessions: [fakeSession('local:otto')], visible: true, offline: null, onAsk: noop, onCancel: noop, onReset: noop, onBack: noop, onClose: noop, onOpenSession: noop, now: Date.parse(T0) };

describe('turns the brain posts (lot 7)', () => {
  it('a turn with an empty question has no question bubble', () => {
    const { container } = render(<ChatCopyProvider value={copy}><ChatView {...base} /></ChatCopyProvider>);
    const bubbles = [...container.querySelectorAll('[data-chat-question]')];
    expect(bubbles.map(b => b.textContent)).toEqual(['Où en est Otto ?']);
    expect(screen.getByText(/Je propose de lancer le rig starter/)).toBeInTheDocument();
  });

  it('a rigLaunch turn draws « Lancer ce rig », whose click hands the card over', () => {
    const onRigLaunch = vi.fn();
    render(<ChatCopyProvider value={withRig}><TurnCards turn={posted} sessions={[]} offline={null} onOpenSession={noop} onRigLaunch={onRigLaunch} /></ChatCopyProvider>);
    const card = screen.getByRole('region', { name: 'Rig to launch' });
    expect(card).toHaveTextContent('starter');
    expect(card).toHaveTextContent('réparer le build');
    fireEvent.click(screen.getByRole('button', { name: 'Launch this rig' }));
    expect(onRigLaunch).toHaveBeenCalledWith(posted.rigLaunch);
  });

  it('without onRigLaunch or its copy, no card', () => {
    render(<ChatCopyProvider value={copy}><TurnCards turn={posted} sessions={[]} offline={null} onOpenSession={noop} onRigLaunch={noop} /></ChatCopyProvider>);
    expect(screen.queryByRole('button', { name: 'Launch this rig' })).toBeNull();
  });
});
