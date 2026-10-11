import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChatTurn } from '@ledge/protocol';
import { ChatView } from '../src/surface/ChatView';
import { AskField } from '../src/surface/AskField';
import { fakeSession } from './mockDaemon';

const T0 = '2026-10-11T10:00:00.000Z';
const sessions = [fakeSession('a', { name: 'Nova', repoPath: '/w/ledge' }), fakeSession('b', { name: 'Pim', repoPath: '/w/other' })];
const base = { sessions, visible: true, offline: null, onAsk: () => {}, onCancel: () => {}, onReset: () => {}, onBack: () => {}, onClose: () => {}, onOpenSession: () => {} };

describe('<AskField>', () => {
  it('sends a non-empty question on Enter and reports typing', () => {
    const onAsk = vi.fn(), onTyping = vi.fn();
    render(<AskField onAsk={onAsk} onTyping={onTyping} />);
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.focus(input); expect(onTyping).toHaveBeenCalledWith(true);
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onAsk).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' Où en sont les autres ? ' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('Où en sont les autres ?'); expect(input).toHaveValue('');
  });
  it('Enter on an empty field and a click on the mascot open the chat without asking', () => {
    const onAsk = vi.fn(), onOpen = vi.fn();
    render(<AskField onAsk={onAsk} onOpen={onOpen} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask Ledge' }), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1); expect(onAsk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open the conversation with Ledge' }));
    expect(onOpen).toHaveBeenCalledTimes(2); expect(onAsk).not.toHaveBeenCalled();
  });
});

describe('<ChatView>', () => {
  it('shows the suggestions when empty, and asks one on click', () => {
    const onAsk = vi.fn();
    render(<ChatView {...base} turns={[]} live={null} onAsk={onAsk} />);
    expect(screen.getByText('Sees 2 sessions · 2 repositories · read only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'How are the others doing?' }));
    expect(onAsk).toHaveBeenCalledWith('How are the others doing?');
  });
  it('shows a running turn with its steps, the live text and a stop button', () => {
    const onCancel = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'a', name: 'Nova' }] }];
    render(<ChatView {...base} turns={turns} live={{ qid: 'q1', text: 'Deux ' }} onCancel={onCancel} />);
    expect(screen.getByText('Reads the sessions')).toBeInTheDocument(); expect(screen.getByText("Reads Nova's terminal")).toBeInTheDocument();
    expect(screen.getByText('Deux')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' })); expect(onCancel).toHaveBeenCalledWith('q1');
    expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeDisabled();
  });
  it('offers a new conversation between questions only', () => {
    const onReset = vi.fn();
    const done: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], answer: 'ok', answeredAt: T0 }];
    const { rerender } = render(<ChatView {...base} turns={[]} live={null} onReset={onReset} />);
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    rerender(<ChatView {...base} turns={[{ qid: 'q1', question: 'x', askedAt: T0, steps: [] }]} live={null} onReset={onReset} />);
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    rerender(<ChatView {...base} turns={done} live={null} onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' })); expect(onReset).toHaveBeenCalledTimes(1);
  });
  it('renders the answer, links bot names to their session, and lists the sources', () => {
    const onOpen = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }, { kind: 'git', id: 'b', name: 'Pim' }], answer: '**Nova** attend votre accord.\n\n- `git push` en attente\n- rien d\'autre', answeredAt: T0 }];
    render(<ChatView {...base} turns={turns} live={null} onOpenSession={onOpen} now={Date.parse(T0) + 10_000} />);
    fireEvent.click(screen.getByRole('link', { name: 'Nova' })); expect(onOpen).toHaveBeenCalledWith('a');
    expect(screen.getByText('git push')).toBeInTheDocument();
    const sources = screen.getByText('Sources').parentElement!;
    expect(within(sources).getByText('the sessions')).toBeInTheDocument(); expect(within(sources).getByText("git in Pim's folder")).toBeInTheDocument(); expect(within(sources).getByText(/ago$/)).toBeInTheDocument();
  });
  it('shows an error under the question and reopens the field; offline disables it with the reason', () => {
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], error: 'boom' }];
    const { rerender } = render(<ChatView {...base} turns={turns} live={null} />);
    expect(screen.getByText('Ledge could not answer: boom')).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeEnabled();
    rerender(<ChatView {...base} turns={[]} live={null} offline="Offline" />);
    expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeDisabled(); expect(screen.getByText('Offline')).toBeInTheDocument();
  });
  it('an answered turn with an empty answer keeps the chat usable and shows only its sources', () => {
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }], answer: '', answeredAt: T0 }];
    render(<ChatView {...base} turns={turns} live={null} now={Date.parse(T0) + 10_000} />);
    expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByText('Sources')).toBeInTheDocument();
  });
  it('a cancelled turn says Stopped, not an error', () => {
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], error: 'cancelled' }];
    render(<ChatView {...base} turns={turns} live={null} />);
    expect(screen.getByText('Stopped.')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('claims every ledge:// link so none reaches the browser', () => {
    const onOpen = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], answer: '[autre](ledge://other/1)', answeredAt: T0 }];
    render(<ChatView {...base} turns={turns} live={null} onOpenSession={onOpen} />);
    fireEvent.click(screen.getByRole('link', { name: 'autre' })); expect(onOpen).not.toHaveBeenCalled();
  });
  it('a ledge:// link nested in bold still opens its session', () => {
    const onOpen = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], answer: '**voir [la session](ledge://session/a)**', answeredAt: T0 }];
    render(<ChatView {...base} turns={turns} live={null} onOpenSession={onOpen} />);
    fireEvent.click(screen.getByRole('link', { name: 'la session' })); expect(onOpen).toHaveBeenCalledWith('a');
  });
  it('the empty-state hint reads naturally for 0, 1 and several sessions', () => {
    const { rerender } = render(<ChatView {...base} sessions={[]} turns={[]} live={null} />);
    expect(screen.getByText('I see no session yet. I read, I touch nothing.')).toBeInTheDocument();
    rerender(<ChatView {...base} sessions={sessions.slice(0, 1)} turns={[]} live={null} />);
    expect(screen.getByText('I see 1 session, its terminal and its repository. I read, I touch nothing.')).toBeInTheDocument();
    rerender(<ChatView {...base} turns={[]} live={null} />);
    expect(screen.getByText('I see 2 sessions, the terminals and the repositories. I read, I touch nothing.')).toBeInTheDocument();
  });
});
