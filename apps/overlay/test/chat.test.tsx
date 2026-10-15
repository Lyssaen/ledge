import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChatRelay, ChatTurn } from '@ledge/protocol';
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
  const proposal = { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the overlay build' };
  const answered = (p: ChatTurn['proposal']): ChatTurn[] => [{ qid: 'q1', question: 'open a session in ledge', askedAt: T0, steps: [], answer: 'Here is the session I would start.', answeredAt: T0, proposal: p }];
  it('shows a proposal card under the answer; Launch names the turn', () => {
    const onLaunchProposal = vi.fn();
    render(<ChatView {...base} turns={answered(proposal)} live={null} onLaunchProposal={onLaunchProposal} />);
    const card = screen.getByRole('region', { name: 'Proposed session' });
    expect(card).toHaveTextContent('ledge'); expect(card).toHaveTextContent('/home/u/ledge');
    expect(card).toHaveTextContent('Claude Code · default'); expect(card).toHaveTextContent('Fix the overlay build');
    fireEvent.click(within(card).getByRole('button', { name: /Start the session/ }));
    expect(onLaunchProposal).toHaveBeenCalledWith('q1');
  });
  it('a card without instruction says so; Launch is disabled while launching or offline', () => {
    const { rerender } = render(<ChatView {...base} turns={answered({ ...proposal, prompt: undefined })} live={null} launchingQid="q1" />);
    const card = () => screen.getByRole('region', { name: 'Proposed session' });
    expect(card()).toHaveTextContent('None, empty session');
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    rerender(<ChatView {...base} turns={answered(proposal)} live={null} offline="Ledge is unreachable" />);
    expect(within(card()).getByRole('button', { name: /Start the session/ })).toBeDisabled();
  });
  it('a launched card names the companion as a link and offers its terminal', () => {
    const onOpenSession = vi.fn(), onTerminal = vi.fn();
    render(<ChatView {...base} turns={answered({ ...proposal, launchedId: 'a' })} live={null} onOpenSession={onOpenSession} onTerminal={onTerminal} />);
    const card = screen.getByRole('region', { name: 'Proposed session' });
    expect(card).toHaveTextContent('Nova has started');
    expect(within(card).queryByRole('button', { name: /Start the session/ })).toBeNull();
    fireEvent.click(within(card).getByRole('link', { name: 'Nova' })); expect(onOpenSession).toHaveBeenCalledWith('a');
    fireEvent.click(within(card).getByRole('button', { name: 'Terminal' })); expect(onTerminal).toHaveBeenCalledWith('a');
  });
  it('a failed card shows the reason and offers a retry', () => {
    const onLaunchProposal = vi.fn();
    render(<ChatView {...base} turns={answered({ ...proposal, error: 'no such folder: /home/u/ledge' })} live={null} onLaunchProposal={onLaunchProposal} />);
    const card = screen.getByRole('region', { name: 'Proposed session' });
    expect(within(card).getByRole('alert')).toHaveTextContent('Could not start: no such folder: /home/u/ledge');
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' })); expect(onLaunchProposal).toHaveBeenCalledWith('q1');
  });
  it('never shows the proposal block while the answer streams', () => {
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }] }];
    const { rerender } = render(<ChatView {...base} turns={turns} live={{ qid: 'q1', text: 'I would start it.\n``' }} />);
    expect(screen.queryByText(/``/)).toBeNull();
    rerender(<ChatView {...base} turns={turns} live={{ qid: 'q1', text: 'I would start it.\n```ledge-session\n{"cwd": "/home' }} />);
    expect(screen.getByText('I would start it.')).toBeInTheDocument();
    expect(screen.queryByText(/cwd/)).toBeNull(); expect(screen.queryByText(/ledge-session/)).toBeNull();
  });
  it('shows the suggestions when empty, and asks one on click', () => {
    const onAsk = vi.fn();
    render(<ChatView {...base} turns={[]} live={null} onAsk={onAsk} />);
    expect(screen.getByText('Sees 2 sessions · 2 repositories · read only')).toBeInTheDocument();
    // The suggestions sit inside the measured thread content: the view is sized to hold them, nothing scrolls.
    const content = document.querySelector('[data-chat-content]')!;
    expect(within(content as HTMLElement).getByText('To start with')).toBeInTheDocument();
    const chip = within(content as HTMLElement).getByRole('button', { name: 'How are the others doing?' });
    fireEvent.click(chip);
    expect(onAsk).toHaveBeenCalledWith('How are the others doing?');
  });
  it('hides the suggestions once a question was asked', () => {
    const turn: ChatTurn = { qid: 'q1', question: 'Hi', askedAt: T0, steps: [], answeredAt: T0, answer: 'Hello.' };
    render(<ChatView {...base} turns={[turn]} live={null} />);
    expect(screen.queryByRole('button', { name: 'How are the others doing?' })).toBeNull();
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

describe('the relay card', () => {
  const relay: ChatRelay = { id: 'a', name: 'Otto', tool: 'claude', text: 'Run the overlay tests' };
  const withRelay = (r: ChatRelay): ChatTurn[] => [{ qid: 'q1', question: 'tell Otto to run the tests', askedAt: T0, steps: [], answer: 'I will pass it on to **Otto**.', answeredAt: T0, relay: r }];
  const otto = fakeSession('a', { name: 'Otto', project: 'ledge', branch: 'feat/x', state: 'idle' });
  const card = () => screen.getByRole('region', { name: 'Instruction to send' });

  it('proposed: the session with its state, the exact instruction, and Send', () => {
    const onRelay = vi.fn();
    render(<ChatView {...base} sessions={[otto]} turns={withRelay(relay)} live={null} onRelay={onRelay} />);
    expect(card()).toHaveTextContent('Otto');
    expect(card()).toHaveTextContent('Claude Code · ledge');
    expect(card()).toHaveTextContent('feat/x');
    expect(card()).toHaveTextContent('your turn');
    expect(card()).toHaveTextContent('Run the overlay tests');
    expect(card()).toHaveTextContent('or rephrase your request');
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    expect(onRelay).toHaveBeenCalledWith('q1');
    expect(screen.queryByRole('region', { name: 'Proposed session' })).toBeNull();
  });

  it.each([
    ['working', 'working'], ['waiting_permission', 'waiting for you'], ['waiting_input', 'waiting for you'], ['exited', 'stopped']
  ] as const)('the pill follows the session: %s', (state, label) => {
    render(<ChatView {...base} sessions={[{ ...otto, state }]} turns={withRelay(relay)} live={null} />);
    expect(card()).toHaveTextContent(label);
  });

  it("a session gone from the snapshot keeps the relay's name and reads stopped", () => {
    render(<ChatView {...base} sessions={[]} turns={withRelay(relay)} live={null} />);
    expect(card()).toHaveTextContent('Otto');
    expect(card()).toHaveTextContent('stopped');
  });

  it('queued: Otto is working, it will go when he is done, with Cancel', () => {
    const onRelayCancel = vi.fn();
    render(<ChatView {...base} sessions={[{ ...otto, state: 'working' }]} turns={withRelay({ ...relay, status: 'queued' })} live={null} onRelayCancel={onRelayCancel} />);
    expect(card()).toHaveTextContent("Otto is working; I'll send it as soon as it's done");
    expect(within(card()).queryByRole('button', { name: /Send/ })).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: 'Cancel' }));
    expect(onRelayCancel).toHaveBeenCalledWith('q1');
  });

  it('sent: the companion, Sent to Otto with the time, the name opens the session', () => {
    const onOpenSession = vi.fn();
    render(<ChatView {...base} sessions={[otto]} turns={withRelay({ ...relay, status: 'sent', sentAt: '2026-10-12T14:32:00.000Z' })} live={null} onOpenSession={onOpenSession} />);
    expect(card()).toHaveTextContent(/Sent to Otto · \d{2}:\d{2}/);
    expect(within(card()).queryByRole('button')).toBeNull();
    fireEvent.click(within(card()).getByRole('link', { name: 'Otto' }));
    expect(onOpenSession).toHaveBeenCalledWith('a');
  });

  it('failed: the reason in an alert, and Retry', () => {
    const onRelay = vi.fn();
    render(<ChatView {...base} sessions={[]} turns={withRelay({ ...relay, error: 'Otto stopped before it got the instruction' })} live={null} onRelay={onRelay} />);
    expect(within(card()).getByRole('alert')).toHaveTextContent('Could not send: Otto stopped before it got the instruction');
    fireEvent.click(within(card()).getByRole('button', { name: 'Retry' }));
    expect(onRelay).toHaveBeenCalledWith('q1');
  });

  it('busy or offline: the buttons are disabled', () => {
    const { rerender } = render(<ChatView {...base} sessions={[otto]} turns={withRelay(relay)} live={null} relayingQid="q1" />);
    expect(within(card()).getByRole('button', { name: /Sending…/ })).toBeDisabled();
    rerender(<ChatView {...base} sessions={[otto]} turns={withRelay(relay)} live={null} offline="Ledge is unreachable" />);
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeDisabled();
  });

  it('a launch in flight on another card disables Send, and a relay in flight disables the launch card', () => {
    const turns: ChatTurn[] = [withRelay(relay)[0]!, { qid: 'q2', question: 'open one', askedAt: T0, steps: [], answer: 'Here.', answeredAt: T0, proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix' } }];
    const { rerender } = render(<ChatView {...base} sessions={[otto]} turns={turns} live={null} launchingQid="q2" />);
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeDisabled();
    rerender(<ChatView {...base} sessions={[otto]} turns={turns} live={null} relayingQid="q1" />);
    expect(within(screen.getByRole('region', { name: 'Proposed session' })).getByRole('button', { name: /Start the session/ })).toBeDisabled();
  });

  it('a relay block being streamed is held back', () => {
    render(<ChatView {...base} sessions={[otto]} turns={[{ qid: 'q1', question: 'x', askedAt: T0, steps: [] }]} live={{ qid: 'q1', text: 'I will pass it on.\n```ledge-relay\n{"session": "a", "te' }} />);
    expect(screen.getByText('I will pass it on.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('ledge-relay');
  });
});
