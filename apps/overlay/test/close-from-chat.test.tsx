import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ChatClose, ChatTurn, ClientMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';
import { answerSay } from './ledgeSay';

const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

let sent: ClientMessage[];
const client = (): DaemonClient => ({ connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} });
const apply = (m: Parameters<typeof daemonStore.apply>[0]) => act(() => { daemonStore.apply(m); });
const mode = () => document.querySelector('[data-surface]')!.getAttribute('data-mode');
const closes: ChatClose[] = [{ id: 'a', name: 'Otto', tool: 'claude' }, { id: 'b', name: 'Pim', tool: 'claude' }];
const sentCloses = () => sent.filter(m => m.type === 'session.close');

/** Opens the chat, asks Ledge, and answers the turn with two sessions to close: the chat shows its card. */
function askAndClose(): { qid: string; turn: (c: ChatClose[]) => ChatTurn } {
  render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a', { name: 'Otto', state: 'idle' }), fakeSession('b', { name: 'Pim', state: 'idle' })] }); });
  act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
  const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.change(input, { target: { value: 'close Otto and Pim' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const at = new Date().toISOString();
  const ask = answerSay(sent, { answer: 'I would close these two.', closes });
  return { qid: ask.qid, turn: c => ({ qid: ask.qid, question: ask.text, askedAt: at, steps: [], answer: 'I would close these two.', answeredAt: at, closes: c }) };
}
const card = () => screen.getByRole('region', { name: '2 sessions to close' });
const all = () => within(card()).getByRole('button', { name: /Close all|Closing…/ });
const closedAt = new Date().toISOString();

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('closing from a chat card', () => {
  it('sends session.close with the open rows and holds the card', () => {
    const { qid } = askAndClose();
    fireEvent.click(within(card()).getByRole('button', { name: /Close all \(2\)/ }));
    expect(sentCloses()).toEqual([{ type: 'session.close', qid, rows: [0, 1] }]);
    expect(within(card()).getAllByRole('button', { name: 'Closing…' })).toHaveLength(2);
    fireEvent.click(within(card()).getAllByRole('button', { name: 'Closing…' })[0]!);
    expect(sentCloses()).toHaveLength(1);
    apply({ type: 'session.closed', qid, row: 0, id: 'a', how: 'exit' });
    expect(mode()).toBe('chat');
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
  });

  it('sends only the rows still open: not the closed ones, nor a session that has exited', () => {
    const { qid, turn } = askAndClose();
    apply({ type: 'session.updated', session: fakeSession('b', { name: 'Pim', state: 'exited' }) });
    fireEvent.click(within(card()).getByRole('button', { name: 'Close' }));
    expect(sentCloses()).toEqual([{ type: 'session.close', qid, rows: [0] }]);
    apply({ type: 'chat.history', turns: [turn([{ ...closes[0]!, closedAt, how: 'exit' }, closes[1]!])] });
    expect(sentCloses()).toHaveLength(1);
  });

  it('frees it when every sent row is marked', () => {
    const { turn } = askAndClose();
    fireEvent.click(within(card()).getByRole('button', { name: /Close all/ }));
    apply({ type: 'chat.history', turns: [turn([{ ...closes[0]!, closedAt, how: 'exit' }, closes[1]!])] });
    expect(within(card()).getAllByRole('button', { name: 'Closing…' })).toHaveLength(1);
    apply({ type: 'chat.history', turns: [turn([{ ...closes[0]!, closedAt, how: 'exit' }, { ...closes[1]!, closedAt, how: 'killed' }])] });
    expect(within(card()).queryByRole('button', { name: 'Closing…' })).toBeNull();
    expect(within(card()).getByText('Closed')).toBeInTheDocument();
    expect(within(card()).getByText('Force closed')).toBeInTheDocument();
  });

  it('frees it when a row fails anew, even with the message it had before', () => {
    const { turn } = askAndClose();
    apply({ type: 'chat.history', turns: [turn([{ ...closes[0]!, error: 'busy' }, closes[1]!])] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Retry' }));
    expect(within(card()).getAllByRole('button', { name: 'Closing…' })).toHaveLength(1);
    apply({ type: 'chat.history', turns: [turn([{ ...closes[0]!, error: 'still busy' }, closes[1]!])] });
    expect(within(card()).queryByRole('button', { name: 'Closing…' })).toBeNull();
  });

  it('frees it on a session.close error and when the daemon is unreachable', () => {
    askAndClose();
    fireEvent.click(all());
    apply({ type: 'error', message: 'unknown turn', request: 'session.close' });
    expect(within(card()).getByRole('button', { name: /Close all/ })).toBeEnabled();
    fireEvent.click(all());
    act(() => { daemonStore.setStatus('unreachable'); });
    expect(within(card()).queryByRole('button', { name: 'Closing…' })).toBeNull();
    act(() => { daemonStore.setStatus('open'); });
    expect(within(card()).getByRole('button', { name: /Close all/ })).toBeEnabled();
  });

  /** A second turn of the same thread proposes a session: its card sits next to the close card. */
  const withLaunchCard = () => {
    const { turn } = askAndClose();
    const at = new Date().toISOString();
    apply({ type: 'chat.history', turns: [turn(closes), { qid: 'q2', question: 'open one', askedAt: at, steps: [], answer: 'Here it is.', answeredAt: at, proposal: { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the build' } }] });
    apply({ type: 'ledge.thread.item', item: { kind: 'ledge', id: 'l-q2', at, text: 'Here it is.', qid: 'q2' } });
  };
  it('does nothing while a launch is in flight', () => {
    withLaunchCard();
    fireEvent.click(screen.getByRole('button', { name: /Start the session/ }));
    expect(sent.filter(m => m.type === 'session.launch')).toHaveLength(1);
    fireEvent.click(within(card()).getByRole('button', { name: /Close all/ }));
    expect(sentCloses()).toEqual([]);
  });
  it('a launch does nothing while the card closes', () => {
    withLaunchCard();
    fireEvent.click(within(card()).getByRole('button', { name: /Close all/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start the session/ }));
    expect(sentCloses()).toHaveLength(1);
    expect(sent.filter(m => m.type === 'session.launch')).toEqual([]);
  });
});
