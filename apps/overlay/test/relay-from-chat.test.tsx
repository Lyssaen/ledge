import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ChatRelay, ChatTurn, ClientMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

let sent: ClientMessage[];
const client = (): DaemonClient => ({ connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} });
const apply = (m: Parameters<typeof daemonStore.apply>[0]) => act(() => { daemonStore.apply(m); });
const mode = () => document.querySelector('[data-surface]')!.getAttribute('data-mode');
const relay: ChatRelay = { id: 'a', name: 'Otto', tool: 'claude', text: 'Run the overlay tests' };
const relays = () => sent.filter(m => m.type === 'session.relay' || m.type === 'session.relay.cancel');

/** Opens the list, asks Ledge, and answers the turn with a relay: the chat shows its card. */
function askAndRelay(): { qid: string; turn: (r: ChatRelay) => ChatTurn } {
  render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a', { name: 'Otto', state: 'working' })] }); });
  act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
  act(() => { vi.advanceTimersByTime(400); });
  fireEvent.click(screen.getByRole('button', { name: 'Open the conversation with Ledge' }));
  const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.change(input, { target: { value: 'tell Otto to run the overlay tests' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const ask = sent.find(m => m.type === 'chat.ask') as Extract<ClientMessage, { type: 'chat.ask' }>;
  const at = new Date().toISOString();
  apply({ type: 'chat.done', qid: ask.qid, text: 'I will pass it on to Otto.', at, relay });
  return { qid: ask.qid, turn: r => ({ qid: ask.qid, question: ask.text, askedAt: at, steps: [], answer: 'I will pass it on to Otto.', answeredAt: at, relay: r }) };
}
const card = () => screen.getByRole('region', { name: 'Instruction to send' });

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('relaying from a chat card', () => {
  it('Send sends the qid once, stays in the chat; the queued card cancels with its qid', () => {
    const { qid, turn } = askAndRelay();
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    expect(within(card()).getByRole('button', { name: /Sending…/ })).toBeDisabled();
    fireEvent.click(within(card()).getByRole('button', { name: /Sending…/ }));
    expect(relays()).toEqual([{ type: 'session.relay', qid }]);
    apply({ type: 'chat.history', turns: [turn({ ...relay, status: 'queued' })] });
    expect(mode()).toBe('chat');
    fireEvent.click(within(card()).getByRole('button', { name: 'Cancel' }));
    expect(relays()).toEqual([{ type: 'session.relay', qid }, { type: 'session.relay.cancel', qid }]);
  });

  it('a refusal with the same message as before frees Retry', () => {
    const { qid, turn } = askAndRelay();
    apply({ type: 'chat.history', turns: [turn({ ...relay, error: 'the agent did not take the answer' })] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Retry' }));
    expect(within(card()).getByRole('button', { name: /Sending…/ })).toBeDisabled();
    apply({ type: 'error', message: 'the agent did not take the answer' });
    expect(within(card()).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(relays()).toEqual([{ type: 'session.relay', qid }]);
  });

  it('a lost connection frees the button; offline keeps it disabled', () => {
    askAndRelay();
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    act(() => { daemonStore.setStatus('unreachable'); });
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeDisabled();
    act(() => { daemonStore.setStatus('open'); });
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeEnabled();
  });

  it('never in flight together with a launch: an id-less error frees only the one that asked', () => {
    askAndRelay();
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    // The + form refuses to launch while a relay is in flight, so the next error can only be the relay's.
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, altKey: true });
    expect(sent.filter(m => m.type === 'session.launch')).toEqual([]);
  });
});
